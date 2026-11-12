import type { SignalAnalysis } from "./signal";

export type Candle = {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

export type TechnicalAnalysis = SignalAnalysis & {
  macd: number;
  macdSignal: number;
  bias: "Bullish" | "Bearish" | "Neutral";
};

function ema(values: number[], period: number): number[] {
  if (values.length === 0) return [];
  const multiplier = 2 / (period + 1);
  return values.map((value, index) =>
    index === 0 ? value : value * multiplier + values[index - 1] * (1 - multiplier),
  );
}

export function calculateAnalysis(candles: Candle[]): TechnicalAnalysis {
  if (candles.length === 0) {
    return {
      ema20: 0,
      ema50: 0,
      rsi14: 50,
      macd: 0,
      macdSignal: 0,
      macdHistogram: 0,
      atr14: 0,
      support: 0,
      resistance: 0,
      trend: "Neutral",
      bias: "Neutral",
    };
  }
  const closes = candles.map((candle) => candle.close);
  const ema20Series = ema(closes, 20);
  const ema50Series = ema(closes, 50);
  const ema26Series = ema(closes, 26);
  const macdSeries = ema(closes, 12).map((value, index) => value - ema26Series[index]);
  const macdSignalSeries = ema(macdSeries, 9);
  const recent = candles.slice(-20);
  const recentCloses = closes.slice(-15);
  const changes = recentCloses.slice(1).map((close, index) => close - recentCloses[index]);
  const gains = changes.map((change) => Math.max(change, 0));
  const losses = changes.map((change) => Math.max(-change, 0));
  const averageGain = gains.length ? gains.reduce((sum, value) => sum + value, 0) / gains.length : 0;
  const averageLoss = losses.length ? losses.reduce((sum, value) => sum + value, 0) / losses.length : 0;
  const rsi14 = averageLoss === 0 ? (averageGain === 0 ? 50 : 100) : 100 - 100 / (1 + averageGain / averageLoss);
  const trueRanges = candles.slice(-14).map((candle, index, recentCandles) => {
    const previousClose = recentCandles[index - 1]?.close ?? candles[candles.length - 15]?.close ?? candle.close;
    return Math.max(candle.high - candle.low, Math.abs(candle.high - previousClose), Math.abs(candle.low - previousClose));
  });
  const latest = closes[closes.length - 1];
  const ema20 = ema20Series[ema20Series.length - 1];
  const ema50 = ema50Series[ema50Series.length - 1];
  const macd = macdSeries[macdSeries.length - 1];
  const macdSignal = macdSignalSeries[macdSignalSeries.length - 1];
  const trend = latest > ema20 && ema20 > ema50 ? "Bullish" : latest < ema20 && ema20 < ema50 ? "Bearish" : "Neutral";
  const score = (trend === "Bullish" ? 1 : trend === "Bearish" ? -1 : 0)
    + (rsi14 > 55 ? 1 : rsi14 < 45 ? -1 : 0)
    + (macd > macdSignal ? 1 : macd < macdSignal ? -1 : 0);

  return {
    ema20,
    ema50,
    rsi14,
    macd,
    macdSignal,
    macdHistogram: macd - macdSignal,
    atr14: trueRanges.reduce((sum, value) => sum + value, 0) / trueRanges.length,
    support: Math.min(...recent.map((candle) => candle.low)),
    resistance: Math.max(...recent.map((candle) => candle.high)),
    trend,
    bias: score >= 2 ? "Bullish" : score <= -2 ? "Bearish" : "Neutral",
  };
}
