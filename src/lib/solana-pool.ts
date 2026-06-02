import { Connection, Keypair, PublicKey, SystemProgram, Transaction, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { supabase } from "@/integrations/supabase/client";

const RPC_URL = typeof import.meta.env !== 'undefined' && (import.meta.env.VITE_SOLANA_PUBLIC_RPC_URL || import.meta.env.VITE_SOLANA_RPC_URL)
  ? (import.meta.env.VITE_SOLANA_PUBLIC_RPC_URL || import.meta.env.VITE_SOLANA_RPC_URL)
  : "https://solana-rpc.publicnode.com";
export const connection = new Connection(RPC_URL, "confirmed");

if (typeof window !== "undefined" && import.meta.env.DEV) {
  console.info("[Solana RPC] frontend bet connection:", RPC_URL);
}

// Adresse du wallet pool (lecture seule côté client)
const POOL_PUBLIC_KEY = typeof import.meta.env !== 'undefined' 
  ? import.meta.env.VITE_SOLANA_POOL_PUBLIC_KEY || "" 
  : "";

export const poolPublicKey = POOL_PUBLIC_KEY ? new PublicKey(POOL_PUBLIC_KEY) : null;

export type SolBet = {
  id: string;
  market_id: string;
  wallet: string;
  side: string;
  amount_sol: number | null;
  tx_signature: string | null;
  created_at: string;
};

/**
 * Vérifier si une transaction a été confirmée sur le réseau
 * Avec retry pour gérer les délais de propagation RPC
 */
export async function verifyTransaction(signature: string, retries = 20): Promise<boolean> {
  for (let i = 0; i < retries; i++) {
    try {
      const status = await connection.getSignatureStatus(signature);
      if (status.value?.err) {
        return false;
      }
      if (status.value?.confirmationStatus === "confirmed" || 
          status.value?.confirmationStatus === "finalized") {
        return true;
      }
      if (i < retries - 1) {
        await new Promise(r => setTimeout(r, 1500));
      }
    } catch {
      // Continue au retry suivant
    }
  }
  return false;
}

async function verifyBetTransfer(
  signature: string,
  wallet: string,
  amountSol: number,
  retries = 20
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!poolPublicKey) {
    return { ok: false, error: "Pool wallet not configured" };
  }

  let userPublicKey: PublicKey;
  try {
    userPublicKey = new PublicKey(wallet);
  } catch {
    return { ok: false, error: "Invalid wallet" };
  }

  let tx = null;
  for (let i = 0; i < retries; i++) {
    tx = await connection.getTransaction(signature, {
      commitment: "confirmed",
      maxSupportedTransactionVersion: 0,
    });
    if (tx) break;
    if (i < retries - 1) {
      await new Promise((resolve) => setTimeout(resolve, 1500));
    }
  }

  if (!tx) return { ok: false, error: "Transaction not found" };
  if (tx.meta?.err) return { ok: false, error: "Transaction failed on network" };
  if (!tx.meta) return { ok: false, error: "Transaction metadata missing" };

  const message = tx.transaction.message as any;
  const keys: PublicKey[] = message.staticAccountKeys ?? message.accountKeys;
  if (!keys || keys.length === 0) {
    return { ok: false, error: "Transaction accounts missing" };
  }

  const walletIdx = keys.findIndex((key) => key.equals(userPublicKey));
  const poolIdx = keys.findIndex((key) => key.equals(poolPublicKey));
  if (walletIdx < 0 || poolIdx < 0) {
    return { ok: false, error: "Transaction does not match this bet" };
  }

  if (walletIdx >= tx.transaction.message.header.numRequiredSignatures) {
    return { ok: false, error: "Wallet did not sign transaction" };
  }

  const expectedLamports = Math.round(amountSol * LAMPORTS_PER_SOL);
  const poolDelta = tx.meta.postBalances[poolIdx] - tx.meta.preBalances[poolIdx];
  if (poolDelta !== expectedLamports) {
    return { ok: false, error: "Transaction amount does not match bet" };
  }

  return { ok: true };
}

/**
 * Récupérer le solde du pool (pour info admin)
 */
export async function getPoolBalance(): Promise<number> {
  if (!poolPublicKey) return 0;
  try {
    const balance = await connection.getBalance(poolPublicKey);
    return balance / LAMPORTS_PER_SOL;
  } catch {
    return 0;
  }
}

/**
 * Créer une transaction de pari (utilisateur → pool)
 * L'utilisateur signe et envoie cette transaction avec son wallet
 */
export async function createBetTransaction(
  userPublicKey: PublicKey,
  amountSol: number
): Promise<Transaction> {
  if (!poolPublicKey) {
    throw new Error("Pool wallet not configured");
  }

  const transaction = new Transaction();
  
  // Transfert SOL vers le pool
  transaction.add(
    SystemProgram.transfer({
      fromPubkey: userPublicKey,
      toPubkey: poolPublicKey,
      lamports: Math.round(amountSol * LAMPORTS_PER_SOL),
    })
  );

  // Fee payer = utilisateur (il paie les frais ~0.000005 SOL)
  transaction.feePayer = userPublicKey;
  
  // Récupérer le blockhash récent
  const { blockhash } = await connection.getLatestBlockhash();
  transaction.recentBlockhash = blockhash;

  return transaction;
}

/**
 * Enregistrer un pari dans la base de données (après confirmation tx)
 */
export async function recordBet(
  marketId: string,
  wallet: string,
  side: "YES" | "NO",
  amountSol: number,
  txSignature: string
): Promise<{ success: boolean; error?: string }> {
  try {
    // Vérifier que la tx n'est pas déjà utilisée (anti-double-spend)
    const { data: existing } = await supabase
      .from("bets")
      .select("id")
      .eq("tx_signature", txSignature)
      .maybeSingle();

    if (existing) {
      return { success: false, error: "Transaction already used" };
    }

    // On enregistre dès que le wallet a renvoyé une signature. La vérification
    // on-chain bloquante se fait côté worker avant tout payout, ce qui évite
    // qu'un RPC lent empêche un vrai bet d'être visible en base.
    const { error } = await supabase.rpc("place_sol_bet_secure" as any, {
      p_market_id: marketId,
      p_wallet: wallet,
      p_side: side,
      p_amount_sol: amountSol,
      p_tx_signature: txSignature,
    });

    if (error) {
      return { success: false, error: error.message };
    }

    return { success: true };
  } catch (err) {
    return { success: false, error: String(err) };
  }
}

/**
 * Récupérer les paris d'un utilisateur
 */
export async function getUserSolBets(wallet: string): Promise<SolBet[]> {
  const { data } = await supabase
    .from("bets")
    .select("*")
    .eq("wallet", wallet)
    .gt("amount_sol", 0)
    .order("created_at", { ascending: false });
  
  return (data || []) as SolBet[];
}

/**
 * Récupérer tous les paris d'un marché (pour calculer les gains)
 */
export async function getMarketSolBets(marketId: string): Promise<SolBet[]> {
  const { data } = await supabase
    .from("bets")
    .select("*")
    .eq("market_id", marketId)
    .gt("amount_sol", 0);
  
  return (data || []) as SolBet[];
}

/**
 * Calculer les gains d'un pari gagnant (même logique que les points)
 */
export function calculateSolWinnings(
  betAmount: number,
  winningPool: number,
  totalLosingPool: number
): number {
  if (winningPool === 0) return 0;
  
  // Le gagnant récupère sa mise + part du pool perdant
  // Ex: pari 1 SOL sur YES, pool YES = 10 SOL, pool NO = 5 SOL
  // Gains = 1 + (1/10 * 5) = 1.5 SOL
  const shareOfLosingPool = (betAmount / winningPool) * totalLosingPool;
  return betAmount + shareOfLosingPool;
}

/**
 * Calculer les totaux d'un marché
 */
export function calculateMarketSolTotals(bets: SolBet[]) {
  return bets.reduce(
    (acc, bet) => {
      const amount = bet.amount_sol ?? 0;
      if (bet.side === "YES") {
        acc.yes += amount;
      } else {
        acc.no += amount;
      }
      return acc;
    },
    { yes: 0, no: 0 }
  );
}

/**
 * Redistribuer les gains aux gagnants d'un marché
 * ⚠️ Cette fonction doit être appelée côté serveur (Edge Function) avec la clé privée
 */
export async function distributeSolWinnings(
  marketId: string,
  winningSide: "YES" | "NO",
  poolKeypair: Keypair
): Promise<{ success: boolean; distributed: number; error?: string }> {
  try {
    // Récupérer tous les paris SOL du marché
    const bets = await getMarketSolBets(marketId);
    if (bets.length === 0) {
      return { success: true, distributed: 0 };
    }

    const totals = calculateMarketSolTotals(bets);
    const winningPool = winningSide === "YES" ? totals.yes : totals.no;
    const losingPool = winningSide === "YES" ? totals.no : totals.yes;

    if (winningPool === 0) {
      return { success: true, distributed: 0 };
    }

    // Transactions à envoyer
    const transactions: Transaction[] = [];

    for (const bet of bets) {
      if (bet.side !== winningSide || !bet.amount_sol || bet.amount_sol <= 0) {
        continue;
      }

      // Calculer les gains
      const winnings = calculateSolWinnings(bet.amount_sol, winningPool, losingPool);
      if (winnings <= 0) continue;

      // Créer transaction de paiement
      const tx = new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: poolKeypair.publicKey,
          toPubkey: new PublicKey(bet.wallet),
          lamports: Math.floor(winnings * LAMPORTS_PER_SOL),
        })
      );

      transactions.push(tx);
    }

    // Envoyer les transactions en batch
    let distributedCount = 0;
    for (const tx of transactions) {
      try {
        const { blockhash } = await connection.getLatestBlockhash();
        tx.recentBlockhash = blockhash;
        tx.feePayer = poolKeypair.publicKey;

        const signature = await connection.sendTransaction(tx, [poolKeypair]);
        await connection.confirmTransaction(signature, "confirmed");
        distributedCount++;
      } catch (err) {
        console.error("Failed to distribute to winner:", err);
        // Continuer avec les autres gagnants
      }
    }

    return { success: true, distributed: distributedCount };
  } catch (err) {
    return {
      success: false,
      distributed: 0,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
