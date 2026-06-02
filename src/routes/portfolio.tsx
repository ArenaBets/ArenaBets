import { createFileRoute, Link } from "@tanstack/react-router";
import { Clock, ExternalLink } from "lucide-react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { Connection, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArenaNav } from "@/components/arena-nav";
import { MarketCountdown } from "@/components/market-countdown";
import { supabase } from "@/integrations/supabase/client";
import {
  isMarketOpen,
  type PortfolioBet,
  type PortfolioMarket,
} from "@/lib/portfolio";

export const Route = createFileRoute("/portfolio")({
  component: PortfolioPage,
});

type PositionAgg = { side: string; total_stake: number; count: number };
type AggregatedBet = {
  market_id: string;
  market: PortfolioBet["market"];
  positions: PositionAgg[];
  total_stake: number;
  latest_created_at: string;
  earliest_created_at: string;
};

function PortfolioPage() {
  const { publicKey, connected } = useWallet();
  const { setVisible } = useWalletModal();
  const [bets, setBets] = useState<PortfolioBet[]>([]);
  const [loading, setLoading] = useState(false);
  const [walletBalance, setWalletBalance] = useState<number | null>(null);
  const [marketPools, setMarketPools] = useState<Map<string, { yes: number; no: number }>>(new Map());
  const [liveFilter, setLiveFilter] = useState<"all" | "ending-soon" | "high-volume" | "biggest">("all");
  const [historyFilter, setHistoryFilter] = useState<"all" | "won" | "lost" | "pending" | "kol" | "crypto" | "24h" | "7d" | "30d">("all");
  const [showAnalytics, setShowAnalytics] = useState(false);
  const portfolioMarketIdsRef = useRef<Set<string>>(new Set());
  const refreshTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const wallet = publicKey?.toBase58();

  const refresh = useCallback(async () => {
    if (!wallet) {
      setBets([]);
      return;
    }

    setLoading(true);

    // 1. Récupérer les paris sans JOIN (évite les problèmes RLS sur markets)
    const { data: userBets, error: betsError } = await supabase
      .from("bets")
      .select("id, market_id, side, amount_sol, created_at")
      .eq("wallet", wallet)
      .order("created_at", { ascending: false });

    if (betsError) {
      console.error("[Portfolio] Bets query error:", betsError);
    }

    // 2. Récupérer les marchés séparément
    const betMarketIds = [...new Set((userBets ?? []).map((b) => b.market_id))];
    let marketsMap = new Map<string, PortfolioMarket>();
    if (betMarketIds.length > 0) {
      const { data: marketsData, error: marketsError } = await supabase
        .from("markets")
        .select("id, question, tag, asset, condition, price_target, resolved, outcome, closes_at, snapshot")
        .in("id", betMarketIds);

      if (marketsError) {
        console.error("[Portfolio] Markets query error:", marketsError);
      }

      for (const m of (marketsData ?? []) as any[]) {
        marketsMap.set(m.id, m as PortfolioMarket);
      }

    }

    // 3. Combiner
    const rows = (userBets ?? [])
      .map((row) => {
        const market = marketsMap.get(row.market_id);
        if (!market) return null;
        return {
          id: row.id,
          market_id: row.market_id,
          side: row.side,
          amount_sol: row.amount_sol,
          created_at: row.created_at,
          market,
        } satisfies PortfolioBet;
      })
      .filter((row): row is PortfolioBet => row !== null);

    setBets(rows);

    // Récupérer les pools de tous les marchés concernés pour calculer les payouts
    const marketIds = [...new Set(rows.map((r) => r.market_id))];
    const pools = new Map<string, { yes: number; no: number }>();
    for (const id of marketIds) {
      pools.set(id, { yes: 0, no: 0 });
    }

    // 1. Pour les marchés résolus avec snapshot, utiliser les vrais pools stockés
    const idsNeedingBetsQuery: string[] = [];
    for (const m of marketsMap.values()) {
      if (m.resolved && (m as any).snapshot) {
        const snap = (m as any).snapshot;
        pools.set(m.id, {
          yes: Number(snap.yesTotal ?? 0),
          no: Number(snap.noTotal ?? 0),
        });
      } else {
        idsNeedingBetsQuery.push(m.id);
      }
    }

    // 2. Fallback sur les pools agrégés pour les marchés sans snapshot (résolus ou ouverts)
    if (idsNeedingBetsQuery.length > 0) {
      const { data: poolRows, error: poolError } = await (supabase.rpc as any)("get_market_pools", {
        p_market_ids: idsNeedingBetsQuery,
      });

      if (poolError) {
        console.error("[Portfolio] market pools query error:", poolError);
      }

      for (const row of (poolRows ?? []) as Array<{ market_id: string; yes_total: number | string | null; no_total: number | string | null }>) {
        const pool = pools.get(row.market_id);
        if (!pool) continue;
        pool.yes = Number(row.yes_total ?? 0);
        pool.no = Number(row.no_total ?? 0);
      }
    }
    setMarketPools(pools);

    setLoading(false);
  }, [wallet]);

  useEffect(() => {
    if (!wallet) {
      setBets([]);
      setWalletBalance(null);
    }
  }, [wallet]);

  useEffect(() => {
    portfolioMarketIdsRef.current = new Set(bets.map((bet) => bet.market_id));
  }, [bets]);

  useEffect(() => {
    if (!publicKey) {
      setWalletBalance(null);
      return;
    }
    const rpcUrl = import.meta.env.VITE_SOLANA_PUBLIC_RPC_URL || "https://solana-rpc.publicnode.com";

    const conn = new Connection(rpcUrl, "confirmed");
    conn.getBalance(publicKey)
      .then((lamports) => setWalletBalance(lamports / LAMPORTS_PER_SOL))
      .catch(() => setWalletBalance(null));
  }, [publicKey]);

  useEffect(() => {
    refresh();
    if (!wallet) return;

    const queueRefresh = () => {
      if (refreshTimeoutRef.current) {
        clearTimeout(refreshTimeoutRef.current);
      }
      refreshTimeoutRef.current = setTimeout(() => {
        refreshTimeoutRef.current = null;
        refresh();
      }, 250);
    };

    const shouldRefreshForBet = (payload: {
      new?: { wallet?: string | null; market_id?: string | null };
      old?: { wallet?: string | null; market_id?: string | null };
    }) => {
      const next = payload.new;
      const previous = payload.old;
      const eventWallet = next?.wallet ?? previous?.wallet;
      const marketId = next?.market_id ?? previous?.market_id;
      return eventWallet === wallet || (marketId ? portfolioMarketIdsRef.current.has(marketId) : false);
    };

    const shouldRefreshForMarket = (payload: {
      new?: { id?: string | null };
      old?: { id?: string | null };
    }) => {
      const marketId = payload.new?.id ?? payload.old?.id;
      return marketId ? portfolioMarketIdsRef.current.has(marketId) : false;
    };

    const channel = supabase
      .channel(`portfolio-${wallet}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "bets" }, (payload) => {
        if (shouldRefreshForBet(payload as any)) queueRefresh();
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "markets" }, (payload) => {
        if (shouldRefreshForMarket(payload as any)) queueRefresh();
      })
      .subscribe();

    return () => {
      if (refreshTimeoutRef.current) {
        clearTimeout(refreshTimeoutRef.current);
        refreshTimeoutRef.current = null;
      }
      supabase.removeChannel(channel);
    };
  }, [refresh, wallet]);

  function aggregateBetsByMarket(betsList: PortfolioBet[]): AggregatedBet[] {
    const map = new Map<string, AggregatedBet>();
    for (const b of betsList) {
      const existing = map.get(b.market_id);
      if (existing) {
        const pos = existing.positions.find((p) => p.side === b.side);
        if (pos) {
          pos.total_stake += b.amount_sol ?? 0;
          pos.count += 1;
        } else {
          existing.positions.push({
            side: b.side,
            total_stake: b.amount_sol ?? 0,
            count: 1,
          });
        }
        existing.total_stake += b.amount_sol ?? 0;
        if (new Date(b.created_at) > new Date(existing.latest_created_at)) {
          existing.latest_created_at = b.created_at;
        }
        if (new Date(b.created_at) < new Date(existing.earliest_created_at)) {
          existing.earliest_created_at = b.created_at;
        }
      } else {
        map.set(b.market_id, {
          market_id: b.market_id,
          market: b.market,
          positions: [
            { side: b.side, total_stake: b.amount_sol ?? 0, count: 1 },
          ],
          total_stake: b.amount_sol ?? 0,
          latest_created_at: b.created_at,
          earliest_created_at: b.created_at,
        });
      }
    }
    return [...map.values()].sort(
      (a, b) =>
        new Date(b.latest_created_at).getTime() -
        new Date(a.latest_created_at).getTime(),
    );
  }

  const liveBets = useMemo(
    () => aggregateBetsByMarket(bets.filter((b) => isMarketOpen(b.market))),
    [bets],
  );
  const historyBets = useMemo(
    () => aggregateBetsByMarket(bets.filter((b) => !isMarketOpen(b.market))),
    [bets],
  );

  const filteredLiveBets = useMemo(() => {
    const now = new Date();
    switch (liveFilter) {
      case "ending-soon":
        return liveBets.filter((b) => {
          if (!b.market.closes_at) return false;
          const closes = new Date(b.market.closes_at).getTime();
          return closes - now.getTime() <= 24 * 60 * 60 * 1000 && closes > now.getTime();
        });
      case "high-volume":
        return [...liveBets].sort((a, b) => {
          const poolA = marketPools.get(a.market_id);
          const poolB = marketPools.get(b.market_id);
          const volA = poolA ? poolA.yes + poolA.no : 0;
          const volB = poolB ? poolB.yes + poolB.no : 0;
          return volB - volA;
        });
      case "biggest":
        return [...liveBets].sort((a, b) => b.total_stake - a.total_stake);
      default:
        return liveBets;
    }
  }, [liveBets, liveFilter, marketPools]);

  const filteredHistoryBets = useMemo(() => {
    const now = new Date();
    switch (historyFilter) {
      case "won":
        return historyBets.filter(
          (b) => b.market.resolved && b.positions.some((p: PositionAgg) => p.side === b.market.outcome),
        );
      case "lost":
        return historyBets.filter(
          (b) =>
            b.market.resolved && b.positions.every((p: PositionAgg) => p.side !== b.market.outcome),
        );
      case "pending":
        return historyBets.filter((b) => !b.market.resolved);
      case "kol":
        return historyBets.filter(
          (b) => b.market.tag?.toUpperCase() === "KOL",
        );
      case "crypto":
        return historyBets.filter(
          (b) => b.market.asset !== null && b.market.asset !== undefined,
        );
      case "24h":
        return historyBets.filter((b) => {
          if (!b.market.closes_at) return false;
          const closes = new Date(b.market.closes_at).getTime();
          return now.getTime() - closes <= 24 * 60 * 60 * 1000;
        });
      case "7d":
        return historyBets.filter((b) => {
          if (!b.market.closes_at) return false;
          const closes = new Date(b.market.closes_at).getTime();
          return now.getTime() - closes <= 7 * 24 * 60 * 60 * 1000;
        });
      case "30d":
        return historyBets.filter((b) => {
          if (!b.market.closes_at) return false;
          const closes = new Date(b.market.closes_at).getTime();
          return now.getTime() - closes <= 30 * 24 * 60 * 60 * 1000;
        });
      default:
        return historyBets;
    }
  }, [historyBets, historyFilter]);

  // Calculer les gains/pertes SOL nets (uniquement marchés résolus)
  const solStats = useMemo(() => {
    let totalWon = 0;
    let totalLost = 0;
    let totalNet = 0;
    let settledCount = 0;
    let pendingCount = 0;

    for (const agg of historyBets) {
      if (!agg.market.resolved || !agg.market.outcome) {
        pendingCount++;
        continue;
      }

      const pool = marketPools.get(agg.market_id);
      let aggNet = 0;
      let hasStake = false;

      for (const pos of agg.positions) {
        const stake = pos.total_stake;
        if (stake <= 0) continue;
        hasStake = true;

        if (pos.side === agg.market.outcome) {
          const payout = computeResolvedPayout(stake, pos.side, agg.market.outcome, pool);
          const net = (payout ?? stake) - stake;
          aggNet += net;
        } else {
          aggNet -= stake;
        }
      }

      if (!hasStake) continue;
      settledCount++;
      totalNet += aggNet;
      if (aggNet > 0) totalWon += aggNet;
      else if (aggNet < 0) totalLost += Math.abs(aggNet);
    }

    return { totalWon, totalLost, totalNet, settledCount, pendingCount };
  }, [historyBets, marketPools]);

  const analytics = useMemo(() => {
    const totalBets = historyBets.length + liveBets.length;
    if (totalBets === 0) {
      return {
        winRate: 0,
        bestCrypto: "—",
        bestKOL: "—",
        avgBetSize: 0,
        chartPoints: [] as ChartPoint[],
        totalPnL: 0,
        totalBets: 0,
        resolvedCount: 0,
        wonCount: 0,
        lostCount: 0,
      };
    }

    const resolved = historyBets.filter(
      (b) => b.market.resolved && b.market.outcome,
    );

    const marketPnls = resolved.map((b) => {
      let net = 0;
      for (const pos of b.positions) {
        const stake = pos.total_stake;
        const payout = computeResolvedPayout(
          stake,
          pos.side,
          b.market.outcome,
          marketPools.get(b.market_id),
        );
        net += (payout ?? 0) - stake;
      }
      return { ...b, net };
    });

    const wonMarkets = marketPnls.filter((b) => b.net > 0);
    const lostMarkets = marketPnls.filter((b) => b.net < 0);

    const winRate =
      marketPnls.length > 0 ? (wonMarkets.length / marketPnls.length) * 100 : 0;

    const bestCrypto = [...marketPnls]
      .filter(
        (b) => b.market.asset !== null && b.market.asset !== undefined,
      )
      .sort((a, b) => b.net - a.net)[0];

    const bestKOL = [...marketPnls]
      .filter((b) => b.market.tag?.toUpperCase() === "KOL")
      .sort((a, b) => b.net - a.net)[0];

    const avgBetSize =
      [...historyBets, ...liveBets].reduce((sum, b) => sum + b.total_stake, 0) /
      totalBets;

    const sortedResolved = [...marketPnls].sort(
      (a, b) =>
        new Date(a.latest_created_at).getTime() -
        new Date(b.latest_created_at).getTime(),
    );
    let cumulative = 0;
    const chartPoints = sortedResolved.map((b) => {
      cumulative += b.net;
      return {
        cumulative,
        net: b.net,
        question: b.market.question,
      };
    });

    return {
      winRate,
      bestCrypto: bestCrypto?.market.question ?? "—",
      bestKOL: bestKOL?.market.question ?? "—",
      avgBetSize,
      chartPoints,
      totalPnL: solStats.totalNet,
      totalBets,
      resolvedCount: marketPnls.length,
      wonCount: wonMarkets.length,
      lostCount: lostMarkets.length,
    };
  }, [historyBets, liveBets, marketPools, solStats]);

  const shortWallet = wallet ? `${wallet.slice(0, 4)}…${wallet.slice(-4)}` : null;

  return (
    <div className="min-h-screen bg-background text-foreground paper-grain">
      <ArenaNav active="portfolio" />

      <main className="mx-auto max-w-7xl px-6 py-12">
        <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <div className="font-mono text-xs uppercase tracking-widest text-foreground/60">— Your account</div>
            <h1 className="mt-2 font-display text-4xl font-black uppercase md:text-5xl">My Portfolio</h1>
            {shortWallet && (
              <div className="mt-2 flex items-center gap-3">
                <p className="font-mono text-sm text-foreground/70">Wallet {shortWallet}</p>
                {walletBalance !== null && (
                  <p className="font-mono text-sm font-bold text-foreground/90">
                    {walletBalance.toFixed(4)} SOL
                  </p>
                )}
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={() => setShowAnalytics((s) => !s)}
            className={`filter-btn-press cursor-pointer ink-border-sm border-2 px-4 py-2 font-mono text-xs font-bold uppercase tracking-wider transition-colors ${
              showAnalytics
                ? "border-foreground bg-foreground text-parchment"
                : "border-foreground/25 text-foreground/60 hover:border-foreground/50 hover:text-foreground/80"
            }`}
          >
            Analytics
          </button>
        </div>

        {!connected ? (
          <div className="mt-12 ink-border bg-parchment p-10 text-center">
            <p className="font-display text-2xl font-bold uppercase">Connect your wallet</p>
            <p className="mt-3 text-foreground/70">
              Link your Solana wallet to see your live bets and settlement history.
            </p>
            <button
              type="button"
              onClick={() => setVisible(true)}
              className="arena-wallet-btn-lg wallet-adapter-button mt-8 !inline-flex"
            >
              Select wallet
            </button>
          </div>
        ) : loading && bets.length === 0 ? (
          <p className="mt-12 font-mono text-sm uppercase tracking-wider text-foreground/60">Loading…</p>
        ) : (
          <>
            {showAnalytics && analytics && (
              <section className="mt-10 animate-fade-slide-up">
                <h2 className="mb-4 font-display text-2xl font-black uppercase">Analytics</h2>
                <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
                  <div className="ink-border-sm bg-parchment p-4">
                    <p className="font-mono text-[10px] uppercase tracking-wider text-foreground/50">Total PnL</p>
                    <p className={`mt-1 font-display text-2xl font-black ${analytics.totalPnL >= 0 ? "text-primary" : "text-accent"}`}>
                      {analytics.totalPnL >= 0 ? "+" : "−"}
                      {Math.abs(analytics.totalPnL).toFixed(4)} SOL
                    </p>
                  </div>
                  <div className="ink-border-sm bg-parchment p-4">
                    <p className="font-mono text-[10px] uppercase tracking-wider text-foreground/50">Win Rate</p>
                    <p className="mt-1 font-display text-2xl font-black text-foreground">
                      {analytics.winRate.toFixed(1)}%
                    </p>
                    <p className="mt-0.5 font-mono text-[10px] text-foreground/40">
                      {analytics.wonCount}W / {analytics.lostCount}L
                    </p>
                  </div>
                  <div className="ink-border-sm bg-parchment p-4">
                    <p className="font-mono text-[10px] uppercase tracking-wider text-foreground/50">Best Crypto</p>
                    <p className="mt-1 text-sm font-bold text-foreground line-clamp-2">{analytics.bestCrypto}</p>
                  </div>
                  <div className="ink-border-sm bg-parchment p-4">
                    <p className="font-mono text-[10px] uppercase tracking-wider text-foreground/50">Best KOL</p>
                    <p className="mt-1 text-sm font-bold text-foreground line-clamp-2">{analytics.bestKOL}</p>
                  </div>
                </div>
                <div className="mt-4 grid grid-cols-1 gap-4 md:grid-cols-3">
                  <div className="ink-border-sm bg-parchment p-4">
                    <p className="font-mono text-[10px] uppercase tracking-wider text-foreground/50">Avg Bet Size</p>
                    <p className="mt-1 font-display text-2xl font-black text-foreground">
                      {analytics.avgBetSize.toFixed(4)} SOL
                    </p>
                  </div>
                  <div className="ink-border-sm bg-parchment p-4 md:col-span-2">
                    <p className="font-mono text-[10px] uppercase tracking-wider text-foreground/50">PnL History</p>
                    <div className="mt-2">
                      <Sparkline data={analytics.chartPoints} width={400} height={60} />
                    </div>
                    <div className="mt-2 flex flex-wrap items-center gap-3 border-t border-foreground/10 pt-2">
                      <div className="flex items-center gap-1.5">
                        <span className="h-0.5 w-4 bg-primary" />
                        <span className="font-mono text-[10px] text-foreground/50">Up</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <span className="h-0.5 w-4 bg-accent" />
                        <span className="font-mono text-[10px] text-foreground/50">Down</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <span className="h-2 w-2 rounded-full bg-primary" />
                        <span className="font-mono text-[10px] text-foreground/50">Win</span>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <span className="h-2 w-2 rounded-full bg-accent" />
                        <span className="font-mono text-[10px] text-foreground/50">Loss</span>
                      </div>
                      <span className="font-mono text-[10px] text-foreground/40">Hover points for details</span>
                    </div>
                  </div>
                </div>
              </section>
            )}

            <section className="mt-12">
              <div className="mb-6 flex flex-col gap-4">
                <div className="flex items-baseline justify-between gap-4">
                  <div className="flex items-center gap-3">
                    <h2 className="font-display text-2xl font-black uppercase">Live bets</h2>
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-100 px-2.5 py-1 font-mono text-[10px] font-bold uppercase tracking-wider text-emerald-700">
                      <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-500" />
                      Live
                    </span>
                  </div>
                  <span className="font-mono text-xs uppercase tracking-wider text-foreground/55">
                    {liveBets.length} open
                  </span>
                </div>
                <div className="flex flex-wrap gap-2">
                  {[
                    { key: "all" as const, label: "All" },
                    { key: "ending-soon" as const, label: "Ending soon" },
                    { key: "high-volume" as const, label: "High volume" },
                    { key: "biggest" as const, label: "My biggest positions" },
                  ].map((f) => (
                    <button
                      key={f.key}
                      onClick={() => setLiveFilter(f.key)}
                      className={`filter-btn-press border-2 px-2.5 py-1 font-mono text-[10px] font-bold uppercase tracking-wider transition-colors ${
                        liveFilter === f.key
                          ? "border-foreground bg-foreground text-parchment"
                          : "border-foreground/20 text-foreground/60 hover:border-foreground/40 hover:text-foreground/80"
                      }`}
                    >
                      {f.label}
                    </button>
                  ))}
                </div>
              </div>
              {liveBets.length === 0 ? (
                <div className="ink-border-sm border-dashed bg-parchment/50 p-8 text-center font-mono text-sm text-foreground/60">
                  No open bets.
                </div>
              ) : (
                <ul className="space-y-3">
                  {filteredLiveBets.map((bet, i) => (
                    <BetCard key={bet.market_id} agg={bet} status="live" pool={marketPools.get(bet.market_id)} index={i} />
                  ))}
                </ul>
              )}
            </section>

            <section className="mt-16">
              <div className="mb-6 flex flex-col gap-4">
                <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                  <h2 className="font-display text-2xl font-black uppercase">History</h2>
                  <div className="ink-border-sm min-w-[14rem] bg-parchment px-5 py-4 text-center sm:text-right">
                    <div className="font-mono text-xs uppercase tracking-wider text-foreground/60">
                      Total PnL (SOL)
                    </div>
                    <div
                      className={`font-display text-4xl font-black ${
                        solStats.totalNet >= 0 ? "text-primary" : "text-accent"
                      }`}
                    >
                      {solStats.settledCount > 0 ? (
                        <>
                          {solStats.totalNet >= 0 ? "+" : "−"}
                          {Math.abs(solStats.totalNet).toFixed(4)} SOL
                        </>
                      ) : solStats.pendingCount > 0 ? (
                        <span className="text-foreground/40">Pending</span>
                      ) : (
                        <>
                          {solStats.totalNet >= 0 ? "+" : "−"}
                          {Math.abs(solStats.totalNet).toFixed(4)} SOL
                        </>
                      )}
                    </div>
                    <p className="mt-1 font-mono text-[10px] uppercase tracking-wider text-foreground/50">
                      {solStats.settledCount} bet{solStats.settledCount === 1 ? "" : "s"} · +
                      {solStats.totalWon.toFixed(4)} won · −
                      {solStats.totalLost.toFixed(4)} lost
                      {solStats.pendingCount > 0 && ` · ${solStats.pendingCount} pending resolution`}
                    </p>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  {[
                    { key: "all" as const, label: "All" },
                    { key: "won" as const, label: "Won" },
                    { key: "lost" as const, label: "Lost" },
                    { key: "pending" as const, label: "Pending" },
                    { key: "kol" as const, label: "KOL" },
                    { key: "crypto" as const, label: "Crypto" },
                    { key: "24h" as const, label: "24h" },
                    { key: "7d" as const, label: "7d" },
                    { key: "30d" as const, label: "30d" },
                  ].map((f) => (
                    <button
                      key={f.key}
                      onClick={() => setHistoryFilter(f.key)}
                      className={`filter-btn-press border-2 px-2.5 py-1 font-mono text-[10px] font-bold uppercase tracking-wider transition-colors ${
                        historyFilter === f.key
                          ? "border-foreground bg-foreground text-parchment"
                          : "border-foreground/20 text-foreground/60 hover:border-foreground/40 hover:text-foreground/80"
                      }`}
                    >
                      {f.label}
                    </button>
                  ))}
                </div>
              </div>
              {filteredHistoryBets.length === 0 ? (
                <div className="ink-border-sm border-dashed bg-parchment/50 p-8 text-center font-mono text-sm text-foreground/60">
                  No settled bets yet.
                </div>
              ) : (
                <ul className="space-y-3">
                  {filteredHistoryBets.map((bet, i) => {
                    if (!bet.market.resolved) {
                      return (
                        <BetCard
                          key={bet.market_id}
                          agg={bet}
                          status="pending"
                          pool={marketPools.get(bet.market_id)}
                          index={i}
                        />
                      );
                    }
                    const won = bet.positions.some((p) => p.side === bet.market.outcome);
                    return (
                      <BetCard
                        key={bet.market_id}
                        agg={bet}
                        status={won ? "won" : "lost"}
                        outcome={bet.market.outcome}
                        pool={marketPools.get(bet.market_id)}
                        index={i}
                      />
                    );
                  })}
                </ul>
              )}
            </section>
          </>
        )}
      </main>
    </div>
  );
}

type ChartPoint = {
  cumulative: number;
  net: number;
  question: string;
};

function Sparkline({ data, width = 400, height = 60 }: { data: ChartPoint[]; width?: number; height?: number }) {
  const [hovered, setHovered] = useState<number | null>(null);

  if (data.length < 2) {
    return <div className="h-[60px] w-full bg-foreground/5" />;
  }

  const values = data.map((d) => d.cumulative);
  const min = Math.min(...values, 0);
  const max = Math.max(...values, 0);
  const range = max - min || 1;

  const getXY = (i: number) => {
    const x = (i / (data.length - 1)) * width;
    const y = height - ((values[i] - min) / range) * height;
    return { x, y };
  };

  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="h-[60px] w-full"
        preserveAspectRatio="none"
        style={{ overflow: "visible" }}
      >
        {/* Remplissage d'aire : vert au-dessus de zéro, rouge en-dessous */}
        {data.map((_, i) => {
          if (i === data.length - 1) return null;
          const from = getXY(i);
          const to = getXY(i + 1);
          const zeroY = height - ((0 - min) / range) * height;
          const y1 = from.y;
          const y2 = to.y;

          // Les deux points au-dessus du zéro
          if (y1 <= zeroY && y2 <= zeroY) {
            return (
              <polygon
                key={`area-${i}`}
                points={`${from.x},${from.y} ${to.x},${to.y} ${to.x},${zeroY} ${from.x},${zeroY}`}
                fill="var(--primary)"
                fillOpacity="0.12"
              />
            );
          }

          // Les deux points en-dessous du zéro
          if (y1 >= zeroY && y2 >= zeroY) {
            return (
              <polygon
                key={`area-${i}`}
                points={`${from.x},${zeroY} ${to.x},${zeroY} ${to.x},${to.y} ${from.x},${from.y}`}
                fill="var(--accent)"
                fillOpacity="0.12"
              />
            );
          }

          // Traversée du zéro : interpolation
          const t = (zeroY - y1) / (y2 - y1);
          const xi = from.x + (to.x - from.x) * t;

          if (y1 < zeroY) {
            // De au-dessus vers en-dessous
            return (
              <g key={`area-${i}`}>
                <polygon
                  points={`${from.x},${from.y} ${xi},${zeroY} ${from.x},${zeroY}`}
                  fill="var(--primary)"
                  fillOpacity="0.12"
                />
                <polygon
                  points={`${xi},${zeroY} ${to.x},${to.y} ${to.x},${zeroY}`}
                  fill="var(--accent)"
                  fillOpacity="0.12"
                />
              </g>
            );
          }

          // De en-dessous vers au-dessus
          return (
            <g key={`area-${i}`}>
              <polygon
                points={`${from.x},${from.y} ${xi},${zeroY} ${from.x},${zeroY}`}
                fill="var(--accent)"
                fillOpacity="0.12"
              />
              <polygon
                points={`${xi},${zeroY} ${to.x},${to.y} ${to.x},${zeroY}`}
                fill="var(--primary)"
                fillOpacity="0.12"
              />
            </g>
          );
        })}
        {/* Lignes : vert au-dessus de zéro, rouge en-dessous */}
        {data.map((_, i) => {
          if (i === data.length - 1) return null;
          const from = getXY(i);
          const to = getXY(i + 1);
          const zeroY = height - ((0 - min) / range) * height;
          const y1 = from.y;
          const y2 = to.y;

          // Les deux points au-dessus du zéro
          if (y1 <= zeroY && y2 <= zeroY) {
            return (
              <line
                key={`seg-${i}`}
                x1={from.x}
                y1={from.y}
                x2={to.x}
                y2={to.y}
                stroke="var(--primary)"
                strokeWidth="2.5"
                strokeLinecap="round"
              />
            );
          }

          // Les deux points en-dessous du zéro
          if (y1 >= zeroY && y2 >= zeroY) {
            return (
              <line
                key={`seg-${i}`}
                x1={from.x}
                y1={from.y}
                x2={to.x}
                y2={to.y}
                stroke="var(--accent)"
                strokeWidth="2.5"
                strokeLinecap="round"
              />
            );
          }

          // Traversée du zéro : interpolation
          const t = (zeroY - y1) / (y2 - y1);
          const xi = from.x + (to.x - from.x) * t;

          if (y1 < zeroY) {
            // De au-dessus vers en-dessous
            return (
              <g key={`seg-${i}`}>
                <line
                  x1={from.x}
                  y1={from.y}
                  x2={xi}
                  y2={zeroY}
                  stroke="var(--primary)"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                />
                <line
                  x1={xi}
                  y1={zeroY}
                  x2={to.x}
                  y2={to.y}
                  stroke="var(--accent)"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                />
              </g>
            );
          }

          // De en-dessous vers au-dessus
          return (
            <g key={`seg-${i}`}>
              <line
                x1={from.x}
                y1={from.y}
                x2={xi}
                y2={zeroY}
                stroke="var(--accent)"
                strokeWidth="2.5"
                strokeLinecap="round"
              />
              <line
                x1={xi}
                y1={zeroY}
                x2={to.x}
                y2={to.y}
                stroke="var(--primary)"
                strokeWidth="2.5"
                strokeLinecap="round"
              />
            </g>
          );
        })}
        {/* Ligne de référence zéro */}
        {min < 0 && max > 0 && (
          <line
            x1={0}
            x2={width}
            y1={height - ((0 - min) / range) * height}
            y2={height - ((0 - min) / range) * height}
            stroke="var(--foreground)"
            strokeWidth="0.5"
            strokeDasharray="4 4"
            opacity="0.3"
          />
        )}
        {/* Points interactifs */}
        {data.map((_, i) => {
          const { x, y } = getXY(i);
          const isHover = hovered === i;
          const pointColor = data[i].net >= 0 ? "var(--primary)" : "var(--accent)";
          return (
            <circle
              key={i}
              cx={x}
              cy={y}
              r={isHover ? 5 : 2.5}
              fill={pointColor}
              stroke={isHover ? "var(--foreground)" : "none"}
              strokeWidth={isHover ? 2 : 0}
              style={{ cursor: "pointer", transition: "r 150ms ease" }}
              onMouseEnter={() => setHovered(i)}
              onMouseLeave={() => setHovered(null)}
            />
          );
        })}
      </svg>
      {/* Tooltip */}
      {hovered !== null && (
        <div className="absolute z-20 -translate-x-1/2 -translate-y-full pb-2" style={{ left: `${(hovered / (data.length - 1)) * 100}%`, top: 0 }}>
          <div className="ink-border-sm bg-parchment px-3 py-2 shadow-lg">
            <p className="max-w-[220px] font-mono text-[10px] font-bold uppercase tracking-wider text-foreground/70 line-clamp-2">
              {data[hovered].question}
            </p>
            <p className={`mt-0.5 font-mono text-xs font-bold ${data[hovered].net >= 0 ? "text-primary" : "text-accent"}`}>
              {data[hovered].net >= 0 ? "+" : "−"}
              {Math.abs(data[hovered].net).toFixed(4)} SOL
            </p>
            <p className="mt-0.5 font-mono text-[10px] text-foreground/40">
              Cumul: {data[hovered].cumulative >= 0 ? "+" : "−"}
              {Math.abs(data[hovered].cumulative).toFixed(4)} SOL
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

function tagSymbol(tag: string) {
  const map: Record<string, string> = {
    BTC: "₿", ETH: "Ξ", SOL: "◎", BNB: "B", DOGE: "Ð",
    XRP: "✕", SHIB: "S", TRX: "T", ZCASH: "Z", TROLL: "T",
  };
  return map[tag] ?? null;
}

function computePotentialPayout(
  stake: number,
  side: string,
  pool: { yes: number; no: number } | undefined,
): number {
  if (!pool || stake <= 0) return stake;
  const winningPool = side === "YES" ? pool.yes : pool.no;
  const losingPool = side === "YES" ? pool.no : pool.yes;
  if (winningPool <= 0) return stake;
  return stake + (stake / winningPool) * losingPool;
}

function computeResolvedPayout(
  stake: number,
  side: string,
  outcome: string | null,
  pool: { yes: number; no: number } | undefined,
): number | null {
  if (!outcome || !pool || stake <= 0) return null;
  if (side !== outcome) return 0;
  const winningPool = side === "YES" ? pool.yes : pool.no;
  const losingPool = side === "YES" ? pool.no : pool.yes;
  if (winningPool <= 0) return stake;
  return stake + (stake / winningPool) * losingPool;
}

function BetCard({
  agg,
  status,
  outcome,
  pool,
  index = 0,
}: {
  agg: AggregatedBet;
  status: "live" | "won" | "lost" | "pending";
  outcome?: string | null;
  pool?: { yes: number; no: number };
  index?: number;
}) {
  const isLive = status === "live";
  const totalStake = agg.total_stake;
  const hasMultiplePositions = agg.positions.length > 1;

  // Payout potentiel total (somme de tous les payouts par position)
  const totalPotentialPayout = isLive
    ? agg.positions.reduce(
        (sum: number, p: PositionAgg) =>
          sum + computePotentialPayout(p.total_stake, p.side, pool),
        0,
      )
    : null;

  // Net result for resolved markets (payout - stake for each position)
  const totalResolvedNet = status === "won" || status === "lost"
    ? agg.positions.reduce((sum: number, p: PositionAgg) => {
        const payout = computeResolvedPayout(
          p.total_stake,
          p.side,
          agg.market.outcome,
          pool,
        );
        return sum + ((payout ?? 0) - p.total_stake);
      }, 0)
    : null;

  // Gross payout (stake returned + winnings) for display
  const totalResolvedPayout = status === "won" || status === "lost"
    ? agg.positions.reduce((sum: number, p: PositionAgg) => {
        const payout = computeResolvedPayout(
          p.total_stake,
          p.side,
          agg.market.outcome,
          pool,
        );
        return sum + (payout ?? 0);
      }, 0)
    : null;

  const totalPool = pool ? pool.yes + pool.no : 0;
  const yesPct = totalPool > 0 ? (pool!.yes / totalPool) * 100 : 50;

  return (
    <li className="list-none">
      <div className="group relative">
        {/* Ombre (reste au sol) */}
        <div className="ink-border-sm absolute inset-0 bg-foreground transition-transform duration-200 ease-out group-hover:translate-x-[10px] group-hover:translate-y-[10px]" />
        {/* Carte (se soulève) */}
        <div
          className={`ink-border-sm relative z-10 p-5 animate-fade-slide-up transition-transform duration-200 ease-out group-hover:-translate-x-2 group-hover:-translate-y-2 ${isLive ? "bg-parchment animate-live-glow" : "bg-muted"}`}
          style={{ animationDelay: `${index * 60}ms` }}
        >
      {/* Header : tag + status à gauche, countdown à droite */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1.5 border-2 border-foreground px-2 py-0.5 font-mono text-[10px] font-bold uppercase tracking-wider text-foreground">
            {tagSymbol(agg.market.tag) && (
              <span className="text-foreground/40">{tagSymbol(agg.market.tag)}</span>
            )}
            {agg.market.tag}
          </span>

          {isLive && (
            <span className="animate-badge-pop inline-flex items-center gap-1.5 bg-primary px-2.5 py-1 font-mono text-[10px] font-bold uppercase tracking-wider text-primary-foreground">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-primary-foreground" />
              Live
            </span>
          )}
          {status === "won" && (
            <span className="animate-badge-pop bg-primary px-2.5 py-1 font-mono text-[10px] font-bold uppercase text-primary-foreground">
              Won
            </span>
          )}
          {status === "lost" && (
            <span className="animate-badge-pop bg-accent px-2.5 py-1 font-mono text-[10px] font-bold uppercase text-accent-foreground">
              Lost
            </span>
          )}
          {status === "pending" && (
            <span className="animate-badge-pop bg-secondary px-2.5 py-1 font-mono text-[10px] font-bold uppercase text-secondary-foreground">
              Pending
            </span>
          )}
        </div>

        {isLive && agg.market.closes_at && (
          <div className="flex shrink-0 items-center gap-1.5 font-mono text-xs text-foreground/50">
            <Clock className="h-3.5 w-3.5" />
            <MarketCountdown
              closes_at={agg.market.closes_at}
              className="bg-transparent p-0 text-foreground/70"
            />
          </div>
        )}
      </div>

      {/* Question */}
      <p className="mt-3 text-lg font-semibold leading-snug">{agg.market.question}</p>

      {/* Positions multiples ou unique */}
      {hasMultiplePositions ? (
        <div className="mt-4 space-y-2">
          {agg.positions.map((pos) => (
            <div key={pos.side} className="border-2 border-foreground p-3">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-mono text-[10px] uppercase tracking-wider text-foreground/50">
                    Position
                  </p>
                  <p className={`mt-0.5 text-sm font-bold ${pos.side === "YES" ? "text-primary" : "text-accent"}`}>
                    {pos.side}
                    {pos.count > 1 && (
                      <span className="ml-1 text-xs font-normal text-foreground/40">
                        ({pos.count} bets)
                      </span>
                    )}
                  </p>
                </div>
                <div className="text-right">
                  <p className="font-mono text-[10px] uppercase tracking-wider text-foreground/50">
                    Stake
                  </p>
                  <p className="mt-0.5 text-sm font-bold">
                    {pos.total_stake.toFixed(4)}{" "}
                    <span className="text-xs font-normal text-foreground/60">SOL</span>
                  </p>
                </div>
                {isLive && (
                  <div className="text-right">
                    <p className="font-mono text-[10px] uppercase tracking-wider text-foreground/50">
                      Potential payout
                    </p>
                    <p className="mt-0.5 text-sm font-bold text-primary">
                      +{computePotentialPayout(pos.total_stake, pos.side, pool).toFixed(4)}{" "}
                      <span className="text-xs font-normal text-foreground/60">SOL</span>
                    </p>
                  </div>
                )}
                {!isLive && status !== "pending" && (
                  <div className="text-right">
                    <p className="font-mono text-[10px] uppercase tracking-wider text-foreground/50">
                      Result
                    </p>
                    {pos.side === agg.market.outcome ? (
                      <p className="mt-0.5 text-sm font-bold text-primary">
                        +{(computeResolvedPayout(pos.total_stake, pos.side, agg.market.outcome, pool) ?? 0).toFixed(4)}{" "}
                        <span className="text-xs font-normal text-foreground/60">SOL</span>
                      </p>
                    ) : (
                      <p className="mt-0.5 text-sm font-bold text-accent">
                        −{pos.total_stake.toFixed(4)}{" "}
                        <span className="text-xs font-normal text-foreground/60">SOL</span>
                      </p>
                    )}
                  </div>
                )}
              </div>
            </div>
          ))}

          {/* Total row */}
          <div className="flex items-center justify-between border-t-2 border-foreground/10 pt-2">
            <p className="font-mono text-[10px] uppercase tracking-wider text-foreground/50">
              Total stake
            </p>
            <p className="font-mono text-sm font-bold">
              {totalStake.toFixed(4)}{" "}
              <span className="text-xs font-normal text-foreground/60">SOL</span>
            </p>
          </div>
          {/* Net result global */}
          {status !== "pending" && totalResolvedNet !== null && (
            <div className="flex items-center justify-between">
              <p className="font-mono text-[10px] uppercase tracking-wider text-foreground/50">
                Net result
              </p>
              <p className={`font-mono text-sm font-bold ${totalResolvedNet >= 0 ? "text-primary" : "text-accent"}`}>
                {totalResolvedNet >= 0 ? "+" : "−"}
                {Math.abs(totalResolvedNet).toFixed(4)}{" "}
                <span className="text-xs font-normal text-foreground/60">SOL</span>
              </p>
            </div>
          )}
          {/* Gross result for won markets (shows recovered stake) */}
          {status === "won" && totalResolvedPayout !== null && (
            <div className="flex items-center justify-between">
              <p className="font-mono text-[10px] uppercase tracking-wider text-foreground/50">
                Result
              </p>
              <p className="font-mono text-sm font-bold text-primary">
                +{totalResolvedPayout.toFixed(4)}{" "}
                <span className="text-xs font-normal text-foreground/60">SOL</span>
              </p>
            </div>
          )}
        </div>
      ) : (
        /* 3 colonnes pour une seule position */
        <div className="mt-4 grid grid-cols-3 gap-3">
          {/* Position */}
          <div className="border-2 border-foreground p-3">
            <p className="font-mono text-[10px] uppercase tracking-wider text-foreground/50">
              Position
            </p>
            <p className={`mt-0.5 text-sm font-bold ${agg.positions[0]?.side === "YES" ? "text-primary" : "text-accent"}`}>
              {agg.positions[0]?.side}
            </p>
          </div>

          {/* Stake */}
          <div className="border-2 border-foreground p-3">
            <p className="font-mono text-[10px] uppercase tracking-wider text-foreground/50">
              Stake
            </p>
            <p className="mt-0.5 text-sm font-bold">
              {totalStake.toFixed(4)}{" "}
              <span className="text-xs font-normal text-foreground/60">SOL</span>
            </p>
          </div>

          {/* Payout / Result */}
          <div className="border-2 border-foreground p-3">
            {isLive && totalPotentialPayout !== null ? (
              <>
                <p className="font-mono text-[10px] uppercase tracking-wider text-foreground/50">
                  Potential payout
                </p>
                <p className="mt-0.5 text-sm font-bold text-primary">
                  +{totalPotentialPayout.toFixed(4)}{" "}
                  <span className="text-xs font-normal text-foreground/60">SOL</span>
                </p>
              </>
            ) : status === "won" && totalResolvedPayout !== null ? (
              <>
                <p className="font-mono text-[10px] uppercase tracking-wider text-foreground/50">
                  Result
                </p>
                <p className="mt-0.5 text-sm font-bold text-primary">
                  +{totalResolvedPayout.toFixed(4)}{" "}
                  <span className="text-xs font-normal text-foreground/60">SOL</span>
                </p>
                {totalResolvedNet === 0 && pool && (
                  <p className="mt-1 text-[10px] text-foreground/40">
                    No counterparty
                  </p>
                )}
              </>
            ) : status === "lost" && totalResolvedNet !== null ? (
              <>
                <p className="font-mono text-[10px] uppercase tracking-wider text-foreground/50">
                  Result
                </p>
                <p className="mt-0.5 text-sm font-bold text-accent">
                  −{Math.abs(totalResolvedNet).toFixed(4)}{" "}
                  <span className="text-xs font-normal text-foreground/60">SOL</span>
                </p>
              </>
            ) : (
              <>
                <p className="font-mono text-[10px] uppercase tracking-wider text-foreground/50">
                  Result
                </p>
                <p className="mt-0.5 text-sm font-bold text-amber-600">Pending</p>
              </>
            )}
          </div>
        </div>
      )}

      {/* Barre de proportion YES / NO du pool (live uniquement) */}
      {isLive && pool && (
        <div className="mt-4">
          <div className="mb-1.5 flex items-center justify-between font-mono text-[10px] uppercase tracking-wider text-foreground/50">
            <span>Market pool</span>
            <span>{totalPool.toFixed(4)} SOL total</span>
          </div>
          <div className="flex h-6 items-stretch border-2 border-foreground overflow-hidden">
            {/* YES */}
            <div
              className="pool-bar-segment flex items-center justify-start bg-primary/20 px-2"
              style={{ width: `${yesPct}%`, minWidth: yesPct > 0 ? "2rem" : "0" }}
            >
              {yesPct >= 15 && (
                <span className="font-mono text-[10px] font-bold text-primary whitespace-nowrap">
                  YES {pool.yes.toFixed(4)}
                </span>
              )}
            </div>
            {/* NO */}
            <div
              className="pool-bar-segment flex items-center justify-end bg-accent/20 px-2"
              style={{ width: `${100 - yesPct}%`, minWidth: 100 - yesPct > 0 ? "2rem" : "0" }}
            >
              {100 - yesPct >= 15 && (
                <span className="font-mono text-[10px] font-bold text-accent whitespace-nowrap">
                  NO {pool.no.toFixed(4)}
                </span>
              )}
            </div>
          </div>
          {/* Labels sous la barre si trop petits pour s'afficher dedans */}
          {(yesPct < 15 || 100 - yesPct < 15) && (
            <div className="mt-1 flex justify-between font-mono text-[10px]">
              {yesPct < 15 && (
                <span className="text-primary font-bold">YES {pool.yes.toFixed(4)} SOL</span>
              )}
              {100 - yesPct < 15 && (
                <span className="text-accent font-bold">NO {pool.no.toFixed(4)} SOL</span>
              )}
            </div>
          )}
        </div>
      )}

      {/* Footer : date + View Market */}
      <div className="mt-4 flex items-center justify-between">
        <div className="font-mono text-[10px] text-foreground/40">
          {isLive ? (
            <span>Opened {new Date(agg.earliest_created_at).toLocaleString("en-GB", {
              day: "2-digit",
              month: "short",
              hour: "2-digit",
              minute: "2-digit",
            })}</span>
          ) : agg.market.closes_at ? (
            <span>Closed {new Date(agg.market.closes_at).toLocaleString("en-GB", {
              day: "2-digit",
              month: "short",
              hour: "2-digit",
              minute: "2-digit",
            })}</span>
          ) : null}
        </div>
        <Link
          to="/market/$marketId"
          params={{ marketId: agg.market_id }}
          className="inline-flex items-center gap-1.5 border-2 border-foreground px-3 py-1.5 font-mono text-[11px] uppercase tracking-wider text-foreground transition-colors hover:bg-foreground hover:text-parchment"
        >
          View Market
          <ExternalLink className="h-3 w-3" />
        </Link>
      </div>
        </div>
      </div>
    </li>
  );
}
