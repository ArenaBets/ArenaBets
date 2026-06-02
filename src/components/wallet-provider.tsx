import { useEffect, useMemo, useState, type ReactNode } from "react";
import { ConnectionProvider, WalletProvider } from "@solana/wallet-adapter-react";
import { WalletModalProvider, WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { PhantomWalletAdapter } from "@solana/wallet-adapter-phantom";
import { SolflareWalletAdapter } from "@solana/wallet-adapter-solflare";
import { BackpackWalletAdapter } from "@solana/wallet-adapter-backpack";
import { TrustWalletAdapter } from "@solana/wallet-adapter-trust";
import "@solana/wallet-adapter-react-ui/styles.css";

export function ArenaWalletProvider({ children }: { children: ReactNode }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const endpoint = useMemo(
    () => import.meta.env.VITE_SOLANA_PUBLIC_RPC_URL || "https://solana-rpc.publicnode.com",
    [],
  );

  useEffect(() => {
    if (import.meta.env.DEV) {
      console.info("[Solana RPC] wallet provider connection:", endpoint);
    }
  }, [endpoint]);
  // OKX Wallet, Glow, etc. are auto-detected via Wallet Standard.
  // We only need to register legacy adapters explicitly.
  const wallets = useMemo(
    () => [
      new PhantomWalletAdapter(),
      new SolflareWalletAdapter(),
      new BackpackWalletAdapter(),
      new TrustWalletAdapter(),
    ],
    [],
  );

  // Pendant SSR/hydration, on rend quand même les providers mais sans autoConnect
  // pour éviter les erreurs de contexte
  return (
    <ConnectionProvider endpoint={endpoint}>
      <WalletProvider wallets={wallets} autoConnect={mounted}>
        <WalletModalProvider>
          {children}
        </WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}

export function ConnectWalletButton({ className = "" }: { className?: string }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  if (!mounted) {
    return (
      <span className={className} aria-hidden>
        Connect Wallet
      </span>
    );
  }
  return <WalletMultiButton className={className} />;
}
