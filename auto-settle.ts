/**
 * Script de settlement automatique
 * Tourne en parallèle du serveur de dev
 * 
 * Usage: npx tsx auto-settle.ts
 */

import { createClient } from "@supabase/supabase-js";
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import bs58 from "bs58";
import { randomUUID } from "node:crypto";
import "dotenv/config";
import {
  buildBetVerificationCacheKey,
  computePayoutAmount,
  computeVerifiedMarketPools,
  filterUniqueVerifiedPayoutBets,
} from "./src/lib/payout-security";

// --- Fix Problème 6 : validation stricte des variables d'environnement critiques ---
// Avant : `process.env.X!` mentait au compilateur sur la nullité, et le worker
// fallback-ait silencieusement vers la clé publishable si SERVICE_ROLE_KEY
// manquait. Conséquence : les UPDATE bypass-RLS échouaient sans alerte
// (settlement et record_payout silencieusement cassés). Maintenant, fail-fast.
function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value || value.trim() === "") {
    console.error(`❌ FATAL: missing required environment variable "${name}". Aborting.`);
    process.exit(1);
  }
  return value;
}

const SUPABASE_URL = requireEnv("SUPABASE_URL");
const SERVICE_ROLE_KEY = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
const RPC_URL = process.env.SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com";
const POOL_PRIVATE_KEY = process.env.SOLANA_POOL_PRIVATE_KEY;

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
const connection = new Connection(RPC_URL, "confirmed");

// --- Fix Problème 4 : chargement UNIQUE de la clé privée du pool au démarrage ---
// Avant : `Keypair.fromSecretKey(bs58.decode(POOL_PRIVATE_KEY))` était appelé à
// chaque marché (jusqu'à plusieurs dizaines de fois par minute), multipliant les
// copies du secret en mémoire heap. On décode une seule fois ici et on réutilise
// l'objet Keypair via le module-scope. Si la clé est invalide, on fail-fast.
let poolKeypair: Keypair | null = null;
if (POOL_PRIVATE_KEY) {
  try {
    poolKeypair = Keypair.fromSecretKey(bs58.decode(POOL_PRIVATE_KEY));
  } catch (err) {
    console.error("❌ FATAL: SOLANA_POOL_PRIVATE_KEY is not a valid base58 secret key.", err);
    process.exit(1);
  }
}

// Track bets already paid in this session to prevent duplicate payouts
const paidBetIds = new Set<string>();

// --- Fix C1 (audit v2) : vérification on-chain de la mise avant payout ---
// Cache des signatures déjà vérifiées. Les transactions Solana sont immuables
// une fois confirmées donc ré-fetcher à chaque cycle est inutile et coûteux.
const verifiedBetCacheKeys = new Set<string>();

function toHourStartIso(value: string | Date): string {
  const date = value instanceof Date ? new Date(value) : new Date(value);
  date.setUTCMinutes(0, 0, 0);
  return date.toISOString();
}

/**
 * Vérifie qu'une mise on-chain correspond bien au bet en DB :
 *  - tx_signature présent et confirmé sans erreur on-chain ;
 *  - bet.wallet présent dans accountKeys ET parmi les signers (numRequiredSignatures premiers) ;
 *  - le pool wallet a reçu exactement amount_sol * LAMPORTS_PER_SOL (delta des balances).
 *
 * Sans cette vérification, un attaquant peut INSERT un bet avec wallet=lui-même
 * mais payer depuis un autre wallet (ou pas du tout selon les RLS) et récupérer
 * les gains au settlement.
 */
async function verifyBetOnChain(
  bet: { id: string; wallet: string; amount_sol: number; tx_signature: string | null | undefined },
  poolPubkey: PublicKey,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const txSignature = bet.tx_signature?.trim();
  const cacheKey = buildBetVerificationCacheKey({
    tx_signature: txSignature,
    wallet: bet.wallet,
    amount_sol: bet.amount_sol,
    pool_public_key: poolPubkey.toBase58(),
  });

  if (!cacheKey || !txSignature) {
    return { ok: false, reason: "invalid bet verification cache key" };
  }

  if (verifiedBetCacheKeys.has(cacheKey)) {
    return { ok: true };
  }

  let tx;
  try {
    for (let attempt = 0; attempt < 12; attempt++) {
      tx = await connection.getTransaction(txSignature, {
        maxSupportedTransactionVersion: 0,
        commitment: "confirmed",
      });
      if (tx) break;
      await new Promise((resolve) => setTimeout(resolve, 1500));
    }
  } catch (err) {
    return { ok: false, reason: `RPC error: ${(err as Error).message}` };
  }

  if (!tx) return { ok: false, reason: "tx not found on-chain" };
  if (tx.meta?.err) return { ok: false, reason: `tx failed on-chain: ${JSON.stringify(tx.meta.err)}` };
  if (!tx.meta) return { ok: false, reason: "tx meta missing" };

  // Account keys : compat versioned (v0) + legacy.
  const message = tx.transaction.message as any;
  const keys: PublicKey[] = message.staticAccountKeys ?? message.accountKeys;
  if (!keys || keys.length === 0) {
    return { ok: false, reason: "no account keys in tx" };
  }

  let expectedWallet: PublicKey;
  try {
    expectedWallet = new PublicKey(bet.wallet);
  } catch {
    return { ok: false, reason: "bet.wallet not a valid PublicKey" };
  }

  const walletIdx = keys.findIndex((k) => k.equals(expectedWallet));
  const poolIdx = keys.findIndex((k) => k.equals(poolPubkey));

  if (walletIdx < 0) return { ok: false, reason: "bet.wallet absent from tx accounts" };
  if (poolIdx < 0) return { ok: false, reason: "pool absent from tx accounts" };

  // Les `numRequiredSignatures` premiers accounts sont les signers de la tx.
  const numSigners = tx.transaction.message.header.numRequiredSignatures;
  if (walletIdx >= numSigners) {
    return { ok: false, reason: "bet.wallet did not sign the tx" };
  }

  // Le delta du pool doit correspondre EXACTEMENT au montant déclaré.
  // (Les fees sont débités du fee payer, pas du pool, donc pas de tolérance nécessaire.)
  const delta = tx.meta.postBalances[poolIdx] - tx.meta.preBalances[poolIdx];
  const expectedLamports = Math.round(bet.amount_sol * LAMPORTS_PER_SOL);
  if (delta !== expectedLamports) {
    return { ok: false, reason: `pool delta ${delta} lamports ≠ expected ${expectedLamports}` };
  }

  verifiedBetCacheKeys.add(cacheKey);
  return { ok: true };
}

type SolBetRow = {
  id: string;
  wallet: string;
  side: "YES" | "NO";
  amount_sol: number;
  tx_signature: string | null;
  valid_onchain?: boolean | null;
  payout_tx?: string | null;
};

async function markBetVerification(
  betId: string,
  valid: boolean,
  reason: string,
): Promise<boolean> {
  const { data, error } = await supabase
    .from("bets")
    .update({
      valid_onchain: valid,
      verified_at: new Date().toISOString(),
      verification_reason: reason,
    })
    .eq("id", betId)
    .select("id")
    .maybeSingle();

  if (error) {
    console.error(`   ⚠️ Failed to persist verification for bet ${betId}:`, error);
    return false;
  }

  if (!data) {
    console.error(`   ⚠️ Verification update affected 0 rows for bet ${betId}`);
    return false;
  }

  return true;
}

async function getVerifiedMarketPools(
  marketId: string,
  poolPubkey: PublicKey,
): Promise<{ bets: SolBetRow[]; yesTotal: number; noTotal: number }> {
  const { data: allBets, error } = await supabase
    .from("bets")
    .select("id,wallet,side,amount_sol,tx_signature,valid_onchain,payout_tx")
    .eq("market_id", marketId)
    .gt("amount_sol", 0);

  if (error) {
    console.error(`   ❌ Failed to load bets for pool verification:`, error);
    return { bets: [], yesTotal: 0, noTotal: 0 };
  }

  const verifiedBets: SolBetRow[] = [];
  const acceptedTxSignatures = new Set<string>();
  for (const rawBet of (allBets ?? []) as SolBetRow[]) {
    const amount = Number(rawBet.amount_sol ?? 0);
    if (!Number.isFinite(amount) || amount <= 0) {
      continue;
    }

    const bet = { ...rawBet, amount_sol: amount };
    const txSignature = bet.tx_signature?.trim();

    if (!txSignature) {
      await markBetVerification(bet.id, false, "missing tx_signature");
      console.error(`   🚨 Excluding unverified bet ${bet.id} from payout pools: missing tx_signature`);
      continue;
    }

    if (acceptedTxSignatures.has(txSignature)) {
      await markBetVerification(bet.id, false, "duplicate tx_signature");
      console.error(`   🚨 Excluding duplicate bet ${bet.id} from payout pools: duplicate tx_signature`);
      continue;
    }

    bet.tx_signature = txSignature;

    if (bet.valid_onchain === true) {
      acceptedTxSignatures.add(txSignature);
      verifiedBets.push(bet);
      continue;
    }

    const verification = await verifyBetOnChain(bet, poolPubkey);
    if (!verification.ok) {
      await markBetVerification(bet.id, false, verification.reason);
      console.error(`   🚨 Excluding unverified bet ${bet.id} from payout pools: ${verification.reason}`);
      continue;
    }

    const persisted = await markBetVerification(bet.id, true, "verified_onchain_by_worker");
    if (!persisted) {
      console.error(`   🚨 Excluding bet ${bet.id}: DB verification state was not persisted`);
      continue;
    }

    acceptedTxSignatures.add(txSignature);
    verifiedBets.push({ ...bet, valid_onchain: true });
  }

  const payoutEligibleBets = filterUniqueVerifiedPayoutBets(verifiedBets);
  const { yesTotal, noTotal } = computeVerifiedMarketPools(payoutEligibleBets);

  return { bets: payoutEligibleBets, yesTotal, noTotal };
}

// --- Fix Problème 3 : prix médian sur 3 sources indépendantes ---
// On interroge CoinGecko + Binance + Coinbase en parallèle. On exige au moins
// 2 sources concordantes (écart < 5%) et on retourne la médiane. Si une seule
// source répond ou si les sources divergent trop, on refuse le settlement
// (retour null → comportement existant : marché skippé jusqu'au cycle suivant).
const COINGECKO_IDS: Record<string, string> = {
  BTC: "bitcoin", ETH: "ethereum", SOL: "solana", BNB: "binancecoin",
  XRP: "ripple", DOGE: "dogecoin", TRX: "tron", ZCASH: "zcash",
  SHIB: "shiba-inu", LTC: "litecoin",
};
const BINANCE_SYMBOLS: Record<string, string> = {
  BTC: "BTCUSDT", ETH: "ETHUSDT", SOL: "SOLUSDT", BNB: "BNBUSDT",
  XRP: "XRPUSDT", DOGE: "DOGEUSDT", TRX: "TRXUSDT", ZCASH: "ZECUSDT",
  SHIB: "SHIBUSDT", LTC: "LTCUSDT",
};
const COINBASE_SYMBOLS: Record<string, string | null> = {
  BTC: "BTC", ETH: "ETH", SOL: "SOL", BNB: null,
  XRP: "XRP", DOGE: "DOGE", TRX: null, ZCASH: "ZEC",
  SHIB: "SHIB", LTC: "LTC",
};

async function fetchJsonWithTimeout(url: string, timeoutMs = 5000): Promise<any | null> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

async function fetchFromCoingecko(asset: string): Promise<number | null> {
  const id = COINGECKO_IDS[asset];
  if (!id) return null;
  const data = await fetchJsonWithTimeout(
    `https://api.coingecko.com/api/v3/simple/price?ids=${id}&vs_currencies=usd`
  );
  const price = data?.[id]?.usd;
  return typeof price === "number" && isFinite(price) && price > 0 ? price : null;
}

async function fetchFromBinance(asset: string): Promise<number | null> {
  const symbol = BINANCE_SYMBOLS[asset];
  if (!symbol) return null;
  const data = await fetchJsonWithTimeout(
    `https://api.binance.com/api/v3/ticker/price?symbol=${symbol}`
  );
  const price = data?.price ? parseFloat(data.price) : NaN;
  return isFinite(price) && price > 0 ? price : null;
}

async function fetchFromCoinbase(asset: string): Promise<number | null> {
  const symbol = COINBASE_SYMBOLS[asset];
  if (!symbol) return null;
  const data = await fetchJsonWithTimeout(
    `https://api.coinbase.com/v2/prices/${symbol}-USD/spot`
  );
  const price = data?.data?.amount ? parseFloat(data.data.amount) : NaN;
  return isFinite(price) && price > 0 ? price : null;
}

async function fetchCryptoPrice(asset: string): Promise<number | null> {
  // Récupérer en parallèle depuis 3 sources indépendantes
  const results = await Promise.all([
    fetchFromCoingecko(asset),
    fetchFromBinance(asset),
    fetchFromCoinbase(asset),
  ]);
  const prices = results.filter((p): p is number => p !== null);

  // Exiger au moins 2 sources pour autoriser le settlement
  if (prices.length < 2) {
    console.warn(`   ⚠️  Only ${prices.length} price source(s) available for ${asset}, refusing settlement`);
    return null;
  }

  // Détecter divergence anormale entre sources (>5%)
  const min = Math.min(...prices);
  const max = Math.max(...prices);
  if (max / min > 1.05) {
    console.warn(`   ⚠️  Price sources diverge >5% for ${asset}: [${prices.join(", ")}], refusing settlement`);
    return null;
  }

  // Médiane : valeur du milieu sur 3, moyenne sur 2
  const sorted = [...prices].sort((a, b) => a - b);
  if (sorted.length === 3) return sorted[1];
  return (sorted[0] + sorted[1]) / 2;
}

async function distributeSolWinnings(
  marketId: string,
  winningSide: "YES" | "NO"
) {
  if (!poolKeypair) {
    return { distributed: 0 };
  }
  // Vérifier le solde du pool
  const poolBalance = await connection.getBalance(poolKeypair.publicKey);
  console.log(`   💰 Pool balance: ${(poolBalance / LAMPORTS_PER_SOL).toFixed(6)} SOL`);

  // Source of truth for payout math: only on-chain verified bets count in pools.
  const { bets: verifiedBets, yesTotal, noTotal } = await getVerifiedMarketPools(
    marketId,
    poolKeypair.publicKey,
  );

  // Filter out paid/claimed bets after verification. Unverified rows never reach
  // this set, so fake losing bets cannot inflate the payout formula.
  const unpaidBets = verifiedBets.filter((b) => !b.payout_tx && !paidBetIds.has(b.id));

  if (unpaidBets.length === 0) {
    console.log(`   ✅ All SOL bets already paid for this market (session cached)`);
    return { distributed: 0 };
  }

  const winningPool = winningSide === "YES" ? yesTotal : noTotal;
  const losingPool = winningSide === "YES" ? noTotal : yesTotal;

  if (winningPool === 0) return { distributed: 0 };

  let distributed = 0;

  for (const bet of unpaidBets) {
    if (bet.side !== winningSide || !bet.amount_sol || bet.amount_sol <= 0) {
      continue;
    }

    // --- Fix Problème 5 : valider l'adresse destinataire AVANT toute opération ---
    // Avant, `new PublicKey(bet.wallet)` était fait dans le try/catch d'envoi :
    // une adresse invalide (string corrompue, length != 32 bytes) était sile-
    // ncieusement skip dans le catch global. Pire, une PDA (off-curve) aurait
    // pu recevoir des SOL irrécupérables. On valide explicitement ici.
    let recipient: PublicKey;
    try {
      recipient = new PublicKey(bet.wallet);
    } catch {
      console.error(`   ⚠️  Invalid wallet for bet ${bet.id}: ${bet.wallet} — skipping`);
      continue;
    }
    if (!PublicKey.isOnCurve(recipient.toBytes())) {
      console.error(`   ⚠️  Wallet not on ed25519 curve (PDA?) for bet ${bet.id}: ${bet.wallet} — skipping`);
      continue;
    }

    // Calculer gains: mise + part du pool perdant
    const winnings = computePayoutAmount(bet.amount_sol, winningPool, losingPool);
    const lamports = Math.floor(winnings * LAMPORTS_PER_SOL);

    // Vérifier si le pool a assez de SOL (avec marge pour les frais)
    if (poolBalance < lamports + 5000) {
      console.error(`   ❌ Pool insufficient funds: need ${(lamports / LAMPORTS_PER_SOL).toFixed(6)} SOL, have ${(poolBalance / LAMPORTS_PER_SOL).toFixed(6)} SOL`);
      continue;
    }

    // --- Fix Problème 1 : RÉSERVATION ATOMIQUE EN DB AVANT L'ENVOI ON-CHAIN ---
    // On pose un claim token sur payout_tx (NULL → 'pending_<uuid>') de façon atomique.
    // Si 0 ligne affectée → un autre cycle/worker a déjà pris ce bet → on skippe.
    // Conséquence : même en cas de crash après envoi, le bet ne sera PAS repayé.
    const claimToken = `pending_${randomUUID()}`;
    const { data: claimed, error: claimError } = await supabase
      .from("bets")
      .update({ payout_tx: claimToken })
      .eq("id", bet.id)
      .eq("valid_onchain", true)
      .is("payout_tx", null)
      .select("id");

    if (claimError) {
      console.error(`   ❌ Failed to claim bet ${bet.id} in DB:`, claimError);
      continue;
    }
    if (!claimed || claimed.length === 0) {
      console.log(`   ⏭️  Bet ${bet.id} already claimed/paid — skipping`);
      paidBetIds.add(bet.id);
      continue;
    }

    // À partir d'ici le bet est verrouillé en DB. Envoi de la tx on-chain.
    let signature: string;
    try {
      const tx = new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: poolKeypair.publicKey,
          toPubkey: recipient,
          lamports,
        })
      );

      const { blockhash } = await connection.getLatestBlockhash();
      tx.recentBlockhash = blockhash;
      tx.feePayer = poolKeypair.publicKey;

      signature = await connection.sendTransaction(tx, [poolKeypair]);
      await connection.confirmTransaction(signature, "confirmed");
    } catch (err) {
      // Échec d'envoi : on libère la réservation pour permettre une nouvelle tentative.
      // (Le service role bypasse la RLS, donc on peut repasser à NULL.)
      const { error: revertError } = await supabase
        .from("bets")
        .update({ payout_tx: null })
        .eq("id", bet.id)
        .eq("payout_tx", claimToken);
      if (revertError) {
        console.error(`   🚨 CRITICAL: failed to revert claim on bet ${bet.id}:`, revertError);
        console.error(`   🚨 Manual reconciliation needed. Claim token: ${claimToken}`);
      }
      console.error(`❌ Échec paiement vers ${bet.wallet}:`, err);
      continue;
    }

    // Tx confirmée : remplacer le claim token par la vraie signature via RPC.
    const { error: rpcError } = await supabase.rpc("record_payout", {
      p_bet_id: bet.id,
      p_payout_tx: signature,
      p_payout_amount: winnings,
    });

    if (rpcError) {
      // La tx on-chain a réussi mais le record DB a échoué.
      // Le bet conserve son claim token → NE SERA PAS repayé (pas de double envoi).
      // Réconciliation manuelle requise pour remplacer le token par la signature réelle.
      console.error(`   🚨 CRITICAL: tx ${signature} sent but record_payout failed for bet ${bet.id}:`, rpcError);
      console.error(`   🚨 Manual reconciliation: replace claim token "${claimToken}" with signature "${signature}" in bets table.`);
    } else {
      console.log(`   📝 Recorded payout in DB via RPC`);
    }

    paidBetIds.add(bet.id);
    console.log(`✅ Payé ${winnings.toFixed(6)} SOL à ${bet.wallet} (tx: ${signature.slice(0, 20)}...)`);
    distributed++;
  }

  return { distributed };
}

async function settleKOLMarkets() {
  const { data: kolMarkets } = await supabase
    .from("markets")
    .select("*")
    .eq("tag", "KOL")
    .eq("resolved", false)
    .is("deleted_at", null)
    .lte("closes_at", new Date().toISOString());

  if (!kolMarkets || kolMarkets.length === 0) return;

  console.log(`🎰 Found ${kolMarkets.length} KOL market(s) to settle`);

  for (const market of kolMarkets) {
    const kolName = (market.kol_params as any)?.kol_name;
    if (!kolName) {
      console.log(`   ⚠️ No kol_name in kol_params for market ${market.id}`);
      continue;
    }

    const { data: kolRow } = await supabase
      .from("kol_wallets")
      .select("wallet")
      .eq("name", kolName)
      .single();

    if (!kolRow) {
      console.log(`   ⚠️ KOL wallet not found for ${kolName}`);
      continue;
    }

    const settlementHour = toHourStartIso(market.closes_at);

    const { data: snapshots } = await supabase
      .from("kol_hourly_snapshots")
      .select("*")
      .eq("wallet", kolRow.wallet)
      .eq("snapshot_hour", settlementHour)
      .limit(1);

    const snapshot = snapshots?.[0] ?? null;

    if (!snapshot) {
      console.log(`   ⏳ No exact KOL snapshot for ${kolName} at ${settlementHour}, skipping`);
      continue;
    }

    if (
      (snapshot.pnl_sol == null || snapshot.pnl_percent == null) &&
      ["pnl_sol_positive", "pnl_sol_negative", "pnl_percent", "head_to_head"].includes((market.kol_params as any)?.type)
    ) {
      console.log(`   ⏳ Snapshot for ${kolName} at ${settlementHour} has no previous-hour baseline, skipping`);
      continue;
    }

    const params = market.kol_params as any;
    if (!params || !params.type) {
      console.log(`   ⚠️ No kol_params for market ${market.id}`);
      continue;
    }

    let outcome: "YES" | "NO";
    let settlementValue: number = 0;

    switch (params.type) {
      case "pnl_sol_positive":
        outcome = (snapshot.pnl_sol ?? 0) >= (params.threshold ?? 0) ? "YES" : "NO";
        settlementValue = snapshot.pnl_sol ?? 0;
        break;
      case "pnl_sol_negative":
        outcome = (snapshot.pnl_sol ?? 0) <= -(params.threshold ?? 0) ? "YES" : "NO";
        settlementValue = snapshot.pnl_sol ?? 0;
        break;
      case "pnl_percent":
        outcome = params.direction === "positive"
          ? ((snapshot.pnl_percent ?? 0) > 0 ? "YES" : "NO")
          : ((snapshot.pnl_percent ?? 0) < 0 ? "YES" : "NO");
        settlementValue = snapshot.pnl_percent ?? 0;
        break;
      case "trades":
        outcome = (snapshot.total_trades ?? 0) > (params.min_trades ?? 5) ? "YES" : "NO";
        settlementValue = snapshot.total_trades ?? 0;
        break;
      case "top3": {
        const { data: allSnapshots } = await supabase
          .from("kol_hourly_snapshots")
          .select("wallet, pnl_sol")
          .eq("snapshot_hour", snapshot.snapshot_hour)
          .order("pnl_sol", { ascending: false });
        const rank = (allSnapshots ?? []).findIndex((s: any) => s.wallet === kolRow.wallet) + 1;
        outcome = rank > 0 && rank <= (params.position ?? 3) ? "YES" : "NO";
        settlementValue = rank;
        break;
      }
      case "head_to_head": {
        const opponentName = params.opponent_kol_name;
        if (!opponentName || opponentName === kolName) {
          console.log(`   ⚠️ Invalid opponent_kol_name for market ${market.id}`);
          continue;
        }

        const { data: opponentRow } = await supabase
          .from("kol_wallets")
          .select("wallet")
          .eq("name", opponentName)
          .single();

        if (!opponentRow) {
          console.log(`   ⚠️ Opponent KOL wallet not found for ${opponentName}`);
          continue;
        }

        const { data: opponentSnapshots } = await supabase
          .from("kol_hourly_snapshots")
          .select("pnl_sol")
          .eq("wallet", opponentRow.wallet)
          .eq("snapshot_hour", settlementHour)
          .limit(1);

        const opponentSnapshot = opponentSnapshots?.[0] ?? null;
        if (!opponentSnapshot || opponentSnapshot.pnl_sol == null) {
          console.log(`   ⏳ No usable opponent snapshot for ${opponentName} at ${settlementHour}, skipping`);
          continue;
        }

        const primaryPnl = Number(snapshot.pnl_sol);
        const opponentPnl = Number(opponentSnapshot.pnl_sol);
        outcome = primaryPnl > opponentPnl ? "YES" : "NO";
        settlementValue = primaryPnl - opponentPnl;
        break;
      }
      default:
        console.log(`   ⚠️ Unknown kol_params type: ${params.type}`);
        continue;
    }

    const { error: rpcError } = await supabase.rpc("settle_market", {
      p_market_id: market.id,
      p_outcome: outcome,
      p_settlement_price: settlementValue,
    });

    if (rpcError) {
      console.error("❌ Failed to settle KOL market via RPC:", rpcError);
      continue;
    }

    console.log(`🏁 KOL Market "${market.question.slice(0, 50)}..."`);
    console.log(`   ✅ DB updated | Outcome: ${outcome} | Value: ${settlementValue}`);

    try {
      const { data: snapData } = await supabase.rpc("generate_market_snapshot", {
        p_market_id: market.id,
      });
      if (snapData) {
        const { data: snapRows, error: snapErr } = await supabase.from("markets").update({ snapshot: snapData }).eq("id", market.id).select();
        if (snapErr) {
          console.error(`   ⚠️ Snapshot update failed:`, snapErr);
        } else if (!snapRows || snapRows.length === 0) {
          console.error(`   ⚠️ Snapshot update affected 0 rows`);
        } else {
          console.log(`   📸 Snapshot saved`);
        }
      }
    } catch (snapErr) {
      console.error("   ⚠️ Snapshot generation failed:", snapErr);
    }

    if (poolKeypair) {
      try {
        const result = await distributeSolWinnings(market.id, outcome);
        console.log(`   💰 Distributed SOL to ${result.distributed} winner(s)`);
      } catch (err) {
        console.error("   ❌ SOL distribution failed:", err);
      }
    }
  }
}

async function settleMarkets() {
  console.log("🔍 Checking for due markets...");
  console.log(`   Current time: ${new Date().toISOString()}`);

  // Récupérer TOUS les marchés non résolus pour traitement
  const { data: allUnresolved, error: unresolvedError } = await supabase
    .from("markets")
    .select("*")
    .eq("resolved", false)
    .is("deleted_at", null);

  if (unresolvedError) {
    console.error("❌ Error fetching unresolved markets:", unresolvedError);
  }

  console.log(`   Total unresolved markets: ${allUnresolved?.length || 0}`);
  
  if (allUnresolved && allUnresolved.length > 0) {
    allUnresolved.forEach(m => {
      const closeTime = new Date(m.closes_at).getTime();
      const now = Date.now();
      const diff = Math.floor((now - closeTime) / 1000);
      const status = closeTime <= now ? "⏰ EXPIRED" : `⏳ in ${Math.floor((closeTime - now)/1000)}s`;
      console.log(`   - "${m.question.slice(0, 40)}..." ${status}`);
    });
  }

  // Filtrer côté client pour éviter les problèmes de timezone
  const dueMarkets = allUnresolved?.filter(m => {
    if (!m.closes_at) return false;
    return new Date(m.closes_at).getTime() <= Date.now();
  }) || [];

  if (dueMarkets.length === 0) {
    console.log("📭 No unresolved markets to settle");
  }

  // Traiter les marchés à résoudre
  const markets = dueMarkets;

  console.log(`📊 Found ${markets.length} market(s) to settle`);

  for (const market of markets) {
    if (!market.asset || !market.condition || !market.price_target) continue;

    const price = await fetchCryptoPrice(market.asset);
    if (!price) {
      console.log(`⚠️ Could not fetch price for ${market.asset}`);
      continue;
    }

    // Déterminer le gagnant
    const target = market.price_target;
    let outcome: "YES" | "NO";
    if (market.condition === "above") {
      outcome = price >= target ? "YES" : "NO";
    } else {
      outcome = price <= target ? "YES" : "NO";
    }

    console.log(`🏁 Market "${market.question.slice(0, 50)}..."`);
    console.log(`   Price: $${price} | Target: $${target} | Outcome: ${outcome}`);

    // Résoudre le marché via RPC (bypass RLS)
    const { error: rpcError } = await supabase.rpc("settle_market", {
      p_market_id: market.id,
      p_outcome: outcome,
      p_settlement_price: price,
    });

    if (rpcError) {
      console.error("❌ Failed to settle market via RPC:", rpcError);
      continue;
    }

    // Générer le snapshot pour archive
    try {
      const { data: snapshot } = await supabase.rpc("generate_market_snapshot", {
        p_market_id: market.id,
      });
      if (snapshot) {
        await supabase
          .from("markets")
          .update({ snapshot })
          .eq("id", market.id);
        console.log(`   📸 Snapshot generated`);
      }
    } catch (snapErr) {
      console.error("   ⚠️ Snapshot generation failed:", snapErr);
    }

    console.log(`   ✅ Market settled`);

    // Distribuer les gains SOL si clé privée configurée (chargée une seule fois au boot)
    if (poolKeypair) {
      try {
        const result = await distributeSolWinnings(market.id, outcome);
        console.log(`   💰 Distributed SOL to ${result.distributed} winner(s)`);
      } catch (err) {
        console.error("   ❌ SOL distribution failed:", err);
      }
    }
  }

  // Étape intermédiaire : Résoudre les marchés KOL via snapshots leaderboard
  await settleKOLMarkets();

  // Étape 2 : Distribuer les gains pour les marchés DÉJÀ résolus (par Supabase)
  // mais qui ont des paris SOL non encore payés
  const { data: resolvedMarkets } = await supabase
    .from("markets")
    .select("*")
    .eq("resolved", true)
    .not("outcome", "is", null)
    .is("deleted_at", null)
    .lte("closes_at", new Date().toISOString());

  if (resolvedMarkets && resolvedMarkets.length > 0) {
    console.log(`🎯 Found ${resolvedMarkets.length} already-resolved market(s) - checking for unpaid SOL bets`);

    for (const market of resolvedMarkets) {
      if (!market.outcome) continue;

      // Vérifier s'il y a des paris SOL non payés
      const { data: unpaidBets } = await supabase
        .from("bets")
        .select("id")
        .eq("market_id", market.id)
        .gt("amount_sol", 0)
        .is("payout_tx", null);

      if (!unpaidBets || unpaidBets.length === 0) {
        console.log(`   ✅ Market "${market.question.slice(0, 40)}..." - all SOL bets already paid`);
        continue;
      }

      console.log(`   📊 Market "${market.question.slice(0, 40)}..." - ${unpaidBets.length} unpaid SOL bet(s), outcome: ${market.outcome}`);

      // Distribuer les gains (clé chargée une seule fois au boot)
      if (poolKeypair) {
        try {
          const result = await distributeSolWinnings(
            market.id,
            market.outcome as "YES" | "NO"
          );
          if (result.distributed > 0) {
            console.log(`   💰 Paid ${result.distributed} winner(s)`);
          } else {
            console.log(`   ⏭️  No new payouts needed`);
          }
        } catch (err) {
          console.error(`   ❌ Distribution failed:`, err);
        }
      }
    }
  }
}

// Boucle principale
console.log("🚀 Auto-settlement worker started");
console.log(`   Pool: ${poolKeypair ? "✅ configured" : "❌ not configured"}`);
console.log("");

// --- Fix Problème 2 : verrou réentrant empêchant deux cycles en parallèle ---
// Si un cycle dépasse 30 s (RPC Solana lent, beaucoup de winners…), le tick
// suivant détecte le flag et skippe au lieu de lancer un second settlement
// concurrent qui pourrait produire des doubles paiements.
let cycleRunning = false;
async function runCycle() {
  if (cycleRunning) {
    console.log("⏭️  Previous settlement cycle still running, skipping this tick");
    return;
  }
  cycleRunning = true;
  try {
    await settleMarkets();
  } catch (err) {
    console.error("❌ Settlement cycle failed:", err);
  } finally {
    cycleRunning = false;
  }
}

await runCycle(); // Run once immediately

if (process.argv.includes("--once") || process.env.AUTO_SETTLE_ONCE === "true") {
  console.log("✅ One settlement cycle completed");
  process.exit(0);
}

// Polling toutes les 30 secondes
setInterval(runCycle, 30_000);

console.log("⏱️  Polling every 30 seconds...");
