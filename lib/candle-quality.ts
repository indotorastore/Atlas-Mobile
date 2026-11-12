import type { SignalTimeframe } from "./signal";
import type { Candle } from "./technical-analysis";

const timeframeSeconds: Record<SignalTimeframe, number> = {
  "1m": 60,
  "5m": 300,
  "15m": 900,
  "1H": 3_600,
  "4H": 14_400,
  "1D": 86_400,
};

export type CandleQuality = {
  valid: boolean;
  gaps: number;
  issues: string[];
};

export function validateCandles(
  candles: Candle[],
  timeframe: SignalTimeframe,
  options: { allowGaps?: boolean; now?: number } = {},
): CandleQuality {
  const step = timeframeSeconds[timeframe];
  const issues: string[] = [];
  let gaps = 0;
  let hasStructuralErrors = false;
  let isFresh = true;

  if (candles.length === 0) {
    return { valid: false, gaps, issues: ["Tidak ada candle untuk diperiksa."] };
  }

  for (let index = 0; index < candles.length; index += 1) {
    const candle = candles[index];
    const values = [candle.time, candle.open, candle.high, candle.low, candle.close, candle.volume];
    if (!values.every(Number.isFinite)
      || candle.time < 0
      || candle.open <= 0
      || candle.close <= 0
      || candle.low <= 0
      || candle.high < Math.max(candle.open, candle.close, candle.low)
      || candle.low > Math.min(candle.open, candle.close)
      || candle.volume < 0) {
      issues.push(`Candle indeks ${index} memiliki nilai OHLCV yang tidak valid.`);
      hasStructuralErrors = true;
      continue;
    }

    if (candle.time % step !== 0) {
      issues.push(`Waktu candle indeks ${index} tidak sejajar dengan timeframe.`);
      hasStructuralErrors = true;
    }
    if (index > 0) {
      const difference = candle.time - candles[index - 1].time;
      if (difference <= 0) {
        issues.push("Urutan timestamp candle tidak meningkat secara ketat.");
        hasStructuralErrors = true;
      } else if (difference !== step) {
        gaps += Math.max(1, Math.floor(difference / step) - 1);
      }
    }
  }

  if (gaps > 0) issues.push(`Ditemukan ${gaps} candle timeframe yang hilang.`);
  const now = options.now ?? Date.now();
  const latest = candles[candles.length - 1];
  if (latest && (latest.time * 1_000 > now || now - (latest.time + step) * 1_000 > step * 3_000)) {
    issues.push("Candle terbaru belum tiba atau terlalu lama untuk timeframe ini.");
    isFresh = false;
  }

  return {
    valid: !hasStructuralErrors && (options.allowGaps === true || gaps === 0)
      && isFresh,
    gaps,
    issues,
  };
}
