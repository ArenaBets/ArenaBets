export type PortfolioMarket = {
  id: string;
  question: string;
  tag: string;
  asset: string | null;
  resolved: boolean;
  outcome: string | null;
  closes_at: string | null;
};

export type PortfolioBet = {
  id: string;
  market_id: string;
  side: string;
  amount_sol: number | null;
  created_at: string;
  market: PortfolioMarket;
};

export type MarketBetStake = {
  side: string;
  amount_sol: number | null;
};

export function isMarketOpen(market: Pick<PortfolioMarket, "resolved" | "closes_at">) {
  if (market.resolved) return false;
  if (!market.closes_at) return true;
  return new Date(market.closes_at).getTime() > Date.now();
}

/** Net SOL won/lost on a resolved market (matches DB payout: winners split full pot by stake). */
export function computeBetPnl(
  bet: Pick<PortfolioBet, "side" | "amount_sol">,
  market: Pick<PortfolioMarket, "resolved" | "outcome">,
  marketBets: MarketBetStake[],
): number | null {
  if (!market.resolved || !market.outcome) return null;

  const stake = bet.amount_sol ?? 0;
  if (stake <= 0) return 0;

  if (bet.side !== market.outcome) return -stake;

  const winningPool = marketBets
    .filter((b) => b.side === market.outcome)
    .reduce((sum, b) => sum + (b.amount_sol ?? 0), 0);
  const losingPool = marketBets
    .filter((b) => b.side !== market.outcome)
    .reduce((sum, b) => sum + (b.amount_sol ?? 0), 0);

  if (winningPool <= 0) return 0;

  const payout = stake + (stake / winningPool) * losingPool;
  return payout - stake;
}

export function summarizeHistoryPnl(
  history: PortfolioBet[],
  betsByMarket: Map<string, MarketBetStake[]>,
) {
  let solWon = 0;
  let solLost = 0;
  let totalNet = 0;
  let settledCount = 0;

  for (const bet of history) {
    const pnl = computeBetPnl(bet, bet.market, betsByMarket.get(bet.market_id) ?? []);
    if (pnl === null) continue;
    settledCount += 1;
    totalNet += pnl;
    if (pnl > 0) solWon += pnl;
    else if (pnl < 0) solLost += Math.abs(pnl);
  }

  return { solWon, solLost, net: totalNet, settledCount };
}

export function formatSignedSol(value: number) {
  const prefix = value > 0 ? "+" : value < 0 ? "−" : "";
  const amount = Math.abs(value).toLocaleString("en-US", { minimumFractionDigits: 6, maximumFractionDigits: 6 });
  return `${prefix}${amount} SOL`;
}
