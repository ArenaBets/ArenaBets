-- Expand supported crypto assets for markets and settlement.

ALTER TABLE public.markets DROP CONSTRAINT IF EXISTS markets_asset_check;

ALTER TABLE public.markets
  ADD CONSTRAINT markets_asset_check CHECK (
    asset IS NULL
    OR asset IN (
      'BTC', 'ETH', 'SOL', 'BNB', 'DOGE', 'ZCASH', 'SHIB', 'TROLL', 'TRX', 'XRP'
    )
  );

DROP POLICY IF EXISTS "anyone can create structured crypto markets" ON public.markets;

CREATE POLICY "anyone can create structured crypto markets"
ON public.markets
FOR INSERT
WITH CHECK (
  asset IN ('BTC', 'ETH', 'SOL', 'BNB', 'DOGE', 'ZCASH', 'SHIB', 'TROLL', 'TRX', 'XRP')
  AND condition IN ('above', 'below')
  AND price_target > 0
  AND duration_hours IN (5, 15, 60, 360, 1440)
  AND closes_at IS NOT NULL
  AND resolved = false
  AND outcome IS NULL
  AND settlement_price IS NULL
);

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
    AND asset IN ('BTC', 'ETH', 'SOL', 'BNB', 'DOGE', 'ZCASH', 'SHIB', 'TROLL', 'TRX', 'XRP')
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

NOTIFY pgrst, 'reload schema';
