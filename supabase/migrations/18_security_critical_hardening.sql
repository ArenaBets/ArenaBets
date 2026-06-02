-- Migration 18 — Critical financial security hardening
-- Additive / backward-compatible:
-- - preserves public reads and existing rows
-- - routes new SOL bet writes through a SECURITY DEFINER RPC
-- - restricts privileged settlement/admin/oracle RPCs to service_role

ALTER TABLE public.bets
  ADD COLUMN IF NOT EXISTS valid_onchain BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS verified_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS verification_reason TEXT;

ALTER TABLE public.kol_hourly_snapshots
  ADD COLUMN IF NOT EXISTS verified_source TEXT,
  ADD COLUMN IF NOT EXISTS signature_hash TEXT,
  ADD COLUMN IF NOT EXISTS ingested_by TEXT;

-- Safe uniqueness: direct historical duplicates can exist. New secure writes are
-- blocked by place_sol_bet_secure(), and verified payout-eligible rows cannot
-- share a tx signature.
CREATE UNIQUE INDEX IF NOT EXISTS bets_verified_tx_signature_unique
  ON public.bets (tx_signature)
  WHERE tx_signature IS NOT NULL AND valid_onchain = TRUE;

CREATE INDEX IF NOT EXISTS bets_market_valid_onchain_idx
  ON public.bets (market_id, valid_onchain)
  WHERE amount_sol IS NOT NULL AND amount_sol > 0;

DROP POLICY IF EXISTS "anyone can insert bets" ON public.bets;
DROP POLICY IF EXISTS "auto-settle can record payouts" ON public.bets;

CREATE OR REPLACE FUNCTION public.place_sol_bet_secure(
  p_market_id UUID,
  p_wallet TEXT,
  p_side TEXT,
  p_amount_sol NUMERIC,
  p_tx_signature TEXT
)
RETURNS public.bets
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  placed_bet public.bets;
BEGIN
  IF p_wallet IS NULL OR length(trim(p_wallet)) < 32 OR length(trim(p_wallet)) > 64 THEN
    RAISE EXCEPTION 'Wallet is invalid';
  END IF;

  IF p_side NOT IN ('YES', 'NO') THEN
    RAISE EXCEPTION 'Side must be YES or NO';
  END IF;

  IF p_amount_sol IS NULL OR p_amount_sol <= 0 THEN
    RAISE EXCEPTION 'SOL amount must be greater than 0';
  END IF;

  IF p_tx_signature IS NULL OR length(trim(p_tx_signature)) < 40 OR length(trim(p_tx_signature)) > 128 THEN
    RAISE EXCEPTION 'Transaction signature is invalid';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.bets
    WHERE tx_signature = p_tx_signature
    FOR UPDATE
  ) THEN
    RAISE EXCEPTION 'Transaction already used';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.markets
    WHERE id = p_market_id
      AND resolved = FALSE
      AND (deleted_at IS NULL)
      AND (closes_at IS NULL OR closes_at > now())
    FOR SHARE
  ) THEN
    RAISE EXCEPTION 'Market is closed';
  END IF;

  INSERT INTO public.bets (
    market_id,
    wallet,
    side,
    amount_sol,
    tx_signature,
    valid_onchain,
    verification_reason
  )
  VALUES (
    p_market_id,
    trim(p_wallet),
    p_side,
    p_amount_sol,
    trim(p_tx_signature),
    FALSE,
    'pending_worker_verification'
  )
  RETURNING * INTO placed_bet;

  RETURN placed_bet;
END;
$$;

CREATE OR REPLACE FUNCTION public.settle_market(
  p_market_id UUID,
  p_outcome TEXT,
  p_settlement_price NUMERIC
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  updated_count INTEGER;
BEGIN
  IF p_outcome NOT IN ('YES', 'NO') THEN
    RAISE EXCEPTION 'Outcome must be YES or NO';
  END IF;

  IF p_settlement_price IS NULL THEN
    RAISE EXCEPTION 'Settlement price is required';
  END IF;

  UPDATE public.markets
  SET
    resolved = TRUE,
    outcome = p_outcome,
    settlement_price = p_settlement_price,
    closed_at = NOW()
  WHERE id = p_market_id
    AND resolved = FALSE
    AND (deleted_at IS NULL)
    AND closes_at IS NOT NULL
    AND closes_at <= NOW();

  GET DIAGNOSTICS updated_count = ROW_COUNT;
  IF updated_count <> 1 THEN
    RAISE EXCEPTION 'Market is not ready for settlement';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.record_payout(
  p_bet_id UUID,
  p_payout_tx TEXT,
  p_payout_amount NUMERIC
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  updated_count INTEGER;
BEGIN
  IF p_payout_tx IS NULL OR length(trim(p_payout_tx)) < 40 THEN
    RAISE EXCEPTION 'Payout transaction is invalid';
  END IF;

  IF p_payout_amount IS NULL OR p_payout_amount <= 0 THEN
    RAISE EXCEPTION 'Payout amount must be greater than 0';
  END IF;

  UPDATE public.bets
  SET
    payout_tx = trim(p_payout_tx),
    payout_amount = p_payout_amount
  WHERE id = p_bet_id
    AND valid_onchain = TRUE
    AND (
      payout_tx IS NULL
      OR payout_tx LIKE 'pending_%'
    );

  GET DIAGNOSTICS updated_count = ROW_COUNT;
  IF updated_count <> 1 THEN
    RAISE EXCEPTION 'Bet is not payable';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.save_kol_snapshot(
  p_wallet TEXT,
  p_balance_sol NUMERIC,
  p_pnl_sol NUMERIC,
  p_pnl_percent NUMERIC,
  p_total_trades INTEGER,
  p_sells INTEGER,
  p_buys INTEGER,
  p_snapshot_hour TIMESTAMPTZ
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.kol_wallets WHERE wallet = p_wallet) THEN
    RAISE EXCEPTION 'Unknown KOL wallet';
  END IF;

  IF p_snapshot_hour IS NULL
     OR p_snapshot_hour > date_trunc('hour', now()) + INTERVAL '5 minutes'
     OR p_snapshot_hour < now() - INTERVAL '30 days' THEN
    RAISE EXCEPTION 'Snapshot hour out of allowed range';
  END IF;

  INSERT INTO public.kol_hourly_snapshots (
    wallet, balance_sol, pnl_sol, pnl_percent,
    total_trades, sells, buys, snapshot_hour,
    verified_source, ingested_by
  )
  VALUES (
    p_wallet, p_balance_sol, p_pnl_sol, p_pnl_percent,
    p_total_trades, p_sells, p_buys, date_trunc('hour', p_snapshot_hour),
    'gmgn-proxy', 'service_role'
  )
  ON CONFLICT (wallet, snapshot_hour) DO UPDATE SET
    balance_sol = EXCLUDED.balance_sol,
    pnl_sol = EXCLUDED.pnl_sol,
    pnl_percent = EXCLUDED.pnl_percent,
    total_trades = EXCLUDED.total_trades,
    sells = EXCLUDED.sells,
    buys = EXCLUDED.buys,
    verified_source = EXCLUDED.verified_source,
    ingested_by = EXCLUDED.ingested_by;
END;
$$;

-- Public-compatible bet entrypoint. Privileged operations are service-only.
GRANT EXECUTE ON FUNCTION public.place_sol_bet_secure(UUID, TEXT, TEXT, NUMERIC, TEXT)
  TO anon, authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.settle_market(UUID, TEXT, NUMERIC)
  FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.record_payout(UUID, TEXT, NUMERIC)
  FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.settle_market_with_snapshot(UUID, NUMERIC)
  FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.settle_crypto_market(UUID, NUMERIC)
  FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.distribute_market_payouts(UUID, TEXT)
  FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.save_kol_snapshot(TEXT, NUMERIC, NUMERIC, NUMERIC, INTEGER, INTEGER, INTEGER, TIMESTAMPTZ)
  FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.link_admin_wallet(TEXT)
  FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.check_admin_rate_limit(TEXT, INT)
  FROM anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.log_admin_action(TEXT, UUID, TEXT)
  FROM anon, authenticated;

GRANT EXECUTE ON FUNCTION public.settle_market(UUID, TEXT, NUMERIC) TO service_role;
GRANT EXECUTE ON FUNCTION public.record_payout(UUID, TEXT, NUMERIC) TO service_role;
GRANT EXECUTE ON FUNCTION public.settle_market_with_snapshot(UUID, NUMERIC) TO service_role;
GRANT EXECUTE ON FUNCTION public.settle_crypto_market(UUID, NUMERIC) TO service_role;
GRANT EXECUTE ON FUNCTION public.distribute_market_payouts(UUID, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.save_kol_snapshot(TEXT, NUMERIC, NUMERIC, NUMERIC, INTEGER, INTEGER, INTEGER, TIMESTAMPTZ) TO service_role;

NOTIFY pgrst, 'reload schema';
