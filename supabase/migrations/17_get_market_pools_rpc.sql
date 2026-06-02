-- RPC function to get market pools (total YES/NO stakes) for a list of market IDs
CREATE OR REPLACE FUNCTION public.get_market_pools(
  p_market_ids UUID[]
)
RETURNS TABLE(market_id UUID, yes_total NUMERIC, no_total NUMERIC)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT
    b.market_id,
    COALESCE(SUM(b.amount_sol) FILTER (WHERE b.side = 'YES'), 0) as yes_total,
    COALESCE(SUM(b.amount_sol) FILTER (WHERE b.side = 'NO'), 0) as no_total
  FROM public.bets b
  WHERE b.market_id = ANY(p_market_ids)
  GROUP BY b.market_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_market_pools(UUID[]) TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';
