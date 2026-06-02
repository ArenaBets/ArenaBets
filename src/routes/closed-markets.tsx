import { createFileRoute } from "@tanstack/react-router";
import { useState, useMemo } from "react";
import { ArenaNav } from "@/components/arena-nav";
import { PriceTicker } from "@/components/price-ticker";
import { BetModal, CreateMarketModal, type Market } from "@/components/bet-modal";
import { MarketsBoard } from "@/components/markets-board";
import { useArenaLive } from "@/hooks/use-arena-live";

export const Route = createFileRoute("/closed-markets")({
  component: ClosedMarketsPage,
});

function ClosedMarketsPage() {
  const { markets, bets, refresh } = useArenaLive();
  const [betTarget, setBetTarget] = useState<{ market: Market; side: "YES" | "NO" } | null>(null);

  // Filtrer uniquement les marchés fermés (sans les marchés KOL)
  const closedMarkets = useMemo(
    () => markets.filter((m) => (m.resolved || (m.closes_at && new Date(m.closes_at).getTime() <= Date.now())) && m.tag !== "KOL"),
    [markets],
  );

  return (
    <div className="min-h-screen bg-background text-foreground paper-grain">
      <ArenaNav />
      <PriceTicker />

      <main className="py-10 md:py-14">
        <MarketsBoard
          markets={closedMarkets}
          bets={bets}
          onBet={(market, side) => setBetTarget({ market, side })}
          onCreate={() => {}}
          mode="closed"
        />
      </main>

      {betTarget && (
        <BetModal
          market={betTarget.market}
          side={betTarget.side}
          isOpen={true}
          onClose={() => setBetTarget(null)}
          onPlaced={refresh}
        />
      )}
    </div>
  );
}
