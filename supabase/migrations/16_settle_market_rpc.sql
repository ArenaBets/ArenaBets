-- RPC function to settle a market (bypass RLS via SECURITY DEFINER)
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
BEGIN
  UPDATE public.markets
  SET
    resolved = true,
    outcome = p_outcome,
    settlement_price = p_settlement_price,
    closed_at = NOW()
  WHERE id = p_market_id;
END;
$$;

-- RPC function to record a payout on a bet
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
BEGIN
  UPDATE public.bets
  SET
    payout_tx = p_payout_tx,
    payout_amount = p_payout_amount
  WHERE id = p_bet_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.settle_market(UUID, TEXT, NUMERIC) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.record_payout(UUID, TEXT, NUMERIC) TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';
