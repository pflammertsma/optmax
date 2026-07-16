# Investment Strategy Approach

*Not financial advice — same disclaimer as the rest of PortMax. This is a
framework for the app's logic, tailored to the persona in
[`situation.md`](situation.md), to be accepted, rejected, or tuned.*

## Why long-term stocks/ETFs over active options trading (for this persona)

The existing PortMax scanner is optimized for **active income generation via
cash-secured puts** — frequent scanning, frequent entries/exits, chasing IV
rank and yield. That's a reasonable strategy for someone who wants it as
their focus. For this persona, three things point the other way:

1. **Professional-trader tax reclassification risk.** In a Swiss-style tax
   regime, the private-capital-gains exemption can be lost if the tax
   authority decides the investor is a professional securities dealer
   (in Switzerland: *gewerbsmässiger Wertschriftenhändler*, see
   Kreisschreiben Nr. 36). The weighed factors include: holding period
   (frequent short-term trades), transaction volume relative to net worth,
   use of leverage/derivatives (**options explicitly increase risk here**),
   and whether trading income funds living expenses. A CSP strategy run "the
   way the scanner is designed to be run" — rolling frequent short-dated puts
   across dozens of tickers — is close to the fact pattern that gets people
   reclassified. If reclassified, gains become taxable income *and* subject
   to social-security contributions. This risk basically doesn't exist for
   someone who buys and holds ETFs/stocks for years.
2. **Employer-stock concentration already dominates the risk budget.**
   Adding active derivatives trading adds a second source of complexity and
   potential loss on top of a concentration problem that hasn't been solved
   yet (see below). Fix the bigger problem first.
3. **Time and skill cost.** Active options income strategies have a real
   learning curve and require ongoing attention (assignment risk, rolling,
   earnings calendars). Long-horizon index investing has a much shallower
   learning curve and, on the historical evidence, is very hard for
   individual active traders to beat net of taxes and mistakes.

**Recommendation:** treat cash-secured puts (the existing scanner) as an
optional, clearly-separated side experiment with a small, capped allocation —
never comingled with core retirement holdings — and kept infrequent enough to
stay clearly on the "private investor" side of the professional-trader line
(puts held to expiration/assignment rather than actively rolled, low overall
transaction count per year).

## The actual problem to solve: concentration + no explicit allocation plan

The persona's holdings are a reasonable, if unstructured, set of picks — but
two structural issues stand out:

### 1. Employer-stock concentration (biggest single risk)
Paid in employer stock, holding employer stock, with career/income *also*
tied to the same company — the most textbook concentration risk in personal
finance (same failure mode as Enron/Lehman employees). The app's #1 job
should be to **track total employer-stock exposure as a % of net worth**
(unvested-adjacent grants, vested shares wherever held, plus the employer's
weight inside held index ETFs — a mega-cap tech employer typically has
meaningful weight in funds like `QQQ` and `VOX`, so true exposure is higher
than the raw share count suggests) and alert when it crosses a configurable
threshold (commonly recommended: systematically sell down single-employer
stock above 5–10% of net worth, regardless of how good the company story is).

### 2. No explicit target asset allocation
A holdings list that accreted over time rather than a deliberate allocation.
A simple, low-maintenance structure fitting a ~25-year horizon:

- **Core (70–90% of portfolio):** broad US total market (`VTI`) + developed
  ex-US (`VEA`) [+ optionally emerging markets, currently missing] — cheap,
  diversified, low maintenance.
- **Tilts/satellite (10–20%):** e.g. `QQQ` (a large tilt toward the same
  mega-cap tech names already concentrated via the employer — this *adds* to
  tech concentration rather than diversifying away from it), individual
  conviction stocks, income-tilted funds (`JEPQ` — a covered-call/derivative-
  income ETF; holding it means already passively running a packaged
  options-income strategy, which behaves differently in strong bull markets).
- **Bonds/cash:** none in the example holdings. At ~42 with a 23+ year
  horizon, 0% bonds is defensible, but it should be an explicit decision
  rather than a default.

The app should let the user **define target % per holding/bucket**, then
compute drift vs. target from live IBKR data, and signal when a rebalance is
due — the single highest-value "signal" for a long-term investor (see
[`signals.md`](signals.md)).

## Suggested glidepath structure (for the app to model, not prescriptive)

A common simple model for "no other retirement savings, this portfolio must
last":

- Age ~42–55: high equity allocation (85–100%), focus on maximizing
  contributions and de-risking the employer-stock concentration.
- Age 55–65: gradually introduce bonds/cash (glide from ~90% equity to
  ~60–70% equity), start planning a withdrawal strategy.
- Age 65–70+: withdrawal phase; sequence-of-returns risk becomes the primary
  concern — this is where a bond/cash buffer (e.g. 2–3 years of expenses)
  matters most.

The app can implement this as a simple age-indexed target-equity formula
(e.g. `target_equity_pct = min(100, 110 - age)`, adjustable) that feeds the
rebalancing signal.

## Other ideas worth exploring

- **Automate contributions / dollar-cost averaging** rather than picking
  entry points — matters more for a 40s+ investor than trying to time markets.
- **Tax-loss harvesting signals** — flag positions with unrealized losses
  that could be sold and replaced with a similar-but-not-identical holding
  (careful: the US wash-sale rule is 30 days; a Swiss-style regime has no
  wash-sale concept for private investors since gains aren't taxed anyway,
  so this mainly matters for the US return).
- **RSU vesting cadence integration** — a signal each vest date reminding the
  user to (a) decide how much to sell immediately (many advisors say: sell
  100% of new vests immediately to avoid compounding concentration, reinvest
  into the diversified core) and (b) transfer shares from the stock-plan
  broker to IBKR if that's the workflow.
- **Currency/home-bias check** — living in one currency zone while holding
  entirely USD-denominated assets deserves a conscious decision on FX
  exposure (not necessarily a problem when income is USD-linked too).

## Open questions

- Should the "target allocation" be something the app suggests (via a model
  glidepath) or something the user inputs and the app just tracks drift
  against?
- Should employer-stock-adjacent exposure (via index-fund weights) be
  included in the concentration calculation, or only directly-held shares?
