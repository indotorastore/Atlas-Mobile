import { NextResponse } from "next/server";

const historySettings: Record<string, { interval: string; range: string; bucketSeconds: number }> = {
  "1m": { interval: "1m", range: "5d", bucketSeconds: 60 },
  "5m": { interval: "5m", range: "1mo", bucketSeconds: 300 },
  "15m": { interval: "15m", range: "1mo", bucketSeconds: 900 },
  "1H": { interval: "1h", range: "1y", bucketSeconds: 3600 },
  "4H": { interval: "1h", range: "1y", bucketSeconds: 14_400 },
  "1D": { interval: "1d", range: "2y", bucketSeconds: 86_400 },
};

type YahooChartResponse = {
  chart?: {
    error?: { description?: string } | null;
    result?: Array<{
      timestamp?: number[];
      indicators?: {
        quote?: Array<{
          open?: (number | null)[];
          high?: (number | null)[];
          low?: (number | null)[];
          close?: (number | null)[];
          volume?: (number | null)[];
        }>;
      };
    }> | null;
  };
};

type Candle = {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

export async function GET(request: Request) {
  const timeframe = new URL(request.url).searchParams.get("timeframe") ?? "";
  const settings = historySettings[timeframe];
  if (!settings) {
    return NextResponse.json({ error: "Timeframe XAUUSD tidak didukung untuk histori." }, { status: 400 });
  }

  const url = new URL("https://query1.finance.yahoo.com/v8/finance/chart/GC%3DF");
  url.searchParams.set("range", settings.range);
  url.searchParams.set("interval", settings.interval);

  try {
    const response = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 AtlasMarketIntelligence/1.0" },
      next: { revalidate: 300 },
      signal: AbortSignal.timeout(12_000),
    });
    if (!response.ok) throw new Error(`Yahoo Finance returned HTTP ${response.status}`);

    const result = await response.json() as YahooChartResponse;
    if (result.chart?.error) {
      throw new Error(result.chart.error.description ?? "Yahoo Finance returned a chart error");
    }
    const chart = result.chart?.result?.[0];
    const quote = chart?.indicators?.quote?.[0];
    if (!chart || !Array.isArray(chart.timestamp)
      || !quote || !Array.isArray(quote.open) || !Array.isArray(quote.high)
      || !Array.isArray(quote.low) || !Array.isArray(quote.close)) {
      throw new Error("Yahoo Finance returned an invalid chart response");
    }

    const candles = new Map<number, Candle>();
    chart.timestamp.forEach((timestamp, index) => {
      const open = quote.open?.[index];
      const high = quote.high?.[index];
      const low = quote.low?.[index];
      const close = quote.close?.[index];
      const volume = quote.volume?.[index] ?? 0;
      if (![timestamp, open, high, low, close, volume].every(Number.isFinite)
        || typeof open !== "number" || typeof high !== "number"
        || typeof low !== "number" || typeof close !== "number") return;

      const time = Math.floor(timestamp / settings.bucketSeconds) * settings.bucketSeconds;
      const candle: Candle = {
        time,
        open,
        high,
        low,
        close,
        volume,
      };
      const existing = candles.get(time);
      if (!existing) {
        candles.set(time, candle);
      } else {
        existing.high = Math.max(existing.high, candle.high);
        existing.low = Math.min(existing.low, candle.low);
        existing.close = candle.close;
        existing.volume += candle.volume;
      }
    });

    const history = [...candles.values()].sort((a, b) => a.time - b.time).slice(-120);
    if (history.length === 0) throw new Error("Yahoo Finance returned no usable gold futures candles");

    return NextResponse.json({
      symbol: "XAUUSD",
      historySymbol: "GC=F",
      source: "Yahoo Finance · COMEX Gold Futures",
      candles: history,
    });
  } catch (error) {
    console.error("[xau-history] Historical gold data request failed", { timeframe, error });
    return NextResponse.json(
      { error: "Histori candle emas eksternal tidak tersedia saat ini. Coba muat ulang nanti." },
      { status: 502 },
    );
  }
}
