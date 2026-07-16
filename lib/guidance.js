'use strict';

const KNOWN_US_ETFS = new Set([
  'VTI', 'VOO', 'SPY', 'QQQ', 'VXUS', 'VEA', 'BND', 'IWM', 'VNQ', 'VWO', 'SCHD', 'JEPQ', 'JEPI', 'SCHB', 'ITOT'
]);
const KNOWN_PFIC_ETFS = new Set([
  'CSPX', 'VWRL', 'VUAA', 'VUSD', 'CSSPX', 'CHSPI', 'IWDA', 'EIMI', 'IUSA', 'SXR8'
]);
const KNOWN_BOND_ETFS = new Set([
  'BND', 'BNDX', 'AGG', 'SHY', 'IEF', 'TLT', 'LQD', 'HYG', 'TIP', 'MBB', 'BSV', 'BIV', 'VCIT', 'VMBS', 'BIL', 'SGOV'
]);

function isBond(h) {
  if (!h) return false;
  const sym = (h.symbol || '').toUpperCase().trim();
  const cat = (h.assetCategory || '').toUpperCase().trim();
  return KNOWN_BOND_ETFS.has(sym) || cat === 'BOND' || cat === 'FIXED INCOME';
}

function analyzeTicker(symbol, holdings = [], cash = 0, yahooQuote = null) {
  const sym = (symbol || '').toUpperCase().trim();
  if (!sym) return null;

  const existingHolding = (holdings || []).find(h => (h.symbol || '').toUpperCase() === sym);
  const currency = existingHolding?.currency || 'USD';
  
  let type = 'stock';
  let domicile = 'United States';
  let isPfic = false;
  let suitability = 'caution';
  let reason = '';
  let details = '';

  if (sym === 'USD' || sym === 'CHF' || sym === 'EUR' || sym === 'GBP') {
    type = 'cash';
    domicile = 'N/A';
    suitability = 'excellent';
    reason = 'Cash balance.';
    details = 'Cash holdings are completely tax-exempt under both US and Swiss rules (excluding wealth tax/income interest).';
  } else if (yahooQuote) {
    // ─── Dynamic Yahoo Finance Classification ───
    const qType = (yahooQuote.quoteType || '').toUpperCase();
    const name = (yahooQuote.longName || yahooQuote.shortName || '').toLowerCase();
    const isBondType = name.includes('bond') || name.includes('fixed income') || name.includes('treasury') || name.includes('gilt') || name.includes('debt') || name.includes('corporate') || KNOWN_BOND_ETFS.has(sym);
    const isUsExchange = ['NGM', 'NMS', 'NYQ', 'ASE', 'PCX'].includes((yahooQuote.exchange || '').toUpperCase());
    const quoteSym = (yahooQuote.symbol || symbol || '').toUpperCase();
    const isUs = isUsExchange || (yahooQuote.currency === 'USD' && !quoteSym.includes('.'));
    
    domicile = isUs ? 'United States' : (quoteSym.includes('.SW') ? 'Switzerland' : 'Foreign (Likely Europe/Ireland)');

    if (qType === 'ETF') {
      if (isBondType) {
        type = 'bond etf';
      } else {
        type = 'etf';
      }
      isPfic = !isUs;
    } else {
      type = 'stock';
      isPfic = false;
    }

    if (isPfic) {
      suitability = 'danger';
      reason = 'Non-US domiciled ETF. Classified as a PFIC.';
      details = `This is a foreign-domiciled fund (${yahooQuote.longName || yahooQuote.shortName || sym}). For US taxpayers (including citizens abroad), holding foreign mutual funds or ETFs triggers Passive Foreign Investment Company (PFIC) rules. This requires filing IRS Form 8621, carries extremely complex accounting requirements, and subjects gains to punitive tax rates (up to 37%+ on unrealized gains). Avoid holding this.`;
    } else if (type === 'bond etf') {
      suitability = 'excellent';
      reason = 'US-domiciled Bond/Fixed-Income ETF. Safe for US taxpayers.';
      details = `This is a US-registered fixed-income exchange-traded fund (${yahooQuote.longName || yahooQuote.shortName || sym}). It is not classified as a PFIC. It is highly suitable for US persons resident abroad and is ideal for building your defensive asset allocation to meet your retirement glidepath target.`;
    } else if (type === 'etf') {
      suitability = 'excellent';
      reason = 'US-domiciled ETF. Safe for US taxpayers.';
      details = `This is a US-registered exchange-traded fund (${yahooQuote.longName || yahooQuote.shortName || sym}). It is not classified as a PFIC. It is highly suitable for US persons resident abroad and benefits from Swiss-US tax treaty withholding recovery.`;
    } else {
      suitability = 'caution';
      reason = 'Individual stock. No PFIC risk, but increases concentration.';
      details = `Individual stocks (even foreign ones like ${yahooQuote.longName || yahooQuote.shortName || sym}) are active operating businesses and are generally not classified as PFICs. However, purchasing individual stocks increases your portfolio concentration risk compared to diversified index ETFs.`;
    }
  } else {
    // ─── Static Fallback Rules (Offline / Tests) ───
    if (KNOWN_BOND_ETFS.has(sym)) {
      type = 'bond etf';
      domicile = 'United States';
      isPfic = false;
      suitability = 'excellent';
      reason = 'US-domiciled Bond/Fixed-Income ETF. Safe for US taxpayers.';
      details = 'This is a US-registered fixed-income exchange-traded fund. It is not classified as a PFIC (Passive Foreign Investment Company) under US tax law. It is highly suitable for US persons resident abroad and is ideal for building your defensive core asset allocation to meet your retirement glidepath target.';
    } else if (KNOWN_US_ETFS.has(sym)) {
      type = 'etf';
      domicile = 'United States';
      isPfic = false;
      suitability = 'excellent';
      reason = 'US-domiciled ETF. Safe for US taxpayers.';
      details = 'This is a US-registered exchange-traded fund. It is not classified as a PFIC (Passive Foreign Investment Company) under US tax law. It is highly suitable for US persons resident abroad and benefits from Swiss-US tax treaty withholding recovery.';
    } else if (KNOWN_PFIC_ETFS.has(sym) || sym.includes('.') || currency !== 'USD') {
      type = 'etf';
      domicile = sym.includes('.SW') || currency === 'CHF' ? 'Switzerland' : 'Europe (Likely Ireland/Luxembourg)';
      isPfic = true;
      suitability = 'danger';
      reason = 'Non-US domiciled ETF. Classified as a PFIC.';
      details = 'This is a foreign-domiciled fund (UCITS / European ETF). For US taxpayers (including citizens abroad), holding foreign mutual funds or ETFs triggers Passive Foreign Investment Company (PFIC) rules. This requires filing IRS Form 8621, carries extremely complex accounting requirements, and subjects gains to punitive tax rates (up to 37%+ on unrealized gains). Avoid holding this.';
    } else {
      // Pattern-guess PFIC only for non-USD holdings: a USD trading currency
      // from the broker is strong evidence of a US listing (e.g. SIDU, ASTS).
      const looksLikePficEtf = currency !== 'USD' &&
        /^[A-Z]{4}$/.test(sym) && !['AAPL', 'AMZN', 'GOOG', 'META', 'MSFT', 'NFLX', 'NVDA', 'TSLA', 'QCOM', 'ASML', 'AVGO', 'INTC', 'COST', 'SBUX', 'AMD', 'NKE'].includes(sym);

      if (looksLikePficEtf) {
        type = 'etf';
        domicile = 'Europe (Likely Ireland/Luxembourg)';
        isPfic = true;
        suitability = 'danger';
        reason = 'Likely Dublin-domiciled UCITS ETF (PFIC risk).';
        details = 'This symbol matches a common Dublin-domiciled UCITS ETF ticker pattern. Foreign pooled funds are PFICs under IRS rules. Ensure this is not a foreign-domiciled fund before purchasing.';
      } else {
        type = 'stock';
        domicile = ['ASML', 'NVO', 'ROG', 'NESN', 'NOVN'].includes(sym) ? 'Europe' : 'United States';
        isPfic = false;
        suitability = 'caution';
        reason = 'Individual stock. No PFIC risk, but increases concentration.';
        details = 'Individual stocks (even foreign ones like Nestlé or ASML) are active operating businesses and are generally not classified as PFICs. However, purchasing individual stocks increases your portfolio concentration risk compared to diversified index ETFs.';
      }
    }
  }

  let weightPct = 0;
  const total = (holdings || []).reduce((s, h) => s + (h.marketValue || 0), 0) + (cash || 0);
  if (total > 0) {
    if (existingHolding) {
      weightPct = (existingHolding.marketValue / total) * 100;
    }
  }

  return {
    symbol: sym,
    type,
    isPfic,
    domicile,
    suitability,
    reason,
    details,
    weightPct,
  };
}

function parseAcquisitionDate(dateStr) {
  if (!dateStr) return null;
  const cleaned = String(dateStr).trim().replace(/[\/\-\s]/g, '');
  if (/^\d{8}$/.test(cleaned)) {
    const y = parseInt(cleaned.substring(0, 4), 10);
    const m = parseInt(cleaned.substring(4, 6), 10) - 1;
    const d = parseInt(cleaned.substring(6, 8), 10);
    return new Date(y, m, d);
  }
  const parsed = new Date(dateStr);
  return isNaN(parsed.getTime()) ? null : parsed;
}

function generatePortfolioGuidance(holdings = [], cash = 0, targets = [], settings = {}, quotes = {}) {
  const items = [];
  const total = (holdings || []).reduce((s, h) => s + (h.marketValue || 0), 0) + (cash || 0);
  if (total <= 0) return items;

  // Group PFIC warnings
  const pficSymbols = [];
  const pficDomiciles = new Set();
  for (const h of holdings) {
    const analysis = analyzeTicker(h.symbol, holdings, cash, quotes[h.symbol.toUpperCase()]);
    if (analysis && analysis.isPfic) {
      pficSymbols.push(h.symbol);
      pficDomiciles.add(analysis.domicile);
    }
  }
  if (pficSymbols.length > 0) {
    const domStr = [...pficDomiciles].join(', ');
    items.push({
      id: 'pfic-grouped',
      type: 'tax-pfic',
      title: 'PFIC Warning: Foreign Domiciled Funds',
      message: `You hold foreign-domiciled funds: ${pficSymbols.join(', ')} (domiciled in ${domStr}). As a US person, foreign mutual funds or ETFs are classified as PFICs. They trigger complex IRS Form 8621 filing requirements and punitive tax rates (up to 37%+ on unrealized gains). Consider replacing them with US-domiciled equivalents.`,
      severity: 'error',
    });
  }

  const employerSyms = new Set((settings.employerSymbols || '').toUpperCase().split(',').map(s => s.trim()).filter(Boolean));
  const employerHoldings = holdings.filter(h => employerSyms.has((h.symbol || '').toUpperCase()));
  const employerVal = employerHoldings.reduce((s, h) => s + (h.marketValue || 0), 0);
  const employerPct = (employerVal / total) * 100;

  if (employerPct > 15) {
    items.push({
      id: 'employer-concentration-hard',
      type: 'concentration',
      title: 'Critical Employer Stock Concentration',
      message: `Your employer stock represents ${employerPct.toFixed(1)}% of your portfolio, exceeding the 15% high-risk threshold. Because your salary and career are already linked to this company, we recommend setting up a systematic diversification plan.`,
      severity: 'error',
    });
  } else if (employerPct > 10) {
    items.push({
      id: 'employer-concentration-soft',
      type: 'concentration',
      title: 'Elevated Employer Stock Concentration',
      message: `Your employer stock represents ${employerPct.toFixed(1)}% of your portfolio. We recommend keeping single-stock exposure under 10% to reduce concentration risk.`,
      severity: 'warning',
    });
  }

  // Cash Drag alert with custom threshold
  const cashDragLimit = settings.cashDragThreshold ?? 5000;
  const cashPct = (cash / total) * 100;
  if (cashPct > 10 && cash > cashDragLimit) {
    items.push({
      id: 'cash-drag',
      type: 'cash-drag',
      title: 'Cash Drag Alert',
      message: `You are holding cash representation of ${cashPct.toFixed(1)}% of your portfolio, exceeding your buffer of $${cashDragLimit.toLocaleString()}. Over long horizons, excess cash reduces returns. Consider deploying this cash into your Core ETFs.`,
      severity: 'warning',
    });
  }

  // Glidepath Allocation Drift
  if (settings.birthYear) {
    const currentYear = new Date().getFullYear();
    const age = currentYear - settings.birthYear;
    if (age > 0) {
      const targetEquityPct = Math.max(0, Math.min(100, (settings.glidepathBase ?? 110) - age));
      
      const equities = [];
      const bonds = [];
      let equitiesVal = 0;
      let bondsVal = 0;

      for (const h of holdings) {
        if (h.assetCategory === 'OPT' || h.symbol.length > 8) continue;
        if (isBond(h)) {
          bonds.push(h.symbol);
          bondsVal += h.marketValue || 0;
        } else {
          equities.push(h.symbol);
          equitiesVal += h.marketValue || 0;
        }
      }

      const actualEquityPct = total > 0 ? (equitiesVal / total) * 100 : 0;
      const actualBondPct = total > 0 ? (bondsVal / total) * 100 : 0;
      const actualCashPct = total > 0 ? (cash / total) * 100 : 0;
      const drift = actualEquityPct - targetEquityPct;
      const tolerance = 5;

      if (Math.abs(drift) > tolerance) {
        const bondListStr = bonds.length > 0 ? bonds.join(', ') : 'None';
        const equityListStr = equities.length > 0 ? equities.join(', ') : 'None';
        
        items.push({
          id: 'glidepath-drift',
          type: 'glidepath',
          title: 'Glidepath Allocation Drift',
          message: `Your actual equity exposure is ${actualEquityPct.toFixed(1)}% (comprising: ${equityListStr}), while your target suggests ${targetEquityPct.toFixed(1)}% (Age ${age}, formula: ${settings.glidepathBase ?? 110} - Age). You currently hold ${actualBondPct.toFixed(1)}% in bonds (${bondListStr}) and ${actualCashPct.toFixed(1)}% in cash. Consider selling some equities to buy core bond ETFs (like BND or AGG) to maintain your target risk profile.`,
          severity: 'warning',
        });
      }
    }
  }

  const hasOptions = holdings.some(h => h.assetCategory === 'OPT' || h.symbol.length > 8);
  if (hasOptions) {
    items.push({
      id: 'swiss-professional-trader-options',
      type: 'swiss-tax',
      title: 'Swiss Professional Trader Risk',
      message: 'You have active options contracts in your portfolio. Swiss tax authorities monitor derivative volume and holding periods. Ensure your transaction count remains low and holding periods long to preserve your tax-free private capital gains status.',
      severity: 'warning',
    });
  }

  // ─── Tax-Aware & Lot-Aware Rebalancing Advice ───

  // 1. Unrealized Loss Harvesting (Tax Loss Harvesting) Candidates
  const tlhCandidates = [];
  let totalLossToHarvest = 0;
  for (const h of holdings) {
    if (!h.lots || h.lots.length === 0) continue;

    for (let idx = 0; idx < h.lots.length; idx++) {
      const lot = h.lots[idx];
      const loss = lot.unrealizedPnl || (lot.marketValue != null && lot.costBasis != null ? lot.marketValue - lot.costBasis : 0);
      if (loss >= -200) continue; // Only flag meaningful losses (< -$200)

      const costBasis = lot.costBasis || (lot.quantity && lot.costPrice ? lot.quantity * lot.costPrice : 0);
      const lossPct = costBasis > 0 ? (Math.abs(loss) / costBasis) * 100 : 0;

      // Substantial if loss >= $500 OR loss >= $200 and lossPct >= 10%
      if (Math.abs(loss) >= 500 || (Math.abs(loss) >= 200 && lossPct >= 10)) {
        let lotDesc = `lot #${idx + 1}`;
        if (lot.acquisitionDate) {
          const parsedDate = parseAcquisitionDate(lot.acquisitionDate);
          if (parsedDate) {
            lotDesc += ` acquired ${parsedDate.toLocaleDateString('en-US')}`;
          }
        }
        totalLossToHarvest += Math.abs(loss);
        tlhCandidates.push(`${h.symbol} (${lotDesc}: -$${Math.abs(loss).toFixed(0)})`);
      }
    }
  }

  if (tlhCandidates.length > 0) {
    items.push({
      id: 'tlh-grouped',
      type: 'tax-loss-harvesting',
      title: 'Tax-Loss Harvesting Opportunities',
      message: `You have unrealized losses totaling $${totalLossToHarvest.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} available to harvest: ${tlhCandidates.join(', ')}. Consider selling these specific lots to offset capital gains on your US tax return. (Ensure you wait 30 days before repurchasing to avoid US wash-sale rules).`,
      severity: 'info',
    });
  }

  // 2. Lot-Aware Rebalancing Trimming Advice
  const actualBuckets = new Map();
  for (const h of holdings) {
    const b = h.bucket || 'unassigned';
    actualBuckets.set(b, (actualBuckets.get(b) || 0) + (h.marketValue || 0));
  }
  if (cash > 0) {
    actualBuckets.set('cash', (actualBuckets.get('cash') || 0) + cash);
  }

  const overweightBuckets = new Set();
  const tolerancePct = 5; // Default tolerance
  
  for (const t of targets || []) {
    const actualVal = actualBuckets.get(t.bucket) || 0;
    const actualPct = total > 0 ? (actualVal / total) * 100 : 0;
    const driftPct = actualPct - t.targetPct;
    if (driftPct > tolerancePct) {
      overweightBuckets.add(t.bucket);
    }
  }

  const today = new Date();
  for (const b of overweightBuckets) {
    const bucketHoldings = holdings.filter(h => (h.bucket || 'unassigned') === b);
    const shortTermTrims = [];
    const nearLtcgTrims = [];

    for (const h of bucketHoldings) {
      if (!h.lots || h.lots.length === 0) continue;

      for (let idx = 0; idx < h.lots.length; idx++) {
        const lot = h.lots[idx];
        if (!lot.acquisitionDate) continue;

        const acqDate = parseAcquisitionDate(lot.acquisitionDate);
        if (!acqDate) continue;

        const ageDays = (today - acqDate) / (1000 * 60 * 60 * 24);
        if (ageDays <= 365) {
          const daysToLtcg = Math.ceil(365 - ageDays);
          if (daysToLtcg > 0 && daysToLtcg <= 60) {
            nearLtcgTrims.push(`${h.symbol} lot #${idx + 1} (${lot.quantity} shares, ${daysToLtcg} days to LTCG)`);
          } else {
            shortTermTrims.push(`${h.symbol} (${lot.quantity} shares)`);
          }
        }
      }
    }

    if (nearLtcgTrims.length > 0) {
      items.push({
        id: `rebalance-near-ltcg-grouped-${b}`,
        type: 'tax-rebalance',
        title: `Rebalance Warning: Lots Nearing Long-Term Status (${b})`,
        message: `Trimming to rebalance your overweight ${b} bucket will require selling positions. However, the following lots are close to Long-Term capital gains status (under 60 days left): ${nearLtcgTrims.join('; ')}. Consider delaying the rebalance for these lots to qualify for lower tax rates.`,
        severity: 'warning',
      });
    } else if (shortTermTrims.length > 0) {
      items.push({
        id: `rebalance-stcg-grouped-${b}`,
        type: 'tax-rebalance',
        title: `Rebalance Warning: Short-Term Sales (${b})`,
        message: `Trimming positions in your overweight ${b} bucket will require selling short-term shares: ${shortTermTrims.join(', ')}. This will subject gains to ordinary income tax rates (up to 37%+). If selling, use Specific Identification (SpecID) at your broker to select long-term lots first.`,
        severity: 'warning',
      });
    }
  }

  return items;
}

module.exports = {
  analyzeTicker,
  generatePortfolioGuidance,
};
