BEGIN;

CREATE OR REPLACE FUNCTION public.get_leaderboard_stats()
RETURNS TABLE (
  wallet TEXT,
  total_bets BIGINT,
  total_wagered NUMERIC,
  total_pnl NUMERIC,
  wins BIGINT,
  losses BIGINT
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH resolved_markets AS (
    SELECT id, outcome
    FROM public.markets
    WHERE resolved = TRUE
      AND outcome IN ('YES', 'NO')
      AND deleted_at IS NULL
  ),
  scored_bets AS (
    SELECT
      b.wallet,
      b.amount_sol,
      CASE WHEN b.side = m.outcome THEN 1 ELSE 0 END AS won,
      CASE
        WHEN b.side = m.outcome THEN
          CASE
            WHEN SUM(b.amount_sol) FILTER (WHERE b.side = m.outcome) OVER (PARTITION BY b.market_id) > 0
            THEN
              COALESCE(
                SUM(b.amount_sol) FILTER (WHERE b.side <> m.outcome) OVER (PARTITION BY b.market_id),
                0
              )
              * b.amount_sol
              / SUM(b.amount_sol) FILTER (WHERE b.side = m.outcome) OVER (PARTITION BY b.market_id)
            ELSE 0
          END
        ELSE -b.amount_sol
      END AS pnl
    FROM public.bets b
    JOIN resolved_markets m ON m.id = b.market_id
    WHERE b.wallet IS NOT NULL
      AND b.side IN ('YES', 'NO')
      AND b.amount_sol IS NOT NULL
      AND b.amount_sol > 0
  )
  SELECT
    scored_bets.wallet,
    COUNT(*)::BIGINT AS total_bets,
    COALESCE(SUM(scored_bets.amount_sol), 0) AS total_wagered,
    COALESCE(SUM(scored_bets.pnl), 0) AS total_pnl,
    COALESCE(SUM(scored_bets.won), 0)::BIGINT AS wins,
    COALESCE(SUM(1 - scored_bets.won), 0)::BIGINT AS losses
  FROM scored_bets
  GROUP BY scored_bets.wallet
  ORDER BY total_pnl DESC;
$$;

REVOKE EXECUTE ON FUNCTION public.get_leaderboard_stats()
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_leaderboard_stats()
  TO anon, authenticated, service_role;

COMMIT;

NOTIFY pgrst, 'reload schema';
