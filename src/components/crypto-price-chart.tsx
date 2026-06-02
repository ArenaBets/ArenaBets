import { useEffect, useRef, useState } from "react";
import { createChart, CandlestickSeries, type ISeriesApi, type CandlestickData } from "lightweight-charts";
import type { CryptoAsset } from "@/lib/crypto-markets";
import { fetchCryptoHistory, formatCryptoPrice, type Candle, type TimeInterval } from "@/hooks/use-crypto-prices";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

interface CryptoPriceChartProps {
  asset: CryptoAsset;
  currentPrice: number;
  change24h: number;
}

const INTERVALS: { label: string; value: TimeInterval }[] = [
  { label: "5m", value: "5m" },
  { label: "15m", value: "15m" },
  { label: "1H", value: "1h" },
  { label: "6H", value: "6h" },
  { label: "1D", value: "1d" },
];

export function CryptoPriceChart({ asset, currentPrice, change24h }: CryptoPriceChartProps) {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<ReturnType<typeof createChart> | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const [loading, setLoading] = useState(true);
  const [candles, setCandles] = useState<Candle[]>([]);
  const [interval, setInterval] = useState<TimeInterval>("1h");

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      const data = await fetchCryptoHistory(asset, interval);
      if (!cancelled) {
        setCandles(data);
        setLoading(false);
      }
    }

    load();
    return () => { cancelled = true; };
  }, [asset, interval]);

  useEffect(() => {
    if (!chartContainerRef.current || candles.length === 0) return;

    const chart = createChart(chartContainerRef.current, {
      layout: {
        background: { color: "transparent" },
        textColor: "#64748b",
      },
      grid: {
        vertLines: { color: "rgba(100, 116, 139, 0.1)" },
        horzLines: { color: "rgba(100, 116, 139, 0.1)" },
      },
      rightPriceScale: {
        borderColor: "rgba(100, 116, 139, 0.2)",
      },
      timeScale: {
        borderColor: "rgba(100, 116, 139, 0.2)",
      },
      crosshair: {
        mode: 0,
      },
      handleScroll: false,
      handleScale: false,
    });

    const series = chart.addSeries(CandlestickSeries, {
      upColor: "#22c55e",
      downColor: "#ef4444",
      borderUpColor: "#22c55e",
      borderDownColor: "#ef4444",
      wickUpColor: "#22c55e",
      wickDownColor: "#ef4444",
    });

    const chartData: CandlestickData[] = candles.map((c) => ({
      time: c.time as any,
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
    }));

    series.setData(chartData);
    chart.timeScale().fitContent();

    chartRef.current = chart;
    seriesRef.current = series;

    const resizeObserver = new ResizeObserver(() => {
      chart.applyOptions({
        width: chartContainerRef.current?.clientWidth ?? 0,
        height: chartContainerRef.current?.clientHeight ?? 0,
      });
    });

    if (chartContainerRef.current) {
      resizeObserver.observe(chartContainerRef.current);
    }

    return () => {
      resizeObserver.disconnect();
      chart.remove();
    };
  }, [candles]);

  const isPositive = change24h >= 0;

  if (loading) {
    return (
      <Card className="w-full h-80 animate-pulse">
        <CardContent className="flex items-center justify-center h-full">
          <span className="text-sm text-muted-foreground">Loading chart...</span>
        </CardContent>
      </Card>
    );
  }

  if (candles.length === 0) {
    return (
      <Card className="w-full h-80">
        <CardContent className="flex items-center justify-center h-full">
          <span className="text-sm text-muted-foreground">No data available</span>
        </CardContent>
      </Card>
    );
  }

  const low = Math.min(...candles.map((c) => c.low));
  const high = Math.max(...candles.map((c) => c.high));

  return (
    <Card className="w-full">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg font-bold">{asset}/USD</CardTitle>
          <div className="text-right">
            <div className="text-xl font-bold">{formatCryptoPrice(currentPrice)}</div>
            <div className={`text-sm font-medium ${isPositive ? "text-green-500" : "text-red-500"}`}>
              {isPositive ? "+" : ""}{change24h.toFixed(2)}%
            </div>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="flex gap-1 mb-2">
          {INTERVALS.map((int) => (
            <Button
              key={int.value}
              variant={interval === int.value ? "default" : "outline"}
              size="sm"
              className="text-xs px-2 py-1 h-7"
              onClick={() => setInterval(int.value)}
            >
              {int.label}
            </Button>
          ))}
        </div>
        <div ref={chartContainerRef} className="h-52 w-full" />
        <div className="mt-2 flex justify-between text-xs text-muted-foreground">
          <span>Low: {formatCryptoPrice(low)}</span>
          <span>High: {formatCryptoPrice(high)}</span>
        </div>
      </CardContent>
    </Card>
  );
}
