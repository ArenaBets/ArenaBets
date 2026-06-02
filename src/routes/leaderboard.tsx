import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { ArenaNav } from "@/components/arena-nav";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Trophy, TrendingUp, TrendingDown, Wallet } from "lucide-react";

export const Route = createFileRoute("/leaderboard")({
  component: LeaderboardPage,
});

type WalletStats = {
  wallet: string;
  totalBets: number;
  totalWagered: number;
  totalPnL: number;
  wins: number;
  losses: number;
};

type LeaderboardRpcRow = {
  wallet: string;
  total_bets: number | string | null;
  total_wagered: number | string | null;
  total_pnl: number | string | null;
  wins: number | string | null;
  losses: number | string | null;
};

function formatWallet(wallet: string): string {
  if (wallet.length <= 12) return wallet;
  return `${wallet.slice(0, 4)}...${wallet.slice(-4)}`;
}

function toNumber(value: number | string | null | undefined): number {
  const numberValue = Number(value ?? 0);
  return Number.isFinite(numberValue) ? numberValue : 0;
}

function LeaderboardPage() {
  const [leaderboard, setLeaderboard] = useState<WalletStats[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function fetchData() {
      setLoading(true);
      const { data, error } = await (supabase.rpc as any)("get_leaderboard_stats");

      if (error) {
        console.error("[Leaderboard] stats query error:", error);
        setLeaderboard([]);
        setLoading(false);
        return;
      }

      const rows = ((data ?? []) as LeaderboardRpcRow[]).map((row) => ({
        wallet: row.wallet,
        totalBets: toNumber(row.total_bets),
        totalWagered: toNumber(row.total_wagered),
        totalPnL: toNumber(row.total_pnl),
        wins: toNumber(row.wins),
        losses: toNumber(row.losses),
      }));

      setLeaderboard(rows);
      setLoading(false);
    }
    fetchData();
  }, []);

  return (
    <div className="min-h-screen bg-background text-foreground paper-grain">
      <ArenaNav active="leaderboard" />

      <main className="py-10 md:py-14">
        <div className="container mx-auto px-4 max-w-5xl">
          <div className="mb-10 text-center">
            <h1 className="font-display text-3xl md:text-4xl font-black uppercase tracking-wider">
              Leaderboard
            </h1>
            <p className="mt-3 text-sm text-muted-foreground font-mono">
              Ranked by total profit/loss on resolved markets
            </p>
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-20">
              <div className="h-8 w-8 animate-spin rounded-full border-2 border-foreground border-t-transparent" />
            </div>
          ) : leaderboard.length === 0 ? (
            <div className="rounded-lg border border-dashed border-foreground/20 bg-parchment/30 p-10 text-center">
              <span className="font-mono text-sm text-foreground/50">
                No resolved markets yet — check back later.
              </span>
            </div>
          ) : (
            <div className="rounded-lg border border-foreground/10 bg-background shadow-sm overflow-hidden">
                <Table>
                  <TableHeader>
                    <TableRow className="border-b border-foreground/10 hover:bg-transparent">
                      <TableHead className="w-16 font-mono text-xs uppercase tracking-wider">Rank</TableHead>
                      <TableHead className="font-mono text-xs uppercase tracking-wider">Wallet</TableHead>
                      <TableHead className="text-right font-mono text-xs uppercase tracking-wider">Bets</TableHead>
                      <TableHead className="text-right font-mono text-xs uppercase tracking-wider">Wagered</TableHead>
                      <TableHead className="text-right font-mono text-xs uppercase tracking-wider">Win Rate</TableHead>
                      <TableHead className="text-right font-mono text-xs uppercase tracking-wider">PnL</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {leaderboard.map((entry, idx) => {
                      const isPositive = entry.totalPnL >= 0;
                      return (
                        <TableRow
                          key={entry.wallet}
                          className="border-b border-foreground/5 hover:bg-muted/30"
                        >
                          <TableCell className="font-mono text-sm font-bold text-muted-foreground">
                            <div className="flex items-center gap-1.5">
                              #{idx + 1}
                              {idx === 0 && (
                                <Trophy className="h-4 w-4 text-yellow-500" />
                              )}
                              {idx === 1 && (
                                <Trophy className="h-4 w-4 text-gray-400" />
                              )}
                              {idx === 2 && (
                                <Trophy className="h-4 w-4 text-orange-700" />
                              )}
                            </div>
                          </TableCell>
                          <TableCell>
                            <div className="flex items-center gap-2">
                              <Wallet className="h-4 w-4 text-muted-foreground" />
                              <span className="font-mono text-sm">{formatWallet(entry.wallet)}</span>
                            </div>
                          </TableCell>
                          <TableCell className="text-right font-mono text-sm text-muted-foreground">
                            {entry.totalBets}
                          </TableCell>
                          <TableCell className="text-right font-mono text-sm text-muted-foreground">
                            {entry.totalWagered.toFixed(4)} SOL
                          </TableCell>
                          <TableCell className="text-right font-mono text-sm text-muted-foreground">
                            {((entry.wins / entry.totalBets) * 100).toFixed(0)}%
                          </TableCell>
                          <TableCell className="text-right">
                            <div
                              className={`inline-flex items-center gap-1 font-mono text-sm font-bold ${
                                isPositive ? "text-green-600" : "text-red-600"
                              }`}
                            >
                              {isPositive ? (
                                <TrendingUp className="h-4 w-4" />
                              ) : (
                                <TrendingDown className="h-4 w-4" />
                              )}
                              {isPositive ? "+" : ""}
                              {entry.totalPnL.toFixed(4)} SOL
                            </div>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
          )}
        </div>
      </main>
    </div>
  );
}
