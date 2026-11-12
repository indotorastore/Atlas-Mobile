import { NextResponse } from "next/server";
import { runBacktest } from "@/lib/backtest";
import type { SignalTimeframe } from "@/lib/signal";
import type { Candle } from "@/lib/technical-analysis";

const markets: Record<string, string> = {
  BTCUSD: "BTCUSDT",
  ETHUSD: "ETHUSDT",
  SOLUSD: "SOLUSDT",
};

const intervals: Record<SignalTimeframe, string> = {
  "1m": "1m",
  "5m": "5m",
  "15m": "15m",
  "1H": "1h",
  "4H": "4h",
  "1D": "1d",
};

async function fetchKlines(symbol: string, interval: string) {
  const failures: string[] = [];

  for (const host of ["api.binance.com", "data-api.binance.vision"]) {
    try {
      const response = await fetch(
        `https://${host}/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=500`,
        { cache: "no-store", signal: AbortSignal.timeout(8_000) },
      );
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response.json() as Promise<unknown>;
    } catch (error) {
      failures.push(`${host}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  throw new Error(`All Binance historical-data hosts failed (${failures.join("; ")})`);
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const symbol = searchParams.get("symbol") ?? "";
  const timeframe = searchParams.get("timeframe") as SignalTimeframe;
  const market = markets[symbol];
  const interval = intervals[timeframe];

  if (!market || !interval) {
    return NextResponse.json({ error: "Backtest hanya tersedia untuk pair crypto Binance yang didukung." }, { status: 400 });
  }

  try {
    const response = await fetchKlines(market, interval);
    if (!Array.isArray(response)) throw new Error("Binance returned an invalid historical-data response");

    const stepMs = {
      "1m": 60_000,
      "5m": 300_000,
      "15m": 900_000,
      "1H": 3_600_000,
      "4H": 14_400_000,
      "1D": 86_400_000,
    }[timeframe];
    const now = Date.now();
    const candles: Candle[] = response.flatMap((row): Candle[] => {
      if (!Array.isArray(row) || row.length < 7) throw new Error("Binance returned a malformed candle.");
      const [openTime, open, high, low, close, volume, closeTime] = row.map(Number);
      if (![openTime, open, high, low, close, volume, closeTime].every(Number.isFinite)) {
        throw new Error("Binance returned a candle with non-numeric fields.");
      }
      if (closeTime >= now) return [];
      return [{
        time: Math.floor(openTime / 1000),
        open,
        high,
        low,
        close,
        volume,
      }];
    });

    if (candles.length < 55 || now - (candles[candles.length - 1].time * 1_000 + stepMs) > stepMs * 3) {
      throw new Error("Historical Binance candles are insufficient or stale for this timeframe.");
    }

    return NextResponse.json(runBacktest(symbol, timeframe, candles));
  } catch (error) {
    console.error("[backtest] Historical evaluation failed", { symbol, timeframe, error });
    return NextResponse.json({
      error: error instanceof Error ? error.message : "Backtest data is unavailable.",
    }, { status: 502 });
  }
}
