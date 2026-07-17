'use strict';

// Fund look-through analysis: what's actually inside an ETF the user is
// looking at, and how much of it duplicates what they already own directly.
// The headline use case: broad US index funds all carry several percent of
// GOOG/GOOGL, so "diversifying" into them quietly adds to an already-heavy
// employer position — that hidden exposure should be visible, not implied.

// Share classes of the same company must match each other (the user holds
// GOOG; VOO reports both GOOGL and GOOG as separate lines).
const SHARE_CLASS_ALIASES = {
  GOOGL: 'GOOG',
  FOXA: 'FOX',
  NWSA: 'NWS',
  'BRK-B': 'BRK-A', 'BRK.B': 'BRK-A', 'BRK.A': 'BRK-A',
  'HEI-A': 'HEI',
  'UHAL-B': 'UHAL',
  'LEN-B': 'LEN',
};

function canonicalSymbol(sym) {
  const s = (sym || '').toUpperCase().trim();
  return SHARE_CLASS_ALIASES[s] || s;
}

// fundHoldings: [{ symbol, holdingName, holdingPercent }] — holdingPercent as
// a FRACTION (Yahoo's topHoldings shape, 0.071 = 7.1%).
// Returns overlap rows, aggregate stats, and the employer-specific number.
function computeFundOverlap(fundHoldings = [], portfolioHoldings = [], employerSymbols = '', totalPortfolioValue = 0) {
  const employerSet = new Set(
    (employerSymbols || '').toUpperCase().split(',').map(s => canonicalSymbol(s)).filter(Boolean)
  );

  // Direct positions by canonical symbol → weight % of total portfolio
  const directWeights = new Map();
  for (const h of portfolioHoldings) {
    if (!h.symbol || h.assetCategory === 'OPT' || h.symbol.length > 8) continue;
    const canon = canonicalSymbol(h.symbol);
    const weight = totalPortfolioValue > 0 ? ((h.marketValue || 0) / totalPortfolioValue) * 100 : 0;
    directWeights.set(canon, (directWeights.get(canon) || 0) + weight);
  }

  // Merge fund lines that are share classes of the same company (GOOGL+GOOG)
  const fundByCanon = new Map();
  for (const fh of fundHoldings) {
    const canon = canonicalSymbol(fh.symbol);
    if (!canon) continue;
    const prev = fundByCanon.get(canon);
    const pct = (fh.holdingPercent || 0) * 100;
    if (prev) {
      prev.fundPct += pct;
    } else {
      fundByCanon.set(canon, {
        symbol: canon,
        name: fh.holdingName || canon,
        fundPct: pct,
        directWeightPct: 0,
        alreadyHeld: false,
        isEmployer: employerSet.has(canon),
      });
    }
  }

  let overlapFundPct = 0;   // share of the fund duplicating direct positions
  let employerFundPct = 0;  // share of the fund that is employer stock
  const rows = [];
  for (const row of fundByCanon.values()) {
    const direct = directWeights.get(row.symbol) || 0;
    row.directWeightPct = Math.round(direct * 100) / 100;
    row.alreadyHeld = direct > 0;
    row.fundPct = Math.round(row.fundPct * 100) / 100;
    if (row.alreadyHeld) overlapFundPct += row.fundPct;
    if (row.isEmployer) employerFundPct += row.fundPct;
    rows.push(row);
  }
  rows.sort((a, b) => b.fundPct - a.fundPct);

  return {
    rows,
    overlapCount: rows.filter(r => r.alreadyHeld).length,
    overlapFundPct: Math.round(overlapFundPct * 100) / 100,
    employerFundPct: Math.round(employerFundPct * 100) / 100,
    // Per $10k invested in the fund, how many dollars are effectively the
    // employer's stock — the number that makes hidden exposure concrete.
    employerUsdPer10k: Math.round(employerFundPct * 100),
  };
}

// Aggregate the employer stock hiding inside every fund the user holds.
// fundLookthroughs: [{ symbol, marketValue, topHoldings }] — one entry per
// held fund whose composition we could fetch (topHoldings in Yahoo's shape).
// Only a fund's reported top holdings are visible (typically top 10), so the
// implied figure is a FLOOR, not an exact number — callers should say so.
function computeIndexImpliedEmployer(fundLookthroughs = [], directEmployerValue = 0, employerSymbols = '', totalPortfolioValue = 0) {
  const employerSet = new Set(
    (employerSymbols || '').toUpperCase().split(',').map(s => canonicalSymbol(s)).filter(Boolean)
  );

  const perFund = [];
  let impliedValue = 0;
  for (const f of fundLookthroughs) {
    let employerFrac = 0;
    for (const h of f.topHoldings || []) {
      if (employerSet.has(canonicalSymbol(h.symbol))) employerFrac += h.holdingPercent || 0;
    }
    if (employerFrac > 0 && f.marketValue > 0) {
      const usd = employerFrac * f.marketValue;
      impliedValue += usd;
      perFund.push({
        symbol: (f.symbol || '').toUpperCase(),
        employerFundPct: Math.round(employerFrac * 10000) / 100,
        impliedUsd: Math.round(usd),
      });
    }
  }
  perFund.sort((a, b) => b.impliedUsd - a.impliedUsd);

  const pct = v => totalPortfolioValue > 0 ? Math.round((v / totalPortfolioValue) * 10000) / 100 : 0;
  return {
    directPct: pct(directEmployerValue),
    impliedPct: pct(impliedValue),
    totalPct: pct(directEmployerValue + impliedValue),
    impliedUsd: Math.round(impliedValue),
    perFund,
    fundsAnalyzed: fundLookthroughs.length,
  };
}

module.exports = { computeFundOverlap, computeIndexImpliedEmployer, canonicalSymbol };
