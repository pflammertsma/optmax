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
const { dividendYieldPct } = require('./yield');

function toUpper(s) { return (s || '').toUpperCase().trim(); }

// Vetted static breadth — US-domiciled (PFIC-safe) names that broaden every
// category deterministically, independent of any live screener. Kept here (not
// in CURATED_CANDIDATES) so the tighter Action-Plan recommender stays focused
// while the browsable scanner gets depth. Quotes still drive final
// classification + scoring; kind/bucket are only hints.
const EXTRA_SEEDS = [
  // Thematic / sector ETFs
  { symbol: 'QQQM', name: 'Invesco Nasdaq-100',            bucket: 'core',      kind: 'equity' },
  { symbol: 'VGT',  name: 'Vanguard Information Technology',bucket: 'satellite', kind: 'equity' },
  { symbol: 'SMH',  name: 'VanEck Semiconductor',          bucket: 'satellite', kind: 'equity' },
  { symbol: 'VHT',  name: 'Vanguard Health Care',          bucket: 'satellite', kind: 'equity' },
  { symbol: 'VDE',  name: 'Vanguard Energy',               bucket: 'satellite', kind: 'equity' },
  { symbol: 'XLF',  name: 'Financial Select Sector',       bucket: 'satellite', kind: 'equity' },
  { symbol: 'VNQ',  name: 'Vanguard Real Estate',          bucket: 'satellite', kind: 'equity' },
  { symbol: 'MOAT', name: 'VanEck Morningstar Wide Moat',  bucket: 'satellite', kind: 'equity' },
  { symbol: 'COWZ', name: 'Pacer US Cash Cows 100',        bucket: 'satellite', kind: 'equity' },
  { symbol: 'AVUV', name: 'Avantis US Small Cap Value',    bucket: 'satellite', kind: 'equity' },
  { symbol: 'VO',   name: 'Vanguard Mid-Cap',              bucket: 'core',      kind: 'equity' },
  { symbol: 'VB',   name: 'Vanguard Small-Cap',            bucket: 'core',      kind: 'equity' },
  { symbol: 'NLR',  name: 'VanEck Uranium+Nuclear Energy', bucket: 'satellite', kind: 'equity' },
  // Dividend-GROWTH ETFs (quality over raw yield — tax-smart for CH)
  { symbol: 'VIG',  name: 'Vanguard Dividend Appreciation',bucket: 'core',      kind: 'equity' },
  { symbol: 'DGRO', name: 'iShares Core Dividend Growth',  bucket: 'core',      kind: 'equity' },
  { symbol: 'VYM',  name: 'Vanguard High Dividend Yield',  bucket: 'core',      kind: 'equity' },
  // Bonds — a bit more of the curve
  { symbol: 'BNDX', name: 'Vanguard Total Intl Bond',      bucket: 'core',      kind: 'bond' },
  { symbol: 'TLT',  name: 'iShares 20+ Year Treasury',     bucket: 'core',      kind: 'bond' },
  { symbol: 'TIP',  name: 'iShares TIPS Bond',             bucket: 'core',      kind: 'bond' },
  { symbol: 'VTIP', name: 'Vanguard Short-Term TIPS',      bucket: 'core',      kind: 'bond' },
  // Quality large-cap dividend growers (individual stocks)
  { symbol: 'JNJ',  name: 'Johnson & Johnson',             bucket: 'satellite', kind: 'equity' },
  { symbol: 'PG',   name: 'Procter & Gamble',              bucket: 'satellite', kind: 'equity' },
  { symbol: 'KO',   name: 'Coca-Cola',                     bucket: 'satellite', kind: 'equity' },
  { symbol: 'PEP',  name: 'PepsiCo',                       bucket: 'satellite', kind: 'equity' },
  { symbol: 'MCD',  name: "McDonald's",                    bucket: 'satellite', kind: 'equity' },
  { symbol: 'HD',   name: 'Home Depot',                    bucket: 'satellite', kind: 'equity' },
  { symbol: 'ABBV', name: 'AbbVie',                        bucket: 'satellite', kind: 'equity' },
  { symbol: 'TXN',  name: 'Texas Instruments',             bucket: 'satellite', kind: 'equity' },
  { symbol: 'AVGO', name: 'Broadcom',                      bucket: 'satellite', kind: 'equity' },
  { symbol: 'UNP',  name: 'Union Pacific',                 bucket: 'satellite', kind: 'equity' },
  { symbol: 'COST', name: 'Costco',                        bucket: 'satellite', kind: 'equity' },
  // Quality large-cap growth (individual stocks)
  { symbol: 'MSFT', name: 'Microsoft',                     bucket: 'satellite', kind: 'equity' },
  { symbol: 'AAPL', name: 'Apple',                         bucket: 'satellite', kind: 'equity' },
  { symbol: 'NVDA', name: 'NVIDIA',                        bucket: 'satellite', kind: 'equity' },
  { symbol: 'AMZN', name: 'Amazon',                        bucket: 'satellite', kind: 'equity' },
  { symbol: 'V',    name: 'Visa',                          bucket: 'satellite', kind: 'equity' },
  { symbol: 'MA',   name: 'Mastercard',                    bucket: 'satellite', kind: 'equity' },
  { symbol: 'UNH',  name: 'UnitedHealth',                  bucket: 'satellite', kind: 'equity' },
  { symbol: 'LLY',  name: 'Eli Lilly',                     bucket: 'satellite', kind: 'equity' },
];

const KNOWN_EXPENSE_RATIOS = {
  VTI: 0.03, VOO: 0.03, VT: 0.07, VUG: 0.04, SCHG: 0.04, VXUS: 0.08, VEA: 0.06, IEMG: 0.09,
  BND: 0.03, AGG: 0.03, SGOV: 0.07, SCHD: 0.06, JEPQ: 0.35, QQQM: 0.15, QQQ: 0.20, VGT: 0.10,
  SMH: 0.35, VHT: 0.10, VDE: 0.10, XLF: 0.09, VNQ: 0.13, MOAT: 0.46, COWZ: 0.39, AVUV: 0.25,
  VO: 0.04, VB: 0.05, NLR: 0.60, VIG: 0.06, DGRO: 0.08, VYM: 0.06, BNDX: 0.07, TLT: 0.15,
  TIP: 0.19, VTIP: 0.04, SPY: 0.09, IVV: 0.03, IWM: 0.19, DIA: 0.16, XLE: 0.09, XLK: 0.09,
  XLV: 0.09, XLI: 0.09, XLP: 0.09, XLU: 0.09, XLC: 0.09, XLB: 0.09, SCHB: 0.03, SCHF: 0.06,
  SCHA: 0.04, SCHE: 0.11, JEPI: 0.35, DGRW: 0.28, QYLD: 0.61, XYLD: 0.60, ARKK: 0.75,
};

// Live trailing yield (%) with a coarse fallback — mirrors recommendations.js.
// Delegates to the shared resolver (lib/yield.js) so the scanner, the
// recommender and the symbol dialog can never disagree about a yield.
function liveYieldPct(quote, fallback) {
  return dividendYieldPct(quote, fallback ?? 0);
}

function expenseRatioPct(quote, fallback) {
  if (quote) {
    if (quote.annualReportExpenseRatio != null) return Math.round(quote.annualReportExpenseRatio * 10000) / 100;
    if (quote.expenseRatioPct != null) return quote.expenseRatioPct;
    if (quote.expenseRatio != null) return Math.round(quote.expenseRatio * 10000) / 100;
  }
  return fallback ?? null;
}

function scanInvestments({ holdings = [], cash = 0, targets = [], settings = {}, quotes = {}, watchlistData = [], discovered = [], maxPerCategory = 60 } = {}) {
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
  // Curated shortlist + vetted breadth seeds + your holdings + watchlist A/B +
  // anything live discovery surfaced (screeners / similar-to-holdings).
  const seen = new Set();
  const candidates = [];
  for (const c of CURATED_CANDIDATES) { seen.add(c.symbol); candidates.push({ ...c, source: 'curated' }); }
  for (const s of EXTRA_SEEDS) {
    if (seen.has(s.symbol)) continue;
    seen.add(s.symbol);
    candidates.push({ ...s, yieldPct: null, source: 'seed' });
  }
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
  for (const d of discovered) {
    const sym = toUpper(d && d.symbol);
    if (!sym || seen.has(sym) || sym.length > 8) continue;
    seen.add(sym);
    candidates.push({ symbol: sym, name: d.name || sym, bucket: d.bucket || 'satellite', kind: d.kind || null, yieldPct: null, source: 'discovery', discoveryHint: d.hint || null });
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

    // Quality guard for LIVE-discovered names (screeners surface junk): require a
    // real USD quote, meaningful size, and a non-penny price. Curated + vetted
    // seeds + your own holdings are trusted and skip this.
    if (c.source === 'discovery') {
      if (!quote || (quote.currency || 'USD').toUpperCase() !== 'USD') continue;
      if (!isFund && ((quote.marketCap || 0) < 2e9 || (quote.regularMarketPrice || 0) < 5)) continue;
    }

    const yieldPct = liveYieldPct(quote, c.yieldPct);
    const taxDragPct = (yieldPct * dividendTaxRatePct) / 100;
    const erPct = isFund ? expenseRatioPct(quote, c.expenseRatioPct || KNOWN_EXPENSE_RATIOS[sym]) : null;
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

    if (c.discoveryHint) reasons.push(c.discoveryHint);

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

  // ── Categorize + rank (capped so aggressive discovery can't flood a tab) ─────
  const cap = arr => (maxPerCategory > 0 ? arr.slice(0, maxPerCategory) : arr);
  const etf = cap(rows.filter(r => r.isFund && r.kind !== 'bond')
    .sort((a, b) => (b.buyHoldScore - a.buyHoldScore) || (a.taxDragPct - b.taxDragPct)));
  const bond = cap(rows.filter(r => r.kind === 'bond')
    .sort((a, b) => (b.buyHoldScore - a.buyHoldScore) || (a.taxDragPct - b.taxDragPct)));
  const stock = cap(rows.filter(r => !r.isFund)
    .sort((a, b) => (b.buyHoldScore - a.buyHoldScore) || ((b.marketCap ?? 0) - (a.marketCap ?? 0))));
  // Dividend: anything paying real income, ranked by the after-tax dividend lens.
  const dividend = cap(rows.filter(r => r.yieldPct >= 1)
    .sort((a, b) => (b.dividendScore - a.dividendScore) || (a.taxDragPct - b.taxDragPct)));

function estimateIbkrFeeUsd(amountUsd, price) {
  if (!amountUsd || amountUsd <= 0) return 0;
  const estimatedShares = price && price > 0 ? Math.ceil(amountUsd / price) : Math.ceil(amountUsd / 100);
  const shareFee = estimatedShares * 0.0035;
  const fee = Math.max(0.35, Math.min(amountUsd * 0.01, shareFee));
  return Math.round(fee * 100) / 100;
}

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
    const qPrice = (quotes[r.symbol] && quotes[r.symbol].regularMarketPrice) || null;
    r.estFeeUsd = estimateIbkrFeeUsd(r.suggestedUsd, qPrice);
    cashLeft -= amt;
    filled.add(r.bucket);
  }

  const recommendation = primary.filter(r => r.suggestedUsd > 0);
  if (!recommendation.length) {
    if (bondsFirst && bond[0]) recommendation.push(bond[0]);
    if (etf[0] && !recommendation.includes(etf[0])) recommendation.push(etf[0]);
    if (stock[0] && !recommendation.includes(stock[0])) recommendation.push(stock[0]);
  }

  return {
    categories: { recommendation, etf, bond, stock, dividend },
    deployableCash: Math.round(deployableCash),
    glidepathNote, bondsFirst,
  };
}

module.exports = { scanInvestments, EXTRA_SEEDS };
