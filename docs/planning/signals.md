# Signal Catalog — Long-Term Portfolio Module

These are the concrete rules `lib/signals.js` would evaluate against a
synced IBKR portfolio snapshot + your configured targets. All are
**strategic/infrequent** signals appropriate for a buy-and-hold long-term
investor — nothing here is a day-trading or technical-timing signal.

## 1. Concentration risk

- **Employer-stock concentration**: fires when directly held employer shares
  (RSU shares wherever vested) exceed a configurable % of total net worth
  (suggested default trigger: 10%, hard-alert at 15–20%). Optionally include
  index-implied exposure via held index-fund weights (e.g. `QQQ`/`VOX`) for a
  "true employer/sector exposure" secondary figure.
- **Single-position concentration (any holding)**: generic version of the
  above for any individual stock (e.g. if `ASML` or `NVO` grows to dominate
  the portfolio through appreciation alone).
- **Sector concentration**: aggregate tech-sector exposure across `QQQ`,
  individual tech names, and employer stock — tech-heavy portfolios can look
  "diversified" by ticker count while being concentrated by sector.

## 2. Rebalancing (drift vs. target allocation)

- Fires when any bucket (core/satellite/bonds, or per-holding if you define
  targets at that granularity) drifts beyond a tolerance band from its
  target weight (common default: ±5 percentage points, or ±25% relative).
- Suggests the specific trade(s) to return to target (sell X shares of A,
  buy Y shares of B) — informational only, you execute manually in IBKR.
- Should account for cash available / tax lots where possible so it doesn't
  suggest a sale that creates an outsized short-term-gain tax event without
  flagging that trade-off.

## 3. Glidepath / age-based equity target

- Compares current overall equity % against the age-indexed target curve
  (see [`strategy.md`](strategy.md)) and flags when you're meaningfully off
  the intended glidepath — mainly relevant as you approach your late 50s/60s,
  essentially dormant for now while 100% equities is expected/fine.

## 4. RSU vesting events

- The user logs (or eventually auto-detects via a stock-plan-broker export)
  a vest date + share count; the app fires a reminder around that date to
  decide how much to sell and whether to transfer to IBKR, and to re-check
  the employer-stock concentration signal immediately after.

## 5. Tax-aware flags (informational, not filing advice)

- **Unrealized loss harvesting candidates**: holdings with a meaningful
  unrealized loss vs. cost basis, where selling + reinvesting in a similar
  (not identical, to respect the 30-day US wash-sale rule) holding could
  offset gains on your US tax return.
- **Long-term vs short-term threshold approaching**: flag lots close to
  crossing the 1-year holding mark, since long-term US capital gains rates
  are materially better — useful for any manual stock sales, RSU-adjacent
  or otherwise.

## 6. Cash drag / contribution reminders

- If IBKR cash balance sits above a configured "keep as buffer" threshold
  for longer than N days, remind you it's uninvested (simple dollar-cost-
  averaging nudge) — deliberately not a market-timing signal, just an
  "you have idle cash" nudge.

## 7. Valuation sanity checks (optional, lower priority)

- Simple, slow-moving checks like "current price vs. 200-day moving average"
  or "off all-time-high by X%" on core holdings — framed as awareness, not a
  trade trigger, since a long-term investor should generally not be reacting
  to these day to day. Lower priority than 1–4 above; consider deferring.

## Explicitly out of scope (for this module)

- Options-based signals (IV rank, IV/HV ratio, delta sweet spots, earnings
  kill-switches) — that's the existing CSP scanner's job, left untouched.
- Any short-term technical/momentum trading signal.
- Automated order placement — this module surfaces signals; the user acts on
  them manually at their broker.

## Open questions

- Which of the above do you actually want at v1 vs. later? Recommendation:
  start with **concentration (1)** and **rebalancing (2)** — they're the
  highest-value, least judgment-call-dependent, and don't require the tax-lot
  detail that (5) needs.
- Notification granularity: one alert per triggered rule, or a single daily
  digest notification summarizing everything currently triggered?
