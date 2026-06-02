import { supabase } from "@/integrations/supabase/client";
import { CRYPTO_ASSETS, type CryptoAsset } from "@/lib/crypto-markets";

export type PriceRow = { symbol: CryptoAsset; price: number; change24h: number };

export const PRICE_REFRESH_MS = 60_000;

const CACHE_TTL_MS = 55_000;

let cachedPrices: PriceRow[] | null = null;
let cachedAt = 0;
let inFlight: Promise<PriceRow[]> | null = null;

export function getEmptyPriceRows(): PriceRow[] {
  return CRYPTO_ASSETS.map((asset) => ({ symbol: asset.symbol, price: 0, change24h: 0 }));
}

export async function fetchCryptoPrices(): Promise<PriceRow[]> {
  const now = Date.now();
  if (cachedPrices && now - cachedAt < CACHE_TTL_MS) {
    return cachedPrices;
  }

  if (inFlight) {
    return inFlight;
  }

  inFlight = loadCryptoPrices().then((prices) => {
    cachedPrices = prices;
    cachedAt = Date.now();
    return prices;
  }).finally(() => {
    inFlight = null;
  });

  return inFlight;
}

async function loadCryptoPrices(): Promise<PriceRow[]> {
  const merged = new Map<CryptoAsset, PriceRow>();

  try {
    const { data, error } = await supabase.functions.invoke("crypto-proxy", {
      body: { action: "prices" },
    });
    if (error) throw error;

    const response = data as { prices?: PriceRow[] };
    if (response.prices) {
      for (const row of response.prices) {
        merged.set(row.symbol as CryptoAsset, row);
      }
    }
  } catch {
    const ids = CRYPTO_ASSETS.map((asset) => asset.coingeckoId).join(",");
    try {
      const res = await fetch(
        `https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd&include_24hr_change=true`,
      );
      if (res.ok) {
        const data = (await res.json()) as Record<string, { usd?: number; usd_24h_change?: number }>;
        for (const asset of CRYPTO_ASSETS) {
          const quote = data[asset.coingeckoId];
          const price = quote?.usd ?? 0;
          if (price > 0) {
            merged.set(asset.symbol, {
              symbol: asset.symbol,
              price,
              change24h: quote?.usd_24h_change ?? 0,
            });
          }
        }
      }
    } catch {
      // keep fallback chain moving
    }

    const missing = CRYPTO_ASSETS.map((asset) => asset.symbol).filter((symbol) => !merged.has(symbol));
    if (missing.length > 0) {
      try {
        const binancePairs = missing
          .map((symbol) => CRYPTO_ASSETS.find((asset) => asset.symbol === symbol))
          .filter((asset): asset is (typeof CRYPTO_ASSETS)[number] => Boolean(asset?.binanceSymbol));
        if (binancePairs.length > 0) {
          const query = encodeURIComponent(JSON.stringify(binancePairs.map((asset) => asset.binanceSymbol)));
          const res = await fetch(`https://api.binance.com/api/v3/ticker/24hr?symbols=${query}`);
          if (res.ok) {
            const data = (await res.json()) as Array<{
              symbol: string;
              lastPrice?: string;
              priceChangePercent?: string;
            }>;
            const byPair = new Map(data.map((row) => [row.symbol, row]));
            for (const asset of binancePairs) {
              const row = byPair.get(asset.binanceSymbol!);
              const price = Number(row?.lastPrice) || 0;
              if (price > 0) {
                merged.set(asset.symbol, {
                  symbol: asset.symbol,
                  price,
                  change24h: Number(row?.priceChangePercent) || 0,
                });
              }
            }
          }
        }
      } catch {
        // keep empty prices for assets that could not be fetched
      }
    }
  }

  return CRYPTO_ASSETS.map(
    (asset) => merged.get(asset.symbol) ?? { symbol: asset.symbol, price: 0, change24h: 0 },
  );
}
