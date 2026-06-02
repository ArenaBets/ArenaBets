import { useEffect, useMemo, useState } from "react";
import { useNavigate, Link } from "@tanstack/react-router";
import { useWallet } from "@solana/wallet-adapter-react";
import { computeTotals, type Market } from "@/components/bet-modal";
import { MarketCountdown } from "@/components/market-countdown";
import { MarketLiquidityBar } from "@/components/market-liquidity-bar";
import type { ArenaBetRow, ArenaMarketRow } from "@/hooks/use-arena-live";
import { CRYPTO_ASSETS, type CryptoAsset } from "@/lib/crypto-markets";
import { useCryptoPrices, formatCryptoPrice } from "@/hooks/use-crypto-prices";
import { CryptoPriceChart } from "@/components/crypto-price-chart";

type MarketsBoardProps = {
  markets: ArenaMarketRow[];
  bets: ArenaBetRow[];
  onBet: (market: Market, side: "YES" | "NO") => void;
  onCreate: () => void;
  mode?: "open" | "closed";
  title?: string;
  subtitle?: string;
  hideHeader?: boolean;
};

export function MarketsBoard({
  markets,
  bets,
  onBet,
  onCreate,
  mode = "open",
  title,
  subtitle,
  hideHeader = false,
}: MarketsBoardProps) {
  const [filter, setFilter] = useState<MarketFilter>("ALL");
  const [showMyBets, setShowMyBets] = useState(false);
  const { prices } = useCryptoPrices();
  const { publicKey } = useWallet();
  const isClosedMode = mode === "closed";

  const betsByMarket = useMemo(() => {
    const map = new Map<string, ArenaBetRow[]>();
    for (const bet of bets) {
      const marketBets = map.get(bet.market_id) ?? [];
      marketBets.push(bet);
      map.set(bet.market_id, marketBets);
    }
    return map;
  }, [bets]);

  const myBetMarketIds = useMemo(() => {
    if (!publicKey) return new Set<string>();
    const wallet = publicKey.toBase58();
    const ids = new Set<string>();
    for (const bet of bets) {
      if (bet.wallet === wallet) {
        ids.add(bet.market_id);
      }
    }
    return ids;
  }, [bets, publicKey]);

  const visibleMarkets = useMemo(() => {
    // Filtrer par mes paris si actif
    const baseMarkets = showMyBets
      ? markets.filter((m) => myBetMarketIds.has(m.id))
      : markets;
    // Filtrer par asset si nécessaire
    const filtered = filter === "ALL"
      ? baseMarkets
      : baseMarkets.filter((market) => market.asset === filter || market.tag === filter);

    if (filter === "ALL") {
      return [...filtered].sort((a, b) => {
        if (isClosedMode) {
          // Mode closed: trier par date de fermeture décroissante (plus récent en premier)
          const aTime = a.closes_at ? new Date(a.closes_at).getTime() : 0;
          const bTime = b.closes_at ? new Date(b.closes_at).getTime() : 0;
          return bTime - aTime;
        }
        // Mode open: ouverts en premier, puis par date de fermeture croissante
        const aOpen = !a.resolved;
        const bOpen = !b.resolved;
        if (aOpen && !bOpen) return -1;
        if (!aOpen && bOpen) return 1;
        const aTime = a.closes_at ? new Date(a.closes_at).getTime() : 0;
        const bTime = b.closes_at ? new Date(b.closes_at).getTime() : 0;
        return aTime - bTime;
      });
    }

    return filtered;
  }, [filter, markets, isClosedMode, showMyBets, myBetMarketIds]);

  // Grouper les marchés par asset
  const marketsByAsset = useMemo(() => {
    const grouped = new Map<CryptoAsset | "OTHER", ArenaMarketRow[]>();
    for (const market of visibleMarkets) {
      const key = market.asset ?? "OTHER";
      const list = grouped.get(key) ?? [];
      list.push(market);
      grouped.set(key, list);
    }
    // Trier par ordre des CRYPTO_ASSETS
    const sorted = new Map<CryptoAsset | "OTHER", ArenaMarketRow[]>();
    for (const asset of CRYPTO_ASSETS) {
      if (grouped.has(asset.symbol)) {
        sorted.set(asset.symbol, grouped.get(asset.symbol)!);
      }
    }
    if (grouped.has("OTHER")) {
      sorted.set("OTHER", grouped.get("OTHER")!);
    }
    return sorted;
  }, [visibleMarkets]);

  return (
    <section className={hideHeader ? "" : "mx-auto max-w-7xl px-4 sm:px-6"}>
      {!hideHeader && (
        <div className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
          <div>
            <div className="font-mono text-xs uppercase tracking-widest text-foreground/50">
              {subtitle ?? (showMyBets ? "Markets you bet on" : isClosedMode ? "Resolved markets" : "Live markets")}
            </div>
            <h1 className="mt-2 font-display text-4xl font-black uppercase tracking-tight md:text-5xl">
              {title ?? (showMyBets ? "My Bets" : isClosedMode ? "Closed Markets" : "Crypto Markets")}
            </h1>
          </div>
          <div className="flex items-center gap-3">
            {publicKey && (
              <button
                type="button"
                onClick={() => setShowMyBets((v) => !v)}
                className={`ink-border-sm cursor-pointer px-4 py-3 font-mono text-xs font-bold uppercase tracking-wider transition-colors ${
                  showMyBets
                    ? "bg-foreground text-background"
                    : "bg-parchment hover:bg-parchment/90"
                }`}
              >
                My Bets
              </button>
            )}
            {isClosedMode && (
              <Link
                to="/cryptomarkets"
                className="ink-border-sm bg-parchment px-4 py-3 font-mono text-xs font-bold uppercase tracking-wider transition-colors hover:bg-parchment/90"
              >
                Open Markets
              </Link>
            )}
            {!isClosedMode && (
              <Link
                to="/closed-markets"
                className="ink-border-sm bg-parchment px-4 py-3 font-mono text-xs font-bold uppercase tracking-wider transition-colors hover:bg-parchment/90"
              >
                Closed Markets
              </Link>
            )}
            {!isClosedMode && (
              <button
                type="button"
                onClick={onCreate}
                className="ink-border-sm bg-foreground px-5 py-3 font-display text-sm font-bold uppercase tracking-widest text-background transition-opacity hover:opacity-90"
              >
                + Create market
              </button>
            )}
          </div>
        </div>
      )}

      <MarketFilterBar active={filter} onChange={setFilter} />

      <div className="mt-8 space-y-10 pb-16">
        {filter === "ALL" ? (
          visibleMarkets.length === 0 ? (
            <div className="rounded-lg border border-dashed border-foreground/20 bg-parchment/30 p-6 text-center">
              <span className="font-mono text-sm text-foreground/50">
                {showMyBets ? "You haven't placed any bets yet." : isClosedMode ? "No closed markets yet." : "No active markets — create the first one!"}
              </span>
            </div>
          ) : (
            // Mode ALL : grille plate de tous les marchés triés (ouverts en premier)
            <div className="grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-3">
              {visibleMarkets.map((market) => (
                <MarketCard
                  key={market.id}
                  market={market}
                  bets={betsByMarket.get(market.id) ?? []}
                  onBet={onBet}
                />
              ))}
            </div>
          )
        ) : (
          // Mode filtré : afficher le filtre sélectionné avec son prix (même sans marchés)
          (() => {
            const asset = filter as CryptoAsset;
            const assetMarkets = marketsByAsset.get(asset) ?? [];
            return (
              <AssetSection
                key={asset}
                asset={asset}
                markets={assetMarkets}
                betsByMarket={betsByMarket}
                priceData={prices.get(asset) ?? null}
                onBet={onBet}
                isClosedMode={isClosedMode}
                showMyBets={showMyBets}
              />
            );
          })()
        )}
      </div>
    </section>
  );
}

function MarketCard({
  market,
  bets,
  onBet,
}: {
  market: ArenaMarketRow;
  bets: ArenaBetRow[];
  onBet: (m: Market, side: "YES" | "NO") => void;
}) {
  const navigate = useNavigate();
  const { publicKey } = useWallet();
  const [locallyClosed, setLocallyClosed] = useState(() => isMarketClosed(market));
  const isClosed = market.resolved || locallyClosed;
  const status = isClosed ? "CLOSED" : "OPEN";
  const asset = market.asset ?? market.tag ?? "MARKET";
  const totals = useMemo(() => computeTotals(bets), [bets]);

  // Trouver le pari de l'utilisateur sur ce marché
  const myBet = useMemo(() => {
    if (!publicKey) return null;
    const wallet = publicKey.toBase58();
    return bets.find(b => b.wallet === wallet) ?? null;
  }, [bets, publicKey]);

  // Calculer le gain/perte si le marché est résolu
  const myResult = useMemo(() => {
    if (!myBet || !market.resolved || !market.outcome) return null;
    
    const won = myBet.side === market.outcome;
    const stake = myBet.amount_sol ?? 0;
    
    if (!won) {
      return { won: false, amount: -stake };
    }
    
    // Calculer les gains: stake + part du pool perdant
    const totalLosing = bets
      .filter(b => b.side !== market.outcome)
      .reduce((sum, b) => sum + (b.amount_sol ?? 0), 0);
    const totalWinning = bets
      .filter(b => b.side === market.outcome)
      .reduce((sum, b) => sum + (b.amount_sol ?? 0), 0);
    
    if (totalWinning === 0) return { won: true, amount: stake };
    
    const share = stake / totalWinning;
    const winnings = stake + (totalLosing * share);
    
    return { won: true, amount: winnings };
  }, [myBet, market.resolved, market.outcome, bets]);

  useEffect(() => {
    setLocallyClosed(isMarketClosed(market));
  }, [market]);

  return (
    <article
      className={`flex min-h-[250px] flex-col rounded-lg border border-foreground/10 bg-background p-5 shadow-sm transition ${
        isClosed ? "opacity-55 grayscale" : "hover:-translate-y-0.5 hover:shadow-md"
      }`}
    >
      <div className="flex items-center justify-between gap-3">
        <span className="rounded-md bg-foreground px-3 py-1 font-mono text-xs font-bold uppercase tracking-wider text-background">
          {asset}
        </span>
        <span
          className={`rounded-md px-3 py-1 font-mono text-xs font-bold uppercase tracking-wider ${
            isClosed
              ? market.outcome
                ? market.outcome === "YES"
                  ? "bg-green-100 text-green-700"
                  : "bg-red-100 text-red-700"
                : "bg-red-100 text-red-700"
              : "bg-green-100 text-green-700"
          }`}
        >
          {isClosed
            ? market.outcome
              ? `MARKET RESOLVED : ${market.outcome}`
              : "CLOSED"
            : "OPEN"}
        </span>
      </div>

      <div className="mt-5 flex-1">
        <h3
          className="font-display text-2xl font-black uppercase leading-tight text-foreground hover:text-foreground/80 transition cursor-pointer"
          onClick={() => navigate({ to: `/market/${market.id}` })}
        >
          {market.question}
        </h3>
      </div>

      <MarketCountdown
        closes_at={market.closes_at}
        className="mt-5"
        onClosed={() => setLocallyClosed(true)}
      />

      {market.resolved && market.settlement_price && (
        <div className="mt-3 font-mono text-xs font-bold uppercase tracking-wider text-foreground/40">
          {market.asset} Final Price: ${market.settlement_price.toLocaleString()}
        </div>
      )}

      {/* Barre de liquidité uniquement pour les marchés ouverts (stats disponibles) */}
      {!isClosed && (
        <MarketLiquidityBar yes_points={totals.yes} no_points={totals.no} className="mt-5" />
      )}

      {/* Afficher le pari de l'utilisateur */}
      {myBet && (
        <div className={`mt-4 rounded-md p-3 ${
          myResult
            ? myResult.won
              ? "bg-green-100 border border-green-200"
              : "bg-red-100 border border-red-200"
            : "bg-muted border border-foreground/10"
        }`}>
          {myResult ? (
            <>
              <div className="font-mono text-sm uppercase tracking-wider text-foreground/70">
                {myResult.won ? "✓ WON" : "✗ LOST"}
              </div>
              <div className="mt-0.5 font-mono text-sm text-foreground/60">
                You picked <span className={myBet.side === "YES" ? "text-green-600 font-bold" : "text-red-600 font-bold"}>{myBet.side}</span>
              </div>
              <div className="mt-3 space-y-1">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-sm uppercase tracking-wider text-foreground/50">Stake</span>
                  <span className="font-mono text-sm font-medium">{(myBet.amount_sol ?? 0).toFixed(4)} SOL</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="font-mono text-sm uppercase tracking-wider text-foreground/50">PnL</span>
                  <span className={`font-mono text-sm font-bold ${myResult.won ? "text-green-700" : "text-red-700"}`}>
                    {myResult.won ? "+" : ""}{myResult.amount.toFixed(4)} SOL
                  </span>
                </div>
              </div>
            </>
          ) : (
            <>
              <div className="flex items-center justify-between">
                <span className="font-mono text-xs uppercase tracking-wider text-foreground/70">Your bet</span>
                <span className={`font-mono text-xs font-bold uppercase ${myBet.side === "YES" ? "text-green-600" : "text-red-600"}`}>
                  {myBet.side}
                </span>
              </div>
              <div className="mt-1 font-mono text-sm font-medium">
                {(myBet.amount_sol ?? 0).toFixed(4)} SOL
              </div>
            </>
          )}
        </div>
      )}

      <div className="mt-5 grid grid-cols-2 gap-3">
        <MarketActionButton side="YES" disabled={isClosed} onClick={() => onBet(market, "YES")} />
        <MarketActionButton side="NO" disabled={isClosed} onClick={() => onBet(market, "NO")} />
      </div>
      
      <div className="mt-3 flex items-center justify-between">
        <span className="text-[10px] font-mono text-foreground/40">
          {isClosed
            ? `Closed ${new Date(market.closes_at ?? market.created_at).toLocaleString("en-US", {
                month: "short",
                day: "numeric",
                hour: "2-digit",
                minute: "2-digit",
              })}`
            : `Opened ${new Date(market.created_at).toLocaleString("en-US", {
                month: "short",
                day: "numeric",
                hour: "2-digit",
                minute: "2-digit",
              })}`}
        </span>
        <span
          onClick={() => navigate({ to: `/market/${market.id}` })}
          className="text-center text-xs font-mono text-muted-foreground hover:text-foreground transition underline cursor-pointer"
        >
          View Details →
        </span>
      </div>
    </article>
  );
}

type MarketFilter = "ALL" | CryptoAsset;

const MARKET_FILTERS: MarketFilter[] = [
  "ALL",
  ...CRYPTO_ASSETS.map((item) => item.symbol),
];

function MarketFilterBar({
  active,
  onChange,
}: {
  active: MarketFilter;
  onChange: (filter: MarketFilter) => void;
}) {
  return (
    <div className="mt-8 flex w-full gap-2 overflow-x-auto rounded-lg border border-foreground/10 bg-background p-1">
      {MARKET_FILTERS.map((filter) => (
        <button
          key={filter}
          type="button"
          onClick={() => onChange(filter)}
          className={`min-w-16 flex-1 rounded-md px-4 py-2.5 font-mono text-xs font-bold uppercase tracking-wider transition ${
            active === filter
              ? "bg-foreground text-background"
              : "text-foreground/60 hover:bg-muted/50 hover:text-foreground"
          }`}
        >
          {filter}
        </button>
      ))}
    </div>
  );
}

function MarketActionButton({
  side,
  disabled,
  onClick,
}: {
  side: "YES" | "NO";
  disabled: boolean;
  onClick: () => void;
}) {
  const isYes = side === "YES";

  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={`rounded-md py-3.5 font-display text-base font-black uppercase tracking-wider text-white transition ${
        isYes ? "bg-green-600 hover:bg-green-700" : "bg-red-600 hover:bg-red-700"
      } disabled:cursor-not-allowed disabled:bg-foreground/20 disabled:text-foreground/40`}
    >
      {side}
    </button>
  );
}

function isMarketClosed(market: ArenaMarketRow) {
  if (market.resolved) return true;
  if (!market.closes_at) return false;
  return new Date(market.closes_at).getTime() <= Date.now();
}

type PriceRow = { symbol: CryptoAsset; price: number; change24h: number };

function AssetSection({
  asset,
  markets,
  betsByMarket,
  priceData,
  onBet,
  isClosedMode = false,
  showMyBets = false,
}: {
  asset: CryptoAsset | "OTHER";
  markets: ArenaMarketRow[];
  betsByMarket: Map<string, ArenaBetRow[]>;
  priceData: PriceRow | null;
  onBet: (market: Market, side: "YES" | "NO") => void;
  isClosedMode?: boolean;
  showMyBets?: boolean;
}) {
  const assetConfig = CRYPTO_ASSETS.find((a) => a.symbol === asset);
  const displayName = assetConfig?.symbol ?? asset;

  const up = (priceData?.change24h ?? 0) >= 0;
  const changeColor = up ? "text-green-600" : "text-red-600";
  const arrow = up ? "▲" : "▼";

  return (
    <div className="space-y-4">
      {/* Header avec prix */}
      <div className="flex items-center justify-between gap-4 rounded-lg border border-foreground/10 bg-background p-4">
        <div className="flex items-center gap-3">
          <span className="rounded-md bg-foreground px-3 py-1 font-display text-lg font-black uppercase tracking-wider text-background">
            {displayName}
          </span>
          {priceData && priceData.price > 0 ? (
            <div className="flex items-center gap-3 font-mono">
              <span className="text-xl font-bold">{formatCryptoPrice(priceData.price)}</span>
              <span className={`flex items-center gap-1 text-sm font-bold ${changeColor}`}>
                {arrow} {Math.abs(priceData.change24h).toFixed(2)}%
              </span>
              <span className="text-xs text-foreground/50">24h</span>
            </div>
          ) : (
            <span className="font-mono text-sm text-foreground/50">Chargement prix...</span>
          )}
        </div>
        <span className="font-mono text-xs uppercase tracking-wider text-foreground/50">
          {markets.length} market{markets.length > 1 ? "s" : ""}
        </span>
      </div>

      {/* Chart de prix (uniquement pour les cryptos connues avec data) */}
      {priceData && priceData.price > 0 && asset !== "OTHER" && (
        <CryptoPriceChart
          asset={asset as CryptoAsset}
          currentPrice={priceData.price}
          change24h={priceData.change24h}
        />
      )}

      {/* Grille des marchés */}
      {markets.length > 0 ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {markets.map((market) => (
            <MarketCard
              key={market.id}
              market={market}
              bets={betsByMarket.get(market.id) ?? []}
              onBet={onBet}
            />
          ))}
        </div>
      ) : (
        <div className="rounded-lg border border-dashed border-foreground/20 bg-parchment/30 p-6 text-center">
          <span className="font-mono text-sm text-foreground/50">
            {showMyBets ? "You haven't placed any bets yet." : isClosedMode ? "No closed markets yet." : "No active markets — create the first one!"}
          </span>
        </div>
      )}
    </div>
  );
}
