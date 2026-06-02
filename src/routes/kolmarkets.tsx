import { useState, useMemo, useCallback } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useWallet } from "@solana/wallet-adapter-react";
import { supabase } from "@/integrations/supabase/client";
import { ArenaNav } from "@/components/arena-nav";
import { KOLPriceTicker } from "@/components/kol-price-ticker";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { KOL_TEST, type KOLName } from "@/components/kol-leaderboard";
import { KOLLeaderboard } from "@/components/kol-leaderboard";
import { useArenaLive } from "@/hooks/use-arena-live";
import { MarketCountdown } from "@/components/market-countdown";
import { MarketLiquidityBar } from "@/components/market-liquidity-bar";
import { BetModal, computeTotals } from "@/components/bet-modal";

export const Route = createFileRoute("/kolmarkets")({
  component: KolMarketsPage,
});

type KOLQuestionType =
  | "pnl_sol_positive"
  | "pnl_sol_negative"
  | "pnl_percent"
  | "trades"
  | "top3"
  | "head_to_head"
  | "custom";

function buildKOLQuestion({
  type,
  kol,
  opponent,
  pnlThreshold,
  tradeThreshold,
  pnlPercentDirection,
  position,
}: {
  type: KOLQuestionType;
  kol: string;
  opponent?: string;
  pnlThreshold: number;
  tradeThreshold: number;
  pnlPercentDirection: "positive" | "negative";
  position: 1 | 2 | 3;
}) {
  if (!kol) return "";

  const templates: Record<Exclude<KOLQuestionType, "custom">, string> = {
    pnl_sol_positive: `Will ${kol} be positive by at least ${pnlThreshold} SOL in 1H?`,
    pnl_sol_negative: `Will ${kol} be negative by at least ${pnlThreshold} SOL in 1H?`,
    pnl_percent: `Will ${kol} have ${pnlPercentDirection} PNL % in 1H?`,
    trades: `Will ${kol} make more than ${tradeThreshold} trades in 1H?`,
    top3: `Will ${kol} finish Top ${position} at next hourly refresh?`,
    head_to_head: opponent ? `Will ${kol} finish ahead of ${opponent} over the next 60 minutes?` : "",
  };

  return type === "custom" ? "" : templates[type];
}

function getNextSnapshotHour(): Date {
  const nextHour = new Date();
  nextHour.setUTCHours(nextHour.getUTCHours() + 1, 0, 0, 0);
  return nextHour;
}

function KOLMarketCard({
  market,
  bets,
  navigate,
  onBet,
}: {
  market: any;
  bets: any[];
  navigate: ReturnType<typeof useNavigate>;
  onBet: (side: "YES" | "NO") => void;
}) {
  const { publicKey } = useWallet();
  const isClosed = market.resolved || (!!market.closes_at && new Date(market.closes_at).getTime() <= Date.now());
  const marketBets = useMemo(() => bets.filter((b) => b.market_id === market.id), [bets, market.id]);
  const totals = computeTotals(marketBets);

  // Pari du wallet connecté
  const wallet = publicKey?.toBase58();
  const myBet = useMemo(() => wallet ? marketBets.find((b) => b.wallet === wallet) ?? null : null, [wallet, marketBets]);

  // Résultat si marché fermé et résolu
  const myResult = useMemo(() => {
    if (!myBet || !market.resolved || !market.outcome) return null;
    const won = myBet.side === market.outcome;
    const stake = myBet.amount_sol ?? 0;
    if (!won) return { won: false, amount: -stake };

    const totalLosing = marketBets
      .filter((b: any) => b.side !== market.outcome)
      .reduce((sum: number, b: any) => sum + (b.amount_sol ?? 0), 0);
    const totalWinning = marketBets
      .filter((b: any) => b.side === market.outcome)
      .reduce((sum: number, b: any) => sum + (b.amount_sol ?? 0), 0);

    if (totalWinning === 0) return { won: true, amount: stake };
    const share = stake / totalWinning;
    const winnings = stake + (totalLosing * share);
    return { won: true, amount: winnings };
  }, [myBet, market.resolved, market.outcome, marketBets]);

  return (
    <article
      className={`flex min-h-[250px] flex-col rounded-lg border border-foreground/10 bg-background p-5 shadow-sm transition ${
        isClosed ? "opacity-55 grayscale" : "hover:-translate-y-0.5 hover:shadow-md"
      }`}
    >
      <div className="flex items-center justify-between gap-3">
        <span className="rounded-md bg-foreground px-3 py-1 font-mono text-xs font-bold uppercase tracking-wider text-background">
          KOL
        </span>
        <span
          className={`rounded-md px-3 py-1 font-mono text-xs font-bold uppercase tracking-wider ${
            isClosed
              ? market.outcome
                ? market.outcome === "YES"
                  ? "bg-green-100 text-green-700"
                  : "bg-red-100 text-red-700"
                : "bg-red-100 text-red-700"
              : "bg-green-100 text-green-700"
          }`}
        >
          {isClosed
            ? market.outcome
              ? `MARKET RESOLVED : ${market.outcome}`
              : "CLOSED"
            : "OPEN"}
        </span>
      </div>

      <div className="mt-5 flex-1">
        <h3
          className="font-display text-2xl font-black uppercase leading-tight text-foreground hover:text-foreground/80 transition cursor-pointer"
          onClick={() => navigate({ to: `/market/${market.id}` })}
        >
          {market.question}
        </h3>
      </div>

      <MarketCountdown closes_at={market.closes_at} className="mt-5" />

      {!isClosed && (
        <MarketLiquidityBar yes_points={totals.yes} no_points={totals.no} className="mt-5" />
      )}

      {/* Pari utilisateur */}
      {myBet && (
        <div className={`mt-4 rounded-md p-3 ${
          myResult
            ? myResult.won
              ? "bg-green-100 border border-green-200"
              : "bg-red-100 border border-red-200"
            : "bg-muted border border-foreground/10"
        }`}>
          {myResult ? (
            <>
              <div className="font-mono text-sm uppercase tracking-wider text-foreground/70">
                {myResult.won ? "✓ WON" : "✗ LOST"}
              </div>
              <div className="mt-0.5 font-mono text-sm text-foreground/60">
                You picked <span className={myBet.side === "YES" ? "text-green-600 font-bold" : "text-red-600 font-bold"}>{myBet.side}</span>
              </div>
              <div className="mt-3 space-y-1">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-sm uppercase tracking-wider text-foreground/50">Stake</span>
                  <span className="font-mono text-sm font-medium">{(myBet.amount_sol ?? 0).toFixed(4)} SOL</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="font-mono text-sm uppercase tracking-wider text-foreground/50">PnL</span>
                  <span className={`font-mono text-sm font-bold ${myResult.won ? "text-green-700" : "text-red-700"}`}>
                    {myResult.won ? "+" : ""}{myResult.amount.toFixed(4)} SOL
                  </span>
                </div>
              </div>
            </>
          ) : (
            <>
              <div className="flex items-center justify-between">
                <span className="font-mono text-xs uppercase tracking-wider text-foreground/70">Your bet</span>
                <span className={`font-mono text-xs font-bold uppercase ${myBet.side === "YES" ? "text-green-600" : "text-red-600"}`}>
                  {myBet.side}
                </span>
              </div>
              <div className="mt-1 font-mono text-sm font-medium">
                {(myBet.amount_sol ?? 0).toFixed(4)} SOL
              </div>
            </>
          )}
        </div>
      )}

      <div className="mt-5 grid grid-cols-2 gap-3">
        <button
          type="button"
          disabled={isClosed}
          onClick={() => onBet("YES")}
          className="rounded-md py-3.5 font-display text-base font-black uppercase tracking-wider text-white transition bg-green-600 hover:bg-green-700 disabled:cursor-not-allowed disabled:bg-foreground/20 disabled:text-foreground/40"
        >
          YES
        </button>
        <button
          type="button"
          disabled={isClosed}
          onClick={() => onBet("NO")}
          className="rounded-md py-3.5 font-display text-base font-black uppercase tracking-wider text-white transition bg-red-600 hover:bg-red-700 disabled:cursor-not-allowed disabled:bg-foreground/20 disabled:text-foreground/40"
        >
          NO
        </button>
      </div>

      <div className="mt-3 flex items-center justify-between">
        <span className="text-[10px] font-mono text-foreground/40">
          {isClosed
            ? `Closed ${new Date(market.closes_at ?? market.created_at).toLocaleString("en-US", {
                month: "short",
                day: "numeric",
                hour: "2-digit",
                minute: "2-digit",
              })}`
            : `Opened ${new Date(market.created_at).toLocaleString("en-US", {
                month: "short",
                day: "numeric",
                hour: "2-digit",
                minute: "2-digit",
              })}`}
        </span>
        <span
          onClick={() => navigate({ to: `/market/${market.id}` })}
          className="text-center text-xs font-mono text-muted-foreground hover:text-foreground transition underline cursor-pointer"
        >
          View Details →
        </span>
      </div>
    </article>
  );
}

function KolMarketsPage() {
  const navigate = useNavigate();
  const { publicKey } = useWallet();
  const { markets, bets, refresh } = useArenaLive();
  const [view, setView] = useState<"markets" | "leaderboard" | "closed" | "mybets">("markets");
  const [myBetsView, setMyBetsView] = useState<"open" | "closed">("open");
  const [betTarget, setBetTarget] = useState<{ market: any; side: "YES" | "NO" } | null>(null);
  const [modalOpen, setModalOpen] = useState(false);

  // Filtrer les marchés KOL
  const kolMarkets = useMemo(
    () => markets.filter((m) => m.tag === "KOL"),
    [markets],
  );
  const openKolMarkets = useMemo(
    () => kolMarkets.filter((m) => !m.resolved && (!m.closes_at || new Date(m.closes_at).getTime() > Date.now())),
    [kolMarkets],
  );
  const closedKolMarkets = useMemo(
    () => kolMarkets.filter((m) => m.resolved || (!!m.closes_at && new Date(m.closes_at).getTime() <= Date.now())),
    [kolMarkets],
  );
  const wallet = publicKey?.toBase58();
  const myBetsMarkets = useMemo(() => {
    if (!wallet) return [];
    const myBetMarketIds = new Set(bets.filter((b) => b.wallet === wallet).map((b) => b.market_id));
    return kolMarkets.filter((m) => myBetMarketIds.has(m.id));
  }, [kolMarkets, bets, wallet]);
  const [question, setQuestion] = useState("");
  const [questionType, setQuestionType] = useState<KOLQuestionType>("pnl_sol_positive");
  const [pnlPercentDirection, setPnlPercentDirection] = useState<"positive" | "negative">("positive");
  const [pnlThreshold, setPnlThreshold] = useState<number>(1);
  const [tradeThreshold, setTradeThreshold] = useState<number>(5);
  const [position, setPosition] = useState<1 | 2 | 3>(1);
  const [selectedKol, setSelectedKol] = useState<KOLName | "">("");
  const [opponentKol, setOpponentKol] = useState<KOLName | "">("");
  const [kolSearch, setKolSearch] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Utiliser uniquement les 20 KOLs du leaderboard
const KOL_NAMES = KOL_TEST.map(k => k.name);
const filteredKols = kolSearch.trim()
    ? KOL_NAMES.filter((k) => k.toLowerCase().includes(kolSearch.toLowerCase()))
    : KOL_NAMES;

  async function handleCreate() {
    setError(null);
    if (!publicKey) {
      setError("Connect your wallet first");
      return;
    }
    if (!selectedKol) {
      setError("Select a KOL");
      return;
    }
    if (questionType === "head_to_head" && !opponentKol) {
      setError("Select the second KOL");
      return;
    }
    if (questionType === "head_to_head" && selectedKol === opponentKol) {
      setError("Select two different KOLs");
      return;
    }
    if (!question.trim()) {
      setError("Enter a market question");
      return;
    }
    setSubmitting(true);
    try {
      const nextHour = getNextSnapshotHour();

      const kolParamsMap: Record<string, Record<string, any>> = {
        pnl_sol_positive: { type: "pnl_sol_positive", threshold: pnlThreshold, kol_name: selectedKol },
        pnl_sol_negative: { type: "pnl_sol_negative", threshold: pnlThreshold, kol_name: selectedKol },
        pnl_percent: { type: "pnl_percent", direction: pnlPercentDirection, kol_name: selectedKol },
        trades: { type: "trades", min_trades: tradeThreshold, kol_name: selectedKol },
        top3: { type: "top3", position, kol_name: selectedKol },
        head_to_head: {
          type: "head_to_head",
          kol_name: selectedKol,
          opponent_kol_name: opponentKol,
        },
      };

      const payload = {
        question: question.trim(),
        tag: "KOL",
        asset: null,
        closes_at: nextHour.toISOString(),
        created_by_wallet: publicKey.toBase58(),
        resolved: false,
        outcome: null,
        settlement_price: null,
        kol_params: kolParamsMap[questionType],
      };
      console.log("[KOL] Creating market with payload:", payload);
      const { error: insertError } = await supabase.from("markets").insert(payload);
      if (insertError) {
        console.error("[KOL] Insert error:", insertError);
        throw insertError;
      }
      console.log("[KOL] Market created successfully");
      setQuestion("");
      setSelectedKol("");
      setOpponentKol("");
      setKolSearch("");
      setModalOpen(false);
      refresh();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to create market";
      console.error("[KOL] Create failed:", msg, e);
      setError(msg);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen bg-background text-foreground paper-grain">
      <ArenaNav active="kol-markets" />
      <KOLPriceTicker />

      <main className="py-10 md:py-14">
        <div className="container mx-auto px-4 max-w-7xl">
          <div className="flex items-center justify-between mb-8">
            <h1 className="font-display text-3xl md:text-4xl font-black uppercase tracking-wider">
              KOL Markets
            </h1>
            <div className="flex items-center gap-3">
              <Button
                onClick={() => setView("mybets")}
                variant={view === "mybets" ? "default" : "outline"}
                className="ink-border-sm px-4 py-2 font-mono text-xs font-bold uppercase tracking-wider"
              >
                My Bets
              </Button>
              <Button
                onClick={() => setView("markets")}
                variant={view === "markets" ? "default" : "outline"}
                className="ink-border-sm bg-primary px-4 py-2 font-mono text-xs font-bold uppercase tracking-wider text-primary-foreground"
              >
                Open Markets
              </Button>
              <Button
                onClick={() => setView("closed")}
                variant={view === "closed" ? "default" : "outline"}
                className="ink-border-sm px-4 py-2 font-mono text-xs font-bold uppercase tracking-wider"
              >
                Closed Markets
              </Button>
              <Button
                onClick={() => setView("leaderboard")}
                variant={view === "leaderboard" ? "default" : "outline"}
                className="ink-border-sm px-4 py-2 font-mono text-xs font-bold uppercase tracking-wider"
              >
                KOL Leaderboard
              </Button>
            </div>
          </div>

          {view === "mybets" ? (
            <div>
              <div className="mb-6">
                <h2 className="font-display text-2xl font-black uppercase tracking-tight">My Bets</h2>
                <p className="mt-2 text-sm text-muted-foreground">
                  KOL markets you have placed bets on.
                </p>
              </div>
              {!wallet ? (
                <div className="rounded-lg border border-dashed border-foreground/20 bg-parchment/30 p-6 text-center">
                  <span className="font-mono text-sm text-foreground/50">Connect your wallet to see your bets.</span>
                </div>
              ) : myBetsMarkets.length === 0 ? (
                <div className="rounded-lg border border-dashed border-foreground/20 bg-parchment/30 p-6 text-center">
                  <span className="font-mono text-sm text-foreground/50">You haven't placed any bets yet.</span>
                </div>
              ) : (
                <div>
                  <div className="flex items-center gap-3 mb-6">
                    <Button
                      onClick={() => setMyBetsView("open")}
                      variant={myBetsView === "open" ? "default" : "outline"}
                      className="ink-border-sm bg-primary px-4 py-2 font-mono text-xs font-bold uppercase tracking-wider text-primary-foreground"
                    >
                      Open Markets
                    </Button>
                    <Button
                      onClick={() => setMyBetsView("closed")}
                      variant={myBetsView === "closed" ? "default" : "outline"}
                      className="ink-border-sm px-4 py-2 font-mono text-xs font-bold uppercase tracking-wider"
                    >
                      Closed Markets
                    </Button>
                  </div>

                  {(() => {
                    const filtered = myBetsMarkets.filter((m) =>
                      myBetsView === "open"
                        ? !m.resolved && (!m.closes_at || new Date(m.closes_at).getTime() > Date.now())
                        : m.resolved || (!!m.closes_at && new Date(m.closes_at).getTime() <= Date.now())
                    );
                    return filtered.length === 0 ? (
                      <div className="rounded-lg border border-dashed border-foreground/20 bg-parchment/30 p-6 text-center">
                        <span className="font-mono text-sm text-foreground/50">
                          {myBetsView === "open" ? "No open bets." : "No closed bets."}
                        </span>
                      </div>
                    ) : (
                      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
                        {filtered.map((market) => (
                          <KOLMarketCard
                            key={market.id}
                            market={market}
                            bets={bets}
                            navigate={navigate}
                            onBet={(side) => setBetTarget({ market, side })}
                          />
                        ))}
                      </div>
                    );
                  })()}
                </div>
              )}
            </div>
          ) : view === "leaderboard" ? (
            <KOLLeaderboard />
          ) : view === "closed" ? (
            <div>
              <div className="mb-6">
                <h2 className="font-display text-2xl font-black uppercase tracking-tight">Closed KOL Markets</h2>
                <p className="mt-2 text-sm text-muted-foreground">
                  Resolved or expired KOL prediction markets.
                </p>
              </div>
              {closedKolMarkets.length === 0 ? (
                <div className="rounded-lg border border-dashed border-foreground/20 bg-parchment/30 p-6 text-center">
                  <span className="font-mono text-sm text-foreground/50">No closed markets yet.</span>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
                  {closedKolMarkets.map((market) => (
                    <KOLMarketCard
                      key={market.id}
                      market={market}
                      bets={bets}
                      navigate={navigate}
                      onBet={(side) => setBetTarget({ market, side })}
                    />
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div>
              <div className="mb-6">
                <h2 className="font-display text-2xl font-black uppercase tracking-tight">Open KOL Markets</h2>
                <p className="mt-2 text-sm text-muted-foreground">
                  Active KOL prediction markets.
                </p>
              </div>

              {/* Bouton CREATE NEW MARKET en dessous du titre */}
              <div className="mb-6">
                <Button 
                  onClick={() => setModalOpen(true)}
                  className="w-full bg-primary text-primary-foreground font-display text-lg font-bold uppercase tracking-wider py-6"
                >
                  + CREATE NEW MARKET
                </Button>
              </div>

              <div className="grid grid-cols-1 gap-6">
                {/* How it works */}
                <Card>
                  <CardHeader>
                    <CardTitle className="text-lg font-bold">How it works</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-muted-foreground">
                      Create a prediction market based on KOL performance. Select a KOL and define your market question. Users can bet YES or NO on the outcome.
                    </p>
                  </CardContent>
                </Card>

                {/* Active KOL Markets */}
                <div className="mt-6">
                  {openKolMarkets.length === 0 ? (
                    <div className="rounded-lg border border-dashed border-foreground/20 bg-parchment/30 p-6 text-center">
                      <span className="font-mono text-sm text-foreground/50">No active markets — create the first one!</span>
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
                      {openKolMarkets.map((market) => (
                        <KOLMarketCard
                          key={market.id}
                          market={market}
                          bets={bets}
                          navigate={navigate}
                          onBet={(side) => setBetTarget({ market, side })}
                        />
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </main>

      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="bg-background ink-border-lg w-full max-w-md p-6">
            <div className="font-mono text-xs uppercase tracking-widest text-foreground/60">
              — Open a new fight
            </div>
            <h3 className="mt-2 font-display text-2xl font-black uppercase">
              Create KOL Market
            </h3>

            <label className="mt-6 block font-mono text-xs uppercase tracking-wider">
              Primary KOL
            </label>
            <select
              value={selectedKol}
              onChange={(e) => {
                const kol = e.target.value as KOLName | "";
                setSelectedKol(kol);
                setKolSearch(kol);
                const nextOpponent = kol === opponentKol ? "" : opponentKol;
                if (nextOpponent !== opponentKol) setOpponentKol("");
                // Auto-generate question if not custom
                if (questionType !== "custom") {
                  setQuestion(buildKOLQuestion({
                    type: questionType,
                    kol,
                    opponent: nextOpponent,
                    pnlThreshold,
                    tradeThreshold,
                    pnlPercentDirection,
                    position,
                  }));
                }
              }}
              className="mt-2 w-full rounded border bg-background px-3 py-2 text-sm"
            >
              <option value="">-- Choose a KOL --</option>
              {KOL_NAMES.map((kol) => (
                <option key={kol} value={kol}>
                  {kol}
                </option>
              ))}
            </select>
            {selectedKol && (
              <p className="mt-1 text-xs text-green-500 font-mono">
                YES means {selectedKol} satisfies this condition.
              </p>
            )}

            <label className="mt-4 block font-mono text-xs uppercase tracking-wider">
              Question Type
            </label>
            <select
              value={questionType}
              onChange={(e) => {
                const type = e.target.value as typeof questionType;
                setQuestionType(type);
                if (selectedKol && type !== "custom") {
                  setQuestion(buildKOLQuestion({
                    type,
                    kol: selectedKol,
                    opponent: opponentKol,
                    pnlThreshold,
                    tradeThreshold,
                    pnlPercentDirection,
                    position,
                  }));
                }
              }}
              className="mt-2 w-full rounded border bg-background px-3 py-2 text-sm"
            >
              <option value="pnl_sol_positive">PNL SOL positive (≥ X SOL)</option>
              <option value="pnl_sol_negative">PNL SOL negative (≤ -X SOL)</option>
              <option value="pnl_percent">PNL % (positive/negative)</option>
              <option value="trades">Number of trades (&gt; X)</option>
              <option value="top3">Top 3 position at refresh</option>
              <option value="head_to_head">KOL vs KOL ranking</option>
            </select>

            {questionType === "head_to_head" && (
              <>
                <label className="mt-4 block font-mono text-xs uppercase tracking-wider">
                  Opponent KOL
                </label>
                <select
                  value={opponentKol}
                  onChange={(e) => {
                    const kol = e.target.value as KOLName | "";
                    setOpponentKol(kol);
                    if (selectedKol) {
                      setQuestion(buildKOLQuestion({
                        type: "head_to_head",
                        kol: selectedKol,
                        opponent: kol,
                        pnlThreshold,
                        tradeThreshold,
                        pnlPercentDirection,
                        position,
                      }));
                    }
                  }}
                  className="mt-2 w-full rounded border bg-background px-3 py-2 text-sm"
                >
                  <option value="">-- Choose an opponent --</option>
                  {KOL_NAMES.filter((kol) => kol !== selectedKol).map((kol) => (
                    <option key={kol} value={kol}>
                      {kol}
                    </option>
                  ))}
                </select>
                <p className="mt-1 text-xs text-muted-foreground font-mono">
                  YES wins if the primary KOL has a higher PnL 1h than the opponent at the next hourly snapshot.
                </p>
              </>
            )}

            {questionType === "pnl_percent" && (
              <div className="mt-2">
                <label className="block font-mono text-xs text-muted-foreground">
                  PnL % direction
                </label>
                <select
                  value={pnlPercentDirection}
                  onChange={(e) => {
                    const dir = e.target.value as "positive" | "negative";
                    setPnlPercentDirection(dir);
                    if (selectedKol) {
                      setQuestion(buildKOLQuestion({
                        type: questionType,
                        kol: selectedKol,
                        opponent: opponentKol,
                        pnlThreshold,
                        tradeThreshold,
                        pnlPercentDirection: dir,
                        position,
                      }));
                    }
                  }}
                  className="mt-1 w-full rounded border bg-background px-3 py-2 text-sm"
                >
                  <option value="positive">Positive</option>
                  <option value="negative">Negative</option>
                </select>
              </div>
            )}

            {(questionType === "pnl_sol_positive" || questionType === "pnl_sol_negative") && (
              <div className="mt-2">
                <label className="block font-mono text-xs text-muted-foreground">
                  SOL threshold
                </label>
                <input
                  type="number"
                  min="0.1"
                  step="0.1"
                  value={pnlThreshold}
                  onChange={(e) => {
                    const val = parseFloat(e.target.value);
                    setPnlThreshold(val || 0);
                    if (selectedKol) {
                      const q = questionType === "pnl_sol_positive"
                        ? `Will ${selectedKol} be positive by at least ${val} SOL in 1H?`
                        : `Will ${selectedKol} be negative by at least ${val} SOL in 1H?`;
                      setQuestion(q);
                    }
                  }}
                  className="mt-1 w-full rounded border bg-background px-3 py-2 text-sm"
                />
              </div>
            )}

            {questionType === "trades" && (
              <div className="mt-2">
                <label className="block font-mono text-xs text-muted-foreground">
                  Trade threshold
                </label>
                <input
                  type="number"
                  min="0"
                  step="1"
                  value={tradeThreshold}
                  onChange={(e) => {
                    const val = Math.max(0, Math.floor(Number(e.target.value) || 0));
                    setTradeThreshold(val);
                    if (selectedKol) {
                      setQuestion(buildKOLQuestion({
                        type: questionType,
                        kol: selectedKol,
                        opponent: opponentKol,
                        pnlThreshold,
                        tradeThreshold: val,
                        pnlPercentDirection,
                        position,
                      }));
                    }
                  }}
                  className="mt-1 w-full rounded border bg-background px-3 py-2 text-sm"
                />
              </div>
            )}

            {questionType === "top3" && (
              <div className="mt-2">
                <label className="block font-mono text-xs text-muted-foreground">
                  Position target
                </label>
                <select
                  value={position}
                  onChange={(e) => {
                    const pos = Number(e.target.value) as 1 | 2 | 3;
                    setPosition(pos);
                    if (selectedKol) {
                      setQuestion(buildKOLQuestion({
                        type: questionType,
                        kol: selectedKol,
                        opponent: opponentKol,
                        pnlThreshold,
                        tradeThreshold,
                        pnlPercentDirection,
                        position: pos,
                      }));
                    }
                  }}
                  className="mt-1 w-full rounded border bg-background px-3 py-2 text-sm"
                >
                  <option value={1}>Top 1</option>
                  <option value={2}>Top 2</option>
                  <option value={3}>Top 3</option>
                </select>
              </div>
            )}

            <label className="mt-4 block font-mono text-xs uppercase tracking-wider">
              Question {questionType !== "custom" && "(auto-generated)"}
            </label>
            {questionType === "custom" ? (
              <input
                type="text"
                value={question}
                onChange={(e) => setQuestion(e.target.value)}
                placeholder="e.g. Will this KOL call pump 2x this week?"
                className="mt-2 w-full rounded border bg-background px-3 py-2 text-sm"
              />
            ) : (
              <div className="mt-2 w-full rounded border bg-muted px-3 py-2 text-sm text-muted-foreground">
                {question || "Select a KOL to see the question"}
              </div>
            )}

            <label className="mt-4 block font-mono text-xs uppercase tracking-wider">
              Closes At (auto: next hourly refresh)
            </label>
            <div className="mt-2 w-full rounded border bg-muted px-3 py-2 text-sm text-muted-foreground">
              {(() => {
                const nextHour = getNextSnapshotHour();
                const timeStr = nextHour.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false });
                const dateStr = nextHour.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
                return `${dateStr} at ${timeStr} (next leaderboard refresh)`;
              })()}
            </div>

            {error && (
              <p className="mt-4 text-sm text-red-500">{error}</p>
            )}

            <div className="mt-6 flex gap-3">
              <Button
                variant="outline"
                onClick={() => setModalOpen(false)}
                className="flex-1"
              >
                Cancel
              </Button>
              <Button
                onClick={handleCreate}
                disabled={submitting}
                className="flex-1 bg-primary text-primary-foreground"
              >
                {submitting ? "Creating..." : "Create"}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Bet Modal */}
      {betTarget && (
        <BetModal
          market={betTarget.market}
          side={betTarget.side}
          isOpen={!!betTarget}
          onClose={() => setBetTarget(null)}
          onPlaced={() => {
            setBetTarget(null);
            refresh();
          }}
        />
      )}
    </div>
  );
}
