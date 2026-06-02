-- Migration 04 — Distribution du pot aux gagnants à la clôture

ALTER TABLE public.markets
  ADD COLUMN IF NOT EXISTS payouts_distributed BOOLEAN NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION public.distribute_market_payouts(
  p_market_id UUID,
  p_outcome TEXT
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  total_pot INTEGER;
  winning_pool INTEGER;
  paid_total INTEGER := 0;
  remainder INTEGER;
  r RECORD;
  payout INTEGER;
BEGIN
  IF p_outcome NOT IN ('YES', 'NO') THEN
    RAISE EXCEPTION 'Outcome must be YES or NO';
  END IF;

  SELECT COALESCE(SUM(amount_points), 0)::INTEGER
  INTO total_pot
  FROM public.bets
  WHERE market_id = p_market_id
    AND amount_points IS NOT NULL
    AND amount_points > 0;

  IF total_pot <= 0 THEN
    RETURN;
  END IF;

  SELECT COALESCE(SUM(amount_points), 0)::INTEGER
  INTO winning_pool
  FROM public.bets
  WHERE market_id = p_market_id
    AND side = p_outcome
    AND amount_points IS NOT NULL
    AND amount_points > 0;

  IF winning_pool <= 0 THEN
    RETURN;
  END IF;

  FOR r IN
    SELECT wallet, SUM(amount_points)::INTEGER AS stake
    FROM public.bets
    WHERE market_id = p_market_id
      AND side = p_outcome
      AND amount_points IS NOT NULL
      AND amount_points > 0
    GROUP BY wallet
    ORDER BY SUM(amount_points) DESC, wallet
  LOOP
    payout := FLOOR((total_pot::NUMERIC * r.stake) / winning_pool)::INTEGER;

    IF payout > 0 THEN
      PERFORM public.ensure_user(r.wallet);
      UPDATE public.users SET points = points + payout WHERE wallet = r.wallet;
      paid_total := paid_total + payout;
    END IF;
  END LOOP;

  remainder := total_pot - paid_total;

  IF remainder > 0 THEN
    FOR r IN
      SELECT wallet
      FROM public.bets
      WHERE market_id = p_market_id
        AND side = p_outcome
        AND amount_points IS NOT NULL
        AND amount_points > 0
      GROUP BY wallet
      ORDER BY SUM(amount_points) DESC, wallet
      LIMIT 1
    LOOP
      PERFORM public.ensure_user(r.wallet);
      UPDATE public.users SET points = points + remainder WHERE wallet = r.wallet;
    END LOOP;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.settle_crypto_market(
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
  market_outcome TEXT;
BEGIN
  UPDATE public.markets
  SET
    resolved = true,
    settlement_price = p_settlement_price,
    outcome = CASE
      WHEN condition = 'above' AND p_settlement_price > price_target THEN 'YES'
      WHEN condition = 'below' AND p_settlement_price < price_target THEN 'YES'
      ELSE 'NO'
    END
  WHERE id = p_market_id
    AND resolved = false
    AND payouts_distributed = false
    AND closes_at <= now()
    AND asset IN ('BTC', 'ETH', 'SOL')
    AND condition IN ('above', 'below')
    AND price_target IS NOT NULL
    AND p_settlement_price > 0
  RETURNING * INTO settled_market;

  IF settled_market.id IS NULL THEN
    RAISE EXCEPTION 'Market is not ready for settlement';
  END IF;

  market_outcome := settled_market.outcome;
  PERFORM public.distribute_market_payouts(p_market_id, market_outcome);

  UPDATE public.markets SET payouts_distributed = true WHERE id = p_market_id;

  SELECT * INTO settled_market FROM public.markets WHERE id = p_market_id;
  RETURN settled_market;
END;
$$;

DO $$
DECLARE m RECORD;
BEGIN
  FOR m IN
    SELECT id, outcome
    FROM public.markets
    WHERE resolved = true
      AND payouts_distributed = false
      AND outcome IN ('YES', 'NO')
  LOOP
    PERFORM public.distribute_market_payouts(m.id, m.outcome);
    UPDATE public.markets SET payouts_distributed = true WHERE id = m.id;
  END LOOP;
END;
$$;

GRANT EXECUTE ON FUNCTION public.distribute_market_payouts(UUID, TEXT) TO anon, authenticated;

NOTIFY pgrst, 'reload schema';
