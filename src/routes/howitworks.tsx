import { createFileRoute } from "@tanstack/react-router";
import { ArenaNav } from "@/components/arena-nav";

export const Route = createFileRoute("/howitworks")({
  component: HowItWorksPage,
});

function HowItWorksPage() {
  return (
    <div className="min-h-screen bg-background text-foreground paper-grain">
      <ArenaNav active="how-it-works" />
      <main className="mx-auto max-w-3xl px-6 py-20">
        <h1 className="font-display text-5xl font-black uppercase tracking-tight md:text-6xl">
          How it <span className="text-primary">works</span>
        </h1>

        <section className="mt-12 space-y-4">
          <p className="text-lg leading-relaxed text-foreground/80">
            ARENA is a prediction market where you bet on crypto outcomes with SOL.
            You pick a market, stake on YES or NO, and winners split the losing side's pool.
            No hidden mechanics — your stake goes into a transparent pool, outcomes are verified against public data, and payouts happen automatically.
          </p>
        </section>

        <section className="mt-16">
          <h2 className="font-display text-2xl font-black uppercase tracking-tight">
            Placing a bet
          </h2>
          <div className="mt-8 grid gap-6">
            {[
              {
                n: "01",
                title: "Connect your wallet",
                body: "Link your Solana wallet. No account creation, no KYC. You always control your own funds.",
              },
              {
                n: "02",
                title: "Pick a market",
                body: "Browse open crypto or KOL markets. Each one asks a simple question with a clear expiration time — from 5 minutes up to 24 hours.",
              },
              {
                n: "03",
                title: "Choose a side",
                body: "Stake SOL on YES or NO. The minimum bet is 0.001 SOL. Your stake is transferred to the market pool and recorded.",
              },
              {
                n: "04",
                title: "Wait for settlement",
                body: "When the market expires, the result is checked against live data. If your side wins, your payout is sent to your wallet automatically.",
              },
            ].map((step) => (
              <div
                key={step.n}
                className="ink-border wobble-shadow bg-parchment p-6"
              >
                <div className="font-display text-3xl font-black text-primary">
                  {step.n}
                </div>
                <div className="mt-1 font-display text-lg font-bold uppercase tracking-wider">
                  {step.title}
                </div>
                <p className="mt-2 text-sm leading-relaxed text-foreground/80">
                  {step.body}
                </p>
              </div>
            ))}
          </div>
        </section>

        <section className="mt-16">
          <h2 className="font-display text-2xl font-black uppercase tracking-tight">
            Crypto markets
          </h2>
          <p className="mt-4 text-sm leading-relaxed text-foreground/80">
            Crypto markets ask whether an asset price will be above or below a target at expiration.
            For example: "Will BTC be above $70,000 in 1 hour?"
            Supported assets include BTC, ETH, SOL, BNB, XRP, DOGE, and others.
            When the market closes, the platform checks the current price against public market data.
          </p>
        </section>

        <section className="mt-16">
          <h2 className="font-display text-2xl font-black uppercase tracking-tight">
            KOL markets
          </h2>
          <p className="mt-4 text-sm leading-relaxed text-foreground/80">
            KOL (Key Opinion Leader) markets let you bet on the on-chain trading performance of tracked crypto traders.
            You can bet on whether a trader will be profitable by a certain SOL amount, hit a positive or negative PNL percentage, make a minimum number of trades, or rank in the top 3 at the next hourly refresh.
            Outcomes are verified against on-chain trading data, not social media metrics.
          </p>
        </section>

        <section className="mt-16">
          <h2 className="font-display text-2xl font-black uppercase tracking-tight">
            How outcomes are decided
          </h2>
          <p className="mt-4 text-sm leading-relaxed text-foreground/80">
            For crypto markets, the platform fetches the real-time asset price from public price feeds at expiration.
            For KOL markets, it checks the trader's on-chain performance snapshot at the next hourly refresh.
            If the market condition is met, YES wins. Otherwise, NO wins.
            Winners receive their original stake back plus a proportional share of the losing side's pool.
          </p>
        </section>

        <section className="mt-16">
          <h2 className="font-display text-2xl font-black uppercase tracking-tight">
            What you should know
          </h2>
          <ul className="mt-4 list-disc space-y-2 pl-5 text-sm leading-relaxed text-foreground/80">
            <li>
              <strong>Risk of loss:</strong> You can lose your entire stake. Only bet what you can afford to lose.
            </li>
            <li>
              <strong>Volatility:</strong> Crypto prices are unpredictable. Even well-reasoned bets can go wrong.
            </li>
            <li>
              <strong>No platform fees:</strong> 100% of the pool is redistributed to winners. The only cost is the standard Solana network fee per transaction (~0.000005 SOL).
            </li>
            <li>
              <strong>Payouts are automatic:</strong> If you win, SOL is sent directly to your wallet after settlement. There is no manual claim or withdrawal step.
            </li>
            <li>
              <strong>Transparency:</strong> All bets and outcomes are publicly recorded. Payout transactions happen on-chain and can be verified on any Solana explorer.
            </li>
          </ul>
        </section>

        <section className="mt-16 border-t-2 border-foreground pt-8">
          <p className="text-sm leading-relaxed text-foreground/80">
            ARENA is designed to be transparent, simple, and self-sustaining.
            If you have questions, check the open data or reach out through the community channels.
          </p>
        </section>
      </main>
    </div>
  );
}
