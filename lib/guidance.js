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

function generatePortfolioGuidance(holdings = [], cash = 0, targets = [], settings = {}, quotes = {}, watchlistData = []) {
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
      message: `You hold foreign-domiciled funds: ${pficSymbols.join(', ')} (domiciled in ${domStr}). As a US person, foreign mutual funds or ETFs are classified as <span class="help-tooltip" style="border-bottom: 1px dotted var(--text-secondary); cursor: help;" title="Passive Foreign Investment Company. Any mutual fund, ETF, or index fund registered outside the United States is classified as a PFIC. The IRS penalizes holding these with extremely high tax rates (up to 37%+) and complex annual reporting.">PFICs</span>. They trigger complex IRS <span class="help-tooltip" style="border-bottom: 1px dotted var(--text-secondary); cursor: help;" title="Information Return by a Shareholder of a Passive Foreign Investment Company. A complicated, time-consuming tax form required by the IRS for each individual foreign fund you hold.">Form 8621</span> filing requirements and punitive tax rates (up to 37%+ on unrealized gains). Consider replacing them with US-domiciled equivalents.`,
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
      message: `Your employer stock represents ${employerPct.toFixed(1)}% of your portfolio, exceeding the 15% high-risk threshold. Because your salary and career are already linked to this company, we recommend setting up a systematic <span class="help-tooltip" style="border-bottom: 1px dotted var(--text-secondary); cursor: help;" title="A plan to regularly sell a portion of your employer shares (e.g., as they vest) and reinvest the cash in diversified market ETFs, lowering your reliance on one company.">diversification plan</span>.`,
      severity: 'error',
    });
  } else if (employerPct > 10) {
    items.push({
      id: 'employer-concentration-soft',
      type: 'concentration',
      title: 'Elevated Employer Stock Concentration',
      message: `Your employer stock represents ${employerPct.toFixed(1)}% of your portfolio. We recommend keeping single-stock exposure under 10% to reduce <span class="help-tooltip" style="border-bottom: 1px dotted var(--text-secondary); cursor: help;" title="The risk of putting too many eggs in one basket. If your single stock crashes, your entire portfolio suffers a major loss.">concentration risk</span>.`,
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
      message: `You are holding cash representation of ${cashPct.toFixed(1)}% of your portfolio, exceeding your buffer of $${cashDragLimit.toLocaleString()}. Over long horizons, excess cash reduces returns (<span class="help-tooltip" style="border-bottom: 1px dotted var(--text-secondary); cursor: help;" title="Cash drag is when uninvested cash sits in your account earning little to no return, reducing ('dragging down') your long-term compound growth.">cash drag</span>). Consider deploying this cash into your Core ETFs.`,
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
        
        let actionStr = '';
        if (drift > 0) {
          actionStr = `Action: Sell some equities and buy core bond ETFs (like BND or AGG) to align with your <span class="help-tooltip" style="border-bottom: 1px dotted var(--text-secondary); cursor: help;" title="A retirement glidepath target automatically shifts your mix from equities (aggressive/growth) to bonds (defensive/income) as you age to reduce investment risk.">retirement target</span>.`;
        } else {
          actionStr = `Action: Buy core equity ETFs (like VTI or VOO) using excess cash or by selling some bonds to align with your <span class="help-tooltip" style="border-bottom: 1px dotted var(--text-secondary); cursor: help;" title="A retirement glidepath target automatically shifts your mix from equities (aggressive/growth) to bonds (defensive/income) as you age to reduce investment risk.">retirement target</span>.`;
        }

        items.push({
          id: 'glidepath-drift',
          type: 'glidepath',
          title: 'Glidepath Allocation Drift',
          message: `Your actual equity exposure is ${actualEquityPct.toFixed(1)}% (comprising: ${equityListStr}), while your target suggests ${targetEquityPct.toFixed(1)}% (Age ${age}, formula: ${settings.glidepathBase ?? 110} - Age). You currently hold ${actualBondPct.toFixed(1)}% in bonds (${bondListStr}) and ${actualCashPct.toFixed(1)}% in cash. ${actionStr}`,
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

  // ─── Watchlist & Volatility Harvesting Recommendations ───

  const byBucket = new Map();
  for (const h of holdings) {
    const b = h.bucket || 'unassigned';
    byBucket.set(b, (byBucket.get(b) || 0) + (h.marketValue || 0));
  }
  if (cash > 0) byBucket.set('cash', (byBucket.get('cash') || 0) + cash);

  // 1. Satellite Bucket Allocation Opportunity (Screener + Portfolio Rebalancing)
  const satelliteTarget = (targets || []).find(t => t.bucket === 'satellite');
  if (satelliteTarget && satelliteTarget.targetPct > 0) {
    const actualSatPct = total > 0 ? ((byBucket.get('satellite') || 0) / total) * 100 : 0;
    const diffSatPct = satelliteTarget.targetPct - actualSatPct;
    if (diffSatPct > 5) {
      const amountNeeded = (diffSatPct / 100) * total;
      const topOpps = (watchlistData || [])
        .filter(opp => opp && ['A', 'B'].includes(opp.grade))
        .sort((a, b) => b.score - a.score)
        .slice(0, 3);

      if (topOpps.length > 0) {
        const oppStrings = topOpps.map(o => `${o.symbol} (Score: ${o.score}/100, Grade: ${o.grade})`).join(', ');
        items.push({
          id: 'rebalance-watchlist-satellite',
          type: 'rebalance-watchlist',
          title: 'Satellite Bucket Allocation Opportunity',
          message: `Your Satellite bucket is underweight by ${diffSatPct.toFixed(1)}% (approx. $${amountNeeded.toLocaleString('en-US', { maximumFractionDigits: 0 })}). Based on your watchlist scans, the following top-rated opportunities are available to buy: ${oppStrings}.`,
          severity: 'info'
        });
      }
    }
  }

  // 2. Volatility Harvesting: Covered Call Opportunities on holdings with >= 100 shares
  for (const h of holdings) {
    if (h.quantity && h.quantity >= 100 && h.assetCategory !== 'OPT' && h.symbol.length <= 8) {
      const symbolUpper = h.symbol.toUpperCase();
      const q = quotes[symbolUpper];
      const watchlistInfo = (watchlistData || []).find(w => w && w.symbol && w.symbol.toUpperCase() === symbolUpper);
      
      const iv = q && q.impliedVolatility ? q.impliedVolatility : (watchlistInfo && watchlistInfo.impliedVolatility ? watchlistInfo.impliedVolatility : null);
      const ivr = watchlistInfo && watchlistInfo.ivr != null ? watchlistInfo.ivr : null;
      
      if ((iv != null && iv > 0.35) || (ivr != null && ivr >= 40)) {
        const ivPctStr = iv != null ? `${(iv * 100).toFixed(1)}%` : 'elevated';
        const ivrStr = ivr != null ? ` (IV Rank: ${ivr}%)` : '';
        items.push({
          id: `covered-call-${h.symbol}`,
          type: 'options-covered-call',
          title: `Covered Call Opportunity: ${h.symbol}`,
          message: `You hold ${h.quantity} shares of ${h.symbol}. Its implied volatility is currently ${ivPctStr}${ivrStr}. Writing a 30-day covered call at a 0.30 delta could harvest high premium and increase your portfolio yield.`,
          severity: 'info'
        });
      }
    }
  }

  // 3. Volatility Harvesting: Cash-Secured Put Opportunities to deploy excess cash
  if (cashPct > 10 && cash > cashDragLimit) {
    const putOpps = (watchlistData || [])
      .filter(opp => opp && ['A', 'B'].includes(opp.grade) && opp.score >= 35)
      .sort((a, b) => b.score - a.score)
      .slice(0, 3);
      
    if (putOpps.length > 0) {
      const putOppsStr = putOpps.map(o => `${o.symbol} (Score: ${o.score}/100, Grade: ${o.grade})`).join(', ');
      items.push({
        id: 'cash-secured-puts-deploy',
        type: 'options-cash-secured-put',
        title: 'Deploy Idle Cash with Cash-Secured Puts',
        message: `To deploy your excess cash buffer of $${(cash - cashDragLimit).toLocaleString('en-US', { maximumFractionDigits: 0 })} while capturing high yields, consider writing Cash-Secured Puts on these highly-graded watchlist opportunities: ${putOppsStr}.`,
        severity: 'info'
      });
    }
  }

  return items;
}

const PF_CORE_ETFS = new Set([
  'VTI', 'VOO', 'SPY', 'IVV', 'ITOT', 'SCHB',            // US total market / S&P 500
  'VT', 'ACWI',                                          // global
  'VXUS', 'VEA', 'VWO', 'IEFA', 'IEMG', 'EFA', 'EEM',    // ex-US / intl / EM
  'IWDA', 'IWDC', 'VUSA', 'VWRL', 'VWCE', 'IUSC',        // UCITS equivalents
]);

function calculateHoldingRecommendation(holding, quote, watchlistInfo, bucketDrifts = [], tolerancePct = 5, totalPortfolioValue = 0) {
  if (!holding || holding.assetCategory === 'OPT' || (holding.symbol && holding.symbol.length > 8)) {
    return { type: '—', reason: '' };
  }

  const quoteType = quote?.quoteType?.toUpperCase();
  const isFund = quoteType === 'ETF' || quoteType === 'MUTUALFUND' || PF_CORE_ETFS.has(holding.symbol.toUpperCase());

  // PFIC holdings must never receive a Buy — an underweight bucket is not a
  // reason to grow a punitively-taxed position. Recommend replacing instead.
  if (isFund) {
    const analysis = analyzeTicker(holding.symbol, [holding], 0, quote);
    if (analysis && analysis.isPfic) {
      return { type: 'Replace', reason: `Foreign-domiciled fund (PFIC) — replace with a US-domiciled equivalent, don't add` };
    }
  }

  const bucket = holding.bucket || 'unassigned';
  const driftRow = (bucketDrifts || []).find(d => d.bucket === bucket);
  const driftPct = driftRow ? driftRow.driftPct : 0;
  const rebalance = driftRow ? driftRow.rebalance : false;

  const holdingPct = totalPortfolioValue > 0 ? ((holding.marketValue || 0) / totalPortfolioValue) * 100 : 0;

  // 1. Global concentration check: individual stock exceeding 10% weight is ALWAYS a Trim
  if (!isFund && holdingPct > 10) {
    return { type: 'Trim', reason: `Single-stock concentration too high (${holdingPct.toFixed(0)}% vs 10% limit)` };
  }

  // 2. Educational check: individual stock placed in Core bucket
  if (bucket === 'core' && !isFund) {
    return { type: 'Trim', reason: `Individual stock in Core bucket (move to Satellite to reduce risk)` };
  }

  // 3. Volatility Harvesting: Covered Call check (if user holds >= 100 shares of a stock with high IV/IVR)
  if (holding.quantity && holding.quantity >= 100 && !isFund && holding.symbol.length <= 8) {
    const symbolUpper = holding.symbol.toUpperCase();
    const iv = quote && quote.impliedVolatility ? quote.impliedVolatility : (watchlistInfo && watchlistInfo.impliedVolatility ? watchlistInfo.impliedVolatility : null);
    const ivr = watchlistInfo && watchlistInfo.ivr != null ? watchlistInfo.ivr : null;

    if ((iv != null && iv > 0.35) || (ivr != null && ivr >= 40)) {
      const ivPctStr = iv != null ? `${(iv * 100).toFixed(0)}%` : 'elevated';
      return { type: 'Write Call', reason: `High volatility (${ivPctStr} IV): write covered calls for yield` };
    }
  }

  const isCore = bucket === 'core';

  if (isCore) {
    if (driftPct < 0) {
      return { type: 'Buy', reason: `Core bucket underweight (${driftPct.toFixed(1)}%)` };
    }
    if (driftPct > tolerancePct && rebalance) {
      return { type: 'Trim', reason: `Core bucket overweight (+${driftPct.toFixed(1)}%)` };
    }
    return { type: 'Hold', reason: 'Core allocation balanced' };
  } else {
    // Satellite / Unassigned stock
    // Trim rules:
    if (watchlistInfo && (['D', 'E', 'F'].includes(watchlistInfo.grade) || (watchlistInfo.score != null && watchlistInfo.score < 20))) {
      const scoreStr = watchlistInfo.score != null ? ` (Score: ${watchlistInfo.score})` : '';
      return { type: 'Trim', reason: `Low watchlist rating: Grade ${watchlistInfo.grade}${scoreStr}` };
    }
    if (quote && quote.regularMarketPrice && quote.fiftyDayAverage) {
      const ext = (quote.regularMarketPrice / quote.fiftyDayAverage - 1) * 100;
      if (ext > 25) {
        return { type: 'Trim', reason: `Overextended (+${ext.toFixed(0)}% above 50-day MA)` };
      }
    }
    if (quote && quote.regularMarketPrice && quote.targetMeanPrice) {
      if (quote.regularMarketPrice > quote.targetMeanPrice * 1.10) {
        return { type: 'Trim', reason: `Price ($${quote.regularMarketPrice}) exceeds analyst target mean ($${quote.targetMeanPrice})` };
      }
    }

    // Buy rules:
    if (driftPct < 0) {
      if (watchlistInfo && ['A', 'B'].includes(watchlistInfo.grade)) {
        return { type: 'Buy', reason: `Satellite underweight & Grade ${watchlistInfo.grade}` };
      }
      if (quote && quote.regularMarketPrice && quote.targetMeanPrice) {
        if (quote.regularMarketPrice < quote.targetMeanPrice * 0.80) {
          return { type: 'Buy', reason: `20%+ discount to analyst target mean ($${quote.targetMeanPrice})` };
        }
      }
      if (quote && quote.regularMarketPrice && quote.twoHundredDayAverage && quote.fiftyTwoWeekHigh) {
        const belowHighPct = (1 - quote.regularMarketPrice / quote.fiftyTwoWeekHigh) * 100;
        const aboveMa200 = quote.regularMarketPrice > quote.twoHundredDayAverage;
        if (belowHighPct >= 5 && belowHighPct <= 20 && aboveMa200) {
          return { type: 'Buy', reason: `Healthy pullback: ${belowHighPct.toFixed(0)}% off high, above 200-day MA` };
        }
      }
    }

    return { type: 'Hold', reason: 'Allocation balanced' };
  }
}

module.exports = {
  analyzeTicker,
  generatePortfolioGuidance,
  calculateHoldingRecommendation,
};
