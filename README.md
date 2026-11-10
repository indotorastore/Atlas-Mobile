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
- The app uses TradingView Lightweight Charts to render its own candle data.
  BTCUSD, ETHUSD, and SOLUSD receive live/history candles from Binance Spot.
  XAUUSD candles are built from FxPro FIX midpoint quotes received since the
  current connection; FIX does not provide candle history or traded volume.
  EURUSD, AAPL, NVDA, and custom symbols use illustrative demo candles until a
  data provider is configured. Copy the FIX price-connection settings from
  cTrader into `.env.local` using the names in `.env.example`; use the SSL price
  port, not the trading port.
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
- Lightweight Charts is a chart-rendering library and does not provide market
  data. Atlas calculates indicators from the same internal candle series shown
  in its chart. XAUUSD indicators require at least 50 FIX candles collected
  since connecting; historical backfill is unavailable. For other symbols
  without a live Atlas feed, quotes and analysis use illustrative demo prices.
- FIX spot quotes do not provide traded volume or transaction-by-transaction
  bid/ask data. Volume profile, DOM depth, and footprint are unavailable for
  XAUUSD.
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
