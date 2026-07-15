# Target Persona

The portfolio module is designed around the following persona. If your
situation differs, edit this file — the strategy and signal docs key off it.

## Profile

- **Expat tech employee**, subject to **US taxation** (US person), tax resident
  of a country where private capital gains are tax-free for non-professional
  investors (e.g. **Switzerland**).
- Employed at a **large tech company**, early-to-mid 40s. Target retirement:
  **65–70** (roughly a 25-year horizon).
- Receives **employer stock (RSUs)** periodically as regular compensation,
  deposited at the employer's stock-plan broker, periodically transferred to
  **IBKR** to consolidate and sell from one place.
- Self-described newbie investor; open to guidance and to exploring options
  beyond current holdings.
- Retirement plan: expects to live off the IBKR portfolio in retirement;
  **no other significant retirement vehicle** (no strong pension or
  tax-advantaged retirement account).

## Example holdings (illustrative, not synced from IBKR yet)

- ETFs: `QQQ`, `VTI`, `VOX`, `VEA`, `JEPQ`
- Individual stocks: `ASML`, `NVO`, `QCOM`, `AVGO`
- Plus ongoing employer RSU/stock grants (concentration risk — see
  [`strategy.md`](strategy.md))

Once IBKR integration is live, this section is superseded by the synced live
view rather than manually maintained.

## Cross-border complexity in this persona

- **US person abroad**: US taxes apply to worldwide income/gains regardless
  of residence (citizenship-based taxation). This means:
  - **PFIC rules** apply to *non-US-domiciled* pooled funds — a real hazard if
    the investor ever buys locally-domiciled UCITS ETFs (commonly recommended
    to European residents) instead of US-domiciled ETFs. The example tickers
    above are all US-domiciled, so PFIC-safe. **The app/docs should flag this
    whenever European-domiciled fund suggestions come up.**
  - Some brokers restrict EU/CH-resident clients from buying US ETFs due to
    PRIIPs/KID rules — worth confirming the broker's client classification
    allows continued purchases.
- **Local tax residency (Swiss-style regime)**: private capital gains are
  tax-free *if* the investor is not classified as a professional securities
  dealer. See [`strategy.md`](strategy.md) for what triggers reclassification —
  directly relevant to how much active options trading is wise.
- **FBAR / FATCA**: as a US person with foreign accounts, annual reporting
  obligations likely apply to local (non-US) bank accounts above thresholds;
  US-based brokerage accounts are domestic for FBAR purposes.

## Goals for this app

1. Long-term financial planning tailored to retirement at 65–70, living off
   the IBKR portfolio.
2. Actionable buy/sell/rebalance guidance — not day-trading signals.
3. Runs in the background (system tray), periodically pushes signals as
   native notifications.
4. Syncs real portfolio state from IBKR automatically (Client Portal Web API).
5. Open to investment ideas beyond the current ad hoc picks — see
   [`strategy.md`](strategy.md) for a suggested framework.

## Open questions

- Does the persona have any occupational pension or local tax-advantaged
  retirement account (e.g. Swiss pillar 2 / 3a), even a small one, via the
  employer's local entity? This changes how much the IBKR portfolio must
  carry alone.
- Rough target retirement income / current portfolio value — order of
  magnitude is useful for glidepath modeling; better entered privately into
  the app than written in this doc.
- Risk tolerance: comfortable with 100% equities until close to retirement,
  or should bonds/cash enter the mix earlier?
