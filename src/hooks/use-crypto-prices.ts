import { useEffect, useState } from "react";
import { CRYPTO_ASSETS, type CryptoAsset } from "@/lib/crypto-markets";
import { supabase } from "@/integrations/supabase/client";
import { PRICE_REFRESH_MS, fetchCryptoPrices, type PriceRow } from "@/lib/crypto-price-service";

export function useCryptoPrices() {
  const [prices, setPrices] = useState<Map<CryptoAsset, PriceRow>>(new Map());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const rows = await fetchCryptoPrices();
        const nextPrices = new Map(rows.map((row) => [row.symbol, row] as const));
        if (!cancelled) {
          setPrices(nextPrices);
          setLoading(false);
        }
      } catch {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    const id = setInterval(load, PRICE_REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  return { prices, loading };
}

export function formatCryptoPrice(price: number): string {
  if (price <= 0) return "—";
  if (price >= 1_000) {
    return `$${price.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
  }
  if (price < 0.0001) {
    return `$${price.toLocaleString("en-US", { maximumFractionDigits: 8 })}`;
  }
  if (price < 1) {
    return `$${price.toLocaleString("en-US", { minimumFractionDigits: 4, maximumFractionDigits: 6 })}`;
  }
  return `$${price.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export type Candle = {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
};

export type TimeInterval = "5m" | "15m" | "1h" | "6h" | "1d";

const INTERVAL_LIMITS: Record<TimeInterval, number> = {
  "5m": 288,   // 24h
  "15m": 192,  // 48h
  "1h": 168,   // 1 week
  "6h": 168,   // 6 weeks
  "1d": 180,   // 6 months
};

// Historique des prix pour les charts
export async function fetchCryptoHistory(asset: CryptoAsset, interval: TimeInterval = "1h"): Promise<Candle[]> {
  try {
    const { data, error } = await supabase.functions.invoke("crypto-proxy", {
      body: { action: "history", asset, interval },
    });
    if (error) throw error;

    const response = data as { candles?: Candle[] };
    if (response.candles) return response.candles;
  } catch {
    // Fallback: direct API calls
    const assetConfig = CRYPTO_ASSETS.find(a => a.symbol === asset);
    if (!assetConfig) return [];

    const limit = INTERVAL_LIMITS[interval];

    if (assetConfig.mexcSymbol) {
      try {
        const res = await fetch(
          `https://api.mexc.com/api/v3/klines?symbol=${assetConfig.mexcSymbol}&interval=${interval}&limit=${limit}`,
        );
        if (res.ok) {
          const data = await res.json() as [number, string, string, string, string, string, ...number[]][];
          return data.map(candle => ({
            time: Math.floor(candle[0] / 1000),
            open: parseFloat(candle[1]),
            high: parseFloat(candle[2]),
            low: parseFloat(candle[3]),
            close: parseFloat(candle[4]),
          }));
        }
      } catch {
        // ignore
      }
    }

    if (assetConfig.binanceSymbol) {
      try {
        const res = await fetch(
          `https://api.binance.com/api/v3/klines?symbol=${assetConfig.binanceSymbol}&interval=${interval}&limit=${limit}`,
        );
        if (res.ok) {
          const data = await res.json() as [number, string, string, string, string, string, ...number[]][];
          return data.map(candle => ({
            time: Math.floor(candle[0] / 1000),
            open: parseFloat(candle[1]),
            high: parseFloat(candle[2]),
            low: parseFloat(candle[3]),
            close: parseFloat(candle[4]),
          }));
        }
      } catch {
        // ignore
      }
    }

    try {
      const days = interval === "5m" ? 2 : interval === "15m" ? 3 : interval === "1h" ? 7 : interval === "6h" ? 42 : 180;
      const res = await fetch(
        `https://api.coingecko.com/api/v3/coins/${assetConfig.coingeckoId}/market_chart?vs_currency=usd&days=${days}`,
      );
      if (res.ok) {
        const data = await res.json() as { prices: [number, number][] };
        const prices = data.prices;
        const candles: Candle[] = [];
        for (let i = 0; i < prices.length; i += 60) {
          const slice = prices.slice(i, Math.min(i + 60, prices.length));
          if (slice.length === 0) continue;
          const values = slice.map(p => p[1]);
          candles.push({
            time: Math.floor(slice[0][0] / 1000),
            open: values[0],
            high: Math.max(...values),
            low: Math.min(...values),
            close: values[values.length - 1],
          });
        }
        return candles.slice(-limit);
      }
    } catch {
      // ignore
    }
  }

  console.log(`No history available for ${asset}`);
  return [];
}
