'use strict';

// Portfolio Health scorer — the long-term analog of src/scoring.js.
// Pure function: no side effects, no API calls. Grades the whole portfolio
// A–F across five dimensions, with plain-English actions per dimension.
//
// quotes: { SYMBOL: yahooQuote } — optional; used for ETF detection and
// dividend income. Degrades gracefully when absent (offline / tests).

const { analyzeTicker } = require('./guidance');

const GRADE_THRESHOLDS = [
  { grade: 'A', min: 85, label: 'Excellent' },
  { grade: 'B', min: 70, label: 'Good' },
  { grade: 'C', min: 55, label: 'Needs attention' },
  { grade: 'D', min: 40, label: 'At risk' },
  { grade: 'E', min: 0,  label: 'Critical' },
];

function gradeFor(score) {
  return GRADE_THRESHOLDS.find(t => score >= t.min) || GRADE_THRESHOLDS[GRADE_THRESHOLDS.length - 1];
}

const GRADE_ORDER = ['A', 'B', 'C', 'D', 'E'];
function worseGrade(a, b) {
  return GRADE_ORDER[Math.max(GRADE_ORDER.indexOf(a), GRADE_ORDER.indexOf(b))];
}

// Is this holding a diversified fund (vs a single-company stock)?
function isFund(h, quote) {
  if (quote && quote.quoteType) {
    const t = quote.quoteType.toUpperCase();
    return t === 'ETF' || t === 'MUTUALFUND';
  }
  // Fallback: reuse guidance's static classification
  const a = analyzeTicker(h.symbol, [h], 0, null);
  return a != null && (a.type === 'etf' || a.type === 'bond etf');
}

// Is this holding fixed income (a bond fund)? Used to split equity from bonds
// for the age-appropriate allocation check.
function isBondHolding(h, quote) {
  if (quote && quote.quoteType && quote.quoteType.toUpperCase() === 'MUTUALFUND') {
    // Fall through to name/static check — mutual funds can be either.
  }
  const name = `${quote?.longName || quote?.shortName || ''}`.toLowerCase();
  if (name && (name.includes('bond') || name.includes('fixed income') || name.includes('treasury') || name.includes('gilt'))) return true;
  const a = analyzeTicker(h.symbol, [h], 0, quote || null);
  return a != null && a.type === 'bond etf';
}

// Fund expense ratio as a fraction (0.0003 = 0.03%), or null if unknown.
// Individual stocks carry no expense ratio and return 0.
function expenseFraction(h, quote) {
  if (!quote) return null;
  if (quote.annualReportExpenseRatio != null) return quote.annualReportExpenseRatio;
  if (quote.expenseRatio != null) return quote.expenseRatio;
  // A resolved non-fund quote means we know it's a stock → genuinely 0% TER.
  if (quote.quoteType && !isFund(h, quote)) return 0;
  return null;
}

function computePortfolioHealth({ holdings = [], cash = 0, targets = [], tolerancePct = 5, quotes = {}, settings = {} } = {}) {
  const total = holdings.reduce((s, h) => s + (h.marketValue || 0), 0) + (cash || 0);
  if (total <= 0) return null;

  const q = sym => quotes[(sym || '').toUpperCase()] || null;
  const breakdown = [];
  const caps = [];

  // A dimension can be "not applicable" (a missing input, not a portfolio flaw
  // — e.g. no targets set, no birth year, no fund data on a backfilled point).
  // Those are excluded from BOTH the numerator and the denominator, then the
  // remaining points are scaled to /100, so a missing input never silently
  // lowers the grade. applicable:false rows still render, marked N/A.
  const push = (row) => breakdown.push({ applicable: true, ...row });

  const invested = holdings.reduce((s, h) => s + (h.marketValue || 0), 0);
  const employerSyms = new Set((settings.employerSymbols || '').toUpperCase().split(',').map(s => s.trim()).filter(Boolean));

  // ── 1. Concentration (25 pts) — largest single-company position ────────────
  // A fixed calibration against absolute risk: dispersion, not a bankruptcy
  // forecast. The configurable limit only drives the plain-English action.
  const concLimit = settings.concentrationLimitPct ?? 10;
  let largestStock = { symbol: null, pct: 0 };
  let employerPct = 0;
  for (const h of holdings) {
    const pct = ((h.marketValue || 0) / total) * 100;
    if (employerSyms.has((h.symbol || '').toUpperCase())) employerPct += pct;
    if (!isFund(h, q(h.symbol)) && pct > largestStock.pct) {
      largestStock = { symbol: h.symbol, pct };
    }
  }
  const concPct = Math.max(largestStock.pct, employerPct);
  let concScore;
  if      (concPct <= 5)  concScore = 25;
  else if (concPct <= 10) concScore = 20;
  else if (concPct <= 15) concScore = 14;
  else if (concPct <= 20) concScore = 9;
  else if (concPct <= 30) concScore = 4;
  else                    concScore = 0;
  const concIsEmployer = employerPct >= largestStock.pct && employerPct > 0;
  push({
    key: 'concentration', label: 'Concentration', score: concScore, max: 25,
    detail: `Largest single-company exposure: ${largestStock.symbol || '—'} at ${concPct.toFixed(1)}% of the portfolio${concIsEmployer ? ' (employer stock)' : ''}.`,
    action: concPct > concLimit
      ? `Reduce ${largestStock.symbol || 'the position'} below ${concLimit}% — a systematic sell-down (a fixed % each quarter) takes the timing decision off your plate. A single stock at ${concPct.toFixed(0)}% means a 50% fall in that one name is a ${(concPct / 2).toFixed(0)}% hit to your whole portfolio.`
      : 'No single company dominates the portfolio. Keep new employer grants from re-concentrating it.',
  });
  if (employerPct > 25) {
    caps.push({ grade: 'C', reason: `Employer stock is ${employerPct.toFixed(1)}% of the portfolio (>25%). Your salary and future grants already ride on this company, so this is a bigger risk than the raw number suggests — it caps the grade until it's below 25%.` });
  }

  // ── 2. Diversification (15 pts) — fund share of NON-employer equity ─────────
  // Measured on equity excluding the employer stock, so the same oversized
  // position isn't punished here as well as in Concentration (double-counting).
  const employerVal = holdings.filter(h => employerSyms.has((h.symbol || '').toUpperCase())).reduce((s, h) => s + (h.marketValue || 0), 0);
  const nonEmpEquity = Math.max(0, invested - employerVal);
  const fundVal = holdings
    .filter(h => !employerSyms.has((h.symbol || '').toUpperCase()) && isFund(h, q(h.symbol)))
    .reduce((s, h) => s + (h.marketValue || 0), 0);
  if (nonEmpEquity <= 0) {
    push({
      key: 'diversification', label: 'Diversification', score: 0, max: 15, applicable: false,
      detail: 'Everything outside your employer stock is uninvested — no diversified base to measure yet.',
      action: 'As you sell down the employer position, move the proceeds into broad index funds.',
    });
  } else {
    const fundShare = (fundVal / nonEmpEquity) * 100;
    let divScore;
    if      (fundShare >= 80) divScore = 15;
    else if (fundShare >= 60) divScore = 12;
    else if (fundShare >= 40) divScore = 8;
    else if (fundShare >= 25) divScore = 5;
    else                      divScore = 2;
    push({
      key: 'diversification', label: 'Diversification', score: divScore, max: 15,
      detail: `${fundShare.toFixed(0)}% of your non-employer investments are in diversified funds; the rest is individual stocks.`,
      action: fundShare < 60
        ? 'Direct new contributions (and single-stock sale proceeds) into broad index funds until funds carry most of the portfolio.'
        : 'Healthy fund base. Keep individual stocks as a small satellite.',
    });
  }

  // ── 3. Age-appropriate allocation (15 pts) — stock/bond mix vs glidepath ────
  // Uses your birth year + glidepath base (both already in Settings). N/A when
  // no age is known.
  const age = settings.birthYear ? (new Date().getFullYear() - settings.birthYear) : null;
  const bondVal = holdings.filter(h => isBondHolding(h, q(h.symbol))).reduce((s, h) => s + (h.marketValue || 0), 0);
  const equityGrowthVal = Math.max(0, invested - bondVal);
  if (age == null || invested <= 0) {
    push({
      key: 'allocation', label: 'Age-Appropriate Mix', score: 0, max: 15, applicable: false,
      detail: 'No birth year set — the stock/bond mix can\'t be checked against a retirement glidepath.',
      action: 'Add your birth year in Settings to unlock an age-based stock/bond check.',
    });
  } else {
    const targetEquityPct = Math.max(0, Math.min(100, (settings.glidepathBase ?? 110) - age));
    const actualEquityPct = (equityGrowthVal / total) * 100;
    const gap = Math.abs(actualEquityPct - targetEquityPct);
    let allocScore;
    if      (gap <= 5)  allocScore = 15;
    else if (gap <= 10) allocScore = 11;
    else if (gap <= 20) allocScore = 6;
    else                allocScore = 2;
    const overWeight = actualEquityPct > targetEquityPct;
    push({
      key: 'allocation', label: 'Age-Appropriate Mix', score: allocScore, max: 15,
      detail: `At age ${age}, a glidepath of ${settings.glidepathBase ?? 110}−age suggests ~${targetEquityPct.toFixed(0)}% stocks / ${(100 - targetEquityPct).toFixed(0)}% bonds. You hold ${actualEquityPct.toFixed(0)}% in growth assets.`,
      action: gap <= 5
        ? 'Your stock/bond mix fits your age. Rebalance toward bonds gradually as you approach retirement.'
        : overWeight
          ? 'You\'re more stock-heavy than your glidepath suggests. Direct new fixed-income buys (US-domiciled bond ETFs like BND/AGG) toward the gap.'
          : 'You\'re holding more bonds than your age needs — that can quietly cap long-run growth. Favour equity ETFs for new contributions.',
    });
  }

  // ── 4. Allocation drift (10 pts) — distance from your bucket targets ────────
  if (!targets || targets.length === 0) {
    push({
      key: 'drift', label: 'Allocation Drift', score: 0, max: 10, applicable: false,
      detail: 'No target allocation set — drift can\'t be measured.',
      action: 'Set bucket targets in the Targets view to unlock a drift check.',
    });
  } else {
    const byBucket = new Map();
    for (const h of holdings) {
      const b = h.bucket || 'unassigned';
      byBucket.set(b, (byBucket.get(b) || 0) + (h.marketValue || 0));
    }
    if (cash > 0) byBucket.set('cash', (byBucket.get('cash') || 0) + cash);
    let maxDrift = 0, worstBucket = null;
    for (const t of targets) {
      const actualPct = ((byBucket.get(t.bucket) || 0) / total) * 100;
      const drift = Math.abs(actualPct - t.targetPct);
      if (drift > maxDrift) { maxDrift = drift; worstBucket = t.bucket; }
    }
    let driftScore;
    if      (maxDrift <= tolerancePct)     driftScore = 10;
    else if (maxDrift <= tolerancePct * 2) driftScore = 7;
    else if (maxDrift <= tolerancePct * 3) driftScore = 3;
    else                                   driftScore = 0;
    push({
      key: 'drift', label: 'Allocation Drift', score: driftScore, max: 10,
      detail: `Largest drift from target: ${worstBucket ?? '—'} is ${maxDrift.toFixed(1)} points off (tolerance ±${tolerancePct}).`,
      action: driftScore < 10
        ? 'See the Drift table for the specific buy/sell amounts that restore your targets.'
        : 'Allocation is within tolerance — nothing to do.',
    });
  }

  // ── 5. Tax hygiene (15 pts) — PFIC exposure, scaled by size ────────────────
  // A $500 PFIC and a 60%-PFIC portfolio are not the same problem: score by how
  // much of the portfolio sits in foreign-domiciled funds, not a flat 0-or-all.
  const pficHoldings = holdings.filter(h => {
    const a = analyzeTicker(h.symbol, holdings, cash, q(h.symbol));
    return a && a.isPfic;
  });
  const pficVal = pficHoldings.reduce((s, h) => s + (h.marketValue || 0), 0);
  const pficPct = (pficVal / total) * 100;
  let taxScore;
  if      (pficHoldings.length === 0) taxScore = 15;
  else if (pficPct <= 2)  taxScore = 11;
  else if (pficPct <= 5)  taxScore = 8;
  else if (pficPct <= 15) taxScore = 4;
  else                    taxScore = 0;
  push({
    key: 'taxHygiene', label: 'Tax Hygiene', score: taxScore, max: 15,
    detail: pficHoldings.length === 0
      ? 'No PFIC (foreign-domiciled fund) exposure detected.'
      : `${pficHoldings.length} likely PFIC holding(s) at ${pficPct.toFixed(1)}% of the portfolio (${pficVal.toLocaleString('en-US', { maximumFractionDigits: 0 })}): ${pficHoldings.map(h => h.symbol).join(', ')}.`,
    action: pficHoldings.length === 0
      ? 'Keep buying US-domiciled funds only.'
      : 'Replace with US-domiciled equivalents and discuss Form 8621 for the current year with a US tax preparer. See the PFIC estimate on the Guidance page for the likely exit cost.',
  });
  // Only a material PFIC position is severe enough to cap the grade; a token
  // holding is a scored deduction, not a ceiling.
  if (pficPct > 10) {
    caps.push({ grade: 'B', reason: `PFIC holdings are ${pficPct.toFixed(1)}% of the portfolio (>10%) — a US-tax compliance issue large enough to resolve before anything else.` });
  }

  // ── 6. Cost (10 pts) — weighted fund expense ratio ─────────────────────────
  // N/A when no fund carries an expense ratio (e.g. a backfilled point with no
  // live quotes). Individual stocks count as 0% and drag the average down.
  let feeWeighted = 0, feeBase = 0, haveFeeData = false;
  for (const h of holdings) {
    const frac = expenseFraction(h, q(h.symbol));
    if (frac == null) continue;
    haveFeeData = true;
    feeWeighted += (h.marketValue || 0) * frac;
    feeBase += (h.marketValue || 0);
  }
  if (!haveFeeData || feeBase <= 0) {
    push({
      key: 'cost', label: 'Fund Costs', score: 0, max: 10, applicable: false,
      detail: 'No expense-ratio data available for this snapshot.',
      action: 'Refresh live prices to pull fund expense ratios.',
    });
  } else {
    const werPct = (feeWeighted / feeBase) * 100;
    let costScore;
    if      (werPct <= 0.10) costScore = 10;
    else if (werPct <= 0.20) costScore = 8;
    else if (werPct <= 0.40) costScore = 5;
    else if (werPct <= 0.75) costScore = 2;
    else                     costScore = 0;
    push({
      key: 'cost', label: 'Fund Costs', score: costScore, max: 10,
      detail: `Weighted average expense ratio across your holdings is ${werPct.toFixed(2)}% per year.`,
      action: costScore < 8
        ? 'Prefer low-cost broad index funds (typically ≤0.10%). Over decades, fees compound against you as surely as returns compound for you.'
        : 'Costs are low — nothing to do.',
    });
  }

  // ── 7. Cash deployment (10 pts) ────────────────────────────────────────────
  const cashPct = (cash / total) * 100;
  const bufferTarget = settings.cashDragThreshold ?? 5000;
  let cashScore;
  if      (cashPct <= 10 || cash <= bufferTarget) cashScore = 10;
  else if (cashPct <= 20)                         cashScore = 5;
  else                                            cashScore = 0;
  push({
    key: 'cashDrag', label: 'Cash Deployment', score: cashScore, max: 10,
    detail: `Cash is ${cashPct.toFixed(1)}% of the portfolio.`,
    action: cashScore < 10
      ? 'Deploy cash above your buffer into your core funds — idle cash is the quiet drag on a long-term plan.'
      : 'Cash level is fine.',
  });

  // ── Total, caps, grade ──────────────────────────────────────────────────────
  // Normalize over applicable dimensions only, so N/A rows never lower the grade.
  const applicable = breakdown.filter(b => b.applicable);
  const earned = applicable.reduce((s, b) => s + b.score, 0);
  const possible = applicable.reduce((s, b) => s + b.max, 0);
  const totalScore = possible > 0 ? Math.round((earned / possible) * 100) : 0;
  let { grade, label } = gradeFor(totalScore);
  for (const cap of caps) {
    const capped = worseGrade(grade, cap.grade);
    if (capped !== grade) { grade = capped; label = `Capped: ${cap.reason}`; }
  }

  return { totalScore, grade, gradeLabel: label, breakdown, caps };
}

// ── Dividend income projection ───────────────────────────────────────────────
// Sums quantity × trailing annual dividend rate from Yahoo quotes.
function projectAnnualDividends(holdings = [], quotes = {}) {
  let annual = 0;
  const perHolding = [];
  for (const h of holdings) {
    const quote = quotes[(h.symbol || '').toUpperCase()];
    const rate = quote?.trailingAnnualDividendRate;
    if (rate > 0 && h.quantity > 0) {
      const income = rate * h.quantity;
      annual += income;
      perHolding.push({ symbol: h.symbol, annualIncome: income });
    }
  }
  perHolding.sort((a, b) => b.annualIncome - a.annualIncome);
  return { annual, perHolding };
}

// The exact set of inputs the health score depends on, as a stable object for
// cache-invalidation. It MUST list every portfolio field and every setting that
// computePortfolioHealth reads — anything omitted leaves a stale score cached
// when the user changes it. Kept next to the computation so the two move
// together (birthYear + glidepathBase feed Age-Appropriate Mix;
// dividendTaxRatePct feeds the tax-drag dimension).
function healthInputMaterial(p = {}, settings = {}) {
  return {
    holdings: p.holdings,
    cash: p.cash,
    targets: p.targets,
    tolerancePct: p.tolerancePct,
    employerSymbols: p.employerSymbols,
    cashDragThreshold: settings.cashDragThreshold ?? null,
    concentrationLimitPct: settings.concentrationLimitPct ?? null,
    birthYear: settings.birthYear ?? null,
    glidepathBase: settings.glidepathBase ?? null,
    dividendTaxRatePct: settings.dividendTaxRatePct ?? null,
  };
}

module.exports = { computePortfolioHealth, projectAnnualDividends, healthInputMaterial };
