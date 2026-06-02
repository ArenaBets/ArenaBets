import { useWallet } from "@solana/wallet-adapter-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { Market } from "@/components/bet-modal";
import { supabase } from "@/integrations/supabase/client";
import type { CryptoAsset, MarketCondition } from "@/lib/crypto-markets";

export type ArenaMarketRow = Market & {
  asset: CryptoAsset | null;
  condition: MarketCondition | null;
  price_target: number | null;
  duration_hours: number | null;
  kol_params: Record<string, any> | null;
  closes_at: string | null;
  created_at: string;
  resolved: boolean;
  outcome: string | null;
  settlement_price: number | null;
  created_by_wallet: string | null;
  deleted_at: string | null;
};

export type ArenaBetRow = {
  market_id: string;
  wallet: string;
  side: string;
  amount_sol: number | null;
  created_at?: string | null;
  is_pool_aggregate?: boolean;
};

type MarketPoolRow = {
  market_id: string;
  yes_total: number | string | null;
  no_total: number | string | null;
};

const POOL_WALLET_PREFIX = "__arena_pool__";

function amount(value: number | string | null | undefined) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function sumUserBetsByMarketAndSide(userBets: ArenaBetRow[]) {
  const totals = new Map<string, { yes: number; no: number }>();

  for (const bet of userBets) {
    const current = totals.get(bet.market_id) ?? { yes: 0, no: 0 };
    const betAmount = amount(bet.amount_sol);
    if (bet.side === "YES") current.yes += betAmount;
    if (bet.side === "NO") current.no += betAmount;
    totals.set(bet.market_id, current);
  }

  return totals;
}

function buildLightweightBets(
  marketIds: string[],
  poolRows: MarketPoolRow[],
  userBets: ArenaBetRow[],
): ArenaBetRow[] {
  const poolByMarket = new Map(poolRows.map((row) => [row.market_id, row]));
  const userTotals = sumUserBetsByMarketAndSide(userBets);
  const rows: ArenaBetRow[] = [];

  for (const marketId of marketIds) {
    const pool = poolByMarket.get(marketId);
    const user = userTotals.get(marketId) ?? { yes: 0, no: 0 };
    const aggregateYes = Math.max(amount(pool?.yes_total) - user.yes, 0);
    const aggregateNo = Math.max(amount(pool?.no_total) - user.no, 0);

    if (aggregateYes > 0) {
      rows.push({
        market_id: marketId,
        wallet: `${POOL_WALLET_PREFIX}:${marketId}:YES`,
        side: "YES",
        amount_sol: aggregateYes,
        created_at: null,
        is_pool_aggregate: true,
      });
    }

    if (aggregateNo > 0) {
      rows.push({
        market_id: marketId,
        wallet: `${POOL_WALLET_PREFIX}:${marketId}:NO`,
        side: "NO",
        amount_sol: aggregateNo,
        created_at: null,
        is_pool_aggregate: true,
      });
    }
  }

  return [...rows, ...userBets];
}

function uniqueIds(ids: Array<string | null | undefined>) {
  return [...new Set(ids.filter((id): id is string => Boolean(id)))];
}

export function useArenaLive() {
  const { publicKey } = useWallet();
  const [markets, setMarkets] = useState<ArenaMarketRow[]>([]);
  const [bets, setBets] = useState<ArenaBetRow[]>([]);
  const poolRefreshTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingPoolMarketIdsRef = useRef(new Set<string>());

  const refresh = useCallback(async () => {
    const { data: m } = await (supabase
      .from("markets")
      .select(
        "id,question,tag,asset,condition,price_target,duration_hours,kol_params,closes_at,created_at,resolved,outcome,settlement_price,created_by_wallet,deleted_at",
      )
      .is("deleted_at", null)
      .order("created_at", { ascending: false }) as any);
    if (m) setMarkets(m as ArenaMarketRow[]);

    const allMarketIds = m?.map((market: ArenaMarketRow) => market.id) ?? [];
    if (allMarketIds.length === 0) {
      setBets([]);
      return;
    }

    const { data: poolRows } = await (supabase.rpc as any)("get_market_pools", {
      p_market_ids: allMarketIds,
    });

    let userBets: ArenaBetRow[] = [];
    const wallet = publicKey?.toBase58();
    if (wallet) {
      const { data } = await supabase
        .from("bets")
        .select("market_id,wallet,side,amount_sol,created_at")
        .eq("wallet", wallet)
        .in("market_id", allMarketIds)
        .order("created_at", { ascending: false });
      userBets = (data as ArenaBetRow[] | null) ?? [];
    }

    setBets(buildLightweightBets(
      allMarketIds,
      (poolRows as MarketPoolRow[] | null) ?? [],
      userBets,
    ));
  }, [publicKey]);

  const refreshMarketBets = useCallback(async (marketIds: string[]) => {
    const ids = uniqueIds(marketIds);
    if (ids.length === 0) return;

    const { data: poolRows } = await (supabase.rpc as any)("get_market_pools", {
      p_market_ids: ids,
    });

    let userBets: ArenaBetRow[] = [];
    const wallet = publicKey?.toBase58();
    if (wallet) {
      const { data } = await supabase
        .from("bets")
        .select("market_id,wallet,side,amount_sol,created_at")
        .eq("wallet", wallet)
        .in("market_id", ids)
        .order("created_at", { ascending: false });
      userBets = (data as ArenaBetRow[] | null) ?? [];
    }

    const nextRows = buildLightweightBets(
      ids,
      (poolRows as MarketPoolRow[] | null) ?? [],
      userBets,
    );
    const idSet = new Set(ids);

    setBets((current) => [
      ...current.filter((bet) => !idSet.has(bet.market_id)),
      ...nextRows,
    ]);
  }, [publicKey]);

  const queueMarketBetsRefresh = useCallback((marketId: string | null | undefined) => {
    if (!marketId) return;
    pendingPoolMarketIdsRef.current.add(marketId);

    if (poolRefreshTimeoutRef.current) {
      clearTimeout(poolRefreshTimeoutRef.current);
    }

    poolRefreshTimeoutRef.current = setTimeout(() => {
      const ids = [...pendingPoolMarketIdsRef.current];
      pendingPoolMarketIdsRef.current.clear();
      poolRefreshTimeoutRef.current = null;
      void refreshMarketBets(ids);
    }, 250);
  }, [refreshMarketBets]);

  const applyMarketChange = useCallback((payload: any) => {
    const next = payload.new as ArenaMarketRow | null;
    const previous = payload.old as Partial<ArenaMarketRow> | null;
    const marketId = next?.id ?? previous?.id;

    if (!marketId) {
      void refresh();
      return;
    }

    if (payload.eventType === "DELETE" || next?.deleted_at) {
      setMarkets((current) => current.filter((market) => market.id !== marketId));
      setBets((current) => current.filter((bet) => bet.market_id !== marketId));
      return;
    }

    if (!next) return;

    setMarkets((current) => {
      const index = current.findIndex((market) => market.id === marketId);
      if (index === -1) {
        return [next, ...current].sort(
          (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
        );
      }

      const updated = [...current];
      updated[index] = { ...updated[index], ...next };
      return updated;
    });

    if (payload.eventType === "INSERT") {
      queueMarketBetsRefresh(marketId);
    }
  }, [queueMarketBetsRefresh, refresh]);


  useEffect(() => {
    refresh();

    const channel = supabase
      .channel("arena-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "bets" }, (payload) => {
        const next = payload.new as { market_id?: string } | null;
        const previous = payload.old as { market_id?: string } | null;
        queueMarketBetsRefresh(next?.market_id ?? previous?.market_id);
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "markets" }, applyMarketChange)
      .subscribe();

    const fallback = setInterval(refresh, 120_000);
    const onFocus = () => refresh();
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") refresh();
    };
    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      if (poolRefreshTimeoutRef.current) {
        clearTimeout(poolRefreshTimeoutRef.current);
        poolRefreshTimeoutRef.current = null;
      }
      pendingPoolMarketIdsRef.current.clear();
      clearInterval(fallback);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      supabase.removeChannel(channel);
    };
  }, [applyMarketChange, queueMarketBetsRefresh, refresh]);

  return { markets, bets, refresh, publicKey };
}
