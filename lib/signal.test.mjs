import assert from "node:assert/strict";
import test from "node:test";
import backtestModule from "../node_modules/.cache/atlas-signal-tests/backtest.js";
import candleQualityModule from "../node_modules/.cache/atlas-signal-tests/candle-quality.js";
import signalModule from "../node_modules/.cache/atlas-signal-tests/signal.js";
import snapshotsModule from "../node_modules/.cache/atlas-signal-tests/signal-snapshots.js";

const { generateSignal } = signalModule;
const { generateBacktestSignalAtIndex, runBacktest } = backtestModule;
const { validateCandles } = candleQualityModule;
const { createSignalSnapshot, parseSignalSnapshots, saveSignalSnapshot } = snapshotsModule;

const bullishAnalysis = {
  ema20: 110,
  ema50: 100,
  rsi14: 60,
  macdHistogram: 2,
  atr14: 3,
  support: 95,
  resistance: 115,
  trend: "Bullish",
};

function makeInput(overrides = {}) {
  return {
    symbol: "BTCUSD",
    timeframe: "1H",
    source: "Binance Spot API",
    analysis: bullishAnalysis,
    candleCount: 100,
    latestClose: 112,
    latestCandleTime: 1_000,
    inputTimestamp: 1_000_000,
    dataStatus: "live",
    volumes: Array.from({ length: 20 }, () => 10),
    now: 1_000_000,
    ...overrides,
  };
}

test("generates BUY only when all three rule components agree", () => {
  const signal = generateSignal(makeInput());

  assert.equal(signal.direction, "BUY");
  assert.equal(signal.alignment.aligned, 3);
  assert.equal(signal.status, "ready");
  assert.equal(signal.expiresAt, 4_600_000);
});

test("keeps conflicting or neutral components at NEUTRAL", () => {
  const signal = generateSignal(makeInput({
    analysis: { ...bullishAnalysis, rsi14: 50 },
  }));

  assert.equal(signal.direction, "NEUTRAL");
  assert.equal(signal.alignment.aligned, 2);
  assert.match(signal.summary, /bercampur/);
});

test("generates SELL when all three rule components agree bearish", () => {
  const signal = generateSignal(makeInput({
    analysis: {
      ...bullishAnalysis,
      trend: "Bearish",
      rsi14: 40,
      macdHistogram: -2,
    },
  }));

  assert.equal(signal.direction, "SELL");
});

test("does not produce a directional signal from stale or expired data", () => {
  const stale = generateSignal(makeInput({ dataStatus: "stale" }));
  const expired = generateSignal(makeInput({ now: 4_600_000 }));

  assert.equal(stale.direction, "NEUTRAL");
  assert.equal(stale.status, "stale_data");
  assert.equal(expired.direction, "NEUTRAL");
  assert.equal(expired.status, "stale_data");
});

test("does not produce a signal with insufficient candles or invalid indicators", () => {
  const tooFew = generateSignal(makeInput({ candleCount: 49 }));
  const invalid = generateSignal(makeInput({
    analysis: { ...bullishAnalysis, rsi14: Number.NaN },
  }));
  const poorQuality = generateSignal(makeInput({ dataQualityValid: false }));

  assert.equal(tooFew.status, "insufficient_data");
  assert.equal(tooFew.direction, "NEUTRAL");
  assert.equal(invalid.status, "insufficient_data");
  assert.equal(poorQuality.status, "invalid_data");
  assert.equal(poorQuality.direction, "NEUTRAL");
});

test("reports volume comparison when available and unavailable when absent", () => {
  const higherVolume = generateSignal(makeInput({
    volumes: [...Array.from({ length: 15 }, () => 10), ...Array.from({ length: 5 }, () => 20)],
  }));
  const noVolume = generateSignal(makeInput({ volumes: Array.from({ length: 20 }, () => 0) }));

  assert.equal(higherVolume.volume.comparison, "higher");
  assert.equal(noVolume.volume.available, false);
  assert.equal(noVolume.volume.comparison, "unavailable");
});

test("flags candle gaps and invalid OHLC values", () => {
  const nowMs = Math.floor(Date.now() / 3_600_000) * 3_600_000;
  const now = nowMs / 1_000;
  const candles = Array.from({ length: 4 }, (_, index) => ({
    time: now - 4 * 3_600 + index * 3_600,
    open: 100,
    high: 102,
    low: 99,
    close: 101,
    volume: 5,
  }));
  const gap = validateCandles([candles[0], candles[1], candles[3]], "1H", { now: nowMs });
  const invalid = validateCandles([{ ...candles[0], high: 98 }, ...candles.slice(1)], "1H", { now: nowMs });

  assert.equal(gap.valid, false);
  assert.equal(gap.gaps, 1);
  assert.equal(invalid.valid, false);
  assert.match(invalid.issues.join(" "), /OHLCV/);
});

test("flags stale candle history and reports tolerated FIX gaps", () => {
  const step = 3_600;
  const nowMs = Math.floor(Date.now() / (step * 1_000)) * (step * 1_000);
  const now = nowMs / 1_000;
  const candles = [0, 1, 3].map((index) => ({
    time: now - 4 * step + index * step,
    open: 100,
    high: 102,
    low: 99,
    close: 101,
    volume: 5,
  }));
  const stale = validateCandles(candles.map((candle) => ({ ...candle, time: candle.time - 10 * step })), "1H", { now: nowMs });
  const fixGaps = validateCandles(candles, "1H", { now: nowMs, allowGaps: true });

  assert.equal(stale.valid, false);
  assert.match(stale.issues.join(" "), /terlalu lama/);
  assert.equal(fixGaps.valid, true);
  assert.equal(fixGaps.gaps, 1);
});

test("backtest uses shared rules, non-overlapping trades, and explicit costs", () => {
  const step = 3_600;
  const now = Math.floor(Date.now() / (step * 1_000)) * step;
  let previousClose = 100;
  const candles = Array.from({ length: 90 }, (_, index) => {
    const open = previousClose;
    const close = previousClose + (index % 2 === 0 ? 1 : -0.6);
    previousClose = close;
    return {
      time: now - 90 * step + index * step,
      open,
      high: Math.max(open, close) + 0.2,
      low: Math.min(open, close) - 0.2,
      close,
      volume: 100,
    };
  });
  const result = runBacktest("BTCUSD", "1H", candles);

  assert.ok(result.sampleSize > 0);
  assert.equal(result.ruleVersion, "atlas-consensus-v1");
  assert.equal(result.assumptions.holdingBars, 5);
  assert.equal(result.assumptions.feePerSidePct, 0.1);
  assert.equal(result.assumptions.slippagePerSidePct, 0.05);
  assert.equal(result.candleCount, candles.length);
  assert.equal(typeof result.totalNetReturnPct, "number");
  assert.throws(() => runBacktest("BTCUSD", "1H", candles.filter((_, index) => index !== 70)), /candle timeframe yang hilang/);

  const changedFuture = candles.map((candle, index) => index > 60
    ? { ...candle, open: candle.open * 4, high: candle.high * 4, low: candle.low * 4, close: candle.close * 4 }
    : candle);
  assert.deepEqual(
    generateBacktestSignalAtIndex("BTCUSD", "1H", candles, 60),
    generateBacktestSignalAtIndex("BTCUSD", "1H", changedFuture, 60),
  );
});

test("retains reproducible signal snapshots with exact candles and rule version", () => {
  const candles = [{ time: 1_000, open: 100, high: 102, low: 99, close: 101, volume: 4 }];
  const signal = generateSignal(makeInput());
  const snapshot = createSignalSnapshot(signal, candles, 2_000);
  const snapshots = saveSignalSnapshot([], snapshot);
  const parsed = parseSignalSnapshots(JSON.stringify(snapshots));

  assert.equal(parsed[0].ruleVersion, "atlas-consensus-v1");
  assert.deepEqual(parsed[0].candles, candles);
  assert.equal(parsed[0].signal.direction, "BUY");
  assert.equal(saveSignalSnapshot(snapshots, { ...snapshot, savedAt: 3_000 }).length, 1);
});

test("rejects malformed saved signal snapshots", () => {
  assert.throws(() => parseSignalSnapshots(JSON.stringify([{ id: "broken" }])), /format tidak valid/);
});
