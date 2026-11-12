# Atlas — Market Intelligence

A Next.js market-analysis dashboard.

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
- Market charts are displayed with TradingView's Advanced Chart embed; Atlas
  does not read candle data out of the embedded chart. BTCUSD, ETHUSD, and
  SOLUSD technical analysis uses the separate Binance Spot API candle feed.
  XAUUSD analysis uses midpoint candles built from FxPro FIX quotes received
  during the current connection; indicators appear after the first candle and
  Gemini requires 50 candles. FIX does not provide candle history or traded
  volume. Analysis is disabled for
  EURUSD, AAPL, NVDA, and custom symbols until a data source is selected.
  Copy the FIX price-connection settings from cTrader into `.env.local` using
  the names in `.env.example`; use the SSL price port, not the trading port.
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
- The TradingView embed is presentation-only; its chart feed is independent of
  Atlas analysis data. Crypto indicators use Binance Spot API candles.
  XAUUSD indicators use FIX candles collected since connecting, with limited
  history until 50 candles are available; historical backfill is unavailable.
  Atlas does not show calculated analysis for other instruments while their
  data source is undecided.
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
market-data errors and distinguishes TradingView charts from Atlas analysis
feeds.

## Dashboard scope

- TradingView Advanced Chart embed with interactive chart controls.
- Searchable watchlist; Atlas quotes are shown only for the selected crypto
  symbol when Binance data loads or for XAUUSD when FIX quotes are received.
- Responsive dashboard for market analysis and research.

The FxPro FIX connection is read-only market data and does not route orders.
The dashboard does not provide simulated or real order execution. Production
readiness for this signal-focused product requires reliable, appropriately
licensed market data, validated and explainable signals, and
operational/security controls.

## AI task tracker and roadmap

Atlas is a market-analysis and signal decision-support product: it presents BUY/SELL/neutral recommendations and their supporting data so people can make their own decisions. It does not place real orders. Follow the phases in order, keep unfinished work as `[ ]`, and change a task to `[x]` only after implementing and verifying it. If work is deferred or out of scope, record that explicitly.

### Phase 1 — Trustworthy signal MVP (start here)
- [x] Define a typed signal contract: symbol, timeframe, direction (BUY/SELL/NEUTRAL), generated/expiry timestamps, data source, and current-data status.
- [x] Implement a deterministic, rule-based signal generator using the existing analysis calculations; do not present indicator bias alone as a BUY/SELL signal.
- [x] Show the signal's rationale and inputs (trend, EMA, RSI, MACD, ATR, support/resistance, and volume where available), including unavailable or stale data.
- [x] Define and display confidence semantics as a rule-alignment count, not a probability or claim of guaranteed accuracy.
- [x] Add signal-focused unit tests for direction, neutral/insufficient data, stale data, and boundary cases.

### Phase 2 — Evidence and evaluation
- [x] Persist or otherwise reproducibly retain timestamped signal snapshots with the exact input candle/data range and signal-rule version.
- [x] Add historical evaluation/backtesting that avoids look-ahead bias and accounts for fees/slippage assumptions; clearly label simulated results.
- [x] Display outcome metrics by symbol and timeframe, with sample size, date range, and methodology so results are not misleading.
- [x] Add data-quality checks for gaps, invalid values, source outages, and candle freshness; prevent or flag signals from unreliable inputs.

Phase 2 implementation notes: signal snapshots are versioned and stored in the
current browser only (up to 40 snapshots across symbols/timeframes); each keeps
the exact candle input used when first observed for that bar. Backtests cover
the latest 500 completed Binance candles for supported crypto pairs. Signals
are calculated using candles available up to each decision point, entries are
simulated at the next candle open, and non-overlapping trades exit after five
candles. Reported net returns use fixed notional and the displayed fee/slippage
assumptions; they exclude spread, funding, taxes, and actual exchange execution.
This is an illustrative historical simulation, not a forecast or live track
record. XAUUSD remains excluded because the current FIX feed has no historical
candle backfill.

### Phase 3 — Useful user workflows
- [ ] Add watchlists and configurable signal/price alerts; make delivery failures and current alert status visible.
- [ ] Add authenticated user accounts only when personalized saved state or alert delivery requires them.
- [ ] Move user-specific watchlists, alert rules, and signal history to server-side storage with ownership checks and database migrations.
- [ ] Add a user-visible history of generated signals and their rationale; preserve enough provenance to explain past outputs.

### Phase 4 — Production readiness
- [ ] Add automated unit, API/contract, and end-to-end coverage for the core signal and alert workflows.
- [ ] Add security controls appropriate to the deployed features: input validation, authorization, rate limits, secure secret storage, and dependency updates.
- [ ] Add operational observability: structured logs, service/data-feed health, error monitoring, and actionable alerts.
- [ ] Add deployment pipeline, environment separation, backups/retention for persisted user data, and documented recovery procedures.
- [ ] Review applicable legal, licensing, privacy, and compliance requirements for the target markets and jurisdictions; do not claim regulatory approval without review.

### Explicitly out of scope for current product
- [x] Real broker/exchange order execution and automated trading. Revisit only if the product scope changes; it requires a separate security, risk, and compliance review.
- [x] A trading account ledger for real funds; account and order execution features are outside the current product scope.

### Existing foundation
- [x] Define the product as signal-driven decision support with manual user decision-making.
- [x] Add Binance market-data integration for BTCUSD, ETHUSD, and SOLUSD.
- [x] Add TradingView chart embedding and document that it is separate from Atlas analysis data.
- [x] Document FX/XAUUSD data flow, FIX connection requirements, and known limitations.
- [x] Add technical-analysis calculations for trend, momentum, support, resistance, and bias.
- [x] Document macro-data sources and their limitations.
- [x] Add price alerts checked while the dashboard is open.

### Completion rule

Any future AI agent working on this repo must update this checklist as tasks are completed. When a task is done, change `[ ]` to `[x]`; when it is deferred or invalid, add a short note in the same bullet or in a related section explaining the decision.
