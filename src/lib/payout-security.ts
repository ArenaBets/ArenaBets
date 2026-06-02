export type VerifiedPoolBet = {
  side: "YES" | "NO";
  amount_sol: number | null;
  tx_signature?: string | null;
  valid_onchain?: boolean | null;
};

const LAMPORTS_PER_SOL = 1_000_000_000;

export function buildBetVerificationCacheKey(input: {
  tx_signature: string | null | undefined;
  wallet: string;
  amount_sol: number;
  pool_public_key: string;
}) {
  const txSignature = input.tx_signature?.trim();
  const wallet = input.wallet.trim();
  const pool = input.pool_public_key.trim();
  const amountLamports = Math.round(Number(input.amount_sol) * LAMPORTS_PER_SOL);

  if (!txSignature || !wallet || !pool || !Number.isFinite(amountLamports) || amountLamports <= 0) {
    return null;
  }

  return `${txSignature}:${wallet}:${amountLamports}:${pool}`;
}

export function filterUniqueVerifiedPayoutBets<T extends VerifiedPoolBet>(bets: T[]) {
  const seenTxSignatures = new Set<string>();

  return bets.filter((bet) => {
    if (bet.valid_onchain !== true) return false;

    const amount = Number(bet.amount_sol ?? 0);
    if (!Number.isFinite(amount) || amount <= 0) return false;

    const txSignature = bet.tx_signature?.trim();
    if (!txSignature) return false;
    if (seenTxSignatures.has(txSignature)) return false;

    seenTxSignatures.add(txSignature);
    return true;
  });
}

export function computeVerifiedMarketPools(bets: VerifiedPoolBet[]) {
  return filterUniqueVerifiedPayoutBets(bets).reduce(
    (totals, bet) => {
      const amount = Number(bet.amount_sol ?? 0);
      if (bet.side === "YES") totals.yesTotal += amount;
      else totals.noTotal += amount;

      return totals;
    },
    { yesTotal: 0, noTotal: 0 },
  );
}

export function computePayoutAmount(
  betAmount: number,
  winningPool: number,
  losingPool: number,
) {
  if (!Number.isFinite(betAmount) || betAmount <= 0) return 0;
  if (!Number.isFinite(winningPool) || winningPool <= 0) return 0;
  if (!Number.isFinite(losingPool) || losingPool <= 0) return betAmount;
  return betAmount + (betAmount / winningPool) * losingPool;
}
