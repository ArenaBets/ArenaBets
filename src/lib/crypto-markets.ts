import { supabase } from "@/integrations/supabase/client";
import { Keypair, PublicKey, SystemProgram, Transaction, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { connection, getMarketSolBets, calculateMarketSolTotals, calculateSolWinnings } from "./solana-pool";

export type CryptoAssetConfig = {
  symbol: string;
  coingeckoId: string;
  binanceSymbol: string | null;
  mexcSymbol: string | null;
  /** Minimum increment for price targets (USD). */
  priceStep: number;
};

export const CRYPTO_ASSETS = [
  { symbol: "BTC", coingeckoId: "bitcoin", binanceSymbol: "BTCUSDT", mexcSymbol: null, priceStep: 1 },
  { symbol: "ETH", coingeckoId: "ethereum", binanceSymbol: "ETHUSDT", mexcSymbol: null, priceStep: 1 },
  { symbol: "SOL", coingeckoId: "solana", binanceSymbol: "SOLUSDT", mexcSymbol: null, priceStep: 0.01 },
  { symbol: "BNB", coingeckoId: "binancecoin", binanceSymbol: "BNBUSDT", mexcSymbol: null, priceStep: 0.01 },
  { symbol: "XRP", coingeckoId: "ripple", binanceSymbol: "XRPUSDT", mexcSymbol: null, priceStep: 0.01 },
  { symbol: "DOGE", coingeckoId: "dogecoin", binanceSymbol: "DOGEUSDT", mexcSymbol: null, priceStep: 0.01 },
  { symbol: "TRX", coingeckoId: "tron", binanceSymbol: "TRXUSDT", mexcSymbol: null, priceStep: 0.01 },
  { symbol: "ZCASH", coingeckoId: "zcash", binanceSymbol: "ZECUSDT", mexcSymbol: null, priceStep: 0.01 },
  { symbol: "SHIB", coingeckoId: "shiba-inu", binanceSymbol: "SHIBUSDT", mexcSymbol: null, priceStep: 0.0000001 },
  { symbol: "LTC", coingeckoId: "litecoin", binanceSymbol: "LTCUSDT", mexcSymbol: null, priceStep: 0.01 },
] as const satisfies readonly CryptoAssetConfig[];

export const MARKET_CONDITIONS = ["above", "below"] as const;
export const MARKET_DURATIONS = [5, 15, 60, 360, 1440] as const;

export type CryptoAsset = (typeof CRYPTO_ASSETS)[number]["symbol"];
export type MarketCondition = (typeof MARKET_CONDITIONS)[number];
export type MarketDuration = (typeof MARKET_DURATIONS)[number];

export type CryptoMarket = {
  id: string;
  asset: CryptoAsset | null;
  condition: MarketCondition | null;
  price_target: number | null;
  closes_at: string | null;
  resolved: boolean;
};

const assetToCoingeckoId = new Map(
  CRYPTO_ASSETS.map((asset) => [asset.symbol, asset.coingeckoId]),
);
const assetToBinanceSymbol = new Map(
  CRYPTO_ASSETS.filter((asset) => asset.binanceSymbol).map((asset) => [
    asset.symbol,
    asset.binanceSymbol!,
  ]),
);
const assetBySymbol = new Map(CRYPTO_ASSETS.map((asset) => [asset.symbol, asset]));

export function getCryptoAsset(symbol: CryptoAsset) {
  const asset = assetBySymbol.get(symbol);
  if (!asset) throw new Error(`Unknown asset: ${symbol}`);
  return asset;
}

export function priceDecimalsForStep(step: number) {
  if (step >= 1) return 0;
  return Math.ceil(-Math.log10(step));
}

export function snapToPriceStep(price: number, step: number) {
  const decimals = priceDecimalsForStep(step);
  const snapped = Math.round(price / step) * step;
  return Number(snapped.toFixed(decimals));
}

export function isValidPriceStep(price: number, step: number) {
  if (!Number.isFinite(price) || price <= 0) return false;
  const snapped = snapToPriceStep(price, step);
  return Math.abs(price - snapped) <= step / 10;
}

export function formatCryptoPrice(symbol: CryptoAsset, price: number) {
  const { priceStep } = getCryptoAsset(symbol);
  const decimals = priceDecimalsForStep(priceStep);
  return price.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

export function buildCryptoMarketQuestion({
  asset,
  condition,
  priceTarget,
  durationHours,
}: {
  asset: CryptoAsset;
  condition: MarketCondition;
  priceTarget: number;
  durationHours: MarketDuration;
}) {
  const durationLabel = durationHours < 60 
    ? `${durationHours}min` 
    : `${Math.round(durationHours / 60)}h`;
  return `Will ${asset} be ${condition} $${formatCryptoPrice(asset, priceTarget)} in ${durationLabel}?`;
}

export async function fetchCryptoPrices(assets: CryptoAsset[]) {
  const uniqueAssets = Array.from(new Set(assets));

  // 1. Essayer le proxy Edge Function
  try {
    const { data, error } = await supabase.functions.invoke("crypto-proxy", {
      body: { action: "prices" },
    });
    if (error) throw error;

    const response = data as { prices?: Array<{ symbol: string; price: number }> };
    if (response.prices) {
      const bySymbol = new Map(response.prices.map((p) => [p.symbol, p.price]));
      const prices = new Map(
        uniqueAssets
          .map((asset) => [asset, bySymbol.get(asset) ?? 0] as const)
          .filter(([, price]) => price > 0),
      );
      if (prices.size === uniqueAssets.length) return prices;
    }
  } catch {
    // Fallback direct
  }

  // 2. Fallback direct: CoinGecko
  const ids = uniqueAssets
    .map((asset) => assetToCoingeckoId.get(asset))
    .filter(Boolean)
    .join(",");

  if (!ids) return new Map<CryptoAsset, number>();

  try {
    const response = await fetch(
      `https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd`,
    );

    if (!response.ok) throw new Error("CoinGecko request failed");

    const data = (await response.json()) as Record<string, { usd?: number }>;
    const prices = new Map(
      uniqueAssets
        .map(
          (asset) =>
            [asset, data[assetToCoingeckoId.get(asset) ?? ""]?.usd ?? 0] as const,
        )
        .filter(([, price]) => price > 0),
    );

    if (prices.size === uniqueAssets.length) return prices;
  } catch {
    // Binance fallback below
  }

  const binanceSymbols = uniqueAssets
    .map((asset) => assetToBinanceSymbol.get(asset))
    .filter(Boolean);

  if (binanceSymbols.length === 0) return new Map<CryptoAsset, number>();

  const symbols = encodeURIComponent(JSON.stringify(binanceSymbols));
  const response = await fetch(`https://api.binance.com/api/v3/ticker/price?symbols=${symbols}`);
  if (!response.ok) throw new Error("Failed to fetch crypto prices");

  const data = (await response.json()) as Array<{ symbol: string; price?: string }>;
  const bySymbol = new Map(data.map((row) => [row.symbol, row]));

  return new Map(
    uniqueAssets
      .map((asset) => {
        const binanceSymbol = assetToBinanceSymbol.get(asset);
        if (!binanceSymbol) return null;
        return [asset, Number(bySymbol.get(binanceSymbol)?.price) || 0] as const;
      })
      .filter((entry): entry is [CryptoAsset, number] => entry !== null && entry[1] > 0),
  );
}

export async function evaluateDueMarkets(markets: CryptoMarket[]) {
  const now = Date.now();
  const dueMarkets = markets.filter(
    (market) =>
      !market.resolved &&
      market.asset &&
      assetBySymbol.has(market.asset) &&
      market.condition &&
      market.price_target &&
      market.closes_at &&
      new Date(market.closes_at).getTime() <= now,
  );

  if (dueMarkets.length === 0) return 0;

  const prices = await fetchCryptoPrices(
    Array.from(new Set(dueMarkets.map((market) => market.asset as CryptoAsset))),
  );

  const results = await Promise.all(
    dueMarkets.map((market) => {
      const price = prices.get(market.asset as CryptoAsset);
      if (!price) return Promise.resolve({ data: null, error: null });

      return supabase.rpc("settle_crypto_market", {
        p_market_id: market.id,
        p_settlement_price: price,
      });
    }),
  );

  return results.filter((result) => result.data && !result.error).length;
}
