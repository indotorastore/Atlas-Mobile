import { NextResponse } from "next/server";

const markets: Record<string, string> = {
  BTCUSD: "BTCUSDT",
  ETHUSD: "ETHUSDT",
  SOLUSD: "SOLUSDT",
};

const intervals: Record<string, string> = {
  "1m": "1m",
  "5m": "5m",
  "15m": "15m",
  "1H": "1h",
  "4H": "4h",
  "1D": "1d",
};

const binanceApiHosts = ["api.binance.com", "data-api.binance.vision"];

type BinanceTrade = {
  p: string;
  q: string;
  m: boolean;
  T: number;
};

async function fetchBinance(path: string) {
  const failures: string[] = [];

  for (const host of binanceApiHosts) {
    try {
      const response = await fetch(`https://${host}/api/v3/${path}`, {
        cache: "no-store",
        signal: AbortSignal.timeout(5_000),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      return response.json() as Promise<unknown>;
    } catch (error) {
      failures.push(`${host}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  throw new Error(`All Binance market-data hosts failed (${failures.join("; ")})`);
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const symbol = searchParams.get("symbol") ?? "";
  const timeframe = searchParams.get("timeframe") ?? "";
  const market = markets[symbol];
  const interval = intervals[timeframe];

  if (!market || !interval) {
    return NextResponse.json({ error: "Instrumen atau timeframe tidak didukung untuk data live." }, { status: 400 });
  }

  try {
    const [depthResult, klinesResult, tradesResult, tickerResult] = await Promise.all([
      fetchBinance(`depth?symbol=${market}&limit=20`),
      fetchBinance(`klines?symbol=${market}&interval=${interval}&limit=120`),
      fetchBinance(`aggTrades?symbol=${market}&limit=500`),
      fetchBinance(`ticker/24hr?symbol=${market}`),
    ]);

    if (!depthResult || typeof depthResult !== "object"
      || !Array.isArray((depthResult as { bids?: unknown }).bids)
      || !Array.isArray((depthResult as { asks?: unknown }).asks)
      || !Array.isArray(klinesResult)
      || !Array.isArray(tradesResult)
      || !tickerResult || typeof tickerResult !== "object") {
      throw new Error("Binance returned an invalid market-data response");
    }
    const ticker = tickerResult as { lastPrice?: string; priceChange?: string; priceChangePercent?: string };
    const currentPrice = Number(ticker.lastPrice);
    const change = Number(ticker.priceChange);
    const changePct = Number(ticker.priceChangePercent);
    if (![currentPrice, change, changePct].every(Number.isFinite)) {
      throw new Error("Binance returned invalid ticker data");
    }

    const parseBook = (levels: unknown[]) => levels.flatMap((level) => {
      if (!Array.isArray(level) || typeof level[0] !== "string" || typeof level[1] !== "string") return [];
      const price = Number(level[0]);
      const quantity = Number(level[1]);
      return Number.isFinite(price) && Number.isFinite(quantity) && quantity > 0
        ? [{ price, quantity }]
        : [];
    });

    const candles = klinesResult.flatMap((row) => {
      if (!Array.isArray(row) || row.length < 6) return [];
      const [openTime, open, high, low, close, volume] = row;
      const numbers = [openTime, open, high, low, close, volume].map(Number);
      if (!numbers.every(Number.isFinite)) return [];
      return [{
        time: Math.floor(numbers[0] / 1000),
        open: numbers[1],
        high: numbers[2],
        low: numbers[3],
        close: numbers[4],
        volume: numbers[5],
      }];
    });
    const trades = (tradesResult as BinanceTrade[]).flatMap((trade) => {
      const price = Number(trade.p);
      const quantity = Number(trade.q);
      if (!Number.isFinite(price) || !Number.isFinite(quantity) || quantity <= 0 || !Number.isFinite(trade.T)) return [];
      return [{ price, quantity, buyerIsMaker: trade.m, time: trade.T }];
    });

    if (candles.length < 50 || trades.length === 0) {
      throw new Error("Binance returned insufficient market data");
    }

    const depth = depthResult as { bids: unknown[]; asks: unknown[] };
    return NextResponse.json({
      symbol,
      exchangeSymbol: market,
      fetchedAt: Date.now(),
      currentPrice,
      change,
      changePct,
      candles,
      bids: parseBook(depth.bids),
      asks: parseBook(depth.asks),
      trades,
    });
  } catch (error) {
    console.error("[market-data] Binance request failed", { symbol, timeframe, error });
    return NextResponse.json({ error: "Data live Binance tidak tersedia saat ini. Periksa koneksi lalu coba lagi." }, { status: 502 });
  }
}
