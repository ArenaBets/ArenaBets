-- Migration 02 — Marchés crypto structurés + règlement initial

ALTER TABLE public.markets
  ADD COLUMN IF NOT EXISTS asset TEXT,
  ADD COLUMN IF NOT EXISTS condition TEXT,
  ADD COLUMN IF NOT EXISTS price_target NUMERIC,
  ADD COLUMN IF NOT EXISTS duration_hours INTEGER,
  ADD COLUMN IF NOT EXISTS settlement_price NUMERIC;

ALTER TABLE public.markets DROP CONSTRAINT IF EXISTS markets_asset_check;
ALTER TABLE public.markets DROP CONSTRAINT IF EXISTS markets_condition_check;
ALTER TABLE public.markets DROP CONSTRAINT IF EXISTS markets_price_target_check;
ALTER TABLE public.markets DROP CONSTRAINT IF EXISTS markets_duration_hours_check;

-- Contrainte asset retirée pour permettre les KOLs et futurs assets
-- ALTER TABLE public.markets
--   ADD CONSTRAINT markets_asset_check CHECK (asset IS NULL OR asset IN ('BTC', 'ETH', 'SOL', 'BNB', 'XRP', 'DOGE', 'TRX', 'ZCASH', 'SHIB', 'LTC'));

ALTER TABLE public.markets
  ADD CONSTRAINT markets_condition_check CHECK (condition IS NULL OR condition IN ('above', 'below')),
  ADD CONSTRAINT markets_price_target_check CHECK (price_target IS NULL OR price_target > 0),
  ADD CONSTRAINT markets_duration_hours_check CHECK (duration_hours IS NULL OR duration_hours IN (5, 15, 60, 360, 1440));

DROP POLICY IF EXISTS "anyone can create markets" ON public.markets;
DROP POLICY IF EXISTS "anyone can create structured crypto markets" ON public.markets;
DROP POLICY IF EXISTS "anyone can create kol markets" ON public.markets;

CREATE POLICY "anyone can create structured crypto markets"
ON public.markets
FOR INSERT
WITH CHECK (
  asset IN ('BTC', 'ETH', 'SOL', 'BNB', 'XRP', 'DOGE', 'TRX', 'ZCASH', 'SHIB', 'LTC')
  AND condition IN ('above', 'below')
  AND price_target > 0
  AND duration_hours IN (5, 15, 60, 360, 1440)
  AND closes_at IS NOT NULL
  AND resolved = false
  AND outcome IS NULL
  AND settlement_price IS NULL
);

CREATE POLICY "anyone can create kol markets"
ON public.markets
FOR INSERT
WITH CHECK (
  tag = 'KOL'
  AND question IS NOT NULL
  AND resolved = false
  AND outcome IS NULL
  AND settlement_price IS NULL
);

-- Version sans payout (remplacée par 04_market_payouts.sql sur bases existantes)
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
    AND closes_at <= now()
    AND asset IN ('BTC', 'ETH', 'SOL')
    AND condition IN ('above', 'below')
    AND price_target IS NOT NULL
    AND p_settlement_price > 0
  RETURNING * INTO settled_market;

  IF settled_market.id IS NULL THEN
    RAISE EXCEPTION 'Market is not ready for settlement';
  END IF;

  RETURN settled_market;
END;
$$;

GRANT EXECUTE ON FUNCTION public.settle_crypto_market(UUID, NUMERIC) TO anon, authenticated;
