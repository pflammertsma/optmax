'use strict';

/**
 * tradecost — what it actually costs to buy, hold, and sell an instrument.
 *
 * Two very different costs get confused all the time:
 *
 *   • One-off trade cost (IBKR commission, paid twice — on the way in and on
 *     the way out). Under IBKR's Tiered US-stock pricing this is $0.0035/share,
 *     floored at $0.35 and capped at 1% of the trade. On a normal-sized order
 *     it is so small it is nearly free; on a $100 order the $0.35 floor is a
 *     0.35% toll, which is the real reason "don't buy in dribs and drabs".
 *
 *   • Recurring holding cost (fund expense ratio + the tax you owe every year
 *     on the dividends). This one compounds, and for a buy-and-hold investor it
 *     dwarfs the commission within months.
 *
 * The useful output for a newbie is therefore not "the fee is $0.35" but
 * "order at least $X, and after that the fee stops mattering — the fund's
 * annual cost is what you should care about."
 *
 * Pure functions, no side effects. UMD so the renderer and node tests share it.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.tradeCost = api;
})(typeof window !== 'undefined' ? window : null, function () {

  // IBKR Tiered, US stocks/ETFs. Deliberately a named constant: if the user
  // switches to Fixed pricing ($0.005/share, $1.00 min) only this changes.
  const IBKR_TIERED = { perShareUsd: 0.0035, minUsd: 0.35, maxPctOfTrade: 1.0 };

  // A long-run expected return used ONLY to translate a one-off cost into
  // "how long you'd have to hold to earn it back". Conservative broad-equity
  // assumption; not a forecast and never shown as one.
  const ASSUMED_ANNUAL_RETURN_PCT = 7;

  function num(v) { return typeof v === 'number' && isFinite(v) ? v : null; }

  /** Commission for ONE side of a trade, in USD. */
  function commissionUsd(amountUsd, price, sched = IBKR_TIERED) {
    const amt = num(amountUsd);
    if (amt == null || amt <= 0) return 0;
    const p = num(price);
    // Without a price we can't count shares; assume a $100 share as a
    // mid-range stand-in so the floor still dominates on small orders.
    const shares = Math.ceil(amt / (p && p > 0 ? p : 100));
    const perShare = shares * sched.perShareUsd;
    const capped = amt * (sched.maxPctOfTrade / 100);
    return Math.round(Math.min(Math.max(sched.minUsd, perShare), capped) * 100) / 100;
  }

  /** Round-trip (buy + sell) commission, absolute and as a % of the position. */
  function tradeCost({ amountUsd, price } = {}) {
    const amt = num(amountUsd);
    if (amt == null || amt <= 0) return { buyUsd: 0, sellUsd: 0, roundTripUsd: 0, roundTripPct: 0 };
    const buyUsd = commissionUsd(amt, price);
    const sellUsd = commissionUsd(amt, price);
    const roundTripUsd = Math.round((buyUsd + sellUsd) * 100) / 100;
    return {
      buyUsd, sellUsd, roundTripUsd,
      roundTripPct: Math.round((roundTripUsd / amt) * 10000) / 100,
    };
  }

  /**
   * The smallest order where the round-trip commission stays under
   * `maxRoundTripPct` of the position — i.e. "don't bother buying less than
   * this". Returns null when no order size can get there, which happens on
   * low-priced shares because the per-share fee is a fixed 0.35%/share/price
   * regardless of order size.
   */
  function minSensibleOrderUsd(price, { maxRoundTripPct = 0.1, sched = IBKR_TIERED } = {}) {
    const target = maxRoundTripPct / 100;
    const p = num(price);
    // Per-share component as a fraction of trade value is price-independent of
    // order size: (shares * perShare) / (shares * price) = perShare / price.
    if (p && p > 0) {
      const perShareFraction = (2 * sched.perShareUsd) / p;
      if (perShareFraction > target) return null;      // unreachable at any size
    }
    // Otherwise the $0.35 floor is what binds: 2*min / amount <= target.
    const amount = (2 * sched.minUsd) / target;
    return Math.ceil(amount / 50) * 50;                 // round up to a tidy figure
  }

  /** Recurring cost of simply owning it for a year, in % of position. */
  function annualHoldingCostPct({ expenseRatioPct, yieldPct, dividendTaxRatePct = 0 } = {}) {
    const er = num(expenseRatioPct) || 0;
    const y = num(yieldPct) || 0;
    const taxDrag = (y * dividendTaxRatePct) / 100;
    return {
      expenseRatioPct: Math.round(er * 100) / 100,
      taxDragPct: Math.round(taxDrag * 100) / 100,
      totalPct: Math.round((er + taxDrag) * 100) / 100,
    };
  }

  /**
   * How long the position must be held for its expected growth to cover the
   * one-off round-trip commission. Returns days (may be fractional).
   */
  function daysToCoverTradeCost(roundTripPct, annualReturnPct = ASSUMED_ANNUAL_RETURN_PCT) {
    const rt = num(roundTripPct);
    if (rt == null || rt <= 0) return 0;
    if (!annualReturnPct || annualReturnPct <= 0) return Infinity;
    return (rt / annualReturnPct) * 365;
  }

  /**
   * The whole picture for one instrument, in the shape the UI wants.
   *
   * `amountUsd` is the order size being considered. When it is unknown the
   * caller can omit it and still get `minOrderUsd` + the annual figures, which
   * are the size-independent half of the answer.
   */
  function costSummary({
    amountUsd, price, expenseRatioPct, yieldPct, dividendTaxRatePct = 0,
    annualReturnPct = ASSUMED_ANNUAL_RETURN_PCT,
  } = {}) {
    const annual = annualHoldingCostPct({ expenseRatioPct, yieldPct, dividendTaxRatePct });
    const minOrderUsd = minSensibleOrderUsd(price);
    const trade = amountUsd ? tradeCost({ amountUsd, price }) : null;
    const days = trade ? daysToCoverTradeCost(trade.roundTripPct, annualReturnPct) : null;

    // Plain-language answer to "do I have to hold this for a while?".
    let holdNote, holdLevel;
    if (days == null) {
      holdNote = minOrderUsd
        ? `Commission is a flat ~$${IBKR_TIERED.minUsd.toFixed(2)} each way, so keep orders at $${minOrderUsd.toLocaleString('en-US')}+ and it rounds to nothing.`
        : 'This share price is low enough that IBKR\'s per-share fee is a real percentage — buy in size, or prefer a higher-priced fund.';
      holdLevel = 'info';
    } else if (days <= 7) {
      holdNote = 'Commission is negligible here — no minimum hold period for cost reasons.';
      holdLevel = 'ok';
    } else if (days <= 60) {
      holdNote = `Plan to hold ~${Math.ceil(days)} days just to out-earn the buy+sell commission.`;
      holdLevel = 'warn';
    } else if (isFinite(days)) {
      holdNote = `This order is small enough that commission costs ${trade.roundTripPct.toFixed(2)}% — you'd need roughly ${Math.round(days / 30)} months of typical growth to earn it back. Buy a larger amount instead.`;
      holdLevel = 'bad';
    } else {
      holdNote = 'Commission cannot be recovered from growth at this order size.';
      holdLevel = 'bad';
    }

    // For a long-term holder the annual cost overtakes the one-off commission
    // fast; saying when makes the trade-off concrete.
    let dominantCost = 'trade';
    if (annual.totalPct > 0 && trade && trade.roundTripPct > 0) {
      dominantCost = annual.totalPct >= trade.roundTripPct ? 'holding' : 'trade';
    } else if (annual.totalPct > 0) {
      dominantCost = 'holding';
    }

    return {
      ...annual,
      minOrderUsd,
      trade,
      daysToCoverTradeCost: days,
      holdNote, holdLevel, dominantCost,
      annualCostPer10kUsd: Math.round(annual.totalPct * 100),   // 1% of $10k = $100
      assumedAnnualReturnPct: annualReturnPct,
    };
  }

  return {
    IBKR_TIERED, ASSUMED_ANNUAL_RETURN_PCT,
    commissionUsd, tradeCost, minSensibleOrderUsd,
    annualHoldingCostPct, daysToCoverTradeCost, costSummary,
  };
});
