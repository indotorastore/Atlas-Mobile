"use client";

import Image from "next/image";
import {
  CandlestickSeries,
  ColorType,
  createChart,
  HistogramSeries,
  LineSeries,
  type IChartApi,
  type ISeriesApi,
  type UTCTimestamp,
} from "lightweight-charts";
import { DrawingManager, type DrawingKind } from "lightweight-charts-drawing";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

type Candle = {
  time: UTCTimestamp;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};
type Instrument = {
  symbol: string;
  name: string;
  price: number;
  change: number;
  changePct: number;
  decimals: number;
};
type TechnicalAnalysis = {
  ema20: number;
  ema50: number;
  rsi14: number;
  macd: number;
  macdSignal: number;
  macdHistogram: number;
  atr14: number;
  support: number;
  resistance: number;
  trend: "Bullish" | "Bearish" | "Neutral";
  bias: "Bullish" | "Bearish" | "Neutral";
};
type MarketData = {
  symbol: string;
  timeframe: Timeframe;
  fetchedAt: number;
  currentPrice: number;
  change: number;
  changePct: number;
  candles: Candle[];
  bids: { price: number; quantity: number }[];
  asks: { price: number; quantity: number }[];
  trades: { price: number; quantity: number; buyerIsMaker: boolean; time: number }[];
};
type PriceAlert = {
  id: string;
  symbol: string;
  direction: "above" | "below";
  target: number;
  triggered: boolean;
};
type FxProQuote = { bid: number; ask: number };
type MacroData = {
  country: string;
  source: string;
  data: { id: string; label: string; unit: string; frequency: string; year: string | null; value: number | null }[];
};

const initialInstruments: Instrument[] = [
  { symbol: "BTCUSD", name: "Bitcoin / U.S. Dollar", price: 67482.4, change: 842.6, changePct: 1.26, decimals: 2 },
  { symbol: "ETHUSD", name: "Ethereum / U.S. Dollar", price: 3521.18, change: 28.44, changePct: 0.81, decimals: 2 },
  { symbol: "EURUSD", name: "Euro / U.S. Dollar", price: 1.08426, change: -0.00118, changePct: -0.11, decimals: 5 },
  { symbol: "XAUUSD", name: "Gold / U.S. Dollar", price: 2384.72, change: 13.26, changePct: 0.56, decimals: 2 },
  { symbol: "AAPL", name: "Apple Inc.", price: 213.07, change: 1.94, changePct: 0.92, decimals: 2 },
  { symbol: "NVDA", name: "NVIDIA Corporation", price: 140.11, change: -2.36, changePct: -1.66, decimals: 2 },
  { symbol: "SOLUSD", name: "Solana / U.S. Dollar", price: 181.46, change: 5.82, changePct: 3.31, decimals: 2 },
];

const timeframeOptions = ["1m", "5m", "15m", "1H", "4H", "1D"] as const;
type Timeframe = (typeof timeframeOptions)[number];
const drawingTools: { label: string; kind: DrawingKind }[] = [
  { label: "Trend line", kind: "trend-line" },
  { label: "Horizontal line", kind: "horizontal-line" },
  { label: "Horizontal ray", kind: "horizontal-ray" },
  { label: "Fib retracement", kind: "fib-retracement" },
  { label: "Rectangle", kind: "rectangle" },
];
const stepByTimeframe: Record<Timeframe, number> = {
  "1m": 60,
  "5m": 300,
  "15m": 900,
  "1H": 3600,
  "4H": 14400,
  "1D": 86400,
};
const liveSymbols: Record<string, string> = { BTCUSD: "BTCUSDT", ETHUSD: "ETHUSDT", SOLUSD: "SOLUSDT" };
const money = (value: number, digits = 2) =>
  new Intl.NumberFormat("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(value);

function makeCandles(instrument: Instrument, timeframe: Timeframe): Candle[] {
  const data: Candle[] = [];
  const now = Math.floor(Date.now() / 1000);
  const step = stepByTimeframe[timeframe];
  const seed = [...instrument.symbol].reduce((total, char) => total + char.charCodeAt(0), 0);
  let close = instrument.price * (1 - instrument.changePct / 100 * 0.34);
  for (let i = 119; i >= 0; i--) {
    const index = 120 - i;
    const wave = Math.sin((index + seed) * 0.21) * 0.0018 + Math.cos((index + seed) * 0.071) * 0.0012;
    const drift = (index / 120 - 0.5) * instrument.changePct / 100 * 0.85;
    const open = close;
    close = open * (1 + wave + drift / 120);
    const wick = instrument.price * (0.0006 + ((index * 7 + seed) % 9) * 0.00012);
    data.push({
      time: (Math.floor(now / step) * step - i * step) as UTCTimestamp,
      open,
      close,
      high: Math.max(open, close) + wick * (0.55 + (index % 3) * 0.2),
      low: Math.min(open, close) - wick * (0.5 + (index % 4) * 0.15),
      volume: 50 + ((index * 97 + seed * 13) % 500) + Math.abs(wave) * 12000,
    });
  }
  const last = data[data.length - 1];
  const target = instrument.price;
  const adjustment = target - last.close;
  return data.map((candle, index) => ({
    ...candle,
    open: candle.open + adjustment * (index / (data.length - 1)),
    close: candle.close + adjustment * (index / (data.length - 1)),
    high: candle.high + adjustment * (index / (data.length - 1)),
    low: candle.low + adjustment * (index / (data.length - 1)),
  }));
}

function ema(values: number[], period: number): number[] {
  if (values.length === 0) return [];
  const multiplier = 2 / (period + 1);
  return values.map((value, index) =>
    index === 0 ? value : value * multiplier + values[index - 1] * (1 - multiplier),
  );
}

function calculateAnalysis(candles: Candle[]): TechnicalAnalysis {
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

function calculateVolumeProfile(candles: Candle[], bucketCount = 12) {
  if (candles.length === 0) return [];
  const low = Math.min(...candles.map((candle) => candle.low));
  const high = Math.max(...candles.map((candle) => candle.high));
  const step = (high - low) / bucketCount || Math.max(high * 0.0001, Number.EPSILON);
  const buckets = Array.from({ length: bucketCount }, (_, index) => ({
    price: low + step * (index + 0.5),
    volume: 0,
  }));

  for (const candle of candles) {
    const first = Math.max(0, Math.min(bucketCount - 1, Math.floor((candle.low - low) / step)));
    const last = Math.max(0, Math.min(bucketCount - 1, Math.floor((candle.high - low) / step)));
    const share = candle.volume / (last - first + 1);
    for (let index = first; index <= last; index++) buckets[index].volume += share;
  }
  return buckets;
}

function findOrderBlocks(candles: Candle[]) {
  const averageBody = candles.slice(-30).reduce((sum, candle) => sum + Math.abs(candle.close - candle.open), 0) / Math.max(1, Math.min(30, candles.length));
  const blocks: { direction: "Bullish" | "Bearish"; low: number; high: number; time: number }[] = [];

  for (let index = Math.max(1, candles.length - 80); index < candles.length; index++) {
    const impulse = candles[index];
    if (Math.abs(impulse.close - impulse.open) < averageBody * 1.8) continue;
    const bullish = impulse.close > impulse.open;
    for (let prior = index - 1; prior >= Math.max(0, index - 4); prior--) {
      const candle = candles[prior];
      if ((bullish && candle.close < candle.open) || (!bullish && candle.close > candle.open)) {
        blocks.push({ direction: bullish ? "Bullish" : "Bearish", low: candle.low, high: candle.high, time: candle.time as number });
        break;
      }
    }
  }
  return blocks.slice(-5).reverse();
}

function groupFootprintTrades(trades: MarketData["trades"], decimals: number) {
  const levels = new Map<string, { price: number; buy: number; sell: number }>();
  for (const trade of trades) {
    const key = trade.price.toFixed(decimals);
    const level = levels.get(key) ?? { price: trade.price, buy: 0, sell: 0 };
    if (trade.buyerIsMaker) level.sell += trade.quantity;
    else level.buy += trade.quantity;
    levels.set(key, level);
  }
  return [...levels.values()].sort((a, b) => b.price - a.price).slice(0, 12);
}

const tradingViewIntervals: Record<Timeframe, string> = {
  "1m": "1",
  "5m": "5",
  "15m": "15",
  "1H": "60",
  "4H": "240",
  "1D": "D",
};

function TradingViewChart({ timeframe }: { timeframe: Timeframe }) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const widgetContainer = document.createElement("div");
    widgetContainer.className = "tradingview-widget-container";
    const widget = document.createElement("div");
    widget.className = "tradingview-widget-container__widget";
    const script = document.createElement("script");
    script.type = "text/javascript";
    script.async = true;
    script.src = "https://s3.tradingview.com/external-embedding/embed-widget-advanced-chart.js";
    script.textContent = JSON.stringify({
      autosize: true,
      symbol: "FX_IDC:XAUUSD",
      interval: tradingViewIntervals[timeframe],
      timezone: "Etc/UTC",
      theme: "dark",
      style: "1",
      locale: "en",
      allow_symbol_change: false,
      calendar: false,
      support_host: "https://www.tradingview.com",
    });
    widgetContainer.append(widget, script);
    container.replaceChildren(widgetContainer);

    return () => container.replaceChildren();
  }, [timeframe]);

  return <div className="tradingview-chart-host" ref={containerRef} />;
}

function MarketChart({
  candles,
  showVolume,
  showEma,
  drawingTool,
  symbol,
  onChartReady,
}: {
  candles: Candle[];
  showVolume: boolean;
  showEma: boolean;
  drawingTool: DrawingKind | null;
  symbol: string;
  onChartReady: (chart: IChartApi | null) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const seriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const volumeRef = useRef<ISeriesApi<"Histogram"> | null>(null);
  const emaRef = useRef<ISeriesApi<"Line"> | null>(null);
  const drawingManagerRef = useRef<DrawingManager | null>(null);
  const restoringDrawingsRef = useRef(false);
  const drawingSaveTimerRef = useRef<number | null>(null);
  const initialChartRangeSetRef = useRef(false);

  useEffect(() => {
    if (!containerRef.current) return;
    initialChartRangeSetRef.current = false;
    const chart = createChart(containerRef.current, {
      autoSize: true,
      layout: {
        background: { type: ColorType.Solid, color: "#0b1017" },
        textColor: "#7f8b9c",
        fontFamily: "Arial, sans-serif",
        fontSize: 11,
        attributionLogo: true,
      },
      grid: {
        vertLines: { color: "rgba(255,255,255,0.035)" },
        horzLines: { color: "rgba(255,255,255,0.045)" },
      },
      rightPriceScale: { borderColor: "rgba(255,255,255,0.09)" },
      timeScale: { borderColor: "rgba(255,255,255,0.09)", timeVisible: true, secondsVisible: false, barSpacing: 10, rightOffset: 4 },
      crosshair: { vertLine: { color: "rgba(138,160,190,0.35)", labelBackgroundColor: "#202b39" }, horzLine: { color: "rgba(138,160,190,0.35)", labelBackgroundColor: "#202b39" } },
      localization: { priceFormatter: (price: number) => price >= 100 ? price.toLocaleString("en-US", { maximumFractionDigits: 2 }) : price.toFixed(5) },
    });
    chartRef.current = chart;
    onChartReady(chart);
    const candlesSeries = chart.addSeries(CandlestickSeries, {
      upColor: "#20c997",
      downColor: "#f05b6b",
      borderUpColor: "#20c997",
      borderDownColor: "#f05b6b",
      wickUpColor: "#20c997",
      wickDownColor: "#f05b6b",
      wickVisible: true,
      borderVisible: true,
      priceLineColor: "#8291a6",
      priceLineStyle: 2,
    });
    const volumeSeries = chart.addSeries(HistogramSeries, {
      priceScaleId: "volume",
      priceFormat: { type: "volume" },
      lastValueVisible: false,
      priceLineVisible: false,
    });
    chart.priceScale("volume").applyOptions({ scaleMargins: { top: 0.83, bottom: 0 } });
    const emaSeries = chart.addSeries(LineSeries, {
      color: "#d6a84f",
      lineWidth: 2,
      priceLineVisible: false,
      lastValueVisible: false,
      crosshairMarkerVisible: false,
    });
    seriesRef.current = candlesSeries;
    volumeRef.current = volumeSeries;
    emaRef.current = emaSeries;
    const drawingManager = new DrawingManager(chart, candlesSeries, { magnet: "weak" });
    drawingManagerRef.current = drawingManager;
    const saveDrawings = () => {
      if (drawingSaveTimerRef.current !== null) {
        window.clearTimeout(drawingSaveTimerRef.current);
        drawingSaveTimerRef.current = null;
      }
      if (!restoringDrawingsRef.current) {
        localStorage.setItem(`marketdesk-drawings-${symbol}`, drawingManager.exportJSON());
      }
    };
    const scheduleSave = () => {
      if (restoringDrawingsRef.current) return;
      if (drawingSaveTimerRef.current !== null) window.clearTimeout(drawingSaveTimerRef.current);
      drawingSaveTimerRef.current = window.setTimeout(saveDrawings, 250);
    };
    const unsubscribeChange = drawingManager.on("change", scheduleSave);
    const unsubscribeGestureEnd = drawingManager.on("gestureEnd", saveDrawings);
    const savedDrawings = localStorage.getItem(`marketdesk-drawings-${symbol}`);
    if (savedDrawings) {
      restoringDrawingsRef.current = true;
      try {
        drawingManager.importJSON(savedDrawings);
      } finally {
        restoringDrawingsRef.current = false;
      }
    }
    return () => {
      if (drawingSaveTimerRef.current !== null) saveDrawings();
      unsubscribeChange();
      unsubscribeGestureEnd();
      drawingManager.destroy();
      drawingManagerRef.current = null;
      onChartReady(null);
      chart.remove();
      chartRef.current = null;
    };
  }, [onChartReady, symbol]);

  useEffect(() => {
    const candlesSeries = seriesRef.current;
    const volumeSeries = volumeRef.current;
    const emaSeries = emaRef.current;
    if (!candlesSeries || !volumeSeries || !emaSeries || candles.length === 0) return;
    candlesSeries.setData(candles.map((candle) => ({
      time: candle.time,
      open: candle.open,
      high: candle.high,
      low: candle.low,
      close: candle.close,
    })));
    volumeSeries.setData(candles.map((candle) => ({
      time: candle.time,
      value: candle.volume,
      color: candle.close >= candle.open ? "rgba(32,201,151,0.25)" : "rgba(240,91,107,0.25)",
    })));
    const emaValues = ema(candles.map((candle) => candle.close), 20);
    emaSeries.setData(candles.map((candle, index) => index >= 19
      ? { time: candle.time, value: emaValues[index] }
      : null).filter((point): point is { time: UTCTimestamp; value: number } => point !== null));
    volumeSeries.applyOptions({ visible: showVolume });
    emaSeries.applyOptions({ visible: showEma });
    if (!initialChartRangeSetRef.current) {
      chartRef.current?.timeScale().setVisibleLogicalRange({
        from: Math.max(0, candles.length - 55),
        to: candles.length + 4,
      });
      initialChartRangeSetRef.current = true;
    }
  }, [candles, showEma, showVolume]);

  useEffect(() => {
    drawingManagerRef.current?.setTool(drawingTool);
  }, [drawingTool, symbol]);

  return <div className="chart-canvas" ref={containerRef} />;
}

function Icon({ name, size = 18 }: { name: string; size?: number }) {
  const common = { width: size, height: size, viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.8, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  const paths: Record<string, React.ReactNode> = {
    chart: <><path d="M3 3v18h18" /><path d="m19 9-5 5-4-4-3 3" /></>,
    search: <><circle cx="11" cy="11" r="7" /><path d="m20 20-4-4" /></>,
    plus: <><path d="M12 5v14M5 12h14" /></>,
    bell: <><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9" /><path d="M10 21h4" /></>,
    settings: <><circle cx="12" cy="12" r="3" /><path d="m19.4 15 .1.1 1.4 1.1-1.4 2.4-1.7-.7a8 8 0 0 1-1.7 1l-.3 1.8h-2.8l-.3-1.8a8 8 0 0 1-1.7-1l-1.7.7-1.4-2.4 1.4-1.1a7 7 0 0 1 0-2l-1.4-1.1 1.4-2.4 1.7.7a8 8 0 0 1 1.7-1l.3-1.8h2.8l.3 1.8a8 8 0 0 1 1.7 1l1.7-.7 1.4 2.4-1.4 1.1a7 7 0 0 1 0 2Z" /></>,
    eye: <><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" /><circle cx="12" cy="12" r="3" /></>,
    close: <><path d="m18 6-12 12M6 6l12 12" /></>,
    menu: <><path d="M4 6h16M4 12h16M4 18h16" /></>,
    arrow: <><path d="M5 12h14M13 6l6 6-6 6" /></>,
    "panel-left": <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M9 4v16" /></>,
    "panel-right": <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M15 4v16" /></>,
  };
  return <svg {...common} aria-hidden="true">{paths[name] ?? paths.chart}</svg>;
}

export default function MarketApp() {
  const [instruments, setInstruments] = useState(initialInstruments);
  const [activeSymbol, setActiveSymbol] = useState("BTCUSD");
  const [timeframe, setTimeframe] = useState<Timeframe>("1H");
  const [search, setSearch] = useState("");
  const [showWatchlist, setShowWatchlist] = useState(true);
  const [showAccount, setShowAccount] = useState(true);
  const [showVolume, setShowVolume] = useState(true);
  const [showEma, setShowEma] = useState(true);
  const [drawingTool, setDrawingTool] = useState<DrawingKind | null>(null);
  const [geminiAnalysis, setGeminiAnalysis] = useState("");
  const [geminiError, setGeminiError] = useState("");
  const [isGeminiLoading, setIsGeminiLoading] = useState(false);
  const [marketData, setMarketData] = useState<MarketData | null>(null);
  const [fxProCandles, setFxProCandles] = useState<Candle[]>([]);
  const [marketDataError, setMarketDataError] = useState("");
  const [isMarketDataLoading, setIsMarketDataLoading] = useState(false);
  const [liveConnection, setLiveConnection] = useState<"connecting" | "live" | "reconnecting" | "demo">("demo");
  const [lastTickAt, setLastTickAt] = useState<number | null>(null);
  const [fxProQuote, setFxProQuote] = useState<FxProQuote | null>(null);
  const [macroData, setMacroData] = useState<MacroData | null>(null);
  const [macroError, setMacroError] = useState("");
  const [alerts, setAlerts] = useState<PriceAlert[]>([]);
  const [alertsReady, setAlertsReady] = useState(false);
  const [alertsError, setAlertsError] = useState("");
  const [alertTarget, setAlertTarget] = useState("");
  const [alertDirection, setAlertDirection] = useState<PriceAlert["direction"]>("above");
  const [marketPanel, setMarketPanel] = useState<"order-block" | "dom" | "profile" | "footprint">("dom");
  const chartApiRef = useRef<IChartApi | null>(null);
  const geminiRequestIdRef = useRef(0);
  const liveBaselineRef = useRef(0);
  const fxProReferencePriceRef = useRef<number | null>(null);
  const instrument = instruments.find((item) => item.symbol === activeSymbol) ?? instruments[0];
  const activeMarketData = marketData?.symbol === activeSymbol && marketData.timeframe === timeframe ? marketData : null;
  const candles = useMemo(
    () => activeMarketData?.candles ?? (activeSymbol === "XAUUSD" && fxProCandles.length > 0
      ? fxProCandles
      : makeCandles(instrument, timeframe)),
    [activeMarketData, activeSymbol, fxProCandles, instrument, timeframe],
  );
  const analysis = useMemo(() => calculateAnalysis(candles), [candles]);
  const volumeProfile = useMemo(() => calculateVolumeProfile(candles), [candles]);
  const orderBlocks = useMemo(() => findOrderBlocks(candles), [candles]);
  const footprint = useMemo(
    () => groupFootprintTrades(activeMarketData?.trades ?? [], instrument.decimals),
    [activeMarketData, instrument.decimals],
  );
  const isBinanceLive = Boolean(activeMarketData && liveSymbols[activeSymbol] && liveConnection === "live" && lastTickAt !== null);
  const isFxProLive = activeSymbol === "XAUUSD" && liveConnection === "live" && lastTickAt !== null;
  const profilePeak = Math.max(1, ...volumeProfile.map((level) => level.volume));
  const currentAlerts = alerts.filter((alert) => alert.symbol === activeSymbol);
  const filteredInstruments = instruments.filter((item) =>
    `${item.symbol} ${item.name}`.toLowerCase().includes(search.toLowerCase()),
  );
  const onChartReady = useCallback((chart: IChartApi | null) => {
    chartApiRef.current = chart;
  }, []);

  useEffect(() => {
    if (window.matchMedia("(max-width: 760px)").matches) setShowWatchlist(false);
  }, []);

  useEffect(() => {
    if (!liveSymbols[activeSymbol]) {
      setMarketData(null);
      if (activeSymbol !== "XAUUSD") setMarketDataError("");
      setIsMarketDataLoading(false);
      return;
    }

    let active = true;
    let controller: AbortController | null = null;
    const loadMarketData = async () => {
      controller?.abort();
      controller = new AbortController();
      setIsMarketDataLoading(true);
      try {
        const response = await fetch(
          `/api/market-data?symbol=${encodeURIComponent(activeSymbol)}&timeframe=${encodeURIComponent(timeframe)}`,
          { signal: controller.signal, cache: "no-store" },
        );
        const result: unknown = await response.json();
        if (!result || typeof result !== "object") throw new Error("Respons data market tidak valid.");
        const data = result as MarketData & { error?: string };
        if (!response.ok) throw new Error(data.error ?? "Data live tidak tersedia.");
        if (!Array.isArray(data.candles) || !Array.isArray(data.bids) || !Array.isArray(data.asks) || !Array.isArray(data.trades)) {
          throw new Error("Struktur data market tidak valid.");
        }
        if (!active) return;
        const liveData = { ...data, timeframe };
        setMarketData(liveData);
        setMarketDataError("");
        liveBaselineRef.current = data.currentPrice - data.change;
        setInstruments((current) => current.map((item) => item.symbol === activeSymbol
          ? { ...item, price: data.currentPrice, change: data.change, changePct: data.changePct }
          : item));
      } catch (error) {
        if (!active || (error instanceof Error && error.name === "AbortError")) return;
        setMarketDataError(error instanceof Error ? error.message : "Tidak dapat memuat data live.");
      } finally {
        if (active) setIsMarketDataLoading(false);
      }
    };

    void loadMarketData();
    const intervalId = window.setInterval(() => void loadMarketData(), 15_000);
    return () => {
      active = false;
      controller?.abort();
      window.clearInterval(intervalId);
    };
  }, [activeSymbol, timeframe]);

  useEffect(() => {
    const exchangeSymbol = liveSymbols[activeSymbol];
    const isFxProSymbol = activeSymbol === "XAUUSD";
    if (!exchangeSymbol && !isFxProSymbol) {
      setLiveConnection("demo");
      setLastTickAt(null);
      setFxProQuote(null);
      return;
    }

    let active = true;
    let socket: WebSocket | null = null;
    let reconnectTimer: number | null = null;
    let connectTimer: number | null = null;
    let inactivityTimer: number | null = null;
    let updateFrame: number | null = null;
    let retryCount = 0;
    let pendingTrade: { price: number; quantity: number; time: number } | null = null;
    setLastTickAt(null);
    setFxProQuote(null);
    setMarketDataError("");
    setFxProCandles([]);
    fxProReferencePriceRef.current = null;

    const resetInactivityTimer = (currentSocket: WebSocket) => {
      if (inactivityTimer !== null) window.clearTimeout(inactivityTimer);
      inactivityTimer = window.setTimeout(() => {
        if (active && currentSocket.readyState === WebSocket.OPEN) {
          setLiveConnection("reconnecting");
          currentSocket.close();
        }
      }, 30_000);
    };

    const scheduleReconnect = () => {
      if (!active || reconnectTimer !== null) return;
      retryCount += 1;
      setLiveConnection("reconnecting");
      const delay = Math.min(1_000 * 2 ** Math.min(retryCount - 1, 5), 30_000);
      reconnectTimer = window.setTimeout(() => {
        reconnectTimer = null;
        connect();
      }, delay);
    };

    const connectFxPro = () => {
      const source = new EventSource("/api/fxpro-xau");
      source.addEventListener("status", (event) => {
        if (!active) return;
        try {
          const data = JSON.parse((event as MessageEvent<string>).data) as { state?: unknown };
          if (data.state === "connecting" || data.state === "reconnecting") {
            setLiveConnection(data.state);
          } else if (data.state === "live") {
            setLiveConnection("connecting");
          }
        } catch {
          setMarketDataError("Status koneksi FxPro FIX tidak valid.");
        }
      });
      source.addEventListener("quote", (event) => {
        if (!active) return;
        let quote: { bid?: unknown; ask?: unknown; price?: unknown; timestamp?: unknown };
        try {
          quote = JSON.parse((event as MessageEvent<string>).data);
        } catch {
          return;
        }
        const price = Number(quote.price);
        const bid = Number(quote.bid);
        const ask = Number(quote.ask);
        const tickTime = Number(quote.timestamp);
        if (!Number.isFinite(price) || price <= 0
          || !Number.isFinite(bid) || bid <= 0
          || !Number.isFinite(ask) || ask <= 0
          || ask < bid
          || !Number.isFinite(tickTime) || tickTime <= 0) return;
        const referencePrice = fxProReferencePriceRef.current ?? price;
        fxProReferencePriceRef.current = referencePrice;

        setLiveConnection("live");
        setMarketDataError("");
        setLastTickAt(tickTime);
        setFxProQuote({ bid, ask });
        setFxProCandles((current) => {
          const bucket = Math.floor(tickTime / 1_000 / stepByTimeframe[timeframe]) * stepByTimeframe[timeframe];
          const last = current[current.length - 1];
          if (last && bucket < (last.time as number)) return current;
          if (last && bucket === (last.time as number)) {
            return [...current.slice(0, -1), {
              ...last,
              high: Math.max(last.high, price),
              low: Math.min(last.low, price),
              close: price,
            }];
          }
          const open = price;
          return [...current, {
            time: bucket as UTCTimestamp,
            open,
            high: Math.max(open, price),
            low: Math.min(open, price),
            close: price,
            volume: 0,
          }].slice(-120);
        });
        setInstruments((current) => current.map((item) => item.symbol === "XAUUSD"
          ? {
            ...item,
            price,
            change: price - referencePrice,
            changePct: (price - referencePrice) / referencePrice * 100,
          }
          : item));
      });
      source.addEventListener("feed-error", (event) => {
        if (!active) return;
        try {
          const data = JSON.parse((event as MessageEvent<string>).data) as { message?: unknown };
          setMarketDataError(typeof data.message === "string" ? data.message : "FxPro FIX tidak tersedia.");
        } catch {
          setMarketDataError("FxPro FIX tidak tersedia.");
        }
        setLiveConnection("demo");
        setLastTickAt(null);
        setFxProQuote(null);
        source.close();
      });
      source.onerror = () => {
        if (active && source.readyState !== EventSource.CLOSED) {
          setLiveConnection("reconnecting");
          setMarketDataError("Koneksi FxPro FIX terputus; mencoba kembali.");
        }
      };
      return source;
    };

    const connect = () => {
      if (!active) return;
      setLiveConnection(retryCount === 0 ? "connecting" : "reconnecting");
      if (!exchangeSymbol) return;
      socket = new WebSocket(`wss://stream.binance.com:9443/ws/${exchangeSymbol.toLowerCase()}@trade`);
      const currentSocket = socket;

      connectTimer = window.setTimeout(() => {
        if (currentSocket.readyState === WebSocket.CONNECTING) currentSocket.close();
      }, 10_000);

      currentSocket.onopen = () => {
        if (!active) return;
        if (connectTimer !== null) window.clearTimeout(connectTimer);
        retryCount = 0;
        resetInactivityTimer(currentSocket);
      };

      currentSocket.onmessage = (event) => {
        let payload: unknown;
        try {
          payload = JSON.parse(String(event.data));
        } catch {
          return;
        }
        if (!payload || typeof payload !== "object") return;
        const trade = payload as { e?: unknown; s?: unknown; p?: unknown; q?: unknown; T?: unknown };
        if (trade.e !== "trade" || trade.s !== exchangeSymbol) return;
        const price = Number(trade.p);
        const quantity = Number(trade.q);
        const time = Number(trade.T);
        if (!Number.isFinite(price) || price <= 0 || !Number.isFinite(quantity) || !Number.isFinite(time)) return;
        resetInactivityTimer(currentSocket);
        setLiveConnection("live");
        pendingTrade = {
          price,
          quantity: (pendingTrade?.quantity ?? 0) + quantity,
          time,
        };
        if (updateFrame !== null) return;

        updateFrame = window.requestAnimationFrame(() => {
          updateFrame = null;
          const latestTrade = pendingTrade;
          pendingTrade = null;
          if (!active || !latestTrade) return;
          setLastTickAt(latestTrade.time);

          setMarketData((current) => {
            if (!current || current.symbol !== activeSymbol || current.timeframe !== timeframe) return current;
            const candles = [...current.candles];
            const last = candles[candles.length - 1];
            if (!last) return current;
            const tradeTime = Math.floor(latestTrade.time / 1000 / stepByTimeframe[timeframe]) * stepByTimeframe[timeframe];
            if (tradeTime < (last.time as number)) return { ...current, currentPrice: latestTrade.price };
            if (tradeTime === (last.time as number)) {
              candles[candles.length - 1] = {
                ...last,
                high: Math.max(last.high, latestTrade.price),
                low: Math.min(last.low, latestTrade.price),
                close: latestTrade.price,
                volume: last.volume + latestTrade.quantity,
              };
            } else {
              candles.push({
                time: tradeTime as UTCTimestamp,
                open: last.close,
                high: Math.max(last.close, latestTrade.price),
                low: Math.min(last.close, latestTrade.price),
                close: latestTrade.price,
                volume: latestTrade.quantity,
              });
              if (candles.length > 120) candles.shift();
            }
            return { ...current, currentPrice: latestTrade.price, candles };
          });

          const baseline = liveBaselineRef.current;
          const change = baseline > 0 ? latestTrade.price - baseline : 0;
          const changePct = baseline > 0 ? change / baseline * 100 : 0;
          setInstruments((current) => current.map((item) => item.symbol === activeSymbol
            ? { ...item, price: latestTrade.price, change, changePct }
            : item));
        });
      };

      currentSocket.onerror = () => currentSocket.close();
      currentSocket.onclose = () => {
        if (!active) return;
        if (connectTimer !== null) window.clearTimeout(connectTimer);
        if (inactivityTimer !== null) window.clearTimeout(inactivityTimer);
        scheduleReconnect();
      };
    };

    const fxProSource = isFxProSymbol ? connectFxPro() : null;
    if (isFxProSymbol) setLiveConnection("connecting");
    else connect();
    return () => {
      active = false;
      if (reconnectTimer !== null) window.clearTimeout(reconnectTimer);
      if (connectTimer !== null) window.clearTimeout(connectTimer);
      if (inactivityTimer !== null) window.clearTimeout(inactivityTimer);
      if (updateFrame !== null) window.cancelAnimationFrame(updateFrame);
      socket?.close();
      fxProSource?.close();
    };
  }, [activeSymbol, timeframe]);

  useEffect(() => {
    let active = true;
    fetch("/api/macro")
      .then(async (response) => {
        const result: unknown = await response.json();
        if (!result || typeof result !== "object") throw new Error("Respons data makro tidak valid.");
        const data = result as MacroData & { error?: string };
        if (!response.ok) throw new Error(data.error ?? "Data makro tidak tersedia.");
        if (!Array.isArray(data.data)) throw new Error("Struktur data makro tidak valid.");
        if (active) setMacroData(data);
      })
      .catch((error: unknown) => {
        if (active) setMacroError(error instanceof Error ? error.message : "Tidak dapat memuat data makro.");
      });
    return () => { active = false; };
  }, []);

  useEffect(() => {
    if (activeSymbol === "XAUUSD" && !isFxProLive) return;
    try {
      const saved = localStorage.getItem("marketdesk-price-alerts");
      if (saved) {
        const parsed: unknown = JSON.parse(saved);
        if (Array.isArray(parsed)) {
          setAlerts(parsed.filter((item): item is PriceAlert =>
            item && typeof item === "object"
            && typeof item.id === "string"
            && typeof item.symbol === "string"
            && (item.direction === "above" || item.direction === "below")
            && typeof item.target === "number"
            && Number.isFinite(item.target)
            && typeof item.triggered === "boolean",
          ));
        }
      }
    } catch {
      setAlertsError("Alert tidak dapat dibaca dari penyimpanan browser.");
    } finally {
      setAlertsReady(true);
    }
  }, []);

  useEffect(() => {
    if (!alertsReady) return;
    try {
      localStorage.setItem("marketdesk-price-alerts", JSON.stringify(alerts));
    } catch {
      setAlertsError("Alert hanya tersimpan sementara; penyimpanan browser tidak tersedia.");
    }
  }, [alerts, alertsReady]);

  useEffect(() => {
    if (activeSymbol === "XAUUSD" && !isFxProLive) return;
    const triggered = alerts.filter((alert) =>
      alert.symbol === activeSymbol
      && !alert.triggered
      && (alert.direction === "above" ? instrument.price >= alert.target : instrument.price <= alert.target),
    );
    if (triggered.length === 0) return;
    const triggeredIds = new Set(triggered.map((alert) => alert.id));
    setAlerts((current) => current.map((alert) => triggeredIds.has(alert.id) ? { ...alert, triggered: true } : alert));
    if (typeof Notification !== "undefined" && Notification.permission === "granted") {
      for (const alert of triggered) {
        new Notification(`Price alert · ${alert.symbol}`, {
          body: `${alert.direction === "above" ? "Di atas" : "Di bawah"} ${money(alert.target, instrument.decimals)}`,
        });
      }
    }
  }, [activeSymbol, alerts, instrument.decimals, instrument.price, isFxProLive]);

  useEffect(() => {
    geminiRequestIdRef.current += 1;
    setGeminiAnalysis("");
    setGeminiError("");
    setIsGeminiLoading(false);
  }, [activeSymbol, timeframe]);

  const requestGeminiAnalysis = async () => {
    const requestId = ++geminiRequestIdRef.current;
    setIsGeminiLoading(true);
    setGeminiError("");
    setGeminiAnalysis("");

    try {
      const response = await fetch("/api/gemini-analysis", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          symbol: instrument.symbol,
          name: instrument.name,
          timeframe,
          price: instrument.price,
          changePct: instrument.changePct,
          ema20: analysis.ema20,
          ema50: analysis.ema50,
          rsi14: analysis.rsi14,
          macdHistogram: analysis.macdHistogram,
          atr14: analysis.atr14,
          support: analysis.support,
          resistance: analysis.resistance,
          trend: analysis.trend,
          bias: analysis.bias,
        }),
      });
      const result: unknown = await response.json();
      if (!result || typeof result !== "object") {
        throw new Error("Respons server tidak valid.");
      }

      const data = result as { analysis?: unknown; error?: unknown };
      if (!response.ok) {
        throw new Error(typeof data.error === "string" ? data.error : "Analisis Gemini gagal.");
      }
      if (typeof data.analysis !== "string") {
        throw new Error("Gemini tidak mengembalikan hasil analisis.");
      }
      if (requestId === geminiRequestIdRef.current) setGeminiAnalysis(data.analysis);
    } catch (error) {
      if (requestId === geminiRequestIdRef.current) {
        setGeminiError(error instanceof Error ? error.message : "Terjadi kesalahan saat meminta analisis Gemini.");
      }
    } finally {
      if (requestId === geminiRequestIdRef.current) setIsGeminiLoading(false);
    }
  };

  const createPriceAlert = () => {
    const target = Number(alertTarget);
    if (!Number.isFinite(target) || target <= 0) {
      setAlertsError("Masukkan harga alert yang valid.");
      return;
    }
    setAlertsError("");
    setAlerts((current) => [{
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      symbol: activeSymbol,
      direction: alertDirection,
      target,
      triggered: false,
    }, ...current]);
    setAlertTarget("");
  };

  const addInstrument = () => {
    const symbol = search.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (!symbol || instruments.some((item) => item.symbol === symbol)) return;
    const created: Instrument = { symbol, name: `${symbol} · Demo`, price: 100 + (symbol.length * 37.11), change: 0.84, changePct: 0.84, decimals: 2 };
    setInstruments((current) => [created, ...current]);
    setActiveSymbol(symbol);
    setSearch("");
  };

  return (
    <main className="app-shell">
      <header className="topbar">
        <a className="brand" href="#" aria-label="Atlas Market Intelligence home">
          <span className="brand-mark"><Image src="/icon.svg" alt="" width={27} height={27} priority /></span>
          <span>ATLAS</span>
          <span className="brand-tag">MARKET INTELLIGENCE</span>
        </a>
        <div className="topbar-center"><span className={`market-pulse ${liveConnection === "reconnecting" ? "pulse-warning" : ""}`} /> MARKET ANALYSIS <span className="topbar-divider">/</span> {isBinanceLive ? `BINANCE SPOT · ${liveConnection.toUpperCase()}` : isFxProLive ? "TRADINGVIEW CHART · FXPRO FIX XAUUSD · LIVE" : liveSymbols[activeSymbol] ? (liveConnection === "connecting" || isMarketDataLoading ? "CONNECTING TO BINANCE SPOT" : "BINANCE SPOT · RECONNECTING") : activeSymbol === "XAUUSD" ? (liveConnection === "connecting" ? "TRADINGVIEW CHART · CONNECTING TO FXPRO FIX" : liveConnection === "reconnecting" ? "TRADINGVIEW CHART · FXPRO FIX RECONNECTING" : "TRADINGVIEW CHART · XAUUSD") : "DEMO DATA"}</div>
        <div className="topbar-actions">
          <button className="icon-button" aria-label="Notifications"><Icon name="bell" /></button>
          <button className="icon-button" aria-label="Settings"><Icon name="settings" /></button>
          <button className="icon-button" aria-label={`${showWatchlist ? "Hide" : "Show"} watchlist`} aria-controls="watchlist-sidebar" aria-expanded={showWatchlist} title={`${showWatchlist ? "Hide" : "Show"} watchlist`} onClick={() => setShowWatchlist((visible) => !visible)}><Icon name="panel-left" /></button>
          <button className="icon-button" aria-label={`${showAccount ? "Hide" : "Show"} account sidebar`} aria-controls="account-sidebar" aria-expanded={showAccount} title={`${showAccount ? "Hide" : "Show"} account sidebar`} onClick={() => setShowAccount((visible) => !visible)}><Icon name="panel-right" /></button>
          <div className="avatar">JD</div>
        </div>
      </header>

      <div className={`workspace ${showWatchlist ? "" : "watchlist-hidden"} ${showAccount ? "" : "account-hidden"}`}>
        <aside id="watchlist-sidebar" className={`watchlist-panel ${showWatchlist ? "open" : "closed"}`}>
          <div className="panel-heading"><div><span className="eyebrow">YOUR MARKETS</span><h2>Watchlist</h2></div><button className="icon-button subtle" aria-label="Add symbol" onClick={() => document.getElementById("watch-search")?.focus()}><Icon name="plus" /></button></div>
          <label className="search-box"><Icon name="search" size={16} /><input id="watch-search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search markets" /><kbd>/</kbd></label>
          <div className="watchlist-labels"><span>SYMBOL</span><span>LAST PRICE</span></div>
          <div className="watchlist-items">
            {filteredInstruments.map((item) => (
              <button key={item.symbol} className={`watch-item ${activeSymbol === item.symbol ? "selected" : ""}`} onClick={() => setActiveSymbol(item.symbol)}>
                <span className="instrument-icon">{item.symbol.slice(0, 1)}</span>
                <span className="watch-instrument"><strong>{item.symbol}</strong><small>{item.name}</small></span>
                <span className="watch-price"><strong>{item.price < 10 ? item.price.toFixed(item.decimals) : money(item.price, item.decimals)}</strong><small className={item.changePct >= 0 ? "positive" : "negative"}>{item.changePct >= 0 ? "+" : ""}{item.changePct.toFixed(2)}%</small></span>
              </button>
            ))}
            {filteredInstruments.length === 0 && <div className="empty-search"><span>No matching markets</span><button onClick={addInstrument}><Icon name="plus" size={14} /> Add demo symbol</button></div>}
          </div>
          <div className="watchlist-footer"><span className="live-dot" /> BTC/ETH/SOL live · XAUUSD live jika FxPro FIX disetel · lainnya demo</div>
        </aside>

        <section className="main-workspace">
          <div className="instrument-header">
            <div className="instrument-title">
              <div className="instrument-avatar">{instrument.symbol.slice(0, 1)}</div>
              <div><div className="symbol-name">{instrument.symbol}<span className="market-type">{activeSymbol === "XAUUSD" ? " · CFD" : liveSymbols[activeSymbol] ? " · SPOT" : " · DEMO"}</span></div><div className="instrument-fullname">{instrument.name}</div></div>
              <button className="star-button" aria-label="Favorite">☆</button>
            </div>
            <div className="instrument-quote"><strong>{money(instrument.price, instrument.decimals)}</strong><span className={instrument.changePct >= 0 ? "positive" : "negative"}>{instrument.change >= 0 ? "+" : ""}{money(instrument.change, instrument.decimals)} ({instrument.changePct >= 0 ? "+" : ""}{instrument.changePct.toFixed(2)}%)</span>{isFxProLive && <small className="last-tick">Change since first quote</small>}</div>
            <div className="session-stat"><span>DATA SOURCE</span><strong><i className={`live-dot ${liveConnection === "reconnecting" ? "pulse-warning" : ""}`} /> {liveSymbols[activeSymbol] ? `Binance Spot · ${liveConnection}` : activeSymbol === "XAUUSD" ? `TradingView chart · FxPro FIX ${liveConnection}` : "Demo data"}</strong>{isFxProLive && fxProQuote ? <small className="last-tick">FIX bid {money(fxProQuote.bid, instrument.decimals)} · ask {money(fxProQuote.ask, instrument.decimals)}</small> : lastTickAt !== null && isBinanceLive ? <small className="last-tick">Trade tick · {new Date(lastTickAt).toLocaleTimeString()}</small> : null}</div>
          </div>

          <div className="chart-toolbar">
            <div className="timeframes">{timeframeOptions.map((option) => <button key={option} className={timeframe === option ? "active" : ""} onClick={() => setTimeframe(option)}>{option}</button>)}</div>
            {activeSymbol !== "XAUUSD" && <>
              <div className="toolbar-separator" />
              <button className={`tool-button ${showEma ? "tool-active" : ""}`} onClick={() => setShowEma(!showEma)}><span className="ema-icon">∿</span> EMA 20</button>
              <button className={`tool-button ${showVolume ? "tool-active" : ""}`} onClick={() => setShowVolume(!showVolume)}><span className="volume-icon">▥</span> Volume</button>
              <label className="drawing-select"><span>DRAW</span><select aria-label="Chart drawing tool" value={drawingTool ?? ""} onChange={(event) => setDrawingTool(drawingTools.find((tool) => tool.kind === event.target.value)?.kind ?? null)}><option value="">Off</option>{drawingTools.map((tool) => <option key={tool.kind} value={tool.kind}>{tool.label}</option>)}</select></label>
            </>}
            <div className="toolbar-spacer" />
            {activeSymbol !== "XAUUSD"
              ? <><button className="icon-button chart-action" onClick={() => chartApiRef.current?.timeScale().fitContent()} aria-label="Fit chart"><Icon name="eye" size={16} /></button><span className="chart-currency">USD ▾</span></>
              : <span className="chart-currency">TradingView · FX_IDC:XAUUSD</span>}
          </div>

          <div className="chart-container">
            {activeSymbol === "XAUUSD"
              ? <TradingViewChart timeframe={timeframe} />
              : <>
                <div className="chart-watermark"><span>◈</span> {instrument.symbol}<small> · {timeframe}</small></div>
                <MarketChart candles={candles} showVolume={showVolume} showEma={showEma} drawingTool={drawingTool} symbol={instrument.symbol} onChartReady={onChartReady} />
              </>}
          </div>

          {activeSymbol === "XAUUSD"
            ? <div className="chart-legend"><span className="legend-demo">Chart by TradingView · FX_IDC:XAUUSD. Header quote and price alerts use FxPro FIX; prices may differ.</span></div>
            : <div className="chart-legend"><span><i className="legend-candle up" /> Bull candle</span><span><i className="legend-candle down" /> Bear candle</span><span><i className="legend-line" /> EMA 20</span><span className="legend-demo">{isBinanceLive ? `Binance Spot · last trade ${new Date(lastTickAt!).toLocaleTimeString()}` : activeMarketData ? "Binance Spot · waiting for trade tick" : "Illustrative demo data · Not live market prices"}</span></div>}

          <section className="analysis-table-panel">
            <div className="analysis-section-heading">
              <div><span className="eyebrow">TECHNICAL SUMMARY</span><h2>Indicator dashboard</h2></div>
              <div className="analysis-heading-actions">
                <span className="analysis-timeframe">{timeframe} · {instrument.symbol}</span>
                <button className="gemini-button" onClick={requestGeminiAnalysis} disabled={isGeminiLoading || activeSymbol === "XAUUSD"} title={activeSymbol === "XAUUSD" ? "TradingView tidak mengekspos candle widget ke analisis Atlas" : undefined}>
                  {isGeminiLoading ? "Menganalisis..." : "✦ Analisis Gemini"}
                </button>
              </div>
            </div>
            {activeSymbol === "XAUUSD"
              ? <p className="tool-disclaimer">Chart XAUUSD ditampilkan langsung oleh TradingView. Widget tidak membagikan candle historisnya ke Atlas, jadi indikator teknikal dan analisis Gemini untuk XAUUSD tidak tersedia.</p>
              : <div className="indicator-grid">
              <div className="indicator-cell"><span>RSI · 14</span><strong className={analysis.rsi14 >= 70 ? "negative" : analysis.rsi14 <= 30 ? "positive" : ""}>{analysis.rsi14.toFixed(1)}</strong><small>{analysis.rsi14 >= 70 ? "Overbought zone" : analysis.rsi14 <= 30 ? "Oversold zone" : "Neutral momentum"}</small></div>
              <div className="indicator-cell"><span>MACD · 12/26/9</span><strong className={analysis.macdHistogram >= 0 ? "positive" : "negative"}>{analysis.macdHistogram >= 0 ? "+" : ""}{money(analysis.macdHistogram, instrument.decimals)}</strong><small>{analysis.macdHistogram >= 0 ? "Positive momentum" : "Negative momentum"}</small></div>
              <div className="indicator-cell"><span>EMA · 20</span><strong>{money(analysis.ema20, instrument.decimals)}</strong><small>{instrument.price >= analysis.ema20 ? "Price above average" : "Price below average"}</small></div>
              <div className="indicator-cell"><span>EMA · 50</span><strong>{money(analysis.ema50, instrument.decimals)}</strong><small>{analysis.ema20 >= analysis.ema50 ? "Average trend rising" : "Average trend falling"}</small></div>
              <div className="indicator-cell"><span>ATR · 14</span><strong>{money(analysis.atr14, instrument.decimals)}</strong><small>Recent volatility range</small></div>
              <div className="indicator-cell"><span>20-bar range</span><strong>{money(analysis.support, instrument.decimals)} – {money(analysis.resistance, instrument.decimals)}</strong><small>Support / resistance estimate</small></div>
              </div>}
            {(isGeminiLoading || geminiAnalysis || geminiError) && (
              <div className={`gemini-result ${geminiError ? "has-error" : ""}`} aria-live="polite">
                <strong>Gemini · {instrument.symbol} · {timeframe}</strong>
                {isGeminiLoading && <p>Gemini sedang membaca indikator teknikal...</p>}
                {geminiAnalysis && <p>{geminiAnalysis}</p>}
                {geminiError && <p>{geminiError}</p>}
                <small>Analisis AI berdasarkan data demo; bukan nasihat keuangan atau data live.</small>
              </div>
            )}
          </section>

          <section className="market-tools-panel">
            <div className="analysis-section-heading">
              <div><span className="eyebrow">MARKET MICROSTRUCTURE</span><h2>Order flow &amp; volume tools</h2></div>
              <span className="analysis-timeframe">{isBinanceLive ? "Binance Spot · live" : isFxProLive ? "FxPro FIX · live quotes" : activeSymbol === "XAUUSD" ? "TradingView chart · FxPro FIX quotes" : `${instrument.symbol} · demo candles`}</span>
            </div>
            {marketDataError && <p className="data-error" role="status">{marketDataError}</p>}
            <div className="market-tool-tabs" role="tablist" aria-label="Market analysis tools">
              {([
                ["dom", "DOM"],
                ["order-block", "Order blocks"],
                ["profile", "Volume profile"],
                ["footprint", "Footprint"],
              ] as const).map(([id, label]) => (
                <button key={id} role="tab" aria-selected={marketPanel === id} className={marketPanel === id ? "selected" : ""} onClick={() => setMarketPanel(id)}>{label}</button>
              ))}
            </div>

            {marketPanel === "dom" && activeMarketData && (
              <div className="dom-grid">
                <div className="orderbook-side asks"><div className="book-heading"><span>ASK · SELL</span><span>SIZE</span></div>{activeMarketData.asks.slice(0, 10).reverse().map((level, index) => <div key={`${level.price}-${index}`}><span>{money(level.price, instrument.decimals)}</span><span>{level.quantity.toFixed(5)}</span></div>)}</div>
                <div className="orderbook-side bids"><div className="book-heading"><span>BID · BUY</span><span>SIZE</span></div>{activeMarketData.bids.slice(0, 10).map((level, index) => <div key={`${level.price}-${index}`}><span>{money(level.price, instrument.decimals)}</span><span>{level.quantity.toFixed(5)}</span></div>)}</div>
              </div>
            )}
            {marketPanel === "dom" && !activeMarketData && <p className="data-empty">{activeSymbol === "XAUUSD" ? "FxPro FIX spot feed menyediakan kuotasi bid/ask, bukan market depth atau riwayat transaksi. DOM tidak tersedia untuk pair ini." : "DOM live hanya tersedia untuk BTCUSD, ETHUSD, dan SOLUSD melalui Binance Spot. Pilih instrumen kripto untuk memuat order book."} {marketDataError}</p>}

            {marketPanel === "order-block" && (
              <>
                <p className="tool-disclaimer">{isBinanceLive ? "Zona heuristik dari candle Binance; bukan level institusional terverifikasi." : isFxProLive ? "Zona heuristik dari candle kuotasi FxPro FIX sejak koneksi; riwayat intraday dan volume tidak tersedia." : activeSymbol === "XAUUSD" ? "Zona XAUUSD menunggu kuotasi live; candle simulasi tidak digunakan untuk menghitung order block." : "Zona heuristik dari candle simulasi; bukan level institusional terverifikasi."}</p>
                {activeSymbol === "XAUUSD" && !isFxProLive ? <p className="data-empty">Order block XAUUSD akan tersedia setelah kuotasi live diterima.</p> : orderBlocks.length ? <div className="tool-list">{orderBlocks.map((block, index) => <div className="tool-list-row" key={`${block.time}-${index}`}><span className={`direction-tag ${block.direction.toLowerCase()}`}>{block.direction}</span><strong>{money(block.low, instrument.decimals)} – {money(block.high, instrument.decimals)}</strong><small>{new Date(block.time * 1000).toLocaleString()}</small></div>)}</div> : <p className="data-empty">Belum ada zona order block yang memenuhi kriteria heuristik di candle ini.</p>}
              </>
            )}

            {marketPanel === "profile" && (
              <>
                <p className="tool-disclaimer">Estimasi distribusi volume dengan membagi volume candle secara merata di rentang high-low; bukan tick-level volume profile.</p>
                {activeSymbol === "XAUUSD" ? <p className="data-empty">{isFxProLive ? "Spot quotes FxPro FIX tidak menyediakan volume transaksi XAUUSD; volume profile tidak ditampilkan." : "Volume profile XAUUSD menunggu data live; feed FIX spot tidak menyediakan volume transaksi."}</p> : <div className="volume-profile">{[...volumeProfile].reverse().map((level, index) => <div className="profile-row" key={index}><span>{money(level.price, instrument.decimals)}</span><i><b style={{ width: `${Math.max(2, level.volume / profilePeak * 100)}%` }} /></i><small>{money(level.volume, 2)}</small></div>)}</div>}
              </>
            )}

            {marketPanel === "footprint" && activeMarketData && (
              <>
                <p className="tool-disclaimer">Binance aggregate trades · sisi agresor diturunkan dari flag buyer-is-maker.</p>
                <div className="footprint-table"><div><span>PRICE</span><span>BUYER TAKER</span><span>SELLER TAKER</span><span>DELTA</span></div>{footprint.map((level) => <div key={level.price}><strong>{money(level.price, instrument.decimals)}</strong><span className="positive">{level.buy.toFixed(5)}</span><span className="negative">{level.sell.toFixed(5)}</span><strong className={level.buy >= level.sell ? "positive" : "negative"}>{(level.buy - level.sell).toFixed(5)}</strong></div>)}</div>
              </>
            )}
            {marketPanel === "footprint" && !activeMarketData && <p className="data-empty">{activeSymbol === "XAUUSD" ? "FxPro FIX spot quotes tidak menyediakan transaksi bid/ask untuk footprint." : "Footprint memerlukan data transaksi live; tersedia untuk BTCUSD, ETHUSD, dan SOLUSD."}</p>}
          </section>

          <section className="alerts-panel">
            <div className="analysis-section-heading"><div><span className="eyebrow">PRICE MONITOR</span><h2>Price alerts</h2></div><span className="analysis-timeframe">{currentAlerts.length} · {instrument.symbol}</span></div>
            <form className="alert-form" onSubmit={(event) => { event.preventDefault(); createPriceAlert(); }}>
              <select aria-label="Alert direction" value={alertDirection} onChange={(event) => setAlertDirection(event.target.value as PriceAlert["direction"])}>
                <option value="above">Price rises above</option>
                <option value="below">Price falls below</option>
              </select>
              <input aria-label="Alert target price" type="number" step="any" min="0" value={alertTarget} onChange={(event) => setAlertTarget(event.target.value)} placeholder={`Target · ${instrument.symbol}`} />
              <button type="submit">Create alert</button>
              {typeof Notification !== "undefined" && Notification.permission === "default" && <button type="button" className="notification-button" onClick={() => void Notification.requestPermission()}>Enable browser notification</button>}
            </form>
            {alertsError && <p className="data-error" role="alert">{alertsError}</p>}
            <p className="tool-disclaimer">Alert disimpan di browser ini dan hanya dipantau saat dashboard terbuka. {isBinanceLive ? "Harga memakai feed live Binance Spot." : activeSymbol === "XAUUSD" ? "Harga memakai midpoint kuotasi FxPro FIX XAUUSD dan dapat berbeda dari chart TradingView." : "Harga instrumen ini simulasi."} Notifikasi browser memerlukan izin.</p>
            {currentAlerts.length > 0 ? <div className="alert-list">{currentAlerts.map((alert) => <div className="alert-item" key={alert.id}><span className={alert.triggered ? "triggered" : ""}>{alert.triggered ? "Triggered" : "Armed"}</span><strong>{alert.direction === "above" ? "≥" : "≤"} {money(alert.target, instrument.decimals)}</strong><button onClick={() => setAlerts((current) => current.filter((item) => item.id !== alert.id))} aria-label={`Remove alert at ${alert.target}`}>Remove</button></div>)}</div> : <p className="data-empty">Belum ada alert untuk {instrument.symbol}.</p>}
          </section>

          <section className="macro-panel">
            <div className="analysis-section-heading"><div><span className="eyebrow">MACRO DASHBOARD · UNITED STATES</span><h2>Economic indicators</h2></div><span className="analysis-timeframe">{macroData?.source ?? "World Bank"}</span></div>
            {macroError && <p className="data-error" role="status">{macroError}</p>}
            <div className="macro-grid">{macroData?.data.map((item) => <div className="macro-card" key={item.id}><span>{item.label}</span><strong>{item.value === null ? "N/A" : `${item.value.toFixed(2)}${item.unit}`}</strong><small>{item.year ? `Latest available · ${item.year}` : "No observations"} · annual</small></div>)}</div>
            <p className="tool-disclaimer">Sumber: World Bank Indicators API · seri tahunan dengan jeda publikasi, bukan kalender rilis atau data real-time. {macroData ? "Negara: United States." : "Memuat indikator makro..."}</p>
          </section>
        </section>

        <aside id="account-sidebar" className={`account-panel analysis-panel ${showAccount ? "" : "closed"}`}>
          {activeSymbol === "XAUUSD" ? (
            <section className="analysis-card xau-data-note">
              <div className="side-heading"><div><span className="eyebrow">XAUUSD DATA</span><h3>TradingView chart</h3></div></div>
              <p>Historical candles are displayed by TradingView (FX_IDC:XAUUSD). Atlas receives only FxPro FIX quotes; the embedded chart does not provide candles to Atlas indicators.</p>
              {fxProQuote && <div className="analysis-row"><span>FxPro FIX midpoint</span><strong>{money((fxProQuote.bid + fxProQuote.ask) / 2, instrument.decimals)}</strong></div>}
              <small>Sources can differ. Technical indicators from Atlas are unavailable for XAUUSD.</small>
            </section>
          ) : <>
          <section className="signal-card">
            <div className="side-heading"><div><span className="eyebrow">TECHNICAL OUTLOOK</span><h3>{instrument.symbol}</h3></div><span className={`signal-pill ${analysis.bias.toLowerCase()}`}>{analysis.bias}</span></div>
            <p>{analysis.bias === "Bullish" ? "Momentum and trend indicators are aligned positively." : analysis.bias === "Bearish" ? "Momentum and trend indicators are aligned negatively." : "Trend and momentum indicators show mixed conditions."}</p>
            <div className="signal-meter"><span className={analysis.bias.toLowerCase()} /></div>
            <small>Rule-based indicator summary · {timeframe}</small>
          </section>
          <section className="analysis-card">
            <div className="side-heading"><h3>Trend &amp; momentum</h3><span className={`trend-label ${analysis.trend.toLowerCase()}`}>{analysis.trend}</span></div>
            <div className="analysis-row"><span>Last price</span><strong>{money(instrument.price, instrument.decimals)}</strong></div>
            <div className="analysis-row"><span>RSI (14)</span><strong>{analysis.rsi14.toFixed(1)} <small>{analysis.rsi14 > 70 ? "Overbought" : analysis.rsi14 < 30 ? "Oversold" : "Neutral"}</small></strong></div>
            <div className="analysis-row"><span>MACD signal</span><strong className={analysis.macdHistogram >= 0 ? "positive" : "negative"}>{analysis.macdHistogram >= 0 ? "Positive" : "Negative"}</strong></div>
            <div className="analysis-row"><span>EMA alignment</span><strong>{analysis.ema20 >= analysis.ema50 ? "20 above 50" : "20 below 50"}</strong></div>
          </section>
          <section className="analysis-card">
            <div className="side-heading"><h3>Key levels</h3><span className="today-label">20 BARS</span></div>
            <div className="level-row"><span>Resistance</span><strong className="negative">{money(analysis.resistance, instrument.decimals)}</strong></div>
            <div className="level-track"><i style={{ left: `${Math.min(100, Math.max(0, ((instrument.price - analysis.support) / Math.max(analysis.resistance - analysis.support, Number.EPSILON)) * 100))}%` }} /></div>
            <div className="level-row"><span>Support</span><strong className="positive">{money(analysis.support, instrument.decimals)}</strong></div>
            <div className="analysis-row"><span>ATR (14)</span><strong>{money(analysis.atr14, instrument.decimals)}</strong></div>
          </section>
          <p className="analysis-disclaimer">Demo OHLC data only. Indicator readings are educational and are not financial advice or a live market feed.</p>
          </>}
        </aside>
      </div>

      <footer className="statusbar"><div><span className={`status-live ${liveConnection === "reconnecting" ? "pulse-warning" : ""}`} /> System operational <span className="status-divider">·</span> {activeMarketData ? `Binance Spot · ${liveConnection}` : activeSymbol === "XAUUSD" ? `TradingView chart · FxPro FIX ${liveConnection}` : "Demo market data + World Bank"}</div><div><a href="https://www.tradingview.com/" target="_blank" rel="noreferrer">TradingView charts</a><span>© 2025 TradingView, Inc.</span><span className="status-divider">·</span><span>Atlas · Market Intelligence</span></div></footer>
    </main>
  );
}
