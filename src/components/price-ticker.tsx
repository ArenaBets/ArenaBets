import { useEffect, useMemo, useState } from "react";
import {
  PRICE_REFRESH_MS,
  fetchCryptoPrices,
  getEmptyPriceRows,
  type PriceRow,
} from "@/lib/crypto-price-service";

function formatTickerPrice(price: number) {
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

export function PriceTicker() {
  const [prices, setPrices] = useState<PriceRow[]>([]);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const nextPrices = await fetchCryptoPrices();
        if (!cancelled && nextPrices.some((row) => row.price > 0)) {
          setPrices(nextPrices);
        }
      } catch {
        // keep last good prices
      }
    }

    load();
    const id = setInterval(load, PRICE_REFRESH_MS);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  const items = useMemo(() => {
    const base =
      prices.length > 0 && prices.some((row) => row.price > 0)
        ? prices
        : getEmptyPriceRows();
    return [...base, ...base, ...base, ...base];
  }, [prices]);

  return (
    <div className="border-y-2 border-foreground bg-foreground text-parchment overflow-hidden">
      <div className="flex animate-ticker whitespace-nowrap py-2 font-mono text-sm">
        {items.map((row, index) => {
          const up = row.change24h >= 0;
          return (
            <span key={`${row.symbol}-${index}`} className="mx-6 inline-flex items-center gap-3">
              <span className="size-1.5 rounded-full bg-primary" />
              <span className="font-bold tracking-widest">{row.symbol}</span>
              <span>{formatTickerPrice(row.price)}</span>
              <span className={up ? "text-primary" : "text-accent"}>
                {up ? "▲" : "▼"} {Math.abs(row.change24h).toFixed(2)}%
              </span>
            </span>
          );
        })}
      </div>
    </div>
  );
}
