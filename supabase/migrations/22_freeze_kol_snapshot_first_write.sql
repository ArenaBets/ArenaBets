BEGIN;

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
  ON CONFLICT (wallet, snapshot_hour) DO NOTHING;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.save_kol_snapshot(TEXT, NUMERIC, NUMERIC, NUMERIC, INTEGER, INTEGER, INTEGER, TIMESTAMPTZ)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.save_kol_snapshot(TEXT, NUMERIC, NUMERIC, NUMERIC, INTEGER, INTEGER, INTEGER, TIMESTAMPTZ)
  TO service_role;

COMMIT;

NOTIFY pgrst, 'reload schema';
