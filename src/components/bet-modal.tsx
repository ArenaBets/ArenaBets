import { useEffect, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { supabase } from "@/integrations/supabase/client";
import {
  buildCryptoMarketQuestion,
  CRYPTO_ASSETS,
  getCryptoAsset,
  isValidPriceStep,
  MARKET_CONDITIONS,
  MARKET_DURATIONS,
  snapToPriceStep,
  type CryptoAsset,
  type MarketCondition,
  type MarketDuration,
} from "@/lib/crypto-markets";
import { createBetTransaction, recordBet, connection, verifyTransaction } from "@/lib/solana-pool";

export type Market = {
  id: string;
  question: string;
  tag: string;
};

type BetTotals = { yes: number; no: number; yesCount: number; noCount: number };

export function BetModal({
  market,
  side,
  isOpen,
  onClose,
  onPlaced,
}: {
  market: Market;
  side: "YES" | "NO";
  isOpen: boolean;
  onClose: () => void;
  onPlaced: () => void;
}) {
  if (!isOpen) return null;
  const { publicKey, connected, signTransaction } = useWallet();
  const { setVisible } = useWalletModal();
  const [solAmount, setSolAmount] = useState("0.01");
  const [solBalance, setSolBalance] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Récupérer le solde SOL
  useEffect(() => {
    if (!publicKey) return;
    connection.getBalance(publicKey).then((lamports) => {
      setSolBalance(lamports / 1e9);
    });
  }, [publicKey]);

  async function handleBet() {
    setError(null);
    if (!connected || !publicKey) {
      setVisible(true);
      return;
    }

    // === PARI EN SOL ===
    const solValue = Number(solAmount);
    if (!Number.isFinite(solValue) || solValue < 0.001) {
      setError("Minimum bet is 0.001 SOL");
      return;
    }
    if (solBalance !== null && solValue > solBalance) {
      setError(`Not enough SOL (balance: ${solBalance.toFixed(4)} SOL)`);
      return;
    }

    setSubmitting(true);
    try {
      // 1. Créer la transaction
      const tx = await createBetTransaction(publicKey, solValue);
      if (!tx) {
        throw new Error("Pool wallet not configured - check .env file");
      }

      // 2. Signer avec le wallet
      if (!signTransaction) {
        throw new Error("Wallet does not support transaction signing");
      }
      const signedTx = await signTransaction(tx);

      // 3. Envoyer sur le réseau
      const signature = await connection.sendRawTransaction(signedTx.serialize(), {
        skipPreflight: false,
        maxRetries: 3,
      });

      // 4. Attendre confirmation sans bloquer l'enregistrement si le RPC indexe lentement.
      const confirmed = await verifyTransaction(signature, 20);
      if (!confirmed) {
        console.warn("[Bet] Transaction sent but not confirmed by RPC before DB insert", signature);
      }

      // 5. Enregistrer en DB
      const result = await recordBet(
        market.id,
        publicKey.toBase58(),
        side,
        solValue,
        signature
      );

      if (!result.success) {
        throw new Error(result.error || "Failed to record bet");
      }

      onPlaced();
      onClose();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <ModalShell onClose={onClose}>
      <div className="font-mono text-xs uppercase tracking-widest text-foreground/60">
        — Place a bet
      </div>
      <h3 className="mt-2 font-display text-2xl font-black uppercase leading-tight">
        {market.question}
      </h3>
      <div className="mt-4 flex items-center gap-3">
        <span className="font-mono text-xs uppercase tracking-wider">Side:</span>
        <span
          className={`ink-border-sm px-3 py-1 font-display text-sm font-bold uppercase tracking-wider ${side === "YES" ? "bg-primary text-primary-foreground" : "bg-accent text-accent-foreground"}`}
        >
          {side}
        </span>
      </div>

      <label className="mt-6 block font-mono text-xs uppercase tracking-wider">
        Amount (SOL)
      </label>
      <input
        type="number"
        min="0.001"
        step="0.001"
        value={solAmount}
        onChange={(e) => setSolAmount(e.target.value)}
        className="mt-2 w-full ink-border-sm bg-background px-4 py-3 font-mono text-lg"
      />
      <p className="mt-3 font-mono text-xs text-foreground/60">
        You pay network fees (~0.000005 SOL).
        {solBalance !== null ? ` Balance: ${solBalance.toFixed(4)} SOL.` : ""}
      </p>
      <p className="mt-1 font-mono text-xs text-foreground/40">
        SOL goes to pool wallet, redistributed to winners on settlement.
      </p>

      {error && (
        <div className="mt-3 ink-border-sm bg-accent/20 px-3 py-2 font-mono text-xs text-accent">
          {error}
        </div>
      )}
      <div className="mt-6 flex gap-3">
        <button
          onClick={onClose}
          className="ink-border-sm bg-parchment px-5 py-2.5 font-display text-sm font-bold uppercase tracking-wider"
        >
          Cancel
        </button>
        <button
          disabled={submitting}
          onClick={handleBet}
          className={`ink-border-sm wobble-shadow flex-1 py-2.5 font-display text-sm font-bold uppercase tracking-wider transition-transform hover:-translate-y-0.5 disabled:opacity-50 ${side === "YES" ? "bg-primary text-primary-foreground" : "bg-accent text-accent-foreground"}`}
        >
          {submitting
            ? "Placing…"
            : connected
              ? `Bet ${solAmount || 0} SOL on ${side}`
              : "Connect wallet"}
        </button>
      </div>
    </ModalShell>
  );
}

export function CreateMarketModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: () => void;
}) {
  const { publicKey } = useWallet();
  const [asset, setAsset] = useState<CryptoAsset>("BTC");
  const [condition, setCondition] = useState<MarketCondition>("above");
  const [priceTarget, setPriceTarget] = useState("");
  const [durationHours, setDurationHours] = useState<MarketDuration>(60);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const priceStep = getCryptoAsset(asset).priceStep;

  async function handleCreate() {
    setError(null);
    if (!publicKey) {
      setError("Connect your wallet first");
      return;
    }
    const target = Number(priceTarget);
    if (!Number.isFinite(target) || target <= 0) {
      setError("Enter a valid price target");
      return;
    }
    if (!isValidPriceStep(target, priceStep)) {
      setError(`Price must be a multiple of ${priceStep} for ${asset}`);
      return;
    }
    const snappedTarget = snapToPriceStep(target, priceStep);

    const closesAt = new Date(Date.now() + durationHours * 60 * 1000);
    const question = buildCryptoMarketQuestion({
      asset,
      condition,
      priceTarget: snappedTarget,
      durationHours,
    });

    // durationHours est maintenant en minutes

    setSubmitting(true);
    try {
      const payload = {
        question,
        tag: asset,
        asset,
        condition,
        price_target: snappedTarget,
        duration_hours: durationHours,
        closes_at: closesAt.toISOString(),
        created_by_wallet: publicKey.toBase58(),
        resolved: false,
        outcome: null,
        settlement_price: null,
      };
      console.log("[Markets] Creating market with payload:", payload);
      const { error: insertError } = await supabase.from("markets").insert(payload);
      if (insertError) {
        console.error("[Markets] Insert error:", insertError);
        throw insertError;
      }
      console.log("[Markets] Market created successfully");
      onCreated();
      onClose();
    } catch (e) {
      const message =
        e instanceof Error
          ? e.message
          : e && typeof e === "object" && "message" in e
            ? String(e.message)
            : "Failed to create market";
      console.error("[Markets] Create failed:", message, e);
      setError(message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <ModalShell onClose={onClose}>
      <div className="font-mono text-xs uppercase tracking-widest text-foreground/60">
        — Open a new fight
      </div>
      <h3 className="mt-2 font-display text-2xl font-black uppercase">
        Create crypto market
      </h3>

      <label className="mt-6 block font-mono text-xs uppercase tracking-wider">Asset</label>
      <div className="mt-2 flex max-h-40 flex-wrap gap-2 overflow-y-auto">
        {CRYPTO_ASSETS.map((item) => (
          <button
            key={item.symbol}
            type="button"
            onClick={() => {
              setAsset(item.symbol);
              setPriceTarget("");
              setError(null);
            }}
            className={`ink-border-sm min-w-[4.5rem] px-2 py-2 font-display text-sm font-bold uppercase tracking-wider ${
              asset === item.symbol
                ? "bg-primary text-primary-foreground"
                : "bg-background"
            }`}
          >
            {item.symbol}
          </button>
        ))}
      </div>

      <label className="mt-4 block font-mono text-xs uppercase tracking-wider">
        Condition
      </label>
      <div className="mt-2 grid grid-cols-2 gap-2">
        {MARKET_CONDITIONS.map((item) => (
          <button
            key={item}
            type="button"
            onClick={() => setCondition(item)}
            className={`ink-border-sm py-2 font-display text-sm font-bold uppercase tracking-wider ${
              condition === item
                ? "bg-accent text-accent-foreground"
                : "bg-background"
            }`}
          >
            {item}
          </button>
        ))}
      </div>

      <label className="mt-4 block font-mono text-xs uppercase tracking-wider">
        Price target (step {priceStep})
      </label>
      <input
        type="number"
        min={priceStep}
        step={priceStep}
        value={priceTarget}
        onChange={(e) => setPriceTarget(e.target.value)}
        placeholder={String(priceStep)}
        className="mt-2 w-full ink-border-sm bg-background px-4 py-3 font-mono text-sm"
      />

      <label className="mt-4 block font-mono text-xs uppercase tracking-wider">
        Duration
      </label>
      <div className="mt-2 grid grid-cols-3 gap-2">
        {MARKET_DURATIONS.map((minutes) => {
          const label = minutes < 60 
            ? `${minutes}min` 
            : `${Math.round(minutes / 60)}h`;
          return (
            <button
              key={minutes}
              type="button"
              onClick={() => setDurationHours(minutes)}
              className={`ink-border-sm py-2 font-display text-sm font-bold uppercase tracking-wider ${
                durationHours === minutes
                  ? "bg-primary text-primary-foreground"
                  : "bg-background"
              }`}
            >
              {label}
            </button>
          );
        })}
      </div>

      <div className="mt-4 ink-border-sm bg-background px-3 py-2 font-mono text-xs text-foreground/70">
        {priceTarget
          ? buildCryptoMarketQuestion({
              asset,
              condition,
              priceTarget: Number(priceTarget) || 0,
              durationHours,
            })
          : "Choose a price target to preview the market."}
      </div>

      {error && (
        <div className="mt-3 ink-border-sm bg-accent/20 px-3 py-2 font-mono text-xs text-accent">
          {error}
        </div>
      )}
      <div className="mt-6 flex gap-3">
        <button
          onClick={onClose}
          className="ink-border-sm bg-parchment px-5 py-2.5 font-display text-sm font-bold uppercase tracking-wider"
        >
          Cancel
        </button>
        <button
          disabled={submitting}
          onClick={handleCreate}
          className="ink-border-sm wobble-shadow flex-1 bg-primary py-2.5 font-display text-sm font-bold uppercase tracking-wider text-primary-foreground disabled:opacity-50"
        >
          {submitting ? "Opening…" : "Open market"}
        </button>
      </div>
    </ModalShell>
  );
}

function ModalShell({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [onClose]);
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-foreground/60 px-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md ink-border wobble-shadow-lg bg-parchment p-6"
        onClick={(e) => e.stopPropagation()}
      >
        {children}
      </div>
    </div>
  );
}

export function computeTotals(
  bets: { side: string; amount_points?: number | null; amount_sol?: number | null }[],
): BetTotals {
  let yes = 0,
    no = 0,
    yesCount = 0,
    noCount = 0;
  for (const b of bets) {
    const a = Number(b.amount_points ?? b.amount_sol) || 0;
    if (b.side === "YES") {
      yes += a;
      yesCount++;
    } else {
      no += a;
      noCount++;
    }
  }
  return { yes, no, yesCount, noCount };
}
