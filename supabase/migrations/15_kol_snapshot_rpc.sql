-- Migration 15 — RPC function to save KOL snapshots from Edge Functions
-- Bypasses REST API issues by using direct SQL execution

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
  INSERT INTO public.kol_hourly_snapshots (
    wallet, balance_sol, pnl_sol, pnl_percent, 
    total_trades, sells, buys, snapshot_hour
  )
  VALUES (
    p_wallet, p_balance_sol, p_pnl_sol, p_pnl_percent,
    p_total_trades, p_sells, p_buys, p_snapshot_hour
  )
  ON CONFLICT (wallet, snapshot_hour) DO UPDATE SET
    balance_sol = EXCLUDED.balance_sol,
    pnl_sol = EXCLUDED.pnl_sol,
    pnl_percent = EXCLUDED.pnl_percent,
    total_trades = EXCLUDED.total_trades,
    sells = EXCLUDED.sells,
    buys = EXCLUDED.buys;
END;
$$;

GRANT EXECUTE ON FUNCTION public.save_kol_snapshot(TEXT, NUMERIC, NUMERIC, NUMERIC, INTEGER, INTEGER, INTEGER, TIMESTAMPTZ) TO anon, authenticated, service_role;
