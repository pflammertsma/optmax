# Long-Term Portfolio Planning — Project Notes

This folder documents the plan to extend PortMax (currently a pure cash-secured-put
scanner) with a second, independent module focused on long-term stock/ETF
portfolio management, retirement planning, and IBKR account sync.

The module is designed around a **target persona** described in
[`situation.md`](situation.md) — an expat tech employee accumulating employer
stock, investing through IBKR, and planning to retire on those investments.
Adjust the persona file to your own facts and the rest of the docs follow.

**Status:** Phase 1 is implemented (Portfolio/Targets/Guidance/Health views,
Activity Statement import with FX, health grading with caching, live prices,
compliance guidance). See [`roadmap.md`](roadmap.md) for what's done, what's
outstanding, and the open decisions. Read in this order:

1. [`roadmap.md`](roadmap.md) — **current status**: done / outstanding / next-phase decisions.
2. [`situation.md`](situation.md) — the target persona: financial situation, goals, and constraints.
3. [`strategy.md`](strategy.md) — investment approach: why stocks/ETFs over active options trading for this persona, the tax angle, employer-stock concentration risk, retirement glidepath.
4. [`ibkr-integration.md`](ibkr-integration.md) — technical plan for connecting to IBKR via the Client Portal Web API (Phase 2).
5. [`architecture.md`](architecture.md) — how this bolts onto the existing Electron app (system tray, background checks, notifications, new data model), without disturbing the existing CSP scanner.
6. [`signals.md`](signals.md) — the catalog of concrete buy/sell/rebalance signals the app should be able to generate for a long-term stock/ETF portfolio.

## Decisions made so far

| Decision | Choice | Rationale |
|---|---|---|
| Relationship to the existing CSP scanner | **Additive** — new "Portfolio" section alongside the existing scanner, not a replacement | Keeps the upstream scanner intact and easy to merge changes into; it stays useful as an optional side-experiment |
| IBKR access method | **Client Portal Web API** (official REST API via the local "Client Portal Gateway" process) | Gives real-time-ish positions/balances/market data; more setup than Flex Query but far more capable |
| Background operation | **System tray + native OS notifications** | App keeps running when the window is closed; fires a notification when a signal triggers; the window is opened only when detail is wanted |
| Primary strategy focus | **Stocks/ETFs, buy-and-hold, long horizon** — not active options trading | See [`strategy.md`](strategy.md) for the tax and concentration reasoning |

## Open questions

Most of the original open questions have been resolved in implementation:

- IBKR module is **read-only** — all views present suggestions as informational; trades are placed manually at the broker.
- Employer-stock concentration thresholds: warning >10%, critical alert >15%, health-grade cap at >25% (configurable ambitions can come later).
- Stock-plan account (employer grants) stays **manual-entry** — no public API exists; a vest log is planned (Phase 4 in [`roadmap.md`](roadmap.md)).
- Glidepath: age-indexed equity target (`base − age`, default base 110) implemented; bonds are reported as drift, not yet held.

Remaining decisions live in the "Decisions still open" section of [`roadmap.md`](roadmap.md).
