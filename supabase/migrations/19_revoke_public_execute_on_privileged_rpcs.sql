BEGIN;

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

GRANT EXECUTE ON FUNCTION public.place_sol_bet_secure(UUID, TEXT, TEXT, NUMERIC, TEXT)
  TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.settle_market(UUID, TEXT, NUMERIC) TO service_role;
GRANT EXECUTE ON FUNCTION public.record_payout(UUID, TEXT, NUMERIC) TO service_role;
GRANT EXECUTE ON FUNCTION public.generate_market_snapshot(UUID) TO service_role;

COMMIT;

NOTIFY pgrst, 'reload schema';