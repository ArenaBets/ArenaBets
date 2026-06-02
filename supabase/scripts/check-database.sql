-- Colle ce script dans Supabase → SQL Editor → Run
-- Il te dit ce qui est installé (sans rien modifier).

SELECT '=== TABLES ===' AS section;
SELECT table_name
FROM information_schema.tables
WHERE table_schema = 'public'
  AND table_type = 'BASE TABLE'
ORDER BY table_name;

SELECT '=== COLONNES markets ===' AS section;
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'markets'
ORDER BY ordinal_position;

SELECT '=== FONCTIONS RPC ===' AS section;
SELECT routine_name
FROM information_schema.routines
WHERE routine_schema = 'public'
  AND routine_type = 'FUNCTION'
ORDER BY routine_name;

SELECT '=== CHECKLIST ARENA ===' AS section;
SELECT
  EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'markets') AS has_markets,
  EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'bets') AS has_bets,
  EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'users') AS has_users,
  EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'markets' AND column_name = 'payouts_distributed'
  ) AS has_payouts_column,
  EXISTS (
    SELECT 1 FROM information_schema.routines
    WHERE routine_schema = 'public' AND routine_name = 'place_points_bet'
  ) AS has_place_points_bet,
  EXISTS (
    SELECT 1 FROM information_schema.routines
    WHERE routine_schema = 'public' AND routine_name = 'settle_crypto_market'
  ) AS has_settle_crypto_market,
  EXISTS (
    SELECT 1 FROM information_schema.routines
    WHERE routine_schema = 'public' AND routine_name = 'distribute_market_payouts'
  ) AS has_distribute_market_payouts;

-- Compteurs rapides
SELECT '=== DONNÉES ===' AS section;
SELECT
  (SELECT COUNT(*) FROM public.markets) AS markets_count,
  (SELECT COUNT(*) FROM public.bets) AS bets_count,
  (SELECT COUNT(*) FROM public.users) AS users_count;
