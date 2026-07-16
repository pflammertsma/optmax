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

function computePortfolioHealth({ holdings = [], cash = 0, targets = [], tolerancePct = 5, quotes = {}, settings = {} } = {}) {
  const total = holdings.reduce((s, h) => s + (h.marketValue || 0), 0) + (cash || 0);
  if (total <= 0) return null;

  const q = sym => quotes[(sym || '').toUpperCase()] || null;
  const breakdown = [];
  const caps = [];

  // ── 1. Concentration (35 pts) — largest single-company position ────────────
  let largestStock = { symbol: null, pct: 0 };
  let employerPct = 0;
  for (const h of holdings) {
    const pct = ((h.marketValue || 0) / total) * 100;
    if (h.isEmployerStock) employerPct += pct;
    if (!isFund(h, q(h.symbol)) && pct > largestStock.pct) {
      largestStock = { symbol: h.symbol, pct };
    }
  }
  const concPct = Math.max(largestStock.pct, employerPct);
  let concScore;
  if      (concPct <= 5)  concScore = 35;
  else if (concPct <= 10) concScore = 28;
  else if (concPct <= 15) concScore = 20;
  else if (concPct <= 20) concScore = 12;
  else if (concPct <= 30) concScore = 6;
  else                    concScore = 0;
  breakdown.push({
    key: 'concentration', label: 'Concentration', score: concScore, max: 35,
    detail: `Largest single-company exposure: ${largestStock.symbol || '—'} at ${concPct.toFixed(1)}% of the portfolio${employerPct > 0 ? ' (employer stock)' : ''}.`,
    action: concPct > 10
      ? `Reduce ${largestStock.symbol} below 10% — a systematic sell-down (e.g. a fixed % each quarter) removes the emotion from it.`
      : 'No single company dominates the portfolio. Keep new employer grants from re-concentrating it.',
  });
  if (employerPct > 25) {
    caps.push({ grade: 'C', reason: `Employer stock is ${employerPct.toFixed(1)}% of the portfolio (>25%) — this risk overrides other strengths.` });
  }

  // ── 2. Diversification (25 pts) — share of equity in diversified funds ─────
  const equityVal = holdings.reduce((s, h) => s + (h.marketValue || 0), 0);
  const fundVal = holdings.filter(h => isFund(h, q(h.symbol))).reduce((s, h) => s + (h.marketValue || 0), 0);
  const fundShare = equityVal > 0 ? (fundVal / equityVal) * 100 : 0;
  let divScore;
  if      (fundShare >= 80) divScore = 25;
  else if (fundShare >= 60) divScore = 20;
  else if (fundShare >= 40) divScore = 14;
  else if (fundShare >= 25) divScore = 8;
  else                      divScore = 3;
  breakdown.push({
    key: 'diversification', label: 'Diversification', score: divScore, max: 25,
    detail: `${fundShare.toFixed(0)}% of your invested assets are in diversified funds; the rest is individual stocks.`,
    action: fundShare < 60
      ? 'Direct new contributions (and single-stock sale proceeds) into broad index funds until funds carry most of the portfolio.'
      : 'Healthy fund base. Keep individual stocks as a small satellite.',
  });

  // ── 3. Allocation drift (15 pts) — distance from your targets ──────────────
  let driftScore = 0;
  let driftDetail, driftAction;
  if (!targets || targets.length === 0) {
    driftDetail = 'No target allocation set — drift cannot be measured.';
    driftAction = 'Set bucket targets in the Targets view; the app can only flag drift once it knows your plan.';
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
    if      (maxDrift <= tolerancePct)     driftScore = 15;
    else if (maxDrift <= tolerancePct * 2) driftScore = 10;
    else if (maxDrift <= tolerancePct * 3) driftScore = 5;
    else                                   driftScore = 0;
    driftDetail = `Largest drift from target: ${worstBucket ?? '—'} is ${maxDrift.toFixed(1)} points off (tolerance ±${tolerancePct}).`;
    driftAction = driftScore < 15
      ? 'See the Drift table for the specific buy/sell amounts that restore your targets.'
      : 'Allocation is within tolerance — nothing to do.';
  }
  breakdown.push({ key: 'drift', label: 'Allocation Drift', score: driftScore, max: 15, detail: driftDetail, action: driftAction });

  // ── 4. Tax hygiene (15 pts) — PFIC exposure ────────────────────────────────
  const pficHoldings = holdings.filter(h => {
    const a = analyzeTicker(h.symbol, holdings, cash, q(h.symbol));
    return a && a.isPfic;
  });
  const pficVal = pficHoldings.reduce((s, h) => s + (h.marketValue || 0), 0);
  const taxScore = pficHoldings.length === 0 ? 15 : 0;
  breakdown.push({
    key: 'taxHygiene', label: 'Tax Hygiene', score: taxScore, max: 15,
    detail: pficHoldings.length === 0
      ? 'No PFIC (foreign-domiciled fund) exposure detected.'
      : `${pficHoldings.length} likely PFIC holding(s) worth ${pficVal.toLocaleString('en-US', { maximumFractionDigits: 0 })}: ${pficHoldings.map(h => h.symbol).join(', ')}.`,
    action: pficHoldings.length === 0
      ? 'Keep buying US-domiciled funds only.'
      : 'Replace with US-domiciled equivalents and discuss Form 8621 for the current year with a US tax preparer.',
  });
  if (pficHoldings.length > 0) {
    caps.push({ grade: 'B', reason: 'PFIC holdings present — a US-tax compliance issue that needs resolving.' });
  }

  // ── 5. Cash drag (10 pts) ───────────────────────────────────────────────────
  const cashPct = (cash / total) * 100;
  const bufferTarget = settings.cashDragThreshold ?? 5000;
  let cashScore;
  if      (cashPct <= 10 || cash <= bufferTarget) cashScore = 10;
  else if (cashPct <= 20)                         cashScore = 5;
  else                                            cashScore = 0;
  breakdown.push({
    key: 'cashDrag', label: 'Cash Deployment', score: cashScore, max: 10,
    detail: `Cash is ${cashPct.toFixed(1)}% of the portfolio.`,
    action: cashScore < 10
      ? 'Deploy cash above your buffer into your core funds — idle cash is the quiet drag on a 25-year plan.'
      : 'Cash level is fine.',
  });

  // ── Total, caps, grade ──────────────────────────────────────────────────────
  const totalScore = breakdown.reduce((s, b) => s + b.score, 0);
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

module.exports = { computePortfolioHealth, projectAnnualDividends };
