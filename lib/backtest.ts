import type { Signal, SignalTimeframe } from "./signal";
import { generateSignal, SIGNAL_RULE_VERSION } from "./signal";
import { validateCandles } from "./candle-quality";
import { calculateAnalysis, type Candle } from "./technical-analysis";

export const BACKTEST_RULE_VERSION = SIGNAL_RULE_VERSION;
export const BACKTEST_ASSUMPTIONS = {
  holdingBars: 5,
  feePerSidePct: 0.1,
  slippagePerSidePct: 0.05,
} as const;

export type BacktestResult = {
  symbol: string;
  timeframe: SignalTimeframe;
  ruleVersion: string;
  candleCount: number;
  sampleSize: number;
  wins: number;
  winRatePct: number | null;
  averageNetReturnPct: number | null;
  totalNetReturnPct: number | null;
  startTime: number | null;
  endTime: number | null;
  assumptions: typeof BACKTEST_ASSUMPTIONS;
  warning: string;
};

const timeframeSeconds: Record<SignalTimeframe, number> = {
  "1m": 60,
  "5m": 300,
  "15m": 900,
  "1H": 3_600,
  "4H": 14_400,
  "1D": 86_400,
};

export function generateBacktestSignalAtIndex(
  symbol: string,
  timeframe: SignalTimeframe,
  candles: Candle[],
  index: number,
): Signal {
  if (!Number.isInteger(index) || index < 0 || index >= candles.length) {
    throw new Error("Indeks candle backtest tidak valid.");
  }
  const history = candles.slice(0, index + 1);
  const latest = history[history.length - 1];
  if (!latest || history.length < 50) throw new Error("Signal backtest membutuhkan minimal 50 candle historis.");
  const step = timeframeSeconds[timeframe];
  const analysis = calculateAnalysis(history);
  const closeTime = (latest.time + step) * 1_000;
  return generateSignal({
    symbol,
    timeframe,
    source: "Binance historical candles",
    analysis,
    candleCount: history.length,
    latestClose: latest.close,
    latestCandleTime: latest.time,
    inputTimestamp: closeTime,
    dataStatus: "live",
    volumes: history.slice(-20).map((candle) => candle.volume),
    now: closeTime - 1,
  });
}

export function runBacktest(
  symbol: string,
  timeframe: SignalTimeframe,
  candles: Candle[],
): BacktestResult {
  const quality = validateCandles(candles, timeframe);
  if (!quality.valid) {
    throw new Error(`Data backtest ditolak: ${quality.issues.join(" ")}`);
  }

  const returns: number[] = [];
  const lastEntryIndex = candles.length - BACKTEST_ASSUMPTIONS.holdingBars;

  for (let index = 50; index < lastEntryIndex; index += 1) {
    const signal = generateBacktestSignalAtIndex(symbol, timeframe, candles, index);

    if (signal.direction === "NEUTRAL") continue;

    const entry = candles[index + 1].open;
    const exit = candles[index + BACKTEST_ASSUMPTIONS.holdingBars].close;
    const direction = signal.direction === "BUY" ? 1 : -1;
    const slippage = BACKTEST_ASSUMPTIONS.slippagePerSidePct / 100;
    const entryFill = entry * (1 + direction * slippage);
    const exitFill = exit * (1 - direction * slippage);
    const grossReturnPct = direction * (exitFill - entryFill) / entry * 100;
    const feeCostsPct = BACKTEST_ASSUMPTIONS.feePerSidePct * (entryFill + exitFill) / entry;
    returns.push(grossReturnPct - feeCostsPct);
    index += BACKTEST_ASSUMPTIONS.holdingBars - 1;
  }

  const wins = returns.filter((value) => value > 0).length;
  return {
    symbol,
    timeframe,
    ruleVersion: BACKTEST_RULE_VERSION,
    candleCount: candles.length,
    sampleSize: returns.length,
    wins,
    winRatePct: returns.length ? wins / returns.length * 100 : null,
    averageNetReturnPct: returns.length
      ? returns.reduce((sum, value) => sum + value, 0) / returns.length
      : null,
    totalNetReturnPct: returns.length ? returns.reduce((sum, value) => sum + value, 0) : null,
    startTime: candles[0]?.time ?? null,
    endTime: candles[candles.length - 1]?.time ?? null,
    assumptions: BACKTEST_ASSUMPTIONS,
    warning: "Backtest simulasi historis, bukan prediksi atau hasil nyata. Entry pada open candle berikutnya; exit pada close setelah holding horizon. Tidak termasuk spread/funding/tax dan biaya aktual dapat berbeda.",
  };
}
