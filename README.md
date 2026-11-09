# Marketdesk

A Next.js market-charting and paper-trading interface.

## Run locally

```sh
npm install
npm run dev
```

Then open http://localhost:3000.

## Demo scope

- Candlestick chart with timeframe controls, volume histogram, and EMA 20.
- Searchable watchlist with illustrative, static demo prices.
- Paper long/short positions, close-position P&L, and order history saved in
  browser local storage.
- Responsive dashboard for account and simulated market overview.

This app does not connect to a market-data provider, broker, or exchange. Prices
are not live, and paper trades are not real orders. A production trading app
needs licensed market data, secure authentication, a server-side account ledger,
and a separately reviewed broker integration.
