import { createFileRoute } from "@tanstack/react-router";
import { ArenaNav } from "@/components/arena-nav";

export const Route = createFileRoute("/docs")({
  component: DocsPage,
});

function Simple({ children }: { children: React.ReactNode }) {
  return (
    <div className="mt-3 rounded-md border-l-4 border-primary bg-parchment/50 p-4">
      <div className="mb-2 font-mono text-xs font-bold uppercase tracking-wider text-primary">Simple</div>
      <div className="text-sm leading-relaxed text-foreground/80">{children}</div>
    </div>
  );
}

function Technical({ children }: { children: React.ReactNode }) {
  return (
    <div className="mt-3 rounded-md border-l-4 border-foreground bg-muted p-4">
      <div className="mb-2 font-mono text-xs font-bold uppercase tracking-wider text-foreground/60">Technical</div>
      <div className="text-sm leading-relaxed text-foreground/80">{children}</div>
    </div>
  );
}

function DocsPage() {
  return (
    <div className="min-h-screen bg-background text-foreground paper-grain">
      <ArenaNav active="docs" />
      <main className="mx-auto max-w-3xl px-6 py-20">
        <h1 className="font-display text-5xl font-black uppercase tracking-tight md:text-6xl">
          <span className="text-primary">Docs</span>
        </h1>
        <p className="mt-4 text-lg text-foreground/60">
          Complete platform documentation — for users and developers.
        </p>

        {/* 1. OVERVIEW */}
        <section className="mt-16" id="overview">
          <h2 className="font-display text-3xl font-black uppercase tracking-tight">1. Overview</h2>

          <Simple>
            ARENA is a prediction market where users bet SOL on crypto price movements and trader performance outcomes. You stake on YES or NO, and if your prediction is correct, you receive a proportional share of the losing side's pool.
          </Simple>

          <Technical>
            ARENA uses Solana for wallet-signed SOL transfers and a managed backend for market data, bet history, and settlement state. When a user places a bet, the stake is transferred on-chain into a shared market pool. After the market closes, an automated settlement system checks the outcome against external data sources and distributes winnings proportionally through on-chain payouts.
          </Technical>
        </section>

        {/* 2. HOW IT WORKS */}
        <section className="mt-16" id="how-it-works">
          <h2 className="font-display text-3xl font-black uppercase tracking-tight">2. How it works</h2>

          <Simple>
            <ol className="mt-3 list-decimal space-y-2 pl-5">
              <li>Connect your Solana wallet — no account or KYC required.</li>
              <li>Browse open markets (crypto prices or trader performance).</li>
              <li>Pick a market and choose YES or NO.</li>
              <li>Enter your stake (minimum 0.001 SOL) and confirm the transaction.</li>
              <li>Wait for the market to expire.</li>
              <li>If you win, SOL is sent automatically to your wallet.</li>
            </ol>
            <p className="mt-4">
              <strong>Example:</strong> A market asks "Will BTC be above $70,000 in 1 hour?" You stake 0.5 SOL on YES. At expiration, BTC is at $71,500. YES wins. The total NO pool is 2 SOL. You get your 0.5 SOL back plus your share of the 2 SOL losing pool based on your stake proportion.
            </p>
          </Simple>

          <Technical>
            <ol className="mt-3 list-decimal space-y-2 pl-5">
              <li>User connects a Solana wallet via wallet adapter.</li>
              <li>The app loads currently open markets and displays their rules, closing time, and pool activity.</li>
              <li>User selects YES or NO, enters a stake, and approves the transaction in their wallet.</li>
              <li>The stake is sent from the user's wallet to the platform pool through a standard Solana transfer.</li>
              <li>After the transaction is confirmed, the bet is recorded with its market, side, amount, wallet, and transaction reference.</li>
              <li>At market expiration, the settlement system evaluates the outcome using price feeds or tracked KOL performance snapshots.</li>
              <li>Winner payouts are calculated proportionally from the losing side's pool.</li>
              <li>Payouts are sent back to winning wallets on-chain and linked to the original bet record.</li>
            </ol>
          </Technical>
        </section>

        {/* 3. SYSTEM ARCHITECTURE */}
        <section className="mt-16" id="architecture">
          <h2 className="font-display text-3xl font-black uppercase tracking-tight">3. System Architecture</h2>

          <Simple>
            The platform uses live price data from public crypto APIs and on-chain trader data to determine market outcomes. Everything is transparent — bets, prices, and payouts are all publicly verifiable.
          </Simple>

          <Technical>
            <h3 className="mt-4 font-display text-lg font-bold uppercase tracking-wider">Data sources</h3>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-foreground/80">
              <li><strong>Crypto prices:</strong> ARENA uses public market data providers to read asset prices at settlement time. A fallback source can be used if the primary feed is unavailable.</li>
              <li><strong>KOL performance:</strong> Trader performance is measured from tracked wallet activity and refreshed on a regular schedule.</li>
            </ul>

            <h3 className="mt-4 font-display text-lg font-bold uppercase tracking-wider">Settlement flow</h3>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-foreground/80">
              <li>The settlement system continuously checks for markets that have reached their closing time.</li>
              <li>Crypto markets compare the settlement price against the market's target and direction.</li>
              <li>KOL markets compare the tracked trader's latest performance snapshot against the market condition.</li>
              <li>Once the result is known, the market is locked, archived, and prepared for payout distribution.</li>
            </ul>

            <h3 className="mt-4 font-display text-lg font-bold uppercase tracking-wider">Stored records</h3>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-foreground/80">
              <li><strong>Markets:</strong> question, asset or trader, condition, closing time, current pool, and final outcome.</li>
              <li><strong>Bets:</strong> wallet, selected side, stake amount, transaction reference, and payout status.</li>
              <li><strong>KOL snapshots:</strong> tracked wallet performance, trading activity, and refresh time.</li>
            </ul>
          </Technical>
        </section>

        {/* 4. MARKET MECHANICS */}
        <section className="mt-16" id="market-mechanics">
          <h2 className="font-display text-3xl font-black uppercase tracking-tight">4. Market Mechanics</h2>

          <Simple>
            There are two types of markets. Crypto markets ask whether a coin price will be above or below a target. KOL markets ask whether a tracked trader will hit a performance goal. Both work the same way: pick YES or NO, stake SOL, and wait for the result.
          </Simple>

          <Technical>
            <h3 className="mt-4 font-display text-lg font-bold uppercase tracking-wider">Crypto markets</h3>
            <p className="mt-2 text-sm text-foreground/80">
              Crypto markets ask whether an asset will be above or below a target price at a specific time. Supported assets include major crypto pairs such as BTC, ETH, SOL, BNB, XRP, DOGE, TRX, ZCASH, SHIB, and LTC. Market durations can range from a few minutes to a full day, depending on the market type.
            </p>

            <h3 className="mt-4 font-display text-lg font-bold uppercase tracking-wider">KOL markets</h3>
            <p className="mt-2 text-sm text-foreground/80">
              KOL markets are based on tracked trader wallets. The market condition can target profitability, trading activity, leaderboard position, or direct performance comparison between two traders.
            </p>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-foreground/80">
              <li><strong>Profit in SOL:</strong> whether a trader reaches a positive or negative SOL profit target.</li>
              <li><strong>Profit percentage:</strong> whether a trader's percentage performance is positive or negative.</li>
              <li><strong>Trading activity:</strong> whether a trader makes enough qualifying trades during the period.</li>
              <li><strong>Leaderboard rank:</strong> whether a trader finishes in a target leaderboard position.</li>
              <li><strong>Head-to-head:</strong> whether one tracked trader outperforms another at settlement.</li>
            </ul>
            <p className="mt-2 text-sm text-foreground/80">
              KOL markets auto-close at the next hourly refresh after creation.
            </p>

            <h3 className="mt-4 font-display text-lg font-bold uppercase tracking-wider">Payout formula</h3>
            <pre className="mt-2 overflow-x-auto rounded-md bg-muted p-3 font-mono text-xs text-foreground/80">
share = (my_stake / winning_pool) * losing_pool
winnings = my_stake + share
            </pre>
            <p className="mt-2 text-sm text-foreground/80">
              If the winning pool is zero (no one bet on the winning side), all stakes remain in the pool. In practice, this is unlikely unless the market is one-sided.
            </p>
          </Technical>
        </section>

        {/* 5. PAYMENTS & WALLETS */}
        <section className="mt-16" id="payments">
          <h2 className="font-display text-3xl font-black uppercase tracking-tight">5. Payments & Wallets</h2>

          <Simple>
            You only need a Solana wallet. When you bet, SOL is sent directly from your wallet to the market pool. If you win, the payout is sent back to your wallet automatically after the market closes. There is no deposit step, no withdrawal step, and no platform account to manage.
          </Simple>

          <Technical>
            <h3 className="mt-4 font-display text-lg font-bold uppercase tracking-wider">Bet transaction</h3>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-foreground/80">
              <li>Each bet is approved by the user through their connected Solana wallet.</li>
              <li>The stake is transferred from the user's wallet to the platform pool.</li>
              <li>Fee payer: user (standard Solana network fee, ~0.000005 SOL).</li>
              <li>Minimum bet: 0.001 SOL enforced client-side.</li>
              <li>Each confirmed transaction is linked to a unique transaction reference to prevent duplicate bet records.</li>
            </ul>

            <h3 className="mt-4 font-display text-lg font-bold uppercase tracking-wider">Payout distribution</h3>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-foreground/80">
              <li>Payouts are executed by the settlement system after the market result is finalized.</li>
              <li>Each winner receives an individual on-chain transfer from the platform pool to their wallet.</li>
              <li>The payout amount and transaction reference are stored for transparency and later verification.</li>
              <li>If a payout cannot be completed immediately, the issue is logged and the payout can be retried.</li>
            </ul>
          </Technical>
        </section>

        {/* 6. RISK & TRANSPARENCY */}
        <section className="mt-16" id="risk">
          <h2 className="font-display text-3xl font-black uppercase tracking-tight">6. Risk & Transparency</h2>

          <Simple>
            Betting always carries risk. You can lose your entire stake. Crypto prices are volatile and unpredictable. The platform does not guarantee any return. All outcomes are verified against public data, and all transactions are recorded on the Solana blockchain where anyone can verify them.
          </Simple>

          <Technical>
            <ul className="mt-3 list-disc space-y-2 pl-5 text-sm text-foreground/80">
              <li><strong>No platform fees:</strong> 100% of the losing pool is redistributed to winners. The platform does not take a cut.</li>
              <li><strong>Data risk:</strong> Crypto prices rely on CoinGecko/Binance APIs. KOL data relies on on-chain snapshots. Both are external dependencies.</li>
              <li><strong>Settlement risk:</strong> Market resolution and payouts are handled by an automated platform process. This creates a centralization point until settlement is fully decentralized.</li>
              <li><strong>Network risk:</strong> Solana congestion or provider outages can delay transaction confirmation.</li>
              <li><strong>Pool solvency risk:</strong> If the pool wallet lacks sufficient SOL to cover all payouts, some winners may not be paid until the pool is replenished.</li>
              <li><strong>Temporary data availability risk:</strong> If the backend is unavailable, bet history may become temporarily inaccessible, though on-chain transactions remain verifiable.</li>
            </ul>
          </Technical>
        </section>

        {/* 7. API / TECHNICAL NOTES */}
        <section className="mt-16" id="api">
          <h2 className="font-display text-3xl font-black uppercase tracking-tight">7. API & Technical Notes</h2>

          <Simple>
            The platform is built with a React frontend, a managed backend, and Solana for payments. There is no public REST API for third-party integrations at this time.
          </Simple>

          <Technical>
            <h3 className="mt-4 font-display text-lg font-bold uppercase tracking-wider">Frontend stack</h3>
            <p className="mt-2 text-sm text-foreground/80">The frontend is a React application with wallet integration, live market views, and real-time updates for markets, bets, and payout status.</p>

            <h3 className="mt-4 font-display text-lg font-bold uppercase tracking-wider">Backend services</h3>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-foreground/80">
              <li><strong>Price service:</strong> fetches and caches crypto market data for settlement and display.</li>
              <li><strong>KOL tracking service:</strong> refreshes tracked wallet performance on a regular schedule.</li>
              <li><strong>Settlement service:</strong> finalizes market outcomes and prepares payout distribution.</li>
              <li><strong>Archive service:</strong> stores final market state so users can review past outcomes.</li>
            </ul>

            <h3 className="mt-4 font-display text-lg font-bold uppercase tracking-wider">Key platform areas</h3>
            <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-foreground/80">
              <li><strong>Wallet and payments:</strong> handles user-approved stake transfers and payout tracking.</li>
              <li><strong>Market engine:</strong> defines market rules, expiration timing, and outcome evaluation.</li>
              <li><strong>Settlement engine:</strong> resolves closed markets and distributes winnings.</li>
              <li><strong>Live data layer:</strong> keeps the interface updated with current markets, pools, and user bets.</li>
            </ul>

            <h3 className="mt-4 font-display text-lg font-bold uppercase tracking-wider">Event flow</h3>
            <pre className="mt-2 whitespace-pre-wrap rounded-md bg-muted p-3 font-mono text-xs text-foreground/80">
User bets → Transaction confirmed → Bet recorded
     ↓
Market expires → Outcome evaluated
     ↓
Winners identified → SOL distributed
     ↓
Payout recorded → Market archived
            </pre>
          </Technical>
        </section>

        <section className="mt-16 border-t-2 border-foreground pt-8">
          <p className="text-sm text-foreground/60">
            Last updated: May 2026. This documentation reflects the current implementation of the ARENA platform.
          </p>
        </section>
      </main>
    </div>
  );
}
