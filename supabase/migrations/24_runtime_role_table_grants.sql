BEGIN;

GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

-- Public runtime reads. RLS policies still decide which rows are visible.
GRANT SELECT ON TABLE public.markets TO anon, authenticated;
GRANT SELECT ON TABLE public.bets TO anon, authenticated;
GRANT SELECT ON TABLE public.users TO anon, authenticated;
GRANT SELECT ON TABLE public.prices_cache TO anon, authenticated;
GRANT SELECT ON TABLE public.kol_wallets TO anon, authenticated;
GRANT SELECT ON TABLE public.kol_hourly_snapshots TO anon, authenticated;

-- Market creation is public, but constrained by the existing INSERT policies.
GRANT INSERT ON TABLE public.markets TO anon, authenticated;

-- Internal scripts and Edge Functions use service_role with explicit table access.
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO service_role;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO service_role;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO service_role;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT ALL PRIVILEGES ON TABLES TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT ALL PRIVILEGES ON SEQUENCES TO service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT EXECUTE ON FUNCTIONS TO service_role;

COMMIT;

NOTIFY pgrst, 'reload schema';
