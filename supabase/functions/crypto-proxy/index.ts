import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Cache en mémoire avec TTL
interface CacheEntry<T> {
  data: T;
  expiresAt: number;
}

const cache = new Map<string, CacheEntry<unknown>>();
const MAX_CACHE_ENTRIES = 20;

const ASSETS = [
  { symbol: "BTC", coingeckoId: "bitcoin", binanceSymbol: "BTCUSDT", mexcSymbol: null },
  { symbol: "ETH", coingeckoId: "ethereum", binanceSymbol: "ETHUSDT", mexcSymbol: null },
  { symbol: "SOL", coingeckoId: "solana", binanceSymbol: "SOLUSDT", mexcSymbol: null },
  { symbol: "BNB", coingeckoId: "binancecoin", binanceSymbol: "BNBUSDT", mexcSymbol: null },
  { symbol: "XRP", coingeckoId: "ripple", binanceSymbol: "XRPUSDT", mexcSymbol: null },
  { symbol: "DOGE", coingeckoId: "dogecoin", binanceSymbol: "DOGEUSDT", mexcSymbol: null },
  { symbol: "TRX", coingeckoId: "tron", binanceSymbol: "TRXUSDT", mexcSymbol: null },
  { symbol: "ZCASH", coingeckoId: "zcash", binanceSymbol: "ZECUSDT", mexcSymbol: null },
  { symbol: "SHIB", coingeckoId: "shiba-inu", binanceSymbol: "SHIBUSDT", mexcSymbol: null },
  { symbol: "LTC", coingeckoId: "litecoin", binanceSymbol: "LTCUSDT", mexcSymbol: null },
] as const;

const INTERVAL_LIMITS: Record<string, number> = {
  "5m": 288,
  "15m": 192,
  "1h": 168,
  "6h": 168,
  "1d": 180,
};

type PriceRow = { symbol: string; price: number; change24h: number };
type Candle = { time: number; open: number; high: number; low: number; close: number };

function getCache<T>(key: string): T | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    cache.delete(key);
    return null;
  }
  return entry.data as T;
}

function evictOldestIfNeeded() {
  while (cache.size >= MAX_CACHE_ENTRIES) {
    const oldestKey = cache.keys().next().value;
    if (oldestKey !== undefined) {
      cache.delete(oldestKey);
    } else {
      break;
    }
  }
}

function setCache<T>(key: string, data: T, ttlSeconds: number) {
  evictOldestIfNeeded();
  cache.set(key, { data, expiresAt: Date.now() + ttlSeconds * 1000 });
}

function cleanExpiredCache() {
  const now = Date.now();
  for (const [key, entry] of cache.entries()) {
    if (now > entry.expiresAt) {
      cache.delete(key);
    }
  }
}

// --- Fetch Prices ---

async function fetchPrices(): Promise<PriceRow[]> {
  const cacheKey = "prices";
  const cached = getCache<PriceRow[]>(cacheKey);
  if (cached) return cached;

  const bySymbol = new Map<string, PriceRow>();

  // 1. CoinGecko d'abord
  try {
    const ids = ASSETS.map((a) => a.coingeckoId).join(",");
    const res = await fetch(
      `https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd&include_24hr_change=true`,
    );
    if (res.ok) {
      const data = (await res.json()) as Record<string, { usd?: number; usd_24h_change?: number }>;
      for (const asset of ASSETS) {
        const quote = data[asset.coingeckoId];
        const price = quote?.usd ?? 0;
        if (price > 0) {
          bySymbol.set(asset.symbol, {
            symbol: asset.symbol,
            price,
            change24h: quote?.usd_24h_change ?? 0,
          });
        }
      }
    }
  } catch {
    // fallback Binance
  }

  // 2. Binance fallback pour ce qui manque
  const missing = ASSETS.filter((a) => !bySymbol.has(a.symbol) && a.binanceSymbol);
  if (missing.length > 0) {
    try {
      const query = encodeURIComponent(JSON.stringify(missing.map((a) => a.binanceSymbol)));
      const res = await fetch(`https://api.binance.com/api/v3/ticker/24hr?symbols=${query}`);
      if (res.ok) {
        const data = (await res.json()) as Array<{
          symbol: string;
          lastPrice?: string;
          priceChangePercent?: string;
        }>;
        const byPair = new Map(data.map((row) => [row.symbol, row]));
        for (const asset of missing) {
          const row = byPair.get(asset.binanceSymbol!);
          const price = Number(row?.lastPrice) || 0;
          if (price > 0) {
            bySymbol.set(asset.symbol, {
              symbol: asset.symbol,
              price,
              change24h: Number(row?.priceChangePercent) || 0,
            });
          }
        }
      }
    } catch {
      // ignore
    }
  }

  const result = Array.from(bySymbol.values());
  setCache(cacheKey, result, 30);
  return result;
}

// --- Fetch History ---

async function fetchHistory(assetSymbol: string, interval: string): Promise<Candle[]> {
  const cacheKey = `history:${assetSymbol}:${interval}`;
  const cached = getCache<Candle[]>(cacheKey);
  if (cached) return cached;

  const asset = ASSETS.find((a) => a.symbol === assetSymbol);
  if (!asset) return [];

  const limit = INTERVAL_LIMITS[interval] ?? 168;

  // 1. MEXC
  if (asset.mexcSymbol) {
    try {
      const res = await fetch(
        `https://api.mexc.com/api/v3/klines?symbol=${asset.mexcSymbol}&interval=${interval}&limit=${limit}`,
      );
      if (res.ok) {
        const data = await res.json() as [number, string, string, string, string, string, ...number[]][];
        const candles = data.map((c) => ({
          time: Math.floor(c[0] / 1000),
          open: parseFloat(c[1]),
          high: parseFloat(c[2]),
          low: parseFloat(c[3]),
          close: parseFloat(c[4]),
        }));
        setCache(cacheKey, candles, 60);
        return candles;
      }
    } catch {
      // fallback
    }
  }

  // 2. Binance
  if (asset.binanceSymbol) {
    try {
      const res = await fetch(
        `https://api.binance.com/api/v3/klines?symbol=${asset.binanceSymbol}&interval=${interval}&limit=${limit}`,
      );
      if (res.ok) {
        const data = await res.json() as [number, string, string, string, string, string, ...number[]][];
        const candles = data.map((c) => ({
          time: Math.floor(c[0] / 1000),
          open: parseFloat(c[1]),
          high: parseFloat(c[2]),
          low: parseFloat(c[3]),
          close: parseFloat(c[4]),
        }));
        setCache(cacheKey, candles, 60);
        return candles;
      }
    } catch {
      // fallback
    }
  }

  // 3. CoinGecko fallback
  try {
    const days = interval === "5m" ? 2 : interval === "15m" ? 3 : interval === "1h" ? 7 : interval === "6h" ? 42 : 180;
    const res = await fetch(
      `https://api.coingecko.com/api/v3/coins/${asset.coingeckoId}/market_chart?vs_currency=usd&days=${days}`,
    );
    if (res.ok) {
      const data = (await res.json()) as { prices: [number, number][] };
      const prices = data.prices;
      const candles: Candle[] = [];
      for (let i = 0; i < prices.length; i += 60) {
        const slice = prices.slice(i, Math.min(i + 60, prices.length));
        if (slice.length === 0) continue;
        const values = slice.map((p) => p[1]);
        candles.push({
          time: Math.floor(slice[0][0] / 1000),
          open: values[0],
          high: Math.max(...values),
          low: Math.min(...values),
          close: values[values.length - 1],
        });
      }
      const result = candles.slice(-limit);
      setCache(cacheKey, result, 60);
      return result;
    }
  } catch {
    // ignore
  }

  return [];
}

// --- Handler ---

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    let action: string | null = null;
    let asset: string | null = null;
    let interval = "1h";

    if (req.method === "POST") {
      const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
      action = typeof body.action === "string" ? body.action : null;
      asset = typeof body.asset === "string" ? body.asset : null;
      interval = typeof body.interval === "string" ? body.interval : "1h";
    } else {
      const url = new URL(req.url);
      action = url.searchParams.get("action");
      asset = url.searchParams.get("asset");
      interval = url.searchParams.get("interval") ?? "1h";
    }

    // Nettoyage périodique du cache (simple, pas critique)
    if (Math.random() < 0.05) cleanExpiredCache();

    if (action === "prices") {
      const prices = await fetchPrices();
      return new Response(JSON.stringify({ prices }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "history") {
      if (!asset) {
        return new Response(JSON.stringify({ error: "asset param required" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const candles = await fetchHistory(asset, interval);
      return new Response(JSON.stringify({ candles }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ error: "Invalid action. Use ?action=prices or ?action=history" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
