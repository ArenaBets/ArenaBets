-- Migration 10 — Soft delete pour les marchés + interface admin

ALTER TABLE public.markets
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ;

-- Index rapide pour filtrer les marchés actifs
CREATE INDEX IF NOT EXISTS markets_deleted_idx ON public.markets(deleted_at) WHERE deleted_at IS NULL;

-- Table: lier un compte auth à un wallet admin
CREATE TABLE IF NOT EXISTS public.admin_wallets (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id),
  wallet TEXT NOT NULL
);

ALTER TABLE public.admin_wallets ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "deny_all_admin_wallets" ON public.admin_wallets;
CREATE POLICY "deny_all_admin_wallets" ON public.admin_wallets FOR ALL USING (false);

-- Fonction: lier son wallet à son compte admin
CREATE OR REPLACE FUNCTION public.link_admin_wallet(p_wallet TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_admin_wallet TEXT := 'Gdzrt6oqrPQNNUSbbfBuiRMxMbTQpo6oQfjmwmW5xtby';
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF p_wallet != v_admin_wallet THEN
    RAISE EXCEPTION 'Invalid admin wallet';
  END IF;

  INSERT INTO public.admin_wallets (user_id, wallet)
  VALUES (v_user_id, p_wallet)
  ON CONFLICT (user_id) DO UPDATE SET wallet = p_wallet;

  RETURN true;
END;
$$;

GRANT EXECUTE ON FUNCTION public.link_admin_wallet(TEXT) TO authenticated;

-- Fonction: soft delete un marché (admin uniquement)
CREATE OR REPLACE FUNCTION public.soft_delete_market(p_market_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_admin_wallet TEXT := 'Gdzrt6oqrPQNNUSbbfBuiRMxMbTQpo6oQfjmwmW5xtby';
  v_user_id UUID := auth.uid();
  v_wallet TEXT;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  SELECT wallet INTO v_wallet FROM public.admin_wallets WHERE user_id = v_user_id;

  IF v_wallet IS NULL OR v_wallet != v_admin_wallet THEN
    RAISE EXCEPTION 'Access denied: admin wallet not linked';
  END IF;

  PERFORM public.check_admin_rate_limit(v_user_id::text, 10);

  PERFORM public.log_admin_action('SOFT_DELETE', p_market_id, v_wallet);

  UPDATE public.markets
  SET deleted_at = NOW()
  WHERE id = p_market_id
    AND deleted_at IS NULL;

  RETURN FOUND;
END;
$$;

-- Fonction: restaurer un marché supprimé (admin uniquement)
CREATE OR REPLACE FUNCTION public.restore_market(p_market_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_admin_wallet TEXT := 'Gdzrt6oqrPQNNUSbbfBuiRMxMbTQpo6oQfjmwmW5xtby';
  v_user_id UUID := auth.uid();
  v_wallet TEXT;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  SELECT wallet INTO v_wallet FROM public.admin_wallets WHERE user_id = v_user_id;

  IF v_wallet IS NULL OR v_wallet != v_admin_wallet THEN
    RAISE EXCEPTION 'Access denied: admin wallet not linked';
  END IF;

  PERFORM public.check_admin_rate_limit(v_user_id::text, 10);

  PERFORM public.log_admin_action('RESTORE', p_market_id, v_wallet);

  UPDATE public.markets
  SET deleted_at = NULL
  WHERE id = p_market_id
    AND deleted_at IS NOT NULL;

  RETURN FOUND;
END;
$$;

-- Supprimer l'ancienne policy si elle existe (ne permettait qu'au créateur de modifier)
DROP POLICY IF EXISTS "creator_can_soft_delete" ON public.markets;

-- Policy: interdit tout UPDATE direct sur les marchés (seules les fonctions RPC admin peuvent modifier)
-- Par défaut, aucune policy UPDATE = personne ne peut modifier directement

-- Table de rate limiting pour l'admin
CREATE TABLE IF NOT EXISTS public.admin_rate_limit (
  wallet TEXT PRIMARY KEY,
  action_count INT NOT NULL DEFAULT 1,
  window_start TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Bloquer tout accès direct à la table (seules les fonctions SECURITY DEFINER peuvent y accéder)
ALTER TABLE public.admin_rate_limit ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "deny_all" ON public.admin_rate_limit;
CREATE POLICY "deny_all" ON public.admin_rate_limit
  FOR ALL USING (false);

-- Fonction helper: vérifier le rate limit (max 10 actions/minute)
CREATE OR REPLACE FUNCTION public.check_admin_rate_limit(p_wallet TEXT, p_max_requests INT DEFAULT 10)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_window TIMESTAMPTZ;
  v_count INT;
BEGIN
  SELECT window_start, action_count
  INTO v_window, v_count
  FROM public.admin_rate_limit
  WHERE wallet = p_wallet;

  IF v_window IS NULL THEN
    -- Premier appel: créer l'entrée
    INSERT INTO public.admin_rate_limit (wallet, action_count, window_start)
    VALUES (p_wallet, 1, NOW());
  ELSIF NOW() - v_window > INTERVAL '1 minute' THEN
    -- Fenêtre expirée: réinitialiser
    UPDATE public.admin_rate_limit
    SET action_count = 1, window_start = NOW()
    WHERE wallet = p_wallet;
  ELSIF v_count >= p_max_requests THEN
    -- Rate limit atteint
    RAISE EXCEPTION 'Rate limit exceeded: max % requests per minute', p_max_requests;
  ELSE
    -- Incrémenter le compteur
    UPDATE public.admin_rate_limit
    SET action_count = action_count + 1
    WHERE wallet = p_wallet;
  END IF;
END;
$$;

-- Table audit log pour tracer toutes les actions admin
CREATE TABLE IF NOT EXISTS public.admin_audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  action TEXT NOT NULL, -- 'SOFT_DELETE', 'RESTORE', etc.
  market_id UUID NOT NULL,
  wallet TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.admin_audit_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "deny_all_audit" ON public.admin_audit_log;
CREATE POLICY "deny_all_audit" ON public.admin_audit_log
  FOR ALL USING (false);

-- Fonction helper: insérer un log d'audit
CREATE OR REPLACE FUNCTION public.log_admin_action(p_action TEXT, p_market_id UUID, p_wallet TEXT)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.admin_audit_log (action, market_id, wallet)
  VALUES (p_action, p_market_id, p_wallet);
END;
$$;

GRANT EXECUTE ON FUNCTION public.link_admin_wallet(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.soft_delete_market(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.restore_market(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.check_admin_rate_limit(TEXT, INT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.log_admin_action(TEXT, UUID, TEXT) TO authenticated;

NOTIFY pgrst, 'reload schema';
