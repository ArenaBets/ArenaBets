-- Migration 13 — Hard delete pour les marchés (admin uniquement)
-- Supprime définitivement un marché et ses paris associés (CASCADE sur bets)

CREATE OR REPLACE FUNCTION public.hard_delete_market(p_market_id UUID)
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

  PERFORM public.log_admin_action('HARD_DELETE', p_market_id, v_wallet);

  DELETE FROM public.markets WHERE id = p_market_id;

  RETURN FOUND;
END;
$$;

GRANT EXECUTE ON FUNCTION public.hard_delete_market(UUID) TO authenticated;

NOTIFY pgrst, 'reload schema';
