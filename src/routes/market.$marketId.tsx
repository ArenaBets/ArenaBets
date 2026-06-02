import { createFileRoute, useParams, useNavigate } from "@tanstack/react-router";
import { useWallet } from "@solana/wallet-adapter-react";
import { useMemo, useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { ArenaBetRow } from "@/hooks/use-arena-live";
import { useMarketDetail } from "@/hooks/use-market-detail";
import { formatCryptoPrice } from "@/hooks/use-crypto-prices";
import { CryptoPriceChart } from "@/components/crypto-price-chart";
import { CRYPTO_ASSETS } from "@/lib/crypto-markets";
import { ArenaNav } from "@/components/arena-nav";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ArrowLeft, TrendingUp, TrendingDown, Wallet, Users } from "lucide-react";
import { BetModal } from "@/components/bet-modal";
import { KOL_TEST, type KOLStat } from "@/components/kol-leaderboard";

export const Route = createFileRoute("/market/$marketId")({
  component: MarketDetailPage,
});

function MarketDetailPage() {
  const { marketId } = useParams({ from: "/market/$marketId" });
  const navigate = useNavigate();
  const { publicKey } = useWallet();
  const { market, bets, setBets, history, loading, isArchived, betStats } = useMarketDetail(marketId);
  const [solBalance, setSolBalance] = useState<number | null>(null);
  const [betModalOpen, setBetModalOpen] = useState(false);
  const [betSide, setBetSide] = useState<"YES" | "NO" | null>(null);
  const [kolStat, setKolStat] = useState<KOLStat | null>(null);
  const [kolRank, setKolRank] = useState<number | null>(null);

  function sortKOLStats(allStats: KOLStat[]) {
    return [...allStats].sort((a, b) => {
      const aHasTrades = a.total_trades && a.total_trades > 0;
      const bHasTrades = b.total_trades && b.total_trades > 0;
      if (!aHasTrades && bHasTrades) return 1;
      if (aHasTrades && !bHasTrades) return -1;
      return (b.pnl_sol ?? -Infinity) - (a.pnl_sol ?? -Infinity);
    });
  }

  // Récupérer les stats KOL depuis le même snapshot serveur que le leaderboard.
  useEffect(() => {
    if (!market || market.tag !== "KOL") return;
    const kolName = market.kol_params?.kol_name ?? market.asset;
    const kol = KOL_TEST.find((k) => k.name === kolName);
    if (!kol) return;
    const selectedKol = kol;

    let cancelled = false;
    setKolStat(null);
    setKolRank(null);

    function applyStats(allStats: KOLStat[]) {
      const found = allStats.find((s) => s.name === selectedKol.name);
      if (found && !found.loading && !cancelled) {
        setKolStat(found);
      }

      const rank = sortKOLStats(allStats).findIndex((s) => s.name === selectedKol.name) + 1;
      if (rank > 0 && !cancelled) setKolRank(rank);
      return Boolean(found && !found.loading);
    }

    const cached = localStorage.getItem("kol_leaderboard_cache");
    if (cached) {
      try {
        const { data } = JSON.parse(cached);
        const allStats: KOLStat[] = data;
        if (Array.isArray(allStats) && applyStats(allStats)) return () => { cancelled = true; };
      } catch {}
    }

    async function loadFromSupabase() {
      const hourStart = new Date();
      hourStart.setMinutes(0, 0, 0);

      let { data } = await supabase
        .from("kol_hourly_snapshots" as any)
        .select("*")
        .gte("snapshot_hour", hourStart.toISOString())
        .order("snapshot_hour", { ascending: false });

      let rows = (Array.isArray(data) ? data : []) as any[];
      if (rows.length === 0) {
        const latestHour = await supabase
          .from("kol_hourly_snapshots" as any)
          .select("snapshot_hour")
          .order("snapshot_hour", { ascending: false })
          .limit(1)
          .maybeSingle();
        const latestHourData = latestHour.data as { snapshot_hour?: string } | null;

        if (latestHourData?.snapshot_hour) {
          const latestSnapshots = await supabase
            .from("kol_hourly_snapshots" as any)
            .select("*")
            .eq("snapshot_hour", latestHourData.snapshot_hour)
            .order("snapshot_hour", { ascending: false });
          rows = (Array.isArray(latestSnapshots.data) ? latestSnapshots.data : []) as any[];
        }
      }

      if (rows.length > 0) {
        const stats = KOL_TEST.map((k) => {
          const row = rows.find((entry: any) => entry.wallet === k.wallet);
          return {
            ...k,
            balance_sol: row?.balance_sol ?? null,
            pnl_sol: row?.pnl_sol ?? null,
            pnl_percent: row?.pnl_percent ?? null,
            win_rate: null,
            total_trades: row?.total_trades ?? null,
            sells: row?.sells ?? null,
            buys: row?.buys ?? null,
            snapshot_hour: row?.snapshot_hour ?? null,
            loading: false,
            error: false,
          } satisfies KOLStat;
        });
        applyStats(stats);
      }
    }

    loadFromSupabase();
    return () => { cancelled = true; };
  }, [market]);

  // Récupérer le solde SOL
  useEffect(() => {
    async function getBalance() {
      if (!publicKey) return;
      try {
        const { Connection } = await import("@solana/web3.js");
        const conn = new Connection(
          import.meta.env.VITE_SOLANA_PUBLIC_RPC_URL || import.meta.env.VITE_SOLANA_RPC_URL || "https://solana-rpc.publicnode.com"
        );
        const balance = await conn.getBalance(publicKey);
        setSolBalance(balance / 1e9);
      } catch {
        setSolBalance(null);
      }
    }
    getBalance();
  }, [publicKey]);

  const currentPrice = history.length > 0 ? history[history.length - 1].close : 0;
  const startPrice = history.length > 0 ? history[0].close : 0;
  const change24h = startPrice > 0 ? ((currentPrice - startPrice) / startPrice) * 100 : 0;
  const isClosed = market?.resolved || new Date(market?.closes_at ?? 0).getTime() <= Date.now();

  // Mon pari (depuis snapshot ou bets live)
  const myBetFromSnapshot = useMemo(() => {
    if (!publicKey) return null;
    const wallet = publicKey.toBase58();
    return bets.find(b => b.wallet === wallet) ?? null;
  }, [bets, publicKey]);

  // Fallback DB pour marchés fermés où le snapshot pourrait être incomplet
  const [myBetFromDb, setMyBetFromDb] = useState<ArenaBetRow | null>(null);
  useEffect(() => {
    if (!publicKey || !marketId) return;
    if (!isClosed || myBetFromSnapshot) return;
    const wallet = publicKey.toBase58();
    supabase
      .from("bets")
      .select("market_id,wallet,side,amount_sol,created_at")
      .eq("market_id", marketId)
      .eq("wallet", wallet)
      .single()
      .then(({ data }) => {
        if (data) setMyBetFromDb(data as ArenaBetRow);
      });
  }, [publicKey, marketId, isClosed, myBetFromSnapshot]);

  const myBet = myBetFromSnapshot ?? myBetFromDb;

  if (loading) {
    return (
      <div className="min-h-screen bg-background">
        <ArenaNav />
        <main className="container mx-auto p-4">
          <div className="animate-pulse space-y-4">
            <div className="h-8 w-32 bg-muted rounded" />
            <div className="h-64 bg-muted rounded" />
          </div>
        </main>
      </div>
    );
  }

  if (!market) {
    return (
      <div className="min-h-screen bg-background">
        <ArenaNav />
        <main className="container mx-auto p-4">
          <Button variant="ghost" className="mb-4" onClick={() => navigate({ to: "/cryptomarkets" })}>
            <ArrowLeft className="mr-2 h-4 w-4" />
            Back to markets
          </Button>
          <Card>
            <CardContent className="p-8 text-center">
              <p className="text-muted-foreground">Market not found</p>
            </CardContent>
          </Card>
        </main>
      </div>
    );
  }

  const assetConfig = CRYPTO_ASSETS.find(a => a.symbol === market.asset);
  const kolName = market.tag === "KOL" ? (market.kol_params?.kol_name ?? market.asset ?? "KOL") : null;

  return (
    <div className="min-h-screen bg-background">
      <ArenaNav />
      
      <main className="container mx-auto p-4 max-w-7xl">
        {/* Back button */}
        <Button
          variant="ghost"
          className="mb-4 -ml-2"
          onClick={() =>
            navigate({ to: market.tag === "KOL" ? "/kolmarkets" : "/cryptomarkets" })
          }
        >
          <ArrowLeft className="mr-2 h-4 w-4" />
          {market.tag === "KOL" ? "Back to KOL markets" : "Back to markets"}
        </Button>

        {/* Header avec titre */}
        <div className="mb-6">
          <div className="flex items-center gap-3 mb-2">
            <span className="rounded-md bg-foreground px-3 py-1 font-mono text-xs font-bold uppercase tracking-wider text-background">
              {kolName ?? market.asset ?? "MARKET"}
            </span>
            <span className={`rounded-md px-3 py-1 font-mono text-xs font-bold uppercase tracking-wider ${
              isClosed 
                ? "bg-red-100 text-red-700" 
                : "bg-green-100 text-green-700"
            }`}>
              {isClosed ? "CLOSED" : "OPEN"}
            </span>
            {market.outcome && (
              <span className="rounded-md bg-foreground/10 px-3 py-1 font-mono text-xs font-bold uppercase">
                Outcome: {market.outcome}
              </span>
            )}
          </div>
          <h1 className="font-display text-3xl font-black uppercase leading-tight">
            {market.question}
          </h1>
        </div>

        {/* Layout principal: Chart à gauche, Actions à droite */}
        <div className="grid gap-6 lg:grid-cols-3">
          {/* Gauche: Chart */}
          <div className="lg:col-span-2 space-y-6">
            {/* Chart pour les marchés crypto / KOL table pour les marchés KOL */}
            {market.tag === "KOL" ? (
              <Card>
                <CardHeader className="pb-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className="flex h-14 w-14 items-center justify-center rounded-lg bg-foreground text-background font-display text-2xl font-black">
                        {kolRank ?? "—"}
                      </div>
                      <div>
                        <CardTitle className="font-display text-3xl font-black uppercase tracking-tight">
                          <a
                            href={kolStat ? `https://kolscan.io/account/${kolStat.wallet}` : "#"}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="hover:text-primary transition-colors"
                          >
                            {kolName}
                          </a>
                        </CardTitle>
                        <p className="text-sm text-muted-foreground font-mono">
                          KOL Performance
                        </p>
                      </div>
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="pt-6">
                  <div className="grid grid-cols-2 md:grid-cols-5 gap-x-8 gap-y-6">
                    <div className="text-center">
                      <p className="text-xs font-mono uppercase tracking-wider text-muted-foreground">Balance</p>
                      <p className="text-2xl font-bold font-mono mt-1">
                        {!kolStat ? "..." :
                         kolStat.balance_sol === null ? "—" :
                         `${kolStat.balance_sol.toFixed(2)} SOL`}
                      </p>
                    </div>
                    <div className="text-center">
                      <p className="text-xs font-mono uppercase tracking-wider text-muted-foreground">PnL 1h (SOL)</p>
                      <p className={`text-2xl font-bold font-mono mt-1 ${
                        !kolStat ? "text-muted-foreground" :
                        kolStat.error ? "text-red-400" :
                        kolStat.pnl_sol === null ? "text-muted-foreground" :
                        kolStat.pnl_sol >= 0 ? "text-green-500" : "text-red-400"
                      }`}>
                        {!kolStat ? "..." :
                         kolStat.error ? "error" :
                         kolStat.pnl_sol !== null ? `${kolStat.pnl_sol >= 0 ? "+" : ""}${kolStat.pnl_sol.toFixed(2)}` :
                         "—"}
                      </p>
                    </div>
                    <div className="text-center">
                      <p className="text-xs font-mono uppercase tracking-wider text-muted-foreground">PnL %</p>
                      <p className={`text-2xl font-bold font-mono mt-1 ${
                        !kolStat ? "text-muted-foreground" :
                        kolStat.pnl_percent === null ? "text-muted-foreground" :
                        kolStat.pnl_percent >= 0 ? "text-green-500" : "text-red-400"
                      }`}>
                        {!kolStat ? "..." :
                         kolStat.pnl_percent === null ? "—" :
                         `${kolStat.pnl_percent >= 0 ? "+" : ""}${kolStat.pnl_percent.toFixed(2)}%`}
                      </p>
                    </div>
                    <div className="text-center">
                      <p className="text-xs font-mono uppercase tracking-wider text-muted-foreground">Trades</p>
                      <p className="text-2xl font-bold font-mono mt-1 text-muted-foreground">
                        {!kolStat ? "..." :
                         kolStat.total_trades === null ? "—" :
                         kolStat.total_trades}
                      </p>
                    </div>
                    <div className="text-center">
                      <p className="text-xs font-mono uppercase tracking-wider text-muted-foreground">Status</p>
                      <p className="text-2xl font-bold font-mono mt-1">
                        {!kolStat ? "⏳" : kolStat.error ? "❌" : "✅"}
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ) : !isArchived && market.asset && (
              <CryptoPriceChart
                asset={market.asset}
                currentPrice={currentPrice}
                change24h={change24h}
              />
            )}

            {/* Liste des trades */}
            <Card>
              <CardHeader>
                <CardTitle className="text-lg font-bold flex items-center gap-2">
                  <Users className="h-5 w-5" />
                  Recent Trades
                </CardTitle>
              </CardHeader>
              <CardContent>
                {bets.length === 0 ? (
                  <p className="text-muted-foreground text-center py-8">
                    No trades yet. Be the first to bet!
                  </p>
                ) : (
                  <div className="space-y-2">
                    {bets.map((bet, i) => (
                      <div 
                        key={i} 
                        className="flex items-center justify-between p-3 rounded-lg bg-muted/50"
                      >
                        <div className="flex items-center gap-3">
                          <span className={`font-mono text-xs font-bold uppercase px-2 py-1 rounded ${
                            bet.side === "YES" 
                              ? "bg-green-100 text-green-700" 
                              : "bg-red-100 text-red-700"
                          }`}>
                            {bet.side}
                          </span>
                          <span className="font-mono text-xs text-muted-foreground">
                            {bet.wallet.slice(0, 8)}...{bet.wallet.slice(-8)}
                          </span>
                        </div>
                        <span className="font-mono text-sm font-medium">
                          {(bet.amount_sol ?? 0).toFixed(4)} SOL
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* Droite: Actions et infos */}
          <div className="space-y-6">
            {/* Solde wallet */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <Wallet className="h-4 w-4" />
                  Your Balance
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold">
                  {solBalance !== null ? `${solBalance.toFixed(4)} SOL` : "—"}
                </p>
              </CardContent>
            </Card>

            {/* Stats du marché */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium">Market Stats</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex justify-between items-center">
                  <span className="text-sm text-muted-foreground flex items-center gap-1">
                    <TrendingUp className="h-4 w-4 text-green-500" />
                    YES Pool
                  </span>
                  <span className="font-mono font-medium">{betStats.yesTotal.toFixed(4)} SOL</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm text-muted-foreground flex items-center gap-1">
                    <TrendingDown className="h-4 w-4 text-red-500" />
                    NO Pool
                  </span>
                  <span className="font-mono font-medium">{betStats.noTotal.toFixed(4)} SOL</span>
                </div>
                <div className="flex justify-between items-center pt-2 border-t">
                  <span className="text-sm text-muted-foreground">Total Volume</span>
                  <span className="font-mono font-bold">
                    {(betStats.yesTotal + betStats.noTotal).toFixed(4)} SOL
                  </span>
                </div>
              </CardContent>
            </Card>

            {/* Mon pari actuel */}
            {myBet && (
              <Card className={`border-2 ${
                isClosed && market.outcome
                  ? myBet.side === market.outcome
                    ? "border-green-500"
                    : "border-red-500"
                  : "border-primary"
              }`}>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium">
                    {isClosed && market.outcome ? "Your Result" : "Your Position"}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="flex justify-between items-center mb-2">
                    <span className={`font-mono text-xs font-bold uppercase px-2 py-1 rounded ${
                      myBet.side === "YES"
                        ? "bg-green-100 text-green-700"
                        : "bg-red-100 text-red-700"
                    }`}>
                      {myBet.side}
                    </span>
                    <span className="font-mono font-bold">
                      {(myBet.amount_sol ?? 0).toFixed(4)} SOL
                    </span>
                  </div>

                  {isClosed && !market.outcome && (
                    <div className="mt-3 pt-3 border-t">
                      <div className="flex items-center justify-between">
                        <span className="font-mono text-sm font-bold uppercase text-amber-600">
                          ⏳ Pending settlement
                        </span>
                      </div>
                    </div>
                  )}

                  {isClosed && market.outcome && (
                    <div className="mt-3 pt-3 border-t">
                      {myBet.side === market.outcome ? (
                        <div className="flex items-center justify-between">
                          <span className="font-mono text-sm font-bold uppercase text-green-600">
                            🏆 WON
                          </span>
                          <span className="font-mono text-sm font-bold text-green-600">
                            +{(() => {
                              const totalPool = betStats.yesTotal + betStats.noTotal;
                              const winningPool = market.outcome === "YES" ? betStats.yesTotal : betStats.noTotal;
                              if (winningPool <= 0) return "0.0000";
                              const payout = (myBet.amount_sol ?? 0) * (totalPool / winningPool);
                              return payout.toFixed(4);
                            })()} SOL
                          </span>
                        </div>
                      ) : (
                        <div className="flex items-center justify-between">
                          <span className="font-mono text-sm font-bold uppercase text-red-600">
                            ❌ LOST
                          </span>
                          <span className="font-mono text-sm font-bold text-red-600">
                            -{(myBet.amount_sol ?? 0).toFixed(4)} SOL
                          </span>
                        </div>
                      )}
                    </div>
                  )}
                </CardContent>
              </Card>
            )}

            {/* Boutons YES/NO */}
            {!isClosed && (
              <div className="space-y-3">
                <Button 
                  className="w-full py-6 text-lg font-bold bg-green-600 hover:bg-green-700"
                  disabled={!publicKey}
                  onClick={() => {
                    setBetSide("YES");
                    setBetModalOpen(true);
                  }}
                >
                  <TrendingUp className="mr-2 h-5 w-5" />
                  BET YES
                </Button>
                <Button 
                  className="w-full py-6 text-lg font-bold bg-red-600 hover:bg-red-700"
                  disabled={!publicKey}
                  onClick={() => {
                    setBetSide("NO");
                    setBetModalOpen(true);
                  }}
                >
                  <TrendingDown className="mr-2 h-5 w-5" />
                  BET NO
                </Button>
                {!publicKey && (
                  <p className="text-xs text-center text-muted-foreground">
                    Connect your wallet to bet
                  </p>
                )}
              </div>
            )}

            {isClosed && (
              <Card className="bg-muted">
                <CardContent className="p-4 text-center">
                  <p className="text-sm text-muted-foreground">
                    This market is closed. Check the outcome above.
                  </p>
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      </main>
      
      {/* Bet Modal */}
      {market && betSide && (
        <BetModal
          market={{
            id: market.id,
            question: market.question,
            tag: market.tag ?? "",
          }}
          side={betSide}
          isOpen={betModalOpen}
          onClose={() => setBetModalOpen(false)}
          onPlaced={() => {
            setBetModalOpen(false);
            // Rafraîchir les paris
            supabase.from("bets").select("*").eq("market_id", marketId).then(({ data }) => {
              if (data) setBets(data as ArenaBetRow[]);
            });
          }}
        />
      )}
    </div>
  );
}
