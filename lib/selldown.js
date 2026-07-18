'use strict';

// Systematic employer-stock sell-down plan (Phase 4).
// Pure math only — no side effects, no API calls; mirrors lib/portfolio.js.
//
// The plan is share-based: at creation we snapshot the position and compute
// how many shares must go to reach the target weight, then spread that evenly
// across N quarters. Progress is judged on shares actually sold (share counts
// are exact and survive price swings), while the "how far am I really" numbers
// (current weight, shares still to sell) are recomputed live from today's
// price and portfolio total so the advice never goes stale.

const QUARTER_MS = 91.3125 * 24 * 60 * 60 * 1000; // 365.25 / 4 days

// Snapshot the current position into an immutable plan.
// { symbol, shares, price, totalValue, targetWeightPct, quartersToTarget, startDate? }
function buildPlan(opts) {
  const {
    symbol, shares, price, totalValue,
    targetWeightPct, quartersToTarget,
    startDate = new Date().toISOString(),
  } = opts;

  if (!symbol) throw new Error('symbol required');
  if (!(shares > 0)) throw new Error('shares must be > 0');
  if (!(price > 0)) throw new Error('price must be > 0');
  if (!(totalValue > 0)) throw new Error('totalValue must be > 0');
  if (!(targetWeightPct >= 0)) throw new Error('targetWeightPct must be >= 0');
  if (!Number.isInteger(quartersToTarget) || quartersToTarget < 1) {
    throw new Error('quartersToTarget must be a positive integer');
  }

  const startValue = shares * price;
  const startWeightPct = (startValue / totalValue) * 100;
  // Shares that would put the position exactly at target weight, assuming the
  // rest of the portfolio holds still. Prices move, so status recomputes the
  // live equivalent every time — this one just anchors the quarterly pace.
  const targetSharesAtStart = startWeightPct > 0
    ? shares * (targetWeightPct / startWeightPct)
    : shares;
  const sharesToSell = Math.max(0, shares - targetSharesAtStart);

  return {
    symbol: symbol.toUpperCase(),
    targetWeightPct,
    quartersToTarget,
    startDate,
    startShares: shares,
    startPrice: price,
    startValue,
    startTotalValue: totalValue,
    startWeightPct,
    targetSharesAtStart,
    sharesPerQuarter: sharesToSell / quartersToTarget,
    createdAt: new Date().toISOString(),
  };
}

// Where the plan stands right now.
// current: { shares, price, totalValue }; now: Date (injectable for tests).
function computePlanStatus(plan, current, now = new Date()) {
  const { shares, price, totalValue } = current;
  const currentValue = shares * price;
  const currentWeightPct = totalValue > 0 ? (currentValue / totalValue) * 100 : 0;

  const startMs = new Date(plan.startDate).getTime();
  const elapsedQuarters = Math.max(0, Math.floor((now.getTime() - startMs) / QUARTER_MS));
  const currentQuarter = Math.min(elapsedQuarters + 1, plan.quartersToTarget);
  const pastEnd = elapsedQuarters >= plan.quartersToTarget;

  const actualSold = plan.startShares - shares; // negative ⇒ position grew (vests)
  const plannedByPrevQuarterEnd = plan.sharesPerQuarter * Math.min(elapsedQuarters, plan.quartersToTarget);
  const plannedByCurrQuarterEnd = plan.sharesPerQuarter * currentQuarter;

  // Live goalposts: how many shares equal the target weight at today's prices.
  const liveTargetShares = price > 0 && totalValue > 0
    ? (plan.targetWeightPct / 100) * totalValue / price
    : plan.targetSharesAtStart;
  const sharesRemainingToTarget = Math.max(0, shares - liveTargetShares);

  const complete = currentWeightPct <= plan.targetWeightPct + 0.05;

  // Vests can push actualSold negative; don't let that alone read as "behind"
  // mid-quarter — the catch-up amount below already includes the new shares.
  const soldForSchedule = Math.max(actualSold, 0);

  let status;
  if (complete) status = 'complete';
  else if (pastEnd) status = 'behind';
  else if (soldForSchedule < plannedByPrevQuarterEnd - 0.5) status = 'behind';
  else if (actualSold >= plannedByCurrQuarterEnd - 0.5) status = 'ahead';
  else status = 'on-track';

  // What to sell before this quarter ends to stay on schedule. Past the plan's
  // end (or when the schedule lags the live goalpost), fall back to whatever
  // still separates us from the target.
  let sellThisQuarter = 0;
  if (!complete) {
    sellThisQuarter = pastEnd
      ? sharesRemainingToTarget
      : Math.min(Math.max(0, plannedByCurrQuarterEnd - actualSold), sharesRemainingToTarget);
  }
  sellThisQuarter = Math.round(sellThisQuarter);

  // Fraction of the weight gap closed so far (for the progress bar).
  const gap = plan.startWeightPct - plan.targetWeightPct;
  const progressPct = gap > 0
    ? Math.max(0, Math.min(100, ((plan.startWeightPct - currentWeightPct) / gap) * 100))
    : 100;

  return {
    status,                        // 'on-track' | 'ahead' | 'behind' | 'complete'
    currentQuarter,
    quartersToTarget: plan.quartersToTarget,
    pastEnd,
    currentWeightPct,
    currentValue,
    currentShares: shares,
    actualSold,
    positionGrew: actualSold < -0.5, // new shares appeared since plan start (RSU vests)
    plannedByPrevQuarterEnd,
    plannedByCurrQuarterEnd,
    liveTargetShares,
    sharesRemainingToTarget,
    sellThisQuarter,
    estProceeds: sellThisQuarter * price,
    progressPct,
    quarterEndsOn: new Date(startMs + currentQuarter * QUARTER_MS).toISOString(),
    planEndsOn: new Date(startMs + plan.quartersToTarget * QUARTER_MS).toISOString(),
  };
}

module.exports = { buildPlan, computePlanStatus, QUARTER_MS };
