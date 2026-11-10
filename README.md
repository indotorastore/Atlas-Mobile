# Atlas — Market Intelligence

A Next.js market-analysis and paper-trading interface.

## Run locally

```sh
npm install
npm run dev
```

Then open http://localhost:3000.

## Gemini market analysis

Create a Google AI Studio API key and add it to `.env.local`:

```env
GEMINI_API_KEY=your_google_ai_studio_api_key
GEMINI_MODEL=gemini-2.5-flash
```

Restart the dev server, then select **Analisis Gemini** in the technical
summary. `GEMINI_MODEL` is optional and defaults to `gemini-2.5-flash`; the
legacy typo `GRMINI_MODEL` is also accepted. The key is used only by the
server-side API route and must not be prefixed with `NEXT_PUBLIC_`. Deployments
should protect the API route with appropriate platform-level rate limits and
usage monitoring.

## Market data and dashboards

- Atlas market-data tools for BTCUSD, ETHUSD, and SOLUSD use Binance Spot public
  endpoints for candles, order-book depth, and aggregate trades, plus Binance
  Spot WebSocket trades for live quote/candle data. If the socket disconnects,
  it reconnects automatically while REST polling continues as a fallback. The
  server falls back to Binance's public market-data-only REST host if the primary
  API host is unavailable. No API key is needed.
- Preset watchlist charts are displayed by TradingView's official Advanced Chart
  widget: BTC/ETH/SOL use Binance symbols, EURUSD uses `FX:EURUSD`, XAUUSD uses
  `FX_IDC:XAUUSD`, and AAPL/NVDA use their NASDAQ symbols. Custom demo symbols
  continue to use the Atlas demo chart. TradingView chart prices may differ from
  Atlas quotes. Copy the FIX price-connection settings from cTrader into
  `.env.local` using the names in `.env.example`; use the SSL price port, not the
  trading port.
  `FXPRO_FIX_XAUUSD_SYMBOL_ID` is the numeric instrument ID supplied by
  FxPro/Spotware, not the text `XAUUSD`. Keep the FIX password server-side and
  never use a `NEXT_PUBLIC_` prefix.
  See the [official cTrader FIX 4.4 specification](https://help.ctrader.com/fix/specification/)
  for the message and connection details.
- The FIX session is opened over TLS by the Node.js API route and streamed to
  the browser over server-sent events. Run this app on an always-on Node server
  that supports long-lived HTTP streams; serverless function time limits may
  interrupt the connection. Credentials are only read by the server. Protect a
  deployed app with access control; otherwise visitors could use its FIX feed.
- TradingView charts are embedded widgets and do not expose their OHLC history
  to Atlas. Atlas indicators and Gemini analysis use separate Atlas feeds and
  may differ from the displayed chart; they are disabled for XAUUSD. FIX spot
  quotes do not provide historical intraday candles, traded volume, or
  transaction-by-transaction bid/ask data. Order blocks, when available, use
  only FIX quotes received since connecting. Volume profile, DOM depth, and
  footprint are unavailable for XAUUSD.
- For symbols without an Atlas live feed, Atlas-side quotes and analysis continue
  to use illustrative demo prices; the TradingView widget still displays its
  mapped external chart.
- DOM and footprint are available only for those Binance symbols. Order blocks
  are heuristic zones; the volume profile allocates each candle's volume evenly
  across its high-low range, so it is an estimate rather than tick-level data.
- The macro dashboard reads annual U.S. GDP growth, inflation, and unemployment
  observations from the World Bank Indicators API. These series are delayed and
  are not a real-time economic calendar.
- Price alerts are stored in the current browser and checked while the dashboard
  is open. Optional browser notifications require permission.

External data feeds can be unavailable or rate-limited; the UI reports
market-data errors and distinguishes live feeds from demo instruments.

## Paper-trading scope

- Candlestick chart with timeframe controls, volume histogram, and EMA 20.
- Searchable watchlist with live BTC/ETH/SOL and optional XAUUSD data; unsupported
  instruments use illustrative demo prices.
- Paper long/short positions, close-position P&L, and order history saved in
  browser local storage.
- Responsive dashboard for account and simulated market overview.

Paper trades are not real orders. Prices for unsupported symbols remain
simulated. The FxPro FIX connection is read-only market data and does not route
orders. A production trading app needs
licensed market data for every asset, secure authentication, a server-side
account ledger, and a separately reviewed broker integration.
