BEGIN;

CREATE TABLE IF NOT EXISTS public.bet_tx_signature_claims (
  tx_signature TEXT PRIMARY KEY,
  bet_id UUID NOT NULL UNIQUE REFERENCES public.bets(id) ON DELETE CASCADE DEFERRABLE INITIALLY DEFERRED,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.bet_tx_signature_claims ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "deny_all_bet_tx_signature_claims" ON public.bet_tx_signature_claims;
CREATE POLICY "deny_all_bet_tx_signature_claims"
  ON public.bet_tx_signature_claims
  FOR ALL
  USING (false)
  WITH CHECK (false);

INSERT INTO public.bet_tx_signature_claims (tx_signature, bet_id)
SELECT DISTINCT ON (trim(tx_signature))
  trim(tx_signature) AS tx_signature,
  id AS bet_id
FROM public.bets
WHERE tx_signature IS NOT NULL
  AND length(trim(tx_signature)) > 0
ORDER BY trim(tx_signature), valid_onchain DESC NULLS LAST, created_at ASC, id ASC
ON CONFLICT (tx_signature) DO NOTHING;

CREATE OR REPLACE FUNCTION public.claim_bet_tx_signature()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  existing_bet_id UUID;
BEGIN
  IF NEW.tx_signature IS NULL OR length(trim(NEW.tx_signature)) = 0 THEN
    RETURN NEW;
  END IF;

  NEW.tx_signature := trim(NEW.tx_signature);

  INSERT INTO public.bet_tx_signature_claims (tx_signature, bet_id)
  VALUES (NEW.tx_signature, NEW.id)
  ON CONFLICT (tx_signature) DO NOTHING;

  SELECT bet_id
  INTO existing_bet_id
  FROM public.bet_tx_signature_claims
  WHERE tx_signature = NEW.tx_signature;

  IF existing_bet_id IS NULL OR existing_bet_id <> NEW.id THEN
    RAISE EXCEPTION 'Transaction already used';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS enforce_bet_tx_signature_claim ON public.bets;
CREATE TRIGGER enforce_bet_tx_signature_claim
  BEFORE INSERT OR UPDATE OF tx_signature
  ON public.bets
  FOR EACH ROW
  EXECUTE FUNCTION public.claim_bet_tx_signature();

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
  v_wallet TEXT := trim(p_wallet);
  v_tx_signature TEXT := trim(p_tx_signature);
BEGIN
  IF v_wallet IS NULL OR length(v_wallet) < 32 OR length(v_wallet) > 64 THEN
    RAISE EXCEPTION 'Wallet is invalid';
  END IF;

  IF p_side NOT IN ('YES', 'NO') THEN
    RAISE EXCEPTION 'Side must be YES or NO';
  END IF;

  IF p_amount_sol IS NULL OR p_amount_sol <= 0 THEN
    RAISE EXCEPTION 'SOL amount must be greater than 0';
  END IF;

  IF v_tx_signature IS NULL OR length(v_tx_signature) < 40 OR length(v_tx_signature) > 128 THEN
    RAISE EXCEPTION 'Transaction signature is invalid';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(v_tx_signature, 0));

  IF EXISTS (
    SELECT 1
    FROM public.bets
    WHERE tx_signature = v_tx_signature
    FOR UPDATE
  ) THEN
    RAISE EXCEPTION 'Transaction already used';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.markets
    WHERE id = p_market_id
      AND resolved = FALSE
      AND deleted_at IS NULL
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
    v_wallet,
    p_side,
    p_amount_sol,
    v_tx_signature,
    FALSE,
    'pending_worker_verification'
  )
  RETURNING * INTO placed_bet;

  RETURN placed_bet;
END;
$$;

REVOKE ALL ON public.bet_tx_signature_claims FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.claim_bet_tx_signature()
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.place_sol_bet_secure(UUID, TEXT, TEXT, NUMERIC, TEXT)
  TO anon, authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.settle_market(UUID, TEXT, NUMERIC)
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.record_payout(UUID, TEXT, NUMERIC)
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.settle_market_with_snapshot(UUID, NUMERIC)
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.settle_crypto_market(UUID, NUMERIC)
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.distribute_market_payouts(UUID, TEXT)
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.save_kol_snapshot(TEXT, NUMERIC, NUMERIC, NUMERIC, INTEGER, INTEGER, INTEGER, TIMESTAMPTZ)
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.generate_market_snapshot(UUID)
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.link_admin_wallet(TEXT)
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.check_admin_rate_limit(TEXT, INT)
  FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.log_admin_action(TEXT, UUID, TEXT)
  FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.settle_market(UUID, TEXT, NUMERIC) TO service_role;
GRANT EXECUTE ON FUNCTION public.record_payout(UUID, TEXT, NUMERIC) TO service_role;
GRANT EXECUTE ON FUNCTION public.settle_market_with_snapshot(UUID, NUMERIC) TO service_role;
GRANT EXECUTE ON FUNCTION public.settle_crypto_market(UUID, NUMERIC) TO service_role;
GRANT EXECUTE ON FUNCTION public.distribute_market_payouts(UUID, TEXT) TO service_role;
GRANT EXECUTE ON FUNCTION public.save_kol_snapshot(TEXT, NUMERIC, NUMERIC, NUMERIC, INTEGER, INTEGER, INTEGER, TIMESTAMPTZ) TO service_role;
GRANT EXECUTE ON FUNCTION public.generate_market_snapshot(UUID) TO service_role;

COMMIT;

NOTIFY pgrst, 'reload schema';
