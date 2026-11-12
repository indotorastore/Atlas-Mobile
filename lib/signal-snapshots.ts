import { SIGNAL_RULE_VERSION, type Signal } from "./signal";
import type { Candle } from "./technical-analysis";

export const signalSnapshotsStorageKey = "atlas-signal-snapshots-v1";
export const maxSignalSnapshots = 40;

export type SignalSnapshot = {
  id: string;
  ruleVersion: string;
  savedAt: number;
  signal: Signal;
  candles: Candle[];
};

export function createSignalSnapshot(signal: Signal, candles: Candle[], savedAt: number): SignalSnapshot | null {
  const latest = candles.at(-1);
  if (!latest || !signal.inputTimestamp) return null;
  return {
    id: `${signal.symbol}:${signal.timeframe}:${latest.time}:${SIGNAL_RULE_VERSION}`,
    ruleVersion: SIGNAL_RULE_VERSION,
    savedAt,
    signal,
    candles: candles.map((candle) => ({ ...candle })),
  };
}

export function saveSignalSnapshot(snapshots: SignalSnapshot[], next: SignalSnapshot): SignalSnapshot[] {
  return [
    next,
    ...snapshots.filter((snapshot) => snapshot.id !== next.id),
  ].slice(0, maxSignalSnapshots);
}

export function parseSignalSnapshots(serialized: string): SignalSnapshot[] {
  const value: unknown = JSON.parse(serialized);
  if (!Array.isArray(value)) throw new Error("Format riwayat sinyal tidak valid.");
  const isSnapshot = (item: unknown): item is SignalSnapshot => {
    if (!item || typeof item !== "object") return false;
    const snapshot = item as Partial<SignalSnapshot>;
    const signal = snapshot.signal;
    return typeof snapshot.id === "string"
      && typeof snapshot.ruleVersion === "string"
      && typeof snapshot.savedAt === "number" && Number.isFinite(snapshot.savedAt)
      && Boolean(signal && typeof signal === "object"
        && typeof signal.symbol === "string"
        && typeof signal.timeframe === "string"
        && ["BUY", "SELL", "NEUTRAL"].includes(signal.direction)
        && typeof signal.generatedAt === "number"
        && typeof signal.source === "string")
      && Array.isArray(snapshot.candles)
      && snapshot.candles.every((candle) =>
        candle && typeof candle === "object"
        && ["time", "open", "high", "low", "close", "volume"].every((key) =>
          typeof (candle as Record<string, unknown>)[key] === "number"),
        );
  };
  if (!value.every(isSnapshot)) throw new Error("Riwayat berisi snapshot dengan format tidak valid.");
  return value;
}
