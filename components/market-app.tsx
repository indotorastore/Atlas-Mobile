"use client";

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
  const changes = closes.slice(-14).map((close, index, values) => close - (values[index - 1] ?? closes[closes.length - 15]));
  const gains = changes.map((change) => Math.max(change, 0));
  const losses = changes.map((change) => Math.max(-change, 0));
  const averageGain = gains.reduce((sum, value) => sum + value, 0) / gains.length;
  const averageLoss = losses.reduce((sum, value) => sum + value, 0) / losses.length;
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

  useEffect(() => {
    if (!containerRef.current) return;
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
      timeScale: { borderColor: "rgba(255,255,255,0.09)", timeVisible: true, secondsVisible: false },
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
    chartRef.current?.timeScale().fitContent();
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
  const chartApiRef = useRef<IChartApi | null>(null);
  const instrument = instruments.find((item) => item.symbol === activeSymbol) ?? instruments[0];
  const candles = useMemo(() => makeCandles(instrument, timeframe), [instrument, timeframe]);
  const analysis = useMemo(() => calculateAnalysis(candles), [candles]);
  const filteredInstruments = instruments.filter((item) =>
    `${item.symbol} ${item.name}`.toLowerCase().includes(search.toLowerCase()),
  );
  const onChartReady = useCallback((chart: IChartApi | null) => {
    chartApiRef.current = chart;
  }, []);

  useEffect(() => {
    if (window.matchMedia("(max-width: 760px)").matches) setShowWatchlist(false);
  }, []);

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
        <a className="brand" href="#" aria-label="Marketdesk home">
          <span className="brand-mark"><Icon name="chart" size={19} /></span>
          <span>market<span className="brand-accent">desk</span></span>
          <span className="brand-tag">ANALYSIS</span>
        </a>
        <div className="topbar-center"><span className="market-pulse" /> MARKET ANALYSIS <span className="topbar-divider">/</span> DEMO DATA</div>
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
          <div className="watchlist-footer"><span className="live-dot" /> Prices are simulated for demo</div>
        </aside>

        <section className="main-workspace">
          <div className="instrument-header">
            <div className="instrument-title">
              <div className="instrument-avatar">{instrument.symbol.slice(0, 1)}</div>
              <div><div className="symbol-name">{instrument.symbol}<span className="market-type"> · SPOT</span></div><div className="instrument-fullname">{instrument.name}</div></div>
              <button className="star-button" aria-label="Favorite">☆</button>
            </div>
            <div className="instrument-quote"><strong>{money(instrument.price, instrument.decimals)}</strong><span className={instrument.changePct >= 0 ? "positive" : "negative"}>{instrument.change >= 0 ? "+" : ""}{money(instrument.change, instrument.decimals)} ({instrument.changePct >= 0 ? "+" : ""}{instrument.changePct.toFixed(2)}%)</span></div>
            <div className="session-stat"><span>ANALYSIS MODE</span><strong><i className="live-dot" /> Technical</strong></div>
          </div>

          <div className="chart-toolbar">
            <div className="timeframes">{timeframeOptions.map((option) => <button key={option} className={timeframe === option ? "active" : ""} onClick={() => setTimeframe(option)}>{option}</button>)}</div>
            <div className="toolbar-separator" />
            <button className={`tool-button ${showEma ? "tool-active" : ""}`} onClick={() => setShowEma(!showEma)}><span className="ema-icon">∿</span> EMA 20</button>
            <button className={`tool-button ${showVolume ? "tool-active" : ""}`} onClick={() => setShowVolume(!showVolume)}><span className="volume-icon">▥</span> Volume</button>
            <label className="drawing-select"><span>DRAW</span><select aria-label="Chart drawing tool" value={drawingTool ?? ""} onChange={(event) => setDrawingTool(drawingTools.find((tool) => tool.kind === event.target.value)?.kind ?? null)}><option value="">Off</option>{drawingTools.map((tool) => <option key={tool.kind} value={tool.kind}>{tool.label}</option>)}</select></label>
            <div className="toolbar-spacer" />
            <button className="icon-button chart-action" onClick={() => chartApiRef.current?.timeScale().fitContent()} aria-label="Fit chart"><Icon name="eye" size={16} /></button>
            <span className="chart-currency">USD ▾</span>
          </div>

          <div className="chart-container">
            <div className="chart-watermark"><span>◈</span> {instrument.symbol}<small> · {timeframe}</small></div>
            <MarketChart candles={candles} showVolume={showVolume} showEma={showEma} drawingTool={drawingTool} symbol={instrument.symbol} onChartReady={onChartReady} />
          </div>

          <div className="chart-legend"><span><i className="legend-candle up" /> Bull candle</span><span><i className="legend-candle down" /> Bear candle</span><span><i className="legend-line" /> EMA 20</span><span className="legend-demo">Illustrative demo data · Not live market prices</span></div>

          <section className="analysis-table-panel">
            <div className="analysis-section-heading">
              <div><span className="eyebrow">TECHNICAL SUMMARY</span><h2>Indicator dashboard</h2></div>
              <span className="analysis-timeframe">{timeframe} · {instrument.symbol}</span>
            </div>
            <div className="indicator-grid">
              <div className="indicator-cell"><span>RSI · 14</span><strong className={analysis.rsi14 >= 70 ? "negative" : analysis.rsi14 <= 30 ? "positive" : ""}>{analysis.rsi14.toFixed(1)}</strong><small>{analysis.rsi14 >= 70 ? "Overbought zone" : analysis.rsi14 <= 30 ? "Oversold zone" : "Neutral momentum"}</small></div>
              <div className="indicator-cell"><span>MACD · 12/26/9</span><strong className={analysis.macdHistogram >= 0 ? "positive" : "negative"}>{analysis.macdHistogram >= 0 ? "+" : ""}{money(analysis.macdHistogram, instrument.decimals)}</strong><small>{analysis.macdHistogram >= 0 ? "Positive momentum" : "Negative momentum"}</small></div>
              <div className="indicator-cell"><span>EMA · 20</span><strong>{money(analysis.ema20, instrument.decimals)}</strong><small>{instrument.price >= analysis.ema20 ? "Price above average" : "Price below average"}</small></div>
              <div className="indicator-cell"><span>EMA · 50</span><strong>{money(analysis.ema50, instrument.decimals)}</strong><small>{analysis.ema20 >= analysis.ema50 ? "Average trend rising" : "Average trend falling"}</small></div>
              <div className="indicator-cell"><span>ATR · 14</span><strong>{money(analysis.atr14, instrument.decimals)}</strong><small>Recent volatility range</small></div>
              <div className="indicator-cell"><span>20-bar range</span><strong>{money(analysis.support, instrument.decimals)} – {money(analysis.resistance, instrument.decimals)}</strong><small>Support / resistance estimate</small></div>
            </div>
          </section>
        </section>

        <aside id="account-sidebar" className={`account-panel analysis-panel ${showAccount ? "" : "closed"}`}>
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
        </aside>
      </div>

      <footer className="statusbar"><div><span className="status-live" /> System operational <span className="status-divider">·</span> Data: simulated</div><div><a href="https://www.tradingview.com/" target="_blank" rel="noreferrer">TradingView Lightweight Charts™</a><span>© 2025 TradingView, Inc.</span><span className="status-divider">·</span><span>Marketdesk v0.1</span></div></footer>
    </main>
  );
}
