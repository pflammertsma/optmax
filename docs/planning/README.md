# Long-Term Portfolio Planning — Project Notes

This folder documents the plan to extend OptMax (currently a pure cash-secured-put
scanner) with a second, independent module focused on long-term stock/ETF
portfolio management, retirement planning, and IBKR account sync.

The module is designed around a **target persona** described in
[`situation.md`](situation.md) — an expat tech employee accumulating employer
stock, investing through IBKR, and planning to retire on those investments.
Adjust the persona file to your own facts and the rest of the docs follow.

**No code has been changed yet.** These are planning documents only, written so
context persists across sessions. Read in this order:

1. [`situation.md`](situation.md) — the target persona: financial situation, goals, and constraints.
2. [`strategy.md`](strategy.md) — investment approach: why stocks/ETFs over active options trading for this persona, the tax angle, employer-stock concentration risk, retirement glidepath.
3. [`ibkr-integration.md`](ibkr-integration.md) — technical plan for connecting to IBKR via the Client Portal Web API.
4. [`architecture.md`](architecture.md) — how this bolts onto the existing Electron app (system tray, background checks, notifications, new data model), without disturbing the existing CSP scanner.
5. [`signals.md`](signals.md) — the catalog of concrete buy/sell/rebalance signals the app should be able to generate for a long-term stock/ETF portfolio.

## Decisions made so far

| Decision | Choice | Rationale |
|---|---|---|
| Relationship to the existing CSP scanner | **Additive** — new "Portfolio" section alongside the existing scanner, not a replacement | Keeps the upstream scanner intact and easy to merge changes into; it stays useful as an optional side-experiment |
| IBKR access method | **Client Portal Web API** (official REST API via the local "Client Portal Gateway" process) | Gives real-time-ish positions/balances/market data; more setup than Flex Query but far more capable |
| Background operation | **System tray + native OS notifications** | App keeps running when the window is closed; fires a notification when a signal triggers; the window is opened only when detail is wanted |
| Primary strategy focus | **Stocks/ETFs, buy-and-hold, long horizon** — not active options trading | See [`strategy.md`](strategy.md) for the tax and concentration reasoning |

## Open questions (to resolve before implementation starts)

See the bottom of each doc for section-specific open questions. The big ones:

- Should the IBKR module be **read-only** (recommended — sync + signals only, all trades placed manually at the broker), or eventually explore semi-automated order placement?
- What should count as "too concentrated" in employer stock before the app alerts (e.g., >10% / >15% / >20% of net worth)?
- Should the stock-plan account (where employer grants vest) be synced too, or is manually logging vest events into the app good enough?
- Target retirement asset allocation glidepath — define target % equities/bonds by age, or start equities-only?
