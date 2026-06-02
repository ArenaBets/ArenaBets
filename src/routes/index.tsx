import { createFileRoute, Link } from "@tanstack/react-router";
import logo from "@/assets/arena-logo.jpg";
import { ArenaNav } from "@/components/arena-nav";
import { PriceTicker } from "@/components/price-ticker";
import { ConnectWalletButton } from "@/components/wallet-provider";
import { useArenaStats } from "@/hooks/use-arena-stats";

export const Route = createFileRoute("/")({
  component: ArenaLanding,
});

function ArenaLanding() {
  const heroStats = useArenaStats();

  return (
    <div className="min-h-screen bg-background text-foreground paper-grain">
      <ArenaNav active="home" />
      <PriceTicker />
      <Hero stats={heroStats} />
      <HowItWorks />
      <Manifesto />
      <Footer />
    </div>
  );
}

function Hero({
  stats,
}: {
  stats: { openMarkets: string; gladiators: string };
}) {
  return (
    <section id="enter" className="mx-auto grid max-w-7xl gap-12 px-6 py-20 md:grid-cols-12 md:py-28">
      <div className="md:col-span-7">
        <div className="mb-6 inline-flex items-center gap-2 ink-border-sm bg-parchment px-3 py-1 font-mono text-xs uppercase tracking-wider">
          <span className="size-2 rounded-full bg-accent" /> Live · Season I — Colosseum
        </div>
        <h1 className="font-display text-6xl font-black uppercase leading-[0.95] tracking-tight md:text-8xl">
          Bet on
          <br />
          <span className="text-primary">results.</span>
          <br />
          Not on hype.
        </h1>
        <p className="mt-8 max-w-xl text-lg leading-relaxed text-foreground/80">
          ARENA is a prediction market built on Solana.
          Stake SOL on crypto price movements and trader performance outcomes.
          No fees, no tokens, no middleman — just transparent pools and automatic payouts.
        </p>
        <div className="mt-10">
          <ConnectWalletButton className="arena-wallet-btn-lg" />
          <div className="mt-4 flex flex-nowrap items-center gap-2">
            <Link
              to="/cryptomarkets"
              className="ink-border wobble-shadow bg-foreground px-4 py-3 font-display text-sm font-bold uppercase tracking-widest text-background transition-transform hover:-translate-y-1"
            >
              Crypto Markets
            </Link>
            <Link
              to="/kolmarkets"
              className="ink-border wobble-shadow bg-foreground px-4 py-3 font-display text-sm font-bold uppercase tracking-widest text-background transition-transform hover:-translate-y-1"
            >
              KOL Markets
            </Link>
            <Link
              to="/howitworks"
              className="ink-border wobble-shadow bg-parchment px-4 py-3 font-display text-sm font-bold uppercase tracking-widest transition-transform hover:-translate-y-1"
            >
              Read the rules
            </Link>
          </div>
        </div>
        <div className="mt-12 flex flex-wrap gap-8 font-mono text-sm">
          <Stat label="Open markets" value={stats.openMarkets} />
          <Stat label="Gladiators" value={stats.gladiators} />
        </div>
      </div>
      <div className="relative md:col-span-5">
        <div className="ink-border wobble-shadow-lg bg-parchment p-8">
          <img src={logo} alt="ARENA crest" className="mx-auto size-56 ink-border-sm" />
          <div className="mt-6 text-center font-display text-sm uppercase tracking-[0.3em]">
            ⚔  Vincit qui se vincit  ⚔
          </div>
          <div className="mt-2 text-center font-mono text-xs text-muted-foreground">
            He conquers who conquers himself
          </div>
        </div>
        <div className="absolute -bottom-6 -left-6 ink-border-sm wobble-shadow bg-accent px-4 py-2 font-display text-xs font-bold uppercase tracking-wider text-accent-foreground">
          No Fees · No KYC · No Lock-in
        </div>
      </div>
    </section>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="font-display text-3xl font-black">{value}</div>
      <div className="text-xs uppercase tracking-wider text-foreground/60">{label}</div>
    </div>
  );
}

function HowItWorks() {
  const steps = [
    { n: "I", title: "Pick your fight", body: "Browse crypto and KOL markets. Every market is a simple question with a clear expiration time." },
    { n: "II", title: "Stake a side", body: "Take YES or NO. Stake SOL directly from your wallet. Minimum bet is 0.001 SOL." },
    { n: "III", title: "Settle and win", body: "At expiration, the outcome is checked against public data. Winners receive their stake plus a share of the losing pool — automatically sent to their wallet." },
  ];
  return (
    <section id="how" className="border-y-2 border-foreground bg-parchment">
      <div className="mx-auto max-w-7xl px-6 py-20">
        <h2 className="font-display text-5xl font-black uppercase tracking-tight md:text-6xl">
          Three rounds. <span className="text-primary">One champion.</span>
        </h2>
        <div className="mt-12 grid gap-8 md:grid-cols-3">
          {steps.map((s) => (
            <div key={s.n} className="ink-border wobble-shadow bg-background p-7">
              <div className="font-display text-7xl font-black text-primary">{s.n}</div>
              <div className="mt-2 font-display text-xl font-bold uppercase tracking-wider">{s.title}</div>
              <p className="mt-3 text-sm leading-relaxed text-foreground/80">{s.body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function Manifesto() {
  return (
    <section id="manifesto" className="mx-auto max-w-4xl px-6 py-28 text-center">
      <div className="font-mono text-xs uppercase tracking-[0.3em] text-foreground/60">— Manifesto</div>
      <p className="mt-6 font-display text-3xl font-bold uppercase leading-tight md:text-5xl">
        "Every epoch has its arena. Ours is settled not by swords, <span className="text-primary">but by conviction</span>. Verified by data. Paid by the chain."
      </p>
      <div className="mt-8 font-mono text-xs uppercase tracking-widest text-foreground/60">
        — ARENA, the Praetor's letter
      </div>
    </section>
  );
}

function Footer() {
  return (
    <footer className="border-t-2 border-foreground bg-parchment">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-6 px-6 py-10">
        <div className="flex items-center gap-3">
          <img src={logo} alt="ARENA" className="size-10 ink-border-sm" />
          <div>
            <div className="font-display text-lg font-black tracking-widest">ARENA</div>
            <div className="font-mono text-xs text-foreground/60">Built on-chain. Settled in glory.</div>
          </div>
        </div>
        <div className="flex flex-wrap gap-6 font-mono text-xs uppercase tracking-wider">
          <Link to="/docs" className="hover:text-accent">Docs</Link>
          <a href="https://x.com/ArenabetsHQ" className="hover:text-accent">Twitter</a>
          <a href="https://github.com/ArenaBets/ArenaBets" className="hover:text-accent">Github</a>
        </div>
        <div className="font-mono text-xs text-foreground/60">© MMXXVI · ARENA</div>
      </div>
    </footer>
  );
}
