import { useEffect, useState, useMemo } from "react";
import { supabase } from "@/integrations/supabase/client";
import type { ArenaBetRow, ArenaMarketRow } from "@/hooks/use-arena-live";
import { fetchCryptoHistory, type Candle } from "@/hooks/use-crypto-prices";
import type { CryptoAsset } from "@/lib/crypto-markets";

export type MarketSnapshot = {
  result: string | null;
  settlement_price: number | null;
  volume: number;
  tradeCount: number;
  yesTotal: number;
  noTotal: number;
  yesPrice: number;
  noPrice: number;
  trades: ArenaBetRow[];
  closedAt: string;
  chart?: number[];
};

export function useMarketDetail(marketId: string) {
  const [market, setMarket] = useState<ArenaMarketRow | null>(null);
  const [bets, setBets] = useState<ArenaBetRow[]>([]);
  const [snapshot, setSnapshot] = useState<MarketSnapshot | null>(null);
  const [history, setHistory] = useState<Candle[]>([]);
  const [loading, setLoading] = useState(true);

  const isArchived = market?.resolved === true;

  // Charger le marché
  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);

      const { data: marketData } = await supabase
        .from("markets")
        .select("*, snapshot")
        .eq("id", marketId)
        .single();

      if (cancelled) return;

      if (marketData) {
        const m = marketData as unknown as ArenaMarketRow & { snapshot: MarketSnapshot | null };
        setMarket(m);

        // Si snapshot disponible (marché fermé), l'utiliser directement
        if (m.snapshot) {
          setSnapshot(m.snapshot);
          setBets(m.snapshot.trades || []);
          setLoading(false);
          return;
        }

        // Marché fermé sans snapshot: charger les paris une fois
        if (m.resolved) {
          const { data: betsData } = await supabase
            .from("bets")
            .select("market_id,wallet,side,amount_sol,created_at")
            .eq("market_id", marketId)
            .order("created_at", { ascending: false });

          if (!cancelled && betsData) {
            setBets(betsData as ArenaBetRow[]);
          }
          setLoading(false);
          return;
        }

        // Marché ouvert: charger historique prix + paris live
        if (m.asset) {
          const hist = await fetchCryptoHistory(m.asset as CryptoAsset);
          if (!cancelled) setHistory(hist);
        }

        const { data: betsData } = await supabase
          .from("bets")
          .select("market_id,wallet,side,amount_sol,created_at")
          .eq("market_id", marketId)
          .order("created_at", { ascending: false });

        if (!cancelled && betsData) {
          setBets(betsData as ArenaBetRow[]);
        }

        setLoading(false);
      } else {
        setLoading(false);
      }
    }

    load();

    // WebSocket pour les paris en temps réel
    let channel: ReturnType<typeof supabase.channel> | null = null;

    if (!isArchived) {
      channel = supabase
        .channel(`market-${marketId}`)
        .on("postgres_changes", { event: "*", schema: "public", table: "bets", filter: `market_id=eq.${marketId}` }, () => {
          supabase.from("bets").select("market_id,wallet,side,amount_sol,created_at").eq("market_id", marketId).order("created_at", { ascending: false }).then(({ data }) => {
            if (data) setBets(data as ArenaBetRow[]);
          });
        })
        .subscribe();
    }

    // WebSocket pour le marché lui-même (settlement, outcome)
    const marketChannel = supabase
      .channel(`market-update-${marketId}`)
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "markets", filter: `id=eq.${marketId}` }, (payload) => {
        const updated = payload.new as ArenaMarketRow & { snapshot: MarketSnapshot | null };
        setMarket(updated);
        if (updated.snapshot) setSnapshot(updated.snapshot);
      })
      .subscribe();

    return () => {
      cancelled = true;
      if (channel) supabase.removeChannel(channel);
      supabase.removeChannel(marketChannel);
    };
  }, [marketId]);

  // Stats des paris (utilise snapshot si archivé)
  const betStats = useMemo(() => {
    if (isArchived && snapshot) {
      return {
        yesTotal: snapshot.yesTotal,
        noTotal: snapshot.noTotal,
        yesPrice: snapshot.yesPrice,
        noPrice: snapshot.noPrice,
        volume: snapshot.volume,
        tradeCount: snapshot.tradeCount,
      };
    }
    const yesBets = bets.filter(b => b.side === "YES");
    const noBets = bets.filter(b => b.side === "NO");
    const yesTotal = yesBets.reduce((s, b) => s + (b.amount_sol ?? 0), 0);
    const noTotal = noBets.reduce((s, b) => s + (b.amount_sol ?? 0), 0);
    const total = yesTotal + noTotal;
    return {
      yesTotal,
      noTotal,
      yesPrice: total > 0 ? yesTotal / total : 0.5,
      noPrice: total > 0 ? noTotal / total : 0.5,
      volume: total,
      tradeCount: bets.length,
    };
  }, [bets, snapshot, isArchived]);

  return {
    market,
    bets: isArchived && snapshot ? snapshot.trades : bets,
    setBets,
    snapshot,
    history,
    loading,
    isArchived,
    betStats,
  };
}
