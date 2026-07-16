# IBKR Integration Plan — Client Portal Web API

## What it is

IBKR's **Client Portal Web API** is a REST/WebSocket API served locally by the
**Client Portal Gateway** — a small Java process you download from IBKR and run
on your own machine (or a server you control). The Electron app's main process
would talk to `https://localhost:5000/v1/api/...` (default gateway port),
which itself proxies to IBKR's servers over an authenticated session.

This is different from:
- **TWS API** (the older socket-based API, requires Trader Workstation or IB
  Gateway desktop app running and logged in) — heavier, but similar
  local-process model.
- **Flex Query** — scheduled report pulls (typically end-of-day), no gateway
  process, simplest but not real-time and read-only by nature.

We chose Client Portal Web API because it gives near-real-time positions,
account balances, and market data without requiring the full TWS desktop UI.

## How auth works (important constraint)

1. You run the Client Portal Gateway executable locally (`bin/run.sh` /
   `.bat`, ships as a zip from IBKR).
2. You open `https://localhost:5000` in a browser and log in with your IBKR
   credentials + 2FA (IBKR Mobile app push, typically) — **this is a manual,
   interactive step you do yourself**, same as logging into IBKR's website.
   The app should never ask for or store your IBKR password.
3. The resulting session is valid for a limited window (IBKR enforces
   re-authentication, commonly needing a `/tickle` keep-alive call every
   <60s and full re-login roughly daily — exact timeout has varied by IBKR
   version, needs verifying against current docs at implementation time).
4. Once authenticated, the local Electron app calls the gateway's REST
   endpoints over `localhost` — no credentials pass through our own code at
   all, only session cookies/CSRF tokens the gateway manages.

**Practical implication for "runs in the background":** the gateway process
needs to be running and logged in for the sync to work. Realistically this
means:
- The app can auto-start the gateway process (bundled or pointed at a path
  you configure) when PortMax launches.
- You'll periodically (likely daily) need to reauthenticate in a browser tab —
  this is an IBKR security requirement, not something we can fully automate
  away (and automating 2FA entry would be a bad idea security-wise regardless).
- The app should clearly surface "IBKR session: connected / needs re-login"
  status, ideally with a tray icon badge or notification, so a stale session
  doesn't silently mean stale signals.

## Key endpoints likely needed

- `GET /iserver/accounts` — list of accounts under your login (should just be
  the one).
- `GET /portfolio/{accountId}/positions/{pageId}` — current positions
  (symbol, quantity, average cost, current market value, unrealized P&L).
- `GET /portfolio/{accountId}/summary` or `/ledger` — cash balances, net
  liquidation value.
- `GET /iserver/marketdata/snapshot` — live quotes for held symbols (may
  overlap with the existing Yahoo Finance usage — could keep Yahoo for
  discovery/pricing of things you don't hold, and use IBKR's own data only
  for what's actually in your account, to reduce API surface).
- `GET /iserver/account/{accountId}/summary/available_funds` and similar for
  buying-power-aware suggestions (e.g. "don't suggest a rebalance trade that
  needs more cash than you have").

Exact paths should be verified against IBKR's current Client Portal Web API
reference at implementation time — the API has had breaking changes across
versions historically.

## Where this plugs into the existing app

- New main-process module, e.g. `lib/ibkr.js`, parallel to the existing
  `lib/strategies.js` — keeps the existing Yahoo-Finance-only code path
  completely untouched.
- New local cache file (e.g. `portfolio.json` in the same `userData` dir
  pattern as `data.json`/`settings.json`) storing last-synced positions,
  separate from the CSP scanner's `data.json`.
- New IPC channels (`get-ibkr-status`, `sync-ibkr-portfolio`, etc.) added to
  `preload.js` alongside the existing ones — additive, not replacing.
- Gateway process lifecycle (start/monitor/restart) managed from `main.js`,
  similar in spirit to how `initScheduler()`/`initPriceScheduler()` already
  manage background timers.

## Alternatives if the Gateway process turns out to be too heavy

- **Flex Query** as a fallback/secondary source for "true position of
  record" reconciliation on a daily cadence, decoupled from the interactive
  gateway session — worth having as a backstop even if Client Portal is
  primary, since Flex Query doesn't need a logged-in session to pull.
- **Manual CSV import** as an even simpler fallback / disaster-recovery path
  if the gateway is down and you need the app to still reflect reality.

## Open questions

- Is running a background Java process (the gateway) plus a daily browser
  re-login acceptable? This is the standard IBKR API workflow, but worth
  confirming it matches the appetite for the "runs in the background"
  expectation.
- Single IBKR account, or multiple (e.g. individual + any joint/other)? Affects
  whether `accountId` selection needs to be a setting.
- Should the employer's stock-plan broker (where RSUs vest) be included via
  any API, or is that out of scope for now (manually logged vest events
  only)? Stock-plan platforms (e.g. Morgan Stanley StockPlan Connect,
  Schwab Equity Awards) generally lack a comparable public retail API —
  this would likely stay manual-entry only unless that changes.
