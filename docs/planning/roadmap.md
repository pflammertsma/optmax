# Roadmap & Status

Living document — the single place to check what's built, in flight, and next.
Update when a phase lands or priorities change. (Last updated: 2026-07-16.)

## Done

### Phase 1 — Portfolio foundation
- [x] `lib/portfolio.js` — pure math: allocation, drift vs. targets, concentration, glidepath, CSV parsing (unit-tested)
- [x] IBKR **Activity Statement** parser: section-aware, per-lot data, FX conversion via the statement's own rates, cash from Cash Report, base-currency detection
- [x] Portfolio view: sortable holdings table (market value, weight, cost basis, P&L, currency, bucket, employer), cash as its own card, IBKR CSV import (annotations survive re-imports)
- [x] Targets view: bucket targets, tolerance, age-indexed recommendation, auto-assign buckets, drift table with dollar-specific trades
- [x] Guidance view: PFIC warnings (quote-backed with currency-validated classification), employer concentration alerts, cash drag, glidepath drift, Swiss professional-trader risk, lot-aware tax-loss harvesting and rebalance/LTCG warnings, ticker compliance lookup
- [x] `lib/health.js` — 100-point Portfolio Health grade (concentration 35 / diversification 25 / drift 15 / tax hygiene 15 / cash deployment 10) with grade caps (employer >25% ⇒ ≤C; PFIC present ⇒ ≤B), plain-English action per dimension
- [x] Health as a standalone page with inline grade badge in the sidebar
- [x] Health caching: SHA-1 fingerprint over score inputs + 24h TTL; recomputes only when the portfolio actually changes (`get-portfolio-health`, `force` option available)
- [x] Live price refresh: quantity × Yahoo quote, currency-guarded (mismatched exchange listings keep imported values), FX via `=X` pairs
- [x] Dividend income projection (trailing rates × quantity)
- [x] Privacy mode, employer symbols as durable store (`employerSymbols` survives imports)

## Outstanding — small items

- [ ] **Health page self-sufficiency** — Health currently populates only after the Portfolio view has run once per session; it should call `get-portfolio-health` on its own init so landing on it cold works
- [ ] **Index-implied employer exposure** — count the employer's weight inside held index funds (QQQ/VOX) toward the concentration figure (needs fund-holdings data; Yahoo doesn't provide it directly)
- [ ] **Cost-drag health dimension** — weighted expense ratios via `quoteSummary`/`fundProfile`; deferred from the health scorer v1
- [ ] **Metric-card overflow** — long values (e.g. `$1,854,155.22`) clip in the Total Value card

## Outstanding — major phases

### Phase 2 — IBKR live sync (`lib/ibkr.js`)
Replace manual CSV import with the Client Portal Web API (local gateway
process, daily browser re-login). Plan in [`ibkr-integration.md`](ibkr-integration.md).
- [ ] Gateway process lifecycle (configure path/port, start/monitor, session status surfaced in UI)
- [ ] Positions/balances sync mapped into the existing `portfolio.json` shape (same fingerprint invalidation applies automatically)
- [ ] Fallbacks per the plan: Flex Query for daily position-of-record, CSV import stays as manual backstop

### Phase 3 — Background mode & notifications
Plan in [`architecture.md`](architecture.md) §1–2, §6; signal catalog in [`signals.md`](signals.md).
- [ ] System tray + keep-alive on window close (opt-in setting)
- [ ] Signal scheduler (hourly-to-daily): sync → recompute health/guidance → notify
- [ ] Native notifications with dedup (`signals.json` state log; fire on threshold *transitions* or a daily digest, not every poll)
- [ ] Notify on health **grade change** specifically

### Phase 4 — Plan-tracking features (turn advice into schedules)
- [ ] **Systematic employer-stock sell-down plan** — user sets a quarterly sell % and target weight; app tracks progress against the schedule and reminds. The single highest-impact feature given a >40% employer concentration
- [ ] **RSU vest log + reminders** — log vest dates/share counts (stock-plan broker has no public API; manual entry), remind at vest to sell/transfer, re-check concentration after
- [ ] **PFIC remediation checklist** — track replacement of flagged foreign-domiciled funds with US-domiciled equivalents

## Decisions still open (need user input)

- Phase order: 2 (live sync) vs. 3 (background/notifications) vs. 4 (sell-down plan) first
- Notification granularity: per-signal immediate vs. daily digest
- Gateway workflow acceptance: background Java process + ~daily browser re-login
- Bond/fixed-income introduction timing (glidepath currently reports drift only)
