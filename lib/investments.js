'use strict';

// Investment scanner: ranks "what to buy" candidates into categories (ETFs,
// bonds, individual stocks, dividend income), each scored through the relevant
// lens and filtered for the user's tax profile (PFIC-safe for US persons,
// dividend-tax-aware). Pure — no side effects, no API calls. Feeds the
// Investment Scanner page the same way the option data feeds the Option Scanner.
//
// This is the "full ranking" companion to generateBuyRecommendations: that one
// surfaces only the ~8 rows the current bucket gaps call for; this one ranks the
// whole candidate universe per category so the user can browse ideas.

const { analyzeTicker } = require('./guidance');
const { isUSPerson } = require('./pfic');
const { scoreLenses } = require('./lensscores');
const { CURATED_CANDIDATES, PFIC_REPLACEMENTS } = require('./recommendations');

function toUpper(s) { return (s || '').toUpperCase().trim(); }

// Live trailing yield (%) with a coarse fallback — mirrors recommendations.js.
function liveYieldPct(quote, fallback) {
  if (quote) {
    if (quote.trailingAnnualDividendYield > 0) return quote.trailingAnnualDividendYield * 100;
    if (quote.trailingAnnualDividendRate > 0 && quote.regularMarketPrice > 0) {
      return (quote.trailingAnnualDividendRate / quote.regularMarketPrice) * 100;
    }
    if (quote.dividendYield > 0) return quote.dividendYield;
  }
  return fallback ?? 0;
}

function expenseRatioPct(quote) {
  if (!quote) return null;
  if (quote.annualReportExpenseRatio != null) return Math.round(quote.annualReportExpenseRatio * 10000) / 100;
  if (quote.expenseRatioPct != null) return quote.expenseRatioPct;
  if (quote.expenseRatio != null) return Math.round(quote.expenseRatio * 10000) / 100;
  return null;
}

function scanInvestments({ holdings = [], cash = 0, targets = [], settings = {}, quotes = {}, watchlistData = [] } = {}) {
  const total = holdings.reduce((s, h) => s + (h.marketValue || 0), 0) + (cash || 0);
  const empty = { categories: { etf: [], bond: [], stock: [], dividend: [] }, deployableCash: 0, glidepathNote: null, bondsFirst: false };
  if (total <= 0) return empty;

  const dividendTaxRatePct = settings.dividendTaxRatePct ?? 30;
  const usPerson = isUSPerson(settings);
  const employerSyms = new Set(toUpper(settings.employerSymbols).split(',').map(s => s.trim()).filter(Boolean));
  for (const h of holdings) if (h.isEmployerStock) employerSyms.add(toUpper(h.symbol));
  const cashBuffer = settings.cashDragThreshold ?? 5000;
  const deployableCash = Math.max(0, (cash || 0) - cashBuffer);

  // Bucket underweight ($) — reused as the "why buy this" reason and to size hints.
  const actualBuckets = new Map();
  for (const h of holdings) {
    const b = h.bucket || 'unassigned';
    actualBuckets.set(b, (actualBuckets.get(b) || 0) + (h.marketValue || 0));
  }
  if (cash > 0) actualBuckets.set('cash', (actualBuckets.get('cash') || 0) + cash);
  const underweightByBucket = new Map();
  for (const t of targets) {
    const actualPct = ((actualBuckets.get(t.bucket) || 0) / total) * 100;
    const driftPct = actualPct - t.targetPct;
    if (driftPct < 0) underweightByBucket.set(t.bucket, (-driftPct / 100) * total);
  }

  // Glidepath: are equities above the age target? Then bonds are the priority.
  let bondsFirst = false, glidepathNote = null;
  if (settings.birthYear) {
    const age = new Date().getFullYear() - settings.birthYear;
    const targetEquityPct = Math.max(0, Math.min(100, (settings.glidepathBase ?? 110) - age));
    let equitiesVal = 0;
    for (const h of holdings) {
      if (h.assetCategory === 'OPT' || (h.symbol || '').length > 8) continue;
      const a = analyzeTicker(h.symbol, holdings, cash, quotes[toUpper(h.symbol)]);
      if (a && a.type !== 'bond etf' && a.type !== 'cash') equitiesVal += h.marketValue || 0;
    }
    const actualEquityPct = (equitiesVal / total) * 100;
    if (actualEquityPct - targetEquityPct > 5) {
      bondsFirst = true;
      glidepathNote = `Equities are ${actualEquityPct.toFixed(0)}% vs your age-${age} glidepath target of ${targetEquityPct.toFixed(0)}% — fixed income comes first.`;
    }
  }

  // ── Candidate universe ─────────────────────────────────────────────────────
  const seen = new Set();
  const candidates = [];
  for (const c of CURATED_CANDIDATES) { seen.add(c.symbol); candidates.push({ ...c, source: 'curated' }); }
  for (const h of holdings) {
    const sym = toUpper(h.symbol);
    if (!sym || seen.has(sym) || h.assetCategory === 'OPT' || sym.length > 8) continue;
    seen.add(sym);
    candidates.push({ symbol: sym, name: h.description || sym, bucket: h.bucket || 'unassigned', kind: null, yieldPct: null, source: 'holding' });
  }
  for (const w of watchlistData) {
    const sym = toUpper(w && w.symbol);
    if (!sym || seen.has(sym)) continue;
    if (!['A', 'B'].includes(w.grade)) continue; // only quality names from the scan
    seen.add(sym);
    candidates.push({ symbol: sym, name: sym, bucket: 'satellite', kind: 'equity', yieldPct: null, source: 'watchlist', watchlistInfo: w });
  }

  // ── Score + categorize ─────────────────────────────────────────────────────
  const rows = [];
  for (const c of candidates) {
    const sym = c.symbol;
    const quote = quotes[sym];
    const analysis = analyzeTicker(sym, holdings, cash, quote);

    if (employerSyms.has(sym)) continue;                       // never suggest more employer stock
    if (analysis && analysis.isPfic && usPerson) continue;     // PFIC — excluded for US persons
    const isFund = !!(analysis && (analysis.type === 'etf' || analysis.type === 'bond etf'));
    const kind = c.kind || (analysis && analysis.type === 'bond etf' ? 'bond' : 'equity');
    // Don't push a single stock that's already near the concentration cap.
    if (!isFund && analysis && analysis.weightPct >= 8) continue;

    const yieldPct = liveYieldPct(quote, c.yieldPct);
    const taxDragPct = (yieldPct * dividendTaxRatePct) / 100;
    const erPct = expenseRatioPct(quote);
    const marketCap = quote ? (quote.marketCap ?? null) : null;

    const lensInput = {
      symbol: sym,
      quoteType: quote && quote.quoteType ? quote.quoteType : (isFund ? 'ETF' : 'EQUITY'),
      analysis, expenseRatioPct: erPct, yieldPct, marketCap,
    };
    const lenses = scoreLenses(lensInput, { usPerson, dividendTaxRatePct });

    const bucketNeedUsd = underweightByBucket.get(c.bucket) || 0;
    const reasons = [];
    if (bucketNeedUsd > 0) reasons.push(`${c.bucket} underweight by $${Math.round(bucketNeedUsd).toLocaleString('en-US')}`);
    if (bondsFirst && kind === 'bond') reasons.push('closes your glidepath fixed-income gap');
    if (c.watchlistInfo) reasons.push(`scan grade ${c.watchlistInfo.grade}`);

    rows.push({
      symbol: sym,
      name: c.name,
      bucket: c.bucket,
      kind, isFund, source: c.source,
      yieldPct: Math.round(yieldPct * 100) / 100,
      taxDragPct: Math.round(taxDragPct * 100) / 100,
      expenseRatioPct: erPct,
      marketCap,
      buyHoldScore: lenses.buyHold.score, buyHoldGrade: lenses.buyHold.grade,
      dividendScore: lenses.dividend.score, dividendGrade: lenses.dividend.grade,
      bucketNeedUsd: Math.round(bucketNeedUsd),
      reasons,
    });
  }

  // ── Categorize + rank ───────────────────────────────────────────────────────
  const etf = rows.filter(r => r.isFund && r.kind !== 'bond')
    .sort((a, b) => (b.buyHoldScore - a.buyHoldScore) || (a.taxDragPct - b.taxDragPct));
  const bond = rows.filter(r => r.kind === 'bond')
    .sort((a, b) => (b.buyHoldScore - a.buyHoldScore) || (a.taxDragPct - b.taxDragPct));
  const stock = rows.filter(r => !r.isFund)
    .sort((a, b) => (b.buyHoldScore - a.buyHoldScore) || ((b.marketCap ?? 0) - (a.marketCap ?? 0)));
  // Dividend: anything paying real income, ranked by the after-tax dividend lens.
  const dividend = rows.filter(r => r.yieldPct >= 1)
    .sort((a, b) => (b.dividendScore - a.dividendScore) || (a.taxDragPct - b.taxDragPct));

  // Suggested $: greedily fill each underweight bucket from deployable cash,
  // assigned to that bucket's top-ranked ETF/bond pick (bonds first if the
  // glidepath calls for it). Purely a hint; exact sizing lives in the Action Plan.
  let cashLeft = deployableCash;
  const primary = bondsFirst ? [...bond, ...etf] : [...etf, ...bond];
  const filled = new Set();
  for (const r of primary) {
    const need = underweightByBucket.get(r.bucket) || 0;
    if (need <= 0 || cashLeft <= 0 || filled.has(r.bucket)) continue;
    const amt = Math.min(cashLeft, need);
    r.suggestedUsd = Math.round(amt);
    cashLeft -= amt;
    filled.add(r.bucket);
  }

  return {
    categories: { etf, bond, stock, dividend },
    deployableCash: Math.round(deployableCash),
    glidepathNote, bondsFirst,
  };
}

module.exports = { scanInvestments };
