'use strict';

// PFIC §1291 "excess distribution" exit-cost estimator + tax-profile helpers.
// Pure math, no side effects. This is a PLANNING estimate, not tax advice:
// it models the default regime (no QEF/MTM election) with simplifying
// assumptions — equal allocation across calendar years held, a flat assumed
// IRS underpayment rate, and no NIIT — and every UI surface showing its
// output must carry the not-tax-advice disclaimer.
//
// Mechanics modeled (why PFIC gains are "punitive"):
//   1. The gain is spread evenly over every calendar year the lot was held.
//   2. Slices for PRIOR years are taxed at the top ordinary rate (37%) no
//      matter the taxpayer's actual bracket — income-independent.
//   3. Each prior-year slice accrues compounded interest as if that tax had
//      been owed back then — this is what grows with every year of waiting.
//   4. Only the CURRENT-year slice is taxed at the user's own marginal rate.
//   5. No long-term capital-gains rate, ever; losses aren't deductible.

// Whether US tax rules (PFIC among them) apply to this user at all.
// An empty profile deliberately counts as a US person: the app's original
// persona is a US citizen, and hiding PFIC warnings by default would be the
// dangerous direction to fail in.
function isUSPerson(settings = {}) {
  if (settings.usGreenCard) return true;
  const c1 = (settings.citizenship1 || '').toUpperCase();
  const c2 = (settings.citizenship2 || '').toUpperCase();
  const res = (settings.residenceCountry || '').toUpperCase();
  if (c1 === 'US' || c2 === 'US' || res === 'US') return true;
  if (!c1 && !c2 && !res) return true; // profile never filled in
  return false;
}

function lotYears(acquisitionDate, currentYear) {
  // IBKR statements report lot dates as YYYYMMDD (sometimes with a time part)
  const cleaned = String(acquisitionDate).trim().split(/[,\s]/)[0].replace(/-/g, '');
  const acqYear = /^\d{8}$/.test(cleaned)
    ? parseInt(cleaned.substring(0, 4), 10)
    : (isNaN(new Date(acquisitionDate).getTime()) ? null : new Date(acquisitionDate).getFullYear());
  if (acqYear === null) return null;
  const n = currentYear - acqYear + 1;
  return n >= 1 ? n : 1;
}

// Tax on one gain evaluated in `evalYear`, held `n` calendar years.
function lotTax(gain, n, evalYear, marginalRate, topRate, r) {
  const perYear = gain / n;
  const acqYear = evalYear - n + 1;
  let deferredTax = 0;
  let interest = 0;
  for (let y = acqYear; y < evalYear; y++) {
    const t = perYear * topRate;
    deferredTax += t;
    interest += t * (Math.pow(1 + r, evalYear - y) - 1);
  }
  return { currentYearTax: perYear * marginalRate, deferredTax, interest };
}

// opts: { currentValue, costBasis, lots?, marginalRatePct, topRatePct,
//         interestRatePct, assumedYearsHeld, now }
function estimatePficExitCost(opts) {
  const {
    currentValue, costBasis, lots = [],
    marginalRatePct = 32, topRatePct = 37,
    interestRatePct = 8, assumedYearsHeld = 3,
    now = new Date(),
  } = opts;

  const currentYear = now.getFullYear();
  const marginal = marginalRatePct / 100;
  const top = topRatePct / 100;
  const r = interestRatePct / 100;

  // Usable lots need a parseable date and both value figures; otherwise the
  // whole position falls back to one synthetic lot at the assumed age.
  const usable = lots.filter(l =>
    l && l.acquisitionDate && lotYears(l.acquisitionDate, currentYear) !== null
    && l.costBasis != null && l.marketValue != null);

  let effLots;
  let usedAssumedAge = false;
  if (usable.length) {
    effLots = usable.map(l => ({
      gain: l.marketValue - l.costBasis,
      n: lotYears(l.acquisitionDate, currentYear),
    }));
  } else {
    usedAssumedAge = true;
    effLots = [{
      gain: (currentValue || 0) - (costBasis || 0),
      n: Math.max(1, Math.round(assumedYearsHeld)),
    }];
  }

  let gainUsd = 0;
  let lossUsd = 0;
  let currentYearTax = 0;
  let deferredTax = 0;
  let interestCharge = 0;
  let totalTaxNextYear = 0;

  for (const l of effLots) {
    if (!(l.gain > 0)) {
      lossUsd += Math.min(0, l.gain);
      continue; // PFIC losses aren't deductible — no tax, no offset
    }
    gainUsd += l.gain;
    const t = lotTax(l.gain, l.n, currentYear, marginal, top, r);
    currentYearTax += t.currentYearTax;
    deferredTax += t.deferredTax;
    interestCharge += t.interest;
    // Same gain re-evaluated next year (conservative: assumes zero growth) —
    // the difference is the pure cost of waiting.
    const tn = lotTax(l.gain, l.n + 1, currentYear + 1, marginal, top, r);
    totalTaxNextYear += tn.currentYearTax + tn.deferredTax + tn.interest;
  }

  const totalTax = currentYearTax + deferredTax + interestCharge;
  const round = v => Math.round(v);

  return {
    gainUsd: round(gainUsd),
    lossUsd: round(lossUsd),
    currentYearTax: round(currentYearTax),
    deferredTax: round(deferredTax),
    interestCharge: round(interestCharge),
    totalTax: round(totalTax),
    effectiveRatePct: gainUsd > 0 ? Math.round((totalTax / gainUsd) * 1000) / 10 : 0,
    // What the same gain would cost in a US-domiciled fund at long-term rates
    ltcgComparisonTax: round(gainUsd * 0.15),
    waitOneYearExtra: round(Math.max(0, totalTaxNextYear - totalTax)),
    usedAssumedAge,
    lotCount: usable.length,
  };
}

module.exports = { isUSPerson, estimatePficExitCost };
