export type SignalDirection = "BUY" | "SELL" | "NEUTRAL";
export const SIGNAL_RULE_VERSION = "atlas-consensus-v1";
export type SignalStance = "Bullish" | "Bearish" | "Neutral";
export type SignalDataStatus = "live" | "delayed" | "stale" | "unavailable";
export type SignalStatus = "ready" | "insufficient_data" | "stale_data" | "invalid_data";
export type SignalTimeframe = "1m" | "5m" | "15m" | "1H" | "4H" | "1D";

export type SignalAnalysis = {
  ema20: number;
  ema50: number;
  rsi14: number;
  macdHistogram: number;
  atr14: number;
  support: number;
  resistance: number;
  trend: SignalStance;
};

export type SignalComponent = {
  name: string;
  stance: SignalStance;
  detail: string;
};

export type Signal = {
  symbol: string;
  timeframe: SignalTimeframe;
  direction: SignalDirection;
  summary: string;
  components: SignalComponent[];
  alignment: { aligned: number; total: 3 };
  volume: {
    available: boolean;
    recentAverage: number | null;
    comparison: "higher" | "similar" | "lower" | "unavailable";
  };
  status: SignalStatus;
  dataStatus: SignalDataStatus;
  dataQualityValid?: boolean;
  dataQualityIssues?: string[];
  source: string;
  generatedAt: number;
  inputTimestamp: number | null;
  expiresAt: number | null;
};

export type SignalInput = {
  symbol: string;
  timeframe: SignalTimeframe;
  source: string;
  analysis: SignalAnalysis;
  candleCount: number;
  latestClose: number | null;
  latestCandleTime: number | null;
  inputTimestamp: number | null;
  dataStatus: SignalDataStatus;
  dataQualityValid?: boolean;
  dataQualityIssues?: string[];
  volumes: number[];
  now: number;
};

const timeframeSeconds: Record<SignalTimeframe, number> = {
  "1m": 60,
  "5m": 300,
  "15m": 900,
  "1H": 3_600,
  "4H": 14_400,
  "1D": 86_400,
};

function getVolumeContext(volumes: number[]): Signal["volume"] {
  const recent = volumes.slice(-20);
  if (recent.length < 20 || recent.some((volume) => !Number.isFinite(volume) || volume < 0)
    || recent.every((volume) => volume === 0)) {
    return { available: false, recentAverage: null, comparison: "unavailable" };
  }

  const recentAverage = recent.slice(-5).reduce((sum, volume) => sum + volume, 0) / 5;
  const previousAverage = recent.slice(0, 15).reduce((sum, volume) => sum + volume, 0) / 15;
  if (previousAverage === 0) {
    return { available: true, recentAverage, comparison: "unavailable" };
  }

  const ratio = recentAverage / previousAverage;
  return {
    available: true,
    recentAverage,
    comparison: ratio > 1.2 ? "higher" : ratio < 0.8 ? "lower" : "similar",
  };
}

export function generateSignal(input: SignalInput): Signal {
  const expiresAt = input.latestCandleTime === null
    ? null
    : (input.latestCandleTime + timeframeSeconds[input.timeframe]) * 1_000;
  const volume = getVolumeContext(input.volumes);
  const indicatorValues = [
    input.analysis.ema20,
    input.analysis.ema50,
    input.analysis.rsi14,
    input.analysis.macdHistogram,
    input.analysis.atr14,
    input.analysis.support,
    input.analysis.resistance,
    input.latestClose,
  ];
  const hasValidIndicators = indicatorValues.every((value) => typeof value === "number" && Number.isFinite(value))
    && input.analysis.rsi14 >= 0
    && input.analysis.rsi14 <= 100
    && (input.latestClose ?? 0) > 0;
  const insufficientData = input.candleCount < 50 || !hasValidIndicators || expiresAt === null;

  const base: Signal = {
    symbol: input.symbol,
    timeframe: input.timeframe,
    direction: "NEUTRAL",
    summary: "",
    components: [],
    alignment: { aligned: 0, total: 3 },
    volume,
    status: "insufficient_data",
    dataStatus: input.dataStatus,
    dataQualityIssues: input.dataQualityIssues ?? [],
    source: input.source,
    generatedAt: input.now,
    inputTimestamp: input.inputTimestamp,
    expiresAt,
  };

  if (insufficientData) {
    return {
      ...base,
      summary: "Sinyal belum tersedia: diperlukan sedikitnya 50 candle dan indikator yang valid.",
    };
  }

  if (input.dataQualityValid === false) {
    return {
      ...base,
      status: "invalid_data",
      summary: "Sinyal ditahan karena pemeriksaan kualitas data gagal.",
    };
  }

  const { analysis } = input;
  const rsiStance: SignalStance = analysis.rsi14 > 50 && analysis.rsi14 < 70
    ? "Bullish"
    : analysis.rsi14 < 50 && analysis.rsi14 > 30
      ? "Bearish"
      : "Neutral";
  const macdStance: SignalStance = analysis.macdHistogram > 0
    ? "Bullish"
    : analysis.macdHistogram < 0
      ? "Bearish"
      : "Neutral";
  const components: SignalComponent[] = [
    {
      name: "Trend",
      stance: analysis.trend,
      detail: analysis.trend === "Bullish"
        ? "Harga berada di atas EMA 20 dan EMA 20 di atas EMA 50."
        : analysis.trend === "Bearish"
          ? "Harga berada di bawah EMA 20 dan EMA 20 di bawah EMA 50."
          : "Harga dan EMA 20/50 belum menunjukkan susunan tren yang searah.",
    },
    {
      name: "RSI 14",
      stance: rsiStance,
      detail: rsiStance === "Bullish"
        ? `RSI ${analysis.rsi14.toFixed(1)} mendukung momentum naik, di luar zona ekstrem.`
        : rsiStance === "Bearish"
          ? `RSI ${analysis.rsi14.toFixed(1)} mendukung momentum turun, di luar zona ekstrem.`
          : `RSI ${analysis.rsi14.toFixed(1)} tidak mengonfirmasi arah; nilai netral atau ekstrem tidak dipakai sebagai pemicu.`,
    },
    {
      name: "MACD",
      stance: macdStance,
      detail: macdStance === "Bullish"
        ? "Histogram MACD positif."
        : macdStance === "Bearish"
          ? "Histogram MACD negatif."
          : "Histogram MACD netral.",
    },
  ];
  const bullishCount = components.filter((component) => component.stance === "Bullish").length;
  const bearishCount = components.filter((component) => component.stance === "Bearish").length;
  const direction = bullishCount === 3 ? "BUY" : bearishCount === 3 ? "SELL" : "NEUTRAL";
  const aligned = Math.max(bullishCount, bearishCount);
  const dataExpired = input.dataStatus === "stale"
    || input.dataStatus === "unavailable"
    || expiresAt <= input.now;
  const status: SignalStatus = dataExpired ? "stale_data" : "ready";

  return {
    ...base,
    direction: status === "ready" ? direction : "NEUTRAL",
    summary: status === "stale_data"
      ? "Sinyal ditahan karena data tidak lagi mutakhir."
      : direction === "BUY"
        ? "Tiga konfirmasi rule-based searah bullish."
        : direction === "SELL"
          ? "Tiga konfirmasi rule-based searah bearish."
          : "Konfirmasi indikator bercampur; belum ada sinyal BUY atau SELL.",
    components,
    alignment: { aligned, total: 3 },
    status,
  };
}
