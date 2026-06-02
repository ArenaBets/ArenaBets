import { Link } from "@tanstack/react-router";
import logo from "@/assets/arena-logo.jpg";
import { ConnectWalletButton } from "@/components/wallet-provider";

type ArenaNavProps = {
  active?: "home" | "markets" | "kol-markets" | "portfolio" | "how-it-works" | "docs" | "leaderboard";
};

export function ArenaNav({ active }: ArenaNavProps) {
  return (
    <header className="mx-auto flex max-w-7xl items-center justify-between px-6 py-5">
      <Link to="/" className="flex items-center gap-3">
        <img src={logo} alt="ARENA" className="size-11 ink-border-sm" />
        <span className="font-display text-2xl font-black tracking-widest">ARENA</span>
      </Link>
      <nav className="hidden items-center gap-8 text-sm font-semibold uppercase tracking-wider md:flex">
        <Link
          to="/cryptomarkets"
          className={active === "markets" ? "text-accent" : "hover:text-accent"}
        >
          Crypto Markets
        </Link>
        <Link
          to="/kolmarkets"
          className={active === "kol-markets" ? "text-accent" : "hover:text-accent"}
        >
          KOL Markets
        </Link>
        <Link
          to="/leaderboard"
          className={active === "leaderboard" ? "text-accent" : "hover:text-accent"}
        >
          Leaderboard
        </Link>
        <Link
          to="/howitworks"
          className={active === "how-it-works" ? "text-accent" : "hover:text-accent"}
        >
          How it works
        </Link>
        <Link
          to="/docs"
          className={active === "docs" ? "text-accent" : "hover:text-accent"}
        >
          Docs
        </Link>
      </nav>
      <div className="flex items-center gap-3">
        <Link
          to="/cryptomarkets"
          className={`ink-border-sm bg-parchment px-3 py-2 font-mono text-xs font-bold uppercase tracking-wider transition-colors hover:bg-parchment/90 md:hidden ${
            active === "markets" ? "text-accent" : ""
          }`}
        >
          Crypto Markets
        </Link>
        <Link
          to="/portfolio"
          className={`ink-border-sm bg-parchment px-3 py-2 font-mono text-xs font-bold uppercase tracking-wider transition-colors hover:bg-parchment/90 ${
            active === "portfolio" ? "text-accent" : ""
          }`}
        >
          My Portfolio
        </Link>
        <ConnectWalletButton className="arena-wallet-btn" />
      </div>
    </header>
  );
}
