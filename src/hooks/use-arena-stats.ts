import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

type ArenaStats = {
  openMarkets: string;
  gladiators: string;
};

const EMPTY_STATS: ArenaStats = {
  openMarkets: "0",
  gladiators: "0",
};

export function useArenaStats() {
  const [stats, setStats] = useState<ArenaStats>(EMPTY_STATS);

  const refresh = useCallback(async () => {
    const { data: openMarkets } = await supabase
      .from("markets")
      .select("id")
      .eq("resolved", false)
      .is("deleted_at", null);

    const marketIds = (openMarkets ?? []).map((market) => market.id);
    let gladiatorCount = 0;

    if (marketIds.length > 0) {
      const { count } = await supabase
        .from("bets")
        .select("id", { count: "exact", head: true })
        .in("market_id", marketIds);
      gladiatorCount = count ?? 0;
    }

    setStats({
      openMarkets: marketIds.length.toLocaleString("en-US"),
      gladiators: gladiatorCount.toLocaleString("en-US"),
    });
  }, []);

  useEffect(() => {
    refresh();

    let timeout: ReturnType<typeof setTimeout> | null = null;
    const queueRefresh = () => {
      if (timeout) clearTimeout(timeout);
      timeout = setTimeout(() => {
        timeout = null;
        refresh();
      }, 250);
    };

    const channel = supabase
      .channel("arena-stats")
      .on("postgres_changes", { event: "*", schema: "public", table: "bets" }, queueRefresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "markets" }, queueRefresh)
      .subscribe();

    const fallback = setInterval(refresh, 120_000);
    const onFocus = () => refresh();
    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") refresh();
    };

    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      if (timeout) clearTimeout(timeout);
      clearInterval(fallback);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      supabase.removeChannel(channel);
    };
  }, [refresh]);

  return stats;
}
