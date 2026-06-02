import { useEffect, useMemo, useState } from "react";

export type KOLStat = {
  name: string;
  wallet: string;
  balance_sol: number | null;
  pnl_sol: number | null;
  pnl_percent: number | null;
  win_rate: number | null;
  total_trades: number | null;
  sells: number | null;
  buys: number | null;
  snapshot_hour: string | null;
  loading?: boolean;
  error?: boolean;
};

const KOL_TICKER_REFRESH_MS = 60_000;

function formatPnL(val: number | null) {
  if (val === null) return "—";
  const sign = val >= 0 ? "+" : "";
  return `${sign}${val.toFixed(2)}`;
}

function loadFromCache(): KOLStat[] {
  try {
    const cached = localStorage.getItem("kol_leaderboard_cache");
    if (!cached) return [];
    const { data } = JSON.parse(cached) as { data: KOLStat[] };
    const sorted = [...data].sort((a, b) => {
      const aHasTrades = a.total_trades && a.total_trades > 0;
      const bHasTrades = b.total_trades && b.total_trades > 0;
      if (!aHasTrades && bHasTrades) return 1;
      if (aHasTrades && !bHasTrades) return -1;
      return (b.pnl_sol ?? -Infinity) - (a.pnl_sol ?? -Infinity);
    });
    return sorted;
  } catch {
    return [];
  }
}

export function KOLPriceTicker() {
  const [items, setItems] = useState<KOLStat[]>(loadFromCache);

  useEffect(() => {
    setItems(loadFromCache());
    const id = setInterval(() => setItems(loadFromCache()), KOL_TICKER_REFRESH_MS);
    return () => clearInterval(id);
  }, []);

  const displayItems = useMemo(() => {
    if (items.length === 0) return [];
    return [...items, ...items, ...items, ...items];
  }, [items]);

  if (items.length === 0) return null;

  return (
    <div className="border-y-2 border-foreground bg-foreground text-parchment overflow-hidden">
      <div className="flex animate-ticker whitespace-nowrap py-2 font-mono text-sm">
        {displayItems.map((row, index) => {
          const rank = (index % items.length) + 1;
          const up = (row.pnl_sol ?? 0) >= 0;
          return (
            <span key={`${row.name}-${index}`} className="mx-6 inline-flex items-center gap-3">
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary text-[10px] font-bold leading-none text-foreground">
                {rank}
              </span>
              <span className="font-bold tracking-widest uppercase">{row.name}</span>
              <span>{formatPnL(row.pnl_sol)} SOL</span>
              <span className={up ? "text-primary" : "text-accent"}>
                {up ? "▲" : "▼"} {formatPnL(row.pnl_percent)}%
              </span>
            </span>
          );
        })}
      </div>
    </div>
  );
}
