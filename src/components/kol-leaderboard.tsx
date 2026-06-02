import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";

export const KOL_TEST = [
  { name: "Cented",   wallet: "CyaE1VxvBrahnPWkqm5VsdCvyS2QmNht2UFrKJHga54o" },
  { name: "theo",     wallet: "Bi4rd5FH5bYEN8scZ7wevxNZyNmKHdaBcvewdPFxYdLt" },
  { name: "Jijo",     wallet: "4BdKaxN8G6ka4GYtQQWk4G4dZRUTX2vQH9GcXdBREFUk" },
  { name: "clukz",    wallet: "G6fUXjMKPJzCY1rveAE6Qm7wy5U3vZgKDJmN1VPAdiZC" },
  { name: "decu",     wallet: "4vw54BmAogeRV3vPKWyFet5yf8DTLcREzdSzx4rw9Ud9" },
  { name: "Cupsey",   wallet: "2fg5QD1eD7rzNNCsvnhmXFm5hqNgwTTG8p7kQ6f3rx6f" },
  { name: "dv",       wallet: "BCagckXeMChUKrHEd6fKFA1uiWDtcmCXMsqaheLiUPJd" },
  { name: "Dani",     wallet: "AuPp4YTMTyqxYXQnHc5KUc6pUuCSsHQpBJhgnD45yqrf" },
  { name: "radiance", wallet: "FAicXNV5FVqtfbpn4Zccs71XcfGeyxBSGbqLDyDJZjke" },
  { name: "Kadenox",  wallet: "B32QbbdDAyhvUQzjcaM5j6ZVKwjCxAwGH5Xgvb9SJqnC" },
];

export type KOLName = typeof KOL_TEST[number]["name"];

type KOLEntry = { name: string; wallet: string };
export type KOLStat = KOLEntry & {
  balance_sol: number | null;
  pnl_sol: number | null;
  pnl_percent: number | null;
  win_rate: number | null;
  total_trades: number | null;
  sells: number | null;
  buys: number | null;
  snapshot_hour: string | null;
  loading: boolean;
  error: boolean;
};

const CACHE_KEY = "kol_leaderboard_cache";
const CACHE_HOUR_KEY = "kol_cache_current_hour";

function getCurrentHourKey(): string {
  const now = new Date();
  return `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}-${now.getHours()}`;
}

function getMsUntilNextHour(): number {
  const now = new Date();
  const nextHour = new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours() + 1, 0, 0, 0);
  return nextHour.getTime() - now.getTime();
}

function isCacheValid(): boolean {
  const cachedHour = localStorage.getItem(CACHE_HOUR_KEY);
  const currentHour = getCurrentHourKey();
  return cachedHour === currentHour;
}

function hasUsableKOLCache(data: unknown): data is KOLStat[] {
  return Array.isArray(data) && data.some((entry) => (
    entry &&
    typeof entry === "object" &&
    "error" in entry &&
    !(entry as KOLStat).error &&
    !(entry as KOLStat).loading &&
    (
      (entry as KOLStat).balance_sol !== null ||
      (entry as KOLStat).total_trades !== null ||
      (entry as KOLStat).snapshot_hour !== null
    )
  ));
}

function readCurrentHourCache(): { data: KOLStat[]; timestamp: number } | null {
  if (!isCacheValid()) return null;

  const cached = localStorage.getItem(CACHE_KEY);
  if (!cached) return null;

  try {
    const parsed = JSON.parse(cached) as { data?: unknown; timestamp?: unknown };
    if (!hasUsableKOLCache(parsed.data) || typeof parsed.timestamp !== "number") {
      localStorage.removeItem(CACHE_KEY);
      localStorage.removeItem(CACHE_HOUR_KEY);
      return null;
    }

    return { data: parsed.data, timestamp: parsed.timestamp };
  } catch {
    localStorage.removeItem(CACHE_KEY);
    localStorage.removeItem(CACHE_HOUR_KEY);
    return null;
  }
}

function mapSnapshotsToStats(snapshots: any[]): KOLStat[] {
  const mapped = KOL_TEST.map((k) => {
    const row = snapshots.find((d: any) => d.wallet === k.wallet);
    if (!row) {
      return { ...k, balance_sol: null, pnl_sol: null, pnl_percent: null, win_rate: null, total_trades: null, sells: null, buys: null, snapshot_hour: null, loading: false, error: false };
    }
    return {
      ...k,
      balance_sol: row.balance_sol,
      pnl_sol: row.pnl_sol,
      pnl_percent: row.pnl_percent,
      win_rate: null,
      total_trades: row.total_trades,
      sells: row.sells,
      buys: row.buys,
      snapshot_hour: row.snapshot_hour,
      loading: false,
      error: false,
    };
  });

  return [...mapped].sort((a, b) => {
    const aHasTrades = a.total_trades && a.total_trades > 0;
    const bHasTrades = b.total_trades && b.total_trades > 0;
    if (!aHasTrades && bHasTrades) return 1;
    if (aHasTrades && !bHasTrades) return -1;
    return (b.pnl_sol ?? -Infinity) - (a.pnl_sol ?? -Infinity);
  });
}

function getLatestSnapshotTimestamp(snapshots: any[]): number | null {
  const timestamps = snapshots
    .map((row) => row?.snapshot_hour ? new Date(row.snapshot_hour).getTime() : NaN)
    .filter((value) => Number.isFinite(value));
  return timestamps.length > 0 ? Math.max(...timestamps) : null;
}

export function KOLLeaderboard({ compact = false }: { compact?: boolean }) {
  const [stats, setStats] = useState<KOLStat[]>(
    KOL_TEST.map((k) => ({ ...k, balance_sol: null, pnl_sol: null, pnl_percent: null, win_rate: null, total_trades: null, sells: null, buys: null, snapshot_hour: null, loading: true, error: false }))
  );
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const [fetching, setFetching] = useState(false);
  const [progress, setProgress] = useState(0);

  // Charger uniquement depuis les snapshots serveur. Le navigateur ne doit pas
  // créer son propre leaderboard, sinon chaque utilisateur peut voir autre chose.
  async function loadFromSupabase() {
    try {
      const cached = readCurrentHourCache();
      if (cached) {
        setStats(cached.data);
        setLastUpdated(new Date(cached.timestamp));
        setFetching(false);
        return;
      }

      const currentHour = getCurrentHourKey();
      const hourStart = new Date();
      hourStart.setMinutes(0, 0, 0);
      setFetching(true);
      setProgress(0);

      let { data, error } = await supabase
        .from("kol_hourly_snapshots" as any)
        .select("*")
        .gte("snapshot_hour", hourStart.toISOString())
        .order("snapshot_hour", { ascending: false });

      if (error || !data || data.length === 0) {
        const latestHour = await supabase
          .from("kol_hourly_snapshots" as any)
          .select("snapshot_hour")
          .order("snapshot_hour", { ascending: false })
          .limit(1)
          .maybeSingle();
        const latestHourData = latestHour.data as { snapshot_hour?: string } | null;

        if (latestHour.error || !latestHourData?.snapshot_hour) {
          setStats(KOL_TEST.map((k) => ({ ...k, balance_sol: null, pnl_sol: null, pnl_percent: null, win_rate: null, total_trades: null, sells: null, buys: null, snapshot_hour: null, loading: false, error: false })));
          setLastUpdated(null);
          setFetching(false);
          return;
        }

        const latestSnapshots = await supabase
          .from("kol_hourly_snapshots" as any)
          .select("*")
          .eq("snapshot_hour", latestHourData.snapshot_hour)
          .order("snapshot_hour", { ascending: false });

        data = latestSnapshots.data;
        error = latestSnapshots.error;
      }

      if (error || !data || data.length === 0) {
        setStats(KOL_TEST.map((k) => ({ ...k, balance_sol: null, pnl_sol: null, pnl_percent: null, win_rate: null, total_trades: null, sells: null, buys: null, snapshot_hour: null, loading: false, error: false })));
        setLastUpdated(null);
        setFetching(false);
        return;
      }

      const snapshots = data as any[];
      const sorted = mapSnapshotsToStats(snapshots);
      const latestTimestamp = getLatestSnapshotTimestamp(snapshots) ?? Date.now();

      setStats(sorted);
      setLastUpdated(new Date(latestTimestamp));

      const latestDate = new Date(latestTimestamp);
      const latestHourKey = `${latestDate.getFullYear()}-${latestDate.getMonth()}-${latestDate.getDate()}-${latestDate.getHours()}`;
      if (latestHourKey === currentHour) {
        localStorage.setItem(CACHE_KEY, JSON.stringify({ data: sorted, timestamp: latestTimestamp }));
        localStorage.setItem(CACHE_HOUR_KEY, getCurrentHourKey());
      } else {
        localStorage.removeItem(CACHE_KEY);
        localStorage.removeItem(CACHE_HOUR_KEY);
      }

      setFetching(false);
      console.log(`[KOL] Loaded ${data.length} snapshots from Supabase`);
    } catch (e) {
      console.error("[KOL] Supabase load failed:", e);
      setFetching(false);
    }
  }

  useEffect(() => {
    loadFromSupabase();

    const scheduleNextRefresh = () => {
      const msUntilNext = getMsUntilNextHour();
      const nextHour = new Date(Date.now() + msUntilNext);
      console.log(`[KOL] Next refresh at ${nextHour.toLocaleTimeString()} (in ${Math.round(msUntilNext / 1000 / 60)} min)`);

      const timeout = setTimeout(() => {
        console.log("[KOL] Refreshing from Supabase...");
        loadFromSupabase();
        scheduleNextRefresh();
      }, msUntilNext);

      return () => clearTimeout(timeout);
    };

    const cleanup = scheduleNextRefresh();
    return () => { cleanup(); };
  }, []);

  const loaded = stats.filter((s) => !s.loading).length;

  const withData = stats.filter((s) => (
    !s.error &&
    (s.balance_sol !== null || s.total_trades !== null || s.snapshot_hour !== null)
  )).length;

  if (compact) {
    // Version compacte pour la sidebar
    return (
      <div className="rounded border overflow-hidden bg-card">
        <div className="flex items-center justify-between px-3 py-2 border-b bg-muted/50">
          <div>
            <h3 className="font-display text-xs font-bold uppercase tracking-wider">KOL Leaderboard</h3>
            <p className="text-[10px] text-muted-foreground font-mono">PnL 1h · Auto</p>
          </div>
          <div className="text-[10px] font-mono text-muted-foreground">
            {fetching ? `${progress}/${KOL_TEST.length}` : loaded > 0 ? "✓" : "..."}
          </div>
        </div>

        {fetching && (
          <div className="h-1 w-full bg-muted overflow-hidden">
            <div className="h-full bg-primary transition-all" style={{ width: `${(progress / KOL_TEST.length) * 100}%` }} />
          </div>
        )}

        <div className="max-h-[350px] overflow-auto">
          <table className="w-full text-[11px]">
            <thead className="bg-muted/30 text-[10px] font-mono uppercase">
              <tr>
                <th className="px-2 py-1.5 text-left">#</th>
                <th className="px-2 py-1.5 text-left">KOL</th>
                <th className="px-2 py-1.5 text-right">PnL%</th>
                <th className="px-2 py-1.5 text-right">SOL</th>
              </tr>
            </thead>
            <tbody>
              {stats.map((kol, i) => (
                <tr key={kol.wallet} className="border-b last:border-0 hover:bg-muted/20">
                  <td className="px-2 py-1.5 font-mono text-muted-foreground">{i + 1}</td>
                  <td className="px-2 py-1.5 font-medium">
                    <a 
                      href={`https://kolscan.io/account/${kol.wallet}`} 
                      target="_blank" 
                      rel="noopener noreferrer"
                      className="hover:text-primary transition-colors"
                    >
                      {kol.name}
                    </a>
                  </td>
                  <td className={`px-2 py-1.5 text-right font-mono ${
                    kol.loading ? "text-muted-foreground" :
                    kol.pnl_percent === null ? "text-muted-foreground" :
                    kol.pnl_percent >= 0 ? "text-green-500" : "text-red-400"
                  }`}>
                    {kol.loading ? "..." : kol.pnl_percent === null ? "—" : `${kol.pnl_percent >= 0 ? "+" : ""}${kol.pnl_percent.toFixed(1)}%`}
                  </td>
                  <td className="px-2 py-1.5 text-right font-mono text-muted-foreground">
                    {kol.loading ? "..." : kol.balance_sol === null ? "—" : kol.balance_sol.toFixed(1)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {lastUpdated && (
          <div className="px-3 py-1.5 border-t text-[10px] text-muted-foreground font-mono text-center">
            {lastUpdated.toLocaleTimeString()}
          </div>
        )}

        {/* Explication du fonctionnement */}
        <div className="mt-4 p-3 bg-muted/50 rounded text-xs text-muted-foreground">
          <p className="font-semibold mb-1">📊 Comment fonctionne le Leaderboard :</p>
          <ul className="space-y-1 ml-4 list-disc">
            <li>Les données sont actualisées automatiquement toutes les heures (à 00:00, 01:00, 02:00...)</li>
            <li>PnL 1h = Profit & Loss sur la dernière heure (SWAP transactions uniquement)</li>
            <li>Même si vous fermez le site, les données restent identiques jusqu'à la prochaine heure</li>
            <li>Les données proviennent de l'API Helius (blockchain Solana)</li>
          </ul>
        </div>
      </div>
    );
  }

  // Version complète
  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="font-display text-3xl font-black uppercase tracking-wider">
            KOL Leaderboard
          </h1>
          <p className="text-xs text-muted-foreground mt-1 font-mono">
            Top 20 · PnL 1h via server snapshot · Auto-refresh
          </p>
        </div>
        <div className="text-xs font-mono text-muted-foreground">
          Auto-refresh: ON
        </div>
      </div>

      {lastUpdated && (
        <p className="text-xs text-muted-foreground font-mono mb-4">
          Last updated: {lastUpdated.toLocaleTimeString()} — {withData}/{loaded} wallets with data
        </p>
      )}

      {fetching && (
        <div className="mb-4 h-1.5 w-full rounded bg-muted overflow-hidden">
          <div
            className="h-full bg-primary transition-all"
            style={{ width: `${(progress / KOL_TEST.length) * 100}%` }}
          />
        </div>
      )}

      <div className="rounded border overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b bg-muted/50 text-xs font-mono uppercase tracking-wider">
              <th className="px-4 py-3 text-left">#</th>
              <th className="px-4 py-3 text-left">KOL</th>
              <th className="px-4 py-3 text-right">Balance (SOL)</th>
              <th className="px-4 py-3 text-right">PnL 1h (SOL)</th>
              <th className="px-4 py-3 text-right">PnL %</th>
              <th className="px-4 py-3 text-right">Trades</th>
              <th className="px-4 py-3 text-right">Status</th>
            </tr>
          </thead>
          <tbody>
            {stats.map((kol, i) => (
              <tr key={kol.wallet} className="border-b last:border-0 hover:bg-muted/30 transition-colors">
                <td className="px-4 py-3 font-mono text-muted-foreground">
                  {kol.loading ? "—" : i + 1}
                </td>
                <td className="px-4 py-3 font-bold">
                  <a
                    href={`https://kolscan.io/account/${kol.wallet}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="hover:text-primary transition-colors"
                  >
                    {kol.name}
                  </a>
                </td>
                <td className="px-4 py-3 text-right font-mono text-xs text-muted-foreground">
                  {kol.loading ? "..." :
                   kol.balance_sol === null ? "—" :
                   kol.balance_sol.toFixed(2)}
                </td>
                <td className={`px-4 py-3 text-right font-mono font-bold ${
                  kol.loading ? "text-muted-foreground" :
                  kol.error ? "text-red-400 text-xs" :
                  kol.pnl_sol === null ? "text-muted-foreground" :
                  kol.pnl_sol >= 0 ? "text-green-500" : "text-red-400"
                }`}>
                  {kol.loading ? "..." :
                   kol.error ? "error" :
                   kol.pnl_sol !== null ? `${kol.pnl_sol >= 0 ? "+" : ""}${kol.pnl_sol.toFixed(2)}` :
                   "—"}
                </td>
                <td className={`px-4 py-3 text-right font-mono text-xs ${
                  kol.loading ? "text-muted-foreground" :
                  kol.pnl_percent === null ? "text-muted-foreground" :
                  kol.pnl_percent >= 0 ? "text-green-500" : "text-red-400"
                }`}>
                  {kol.loading ? "..." :
                   kol.pnl_percent === null ? "—" :
                   `${kol.pnl_percent >= 0 ? "+" : ""}${kol.pnl_percent.toFixed(2)}%`}
                </td>
                <td className="px-4 py-3 text-right font-mono text-xs text-muted-foreground">
                  {kol.loading ? "..." :
                   kol.total_trades === null ? "—" :
                   kol.total_trades}
                </td>
                <td className="px-4 py-3 text-right font-mono text-xs">
                  {kol.loading ? "⏳" : kol.error ? "❌" : "✅"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {lastUpdated && (
          <div className="px-3 py-1.5 border-t text-[10px] text-muted-foreground font-mono text-center">
            {lastUpdated.toLocaleTimeString()}
          </div>
        )}

        {/* How it works */}
        <div className="mt-4 p-3 bg-muted/50 rounded text-xs text-muted-foreground">
          <p className="font-semibold mb-1">📊 How the Leaderboard works:</p>
          <ul className="space-y-1 ml-4 list-disc">
            <li>Data refreshes automatically every hour (at 00:00, 01:00, 02:00...)</li>
            <li>PnL 1h = Profit & Loss over the last hour (SWAP transactions only)</li>
            <li>Even if you close the site, data stays the same until the next hour</li>
            <li>Data comes from the Helius API (Solana blockchain)</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
