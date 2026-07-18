'use strict';

// Tax-aware buy-recommendation engine for a US citizen (PFIC rules apply),
// NL citizen (Dutch dividend withholding on NL-source names), resident in
// Switzerland (private capital gains untaxed; dividends and bond interest
// taxed as ordinary income). Everything here is rules-based and derived from
// the user's own targets and settings — it surfaces what those rules imply,
// it is not financial advice.
//
// The single most strategy-shaping consequence of this tax profile:
// every 1% of dividend yield is a real recurring tax cost, while price
// appreciation is essentially tax-free. So between two funds with the same
// exposure, the lower-yield one wins, and high-distribution products
// (JEPQ/JEPI/SCHD) carry a quantified penalty rather than a ban.

const { analyzeTicker } = require('./guidance');
const { isUSPerson } = require('./pfic');

// Curated US-domiciled building blocks. yieldPct values are coarse fallbacks
// used only when no live quote is available; live trailing yield always wins.
const CURATED_CANDIDATES = [
  // Core equity — broad market, low yield (tax-efficient for CH residents)
  { symbol: 'VTI',  name: 'Vanguard Total US Stock Market',   bucket: 'core',      kind: 'equity', yieldPct: 1.3 },
  { symbol: 'VOO',  name: 'Vanguard S&P 500',                 bucket: 'core',      kind: 'equity', yieldPct: 1.3 },
  { symbol: 'VT',   name: 'Vanguard Total World',             bucket: 'core',      kind: 'equity', yieldPct: 1.9 },
  // Growth tilt — lowest yield, most tax-efficient equity exposure in CH
  { symbol: 'VUG',  name: 'Vanguard Growth',                  bucket: 'core',      kind: 'equity', yieldPct: 0.5 },
  { symbol: 'SCHG', name: 'Schwab US Large-Cap Growth',       bucket: 'core',      kind: 'equity', yieldPct: 0.4 },
  // International — diversification, but structurally higher yield
  { symbol: 'VXUS', name: 'Vanguard Total International',     bucket: 'core',      kind: 'equity', yieldPct: 3.0 },
  { symbol: 'VEA',  name: 'Vanguard Developed Markets',       bucket: 'core',      kind: 'equity', yieldPct: 3.0 },
  { symbol: 'IEMG', name: 'iShares Core MSCI Emerging Mkts',  bucket: 'core',      kind: 'equity', yieldPct: 2.7 },
  // Fixed income — glidepath risk control; interest fully taxed in CH
  { symbol: 'BND',  name: 'Vanguard Total Bond Market',       bucket: 'core',      kind: 'bond',   yieldPct: 4.2 },
  { symbol: 'AGG',  name: 'iShares Core US Aggregate Bond',   bucket: 'core',      kind: 'bond',   yieldPct: 4.1 },
  { symbol: 'SGOV', name: 'iShares 0-3 Month Treasury',       bucket: 'core',      kind: 'bond',   yieldPct: 5.0 },
  // Income products — kept in the universe so the tax penalty is VISIBLE
  { symbol: 'SCHD', name: 'Schwab US Dividend Equity',        bucket: 'core',      kind: 'equity', yieldPct: 3.5 },
  { symbol: 'JEPQ', name: 'JPMorgan Nasdaq Equity Premium',   bucket: 'core',      kind: 'equity', yieldPct: 9.0 },
];

// US-domiciled equivalents for common UCITS/foreign funds. Anything not in
// this map still gets flagged for replacement, just without a named target.
const PFIC_REPLACEMENTS = {
  IWDA: 'VT', IWDC: 'VT', VWRL: 'VT', VWCE: 'VT',
  CSPX: 'VOO', VUSA: 'VOO', VUAA: 'VOO', VUSD: 'VOO', IUSA: 'VOO', SXR8: 'VOO', CSSPX: 'VOO',
  IUSC: 'VB',            // US small/mid-cap exposure, US-domiciled
  EIMI: 'IEMG',
  NUCL: 'NLR',           // nuclear/uranium theme, US-domiciled
  UMI:  'URNM',          // uranium miners, US-domiciled
};

// NL-domiciled operating companies: 15% Dutch dividend withholding applies
// (creditable, but worth surfacing since the user is also an NL citizen).
const NL_SOURCE_STOCKS = new Set(['ASML', 'ASM', 'HEIA', 'AD', 'INGA', 'PHIA', 'UNA', 'RAND', 'WKL', 'ADYEN']);

function toUpper(s) { return (s || '').toUpperCase().trim(); }

function liveYieldPct(quote, fallback) {
  if (quote) {
    // Yahoo reports trailingAnnualDividendYield as a fraction (0.013 = 1.3%),
    // but zeroes it out for many ETFs (IEFA, VT in practice) while still
    // populating dividendYield — which is already in percent (3.4 = 3.4%).
    if (quote.trailingAnnualDividendYield > 0) return quote.trailingAnnualDividendYield * 100;
    if (quote.trailingAnnualDividendRate > 0 && quote.regularMarketPrice > 0) {
      return (quote.trailingAnnualDividendRate / quote.regularMarketPrice) * 100;
    }
    if (quote.dividendYield > 0) return quote.dividendYield;
  }
  return fallback ?? 0;
}

function buildTaxNotes({ symbol, kind, yieldPct, taxDragPct, dividendTaxRatePct }) {
  const notes = [];
  if (kind === 'bond') {
    notes.push(`Bond interest is fully taxed as income in Switzerland — hold for risk control per your glidepath, not for yield.`);
  }
  if (yieldPct >= 0.05) {
    notes.push(`~${yieldPct.toFixed(1)}% yield ≈ ${taxDragPct.toFixed(2)}%/yr tax drag at your ${dividendTaxRatePct}% dividend rate (CH taxes dividends as income; US qualified rates apply with <span class="help-tooltip" style="border-bottom: 1px dotted var(--text-secondary); cursor: help;" title="As a US citizen living in Switzerland, you are taxed by both countries on your dividends. However, the US lets you claim a credit for Swiss taxes you already paid, so you don't pay tax twice on the same money. The 'interplay' is the complex way these Swiss tax credits offset your US tax bill to produce a final combined tax rate.">foreign tax credit interplay</span>).`);
  } else {
    notes.push(`Minimal distributions — in Switzerland unrealized gains are tax-free for private investors, making low-yield funds the most tax-efficient equity exposure for you.`);
  }
  if (NL_SOURCE_STOCKS.has(symbol)) {
    notes.push(`NL-source dividends carry 15% Dutch withholding (generally creditable on your US return).`);
  }
  if (symbol.endsWith('.SW')) {
    notes.push(`Swiss 35% withholding applies to CH-source dividends — reclaimable for CH residents via your tax return.`);
  }
  return notes;
}

// holdings/cash/targets/settings/quotes match the shapes used across the app.
// quotes is keyed by uppercase symbol; each may carry trailingAnnualDividend*.
function generateBuyRecommendations({ holdings = [], cash = 0, targets = [], settings = {}, quotes = {}, watchlistData = [] } = {}) {
  const total = holdings.reduce((s, h) => s + (h.marketValue || 0), 0) + (cash || 0);
  const excluded = [];
  const swaps = [];
  if (total <= 0) return { recommendations: [], swaps, excluded, deployableCash: 0 };

  const dividendTaxRatePct = settings.dividendTaxRatePct ?? 30;
  const usPerson = isUSPerson(settings); // PFIC exclusion/swaps are US-person-only
  const employerSyms = new Set(toUpper(settings.employerSymbols).split(',').map(s => s.trim()).filter(Boolean));
  const cashBuffer = settings.cashDragThreshold ?? 5000;
  const deployableCash = Math.max(0, (cash || 0) - cashBuffer);

  // ── Bucket drift (underweight $ per bucket) ──────────────────────────────
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

  // ── Glidepath direction ──────────────────────────────────────────────────
  // If equities exceed the age-based target, bond candidates take priority.
  let bondsFirst = false;
  let glidepathNote = null;
  if (settings.birthYear) {
    const age = new Date().getFullYear() - settings.birthYear;
    const targetEquityPct = Math.max(0, Math.min(100, (settings.glidepathBase ?? 110) - age));
    let equitiesVal = 0;
    for (const h of holdings) {
      if (h.assetCategory === 'OPT' || (h.symbol || '').length > 8) continue;
      const q = quotes[toUpper(h.symbol)];
      const a = analyzeTicker(h.symbol, holdings, cash, q);
      if (a && a.type !== 'bond etf' && a.type !== 'cash') equitiesVal += h.marketValue || 0;
    }
    const actualEquityPct = (equitiesVal / total) * 100;
    if (actualEquityPct - targetEquityPct > 5) {
      bondsFirst = true;
      glidepathNote = `Equity exposure (${actualEquityPct.toFixed(0)}%) is above your age-${age} <span class="help-tooltip" style="border-bottom: 1px dotted rgba(245,158,11,0.5); cursor: help;" title="A retirement glidepath target automatically shifts your mix from equities (aggressive/growth) to bonds (defensive/income) as you age to reduce investment risk.">glidepath target</span> (${targetEquityPct.toFixed(0)}%), so fixed income ranks first.`;
    }
  }

  // ── Candidate universe ───────────────────────────────────────────────────
  const seen = new Set();
  const candidates = [];

  for (const c of CURATED_CANDIDATES) {
    seen.add(c.symbol);
    candidates.push({ ...c, source: 'curated' });
  }

  for (const h of holdings) {
    const sym = toUpper(h.symbol);
    if (!sym || seen.has(sym) || h.assetCategory === 'OPT' || sym.length > 8) continue;
    seen.add(sym);
    candidates.push({
      symbol: sym,
      name: h.description || sym,
      bucket: h.bucket || 'unassigned',
      kind: null, // classified below
      yieldPct: null,
      source: 'holding',
      holding: h,
    });
  }

  for (const w of watchlistData) {
    const sym = toUpper(w && w.symbol);
    if (!sym || seen.has(sym)) continue;
    if (!['A', 'B'].includes(w.grade)) continue;
    seen.add(sym);
    candidates.push({
      symbol: sym, name: sym, bucket: 'satellite', kind: 'equity',
      yieldPct: null, source: 'watchlist', watchlistInfo: w,
    });
  }

  // ── Filter + score ───────────────────────────────────────────────────────
  const scored = [];
  for (const c of candidates) {
    const sym = c.symbol;
    const quote = quotes[sym];
    const analysis = analyzeTicker(sym, holdings, cash, quote);

    if (employerSyms.has(sym)) {
      excluded.push({ symbol: sym, reason: 'Employer stock — never add to your largest concentration risk.' });
      continue;
    }
    if (analysis && analysis.isPfic && usPerson) {
      const replacement = PFIC_REPLACEMENTS[sym] || null;
      excluded.push({ symbol: sym, reason: `PFIC (${analysis.domicile}) — punitive US taxation, do not buy.` });
      if (c.source === 'holding') {
        swaps.push({
          sell: sym,
          buy: replacement,
          reason: replacement
            ? `Foreign-domiciled fund (PFIC). ${replacement} is a US-domiciled equivalent with the same role and none of the Form 8621 burden.`
            : 'Foreign-domiciled fund (PFIC). Replace with a US-domiciled equivalent covering the same exposure.',
        });
      }
      continue;
    }

    const isFund = analysis && (analysis.type === 'etf' || analysis.type === 'bond etf');
    const kind = c.kind || (analysis && analysis.type === 'bond etf' ? 'bond' : 'equity');

    // Concentration guard: adding to an individual stock at/near the 10% cap
    if (!isFund && analysis && analysis.weightPct >= 8) {
      excluded.push({ symbol: sym, reason: `Single-stock weight already ${analysis.weightPct.toFixed(1)}% — adding more works against your 10% concentration limit.` });
      continue;
    }

    const yieldPct = liveYieldPct(quote, c.yieldPct);
    const taxDragPct = (yieldPct * dividendTaxRatePct) / 100;
    const bucketNeed = underweightByBucket.get(c.bucket) || 0;

    // Rank: fills the biggest gap first; within a gap, lowest tax drag wins;
    // funds outrank single stocks for the same slot. Glidepath overlay can
    // push bonds ahead of everything.
    const glidepathBoost = bondsFirst ? (kind === 'bond' ? 1 : -1) : 0;
    scored.push({
      symbol: sym,
      name: c.name,
      bucket: c.bucket,
      kind,
      isFund,
      source: c.source,
      yieldPct,
      taxDragPct,
      bucketNeed,
      glidepathBoost,
      watchlistInfo: c.watchlistInfo || null,
      taxNotes: buildTaxNotes({ symbol: sym, kind, yieldPct, taxDragPct, dividendTaxRatePct }),
    });
  }

  scored.sort((a, b) =>
    (b.glidepathBoost - a.glidepathBoost)
    || (b.bucketNeed - a.bucketNeed)
    || (a.taxDragPct - b.taxDragPct)
    || ((b.isFund ? 1 : 0) - (a.isFund ? 1 : 0))
  );

  // ── Suggested amounts: greedy from deployable cash into bucket gaps ─────
  let cashLeft = deployableCash;
  const remainingNeed = new Map(underweightByBucket);
  const perBucketCount = new Map();
  const recommendations = [];
  for (const s of scored) {
    if (s.bucketNeed <= 0 && !(bondsFirst && s.kind === 'bond')) continue; // only surface what the strategy actually calls for
    // Don't let one large bucket gap crowd every other bucket out of the list
    const shown = perBucketCount.get(s.bucket) || 0;
    if (shown >= 4) continue;
    perBucketCount.set(s.bucket, shown + 1);
    const need = remainingNeed.get(s.bucket) || 0;
    let suggestedUsd = 0;
    if (cashLeft > 0 && need > 0) {
      suggestedUsd = Math.min(cashLeft, need);
      cashLeft -= suggestedUsd;
      remainingNeed.set(s.bucket, need - suggestedUsd);
    }

    const reasons = [];
    if (s.bucketNeed > 0) reasons.push(`${s.bucket} bucket underweight by $${Math.round(s.bucketNeed).toLocaleString('en-US')}`);
    if (bondsFirst && s.kind === 'bond') reasons.push('ranked first to close your glidepath fixed-income gap');
    if (s.watchlistInfo) reasons.push(`Watchlist grade ${s.watchlistInfo.grade} (score ${s.watchlistInfo.score}/100)`);

    recommendations.push({
      symbol: s.symbol,
      name: s.name,
      bucket: s.bucket,
      kind: s.kind,
      source: s.source,
      yieldPct: Math.round(s.yieldPct * 100) / 100,
      taxDragPct: Math.round(s.taxDragPct * 100) / 100,
      strategyReason: reasons.join(' · ') || 'Fits your allocation targets',
      taxNotes: s.taxNotes,
      suggestedUsd: Math.round(suggestedUsd),
    });
  }

  return {
    recommendations: recommendations.slice(0, 8),
    swaps,
    excluded,
    deployableCash: Math.round(deployableCash),
    glidepathNote,
  };
}

module.exports = {
  generateBuyRecommendations,
  CURATED_CANDIDATES,
  PFIC_REPLACEMENTS,
};
