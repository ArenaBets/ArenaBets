-- Migration 08 — Snapshots pour marchés fermés (mode archive)
-- Objectif: désactiver live/websockets/recalculs sur les marchés terminés

ALTER TABLE public.markets
  ADD COLUMN IF NOT EXISTS snapshot JSONB,
  ADD COLUMN IF NOT EXISTS closed_at TIMESTAMPTZ;

-- Index pour filtrer rapidement marchés avec/sans snapshot
CREATE INDEX IF NOT EXISTS markets_snapshot_idx ON public.markets(snapshot) WHERE snapshot IS NOT NULL;
CREATE INDEX IF NOT EXISTS markets_resolved_idx ON public.markets(resolved, closed_at);

-- Fonction: générer le snapshot au moment du settlement
CREATE OR REPLACE FUNCTION public.generate_market_snapshot(p_market_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  m RECORD;
  bets_data JSONB;
  yes_total NUMERIC;
  no_total NUMERIC;
  total_volume NUMERIC;
  trade_count INTEGER;
BEGIN
  -- Récupérer le marché
  SELECT * INTO m FROM public.markets WHERE id = p_market_id;
  IF m.id IS NULL THEN
    RETURN NULL;
  END IF;

  -- Calculer les stats
  SELECT
    COALESCE(SUM(CASE WHEN side = 'YES' THEN amount_sol ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN side = 'NO' THEN amount_sol ELSE 0 END), 0),
    COALESCE(SUM(amount_sol), 0),
    COUNT(*)
  INTO yes_total, no_total, total_volume, trade_count
  FROM public.bets
  WHERE market_id = p_market_id;

  -- Récupérer les trades (limité à 100 pour éviter les gros JSON)
  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'wallet', wallet,
      'side', side,
      'amount_sol', amount_sol,
      'created_at', created_at
    ) ORDER BY created_at DESC
  ), '[]'::jsonb)
  INTO bets_data
  FROM (
    SELECT wallet, side, amount_sol, created_at
    FROM public.bets
    WHERE market_id = p_market_id
    ORDER BY created_at DESC
    LIMIT 100
  ) sub;

  -- Calculer prix YES/NO (proportion du pool)
  RETURN jsonb_build_object(
    'result', m.outcome,
    'settlement_price', m.settlement_price,
    'volume', total_volume,
    'tradeCount', trade_count,
    'yesTotal', yes_total,
    'noTotal', no_total,
    'yesPrice', CASE WHEN (yes_total + no_total) > 0 THEN yes_total / (yes_total + no_total) ELSE 0.5 END,
    'noPrice', CASE WHEN (yes_total + no_total) > 0 THEN no_total / (yes_total + no_total) ELSE 0.5 END,
    'trades', bets_data,
    'closedAt', COALESCE(m.closed_at, m.closes_at, NOW())
  );
END;
$$;

-- Fonction: settle + snapshot en une transaction
CREATE OR REPLACE FUNCTION public.settle_market_with_snapshot(
  p_market_id UUID,
  p_settlement_price NUMERIC
)
RETURNS public.markets
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  settled_market public.markets;
BEGIN
  -- Mettre à jour le marché
  UPDATE public.markets
  SET
    resolved = true,
    settlement_price = p_settlement_price,
    outcome = CASE
      WHEN condition = 'above' AND p_settlement_price > price_target THEN 'YES'
      WHEN condition = 'below' AND p_settlement_price < price_target THEN 'YES'
      ELSE 'NO'
    END,
    closed_at = NOW()
  WHERE id = p_market_id
    AND resolved = false
  RETURNING * INTO settled_market;

  IF settled_market.id IS NULL THEN
    RETURN NULL;
  END IF;

  -- Générer et sauvegarder le snapshot
  UPDATE public.markets
  SET snapshot = public.generate_market_snapshot(p_market_id)
  WHERE id = p_market_id;

  RETURN settled_market;
END;
$$;

GRANT EXECUTE ON FUNCTION public.generate_market_snapshot(UUID) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.settle_market_with_snapshot(UUID, NUMERIC) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
