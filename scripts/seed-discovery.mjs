import YahooFinance from 'yahoo-finance2';
const yahooFinance = new YahooFinance({
  suppressNotices: ['yahooSurvey', 'ripHistorical'],
  validation: { logErrors: false }
});
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SEED_FILE = path.join(__dirname, '..', 'lib', 'discovery-seed.json');

// Minimal strategy logic to match main.js/lib/strategies.js
function computeHV(closes) {
  if (!closes || closes.length < 5) return null;
  const logReturns = [];
  for (let i = 1; i < closes.length; i++) {
    if (closes[i - 1] > 0 && closes[i] > 0)
      logReturns.push(Math.log(closes[i] / closes[i - 1]));
  }
  if (logReturns.length < 4) return null;
  const mean = logReturns.reduce((s, r) => s + r, 0) / logReturns.length;
  const variance = logReturns.reduce((s, r) => s + (r - mean) ** 2, 0) / (logReturns.length - 1);
  return Math.sqrt(variance) * Math.sqrt(252);
}

function findClosestDate(dates, target) {
  return dates.reduce((best, d) =>
    Math.abs(d - target) < Math.abs(best - target) ? d : best
  );
}

function computeScore(ivr, ivHvRatio, meanReversionSignal) {
  let score = 0;
  if (ivr != null && ivr >= 50) score += 2;
  if (ivHvRatio != null && ivHvRatio >= 1.3) score += 2;
  if (meanReversionSignal) score += 1;
  return score;
}

async function analyzeSingleSymbol(symbol) {
  console.log(`Analyzing ${symbol}...`);
  try {
    const target = new Date();
    target.setDate(target.getDate() + 30);

    const quote = await yahooFinance.quote(symbol);
    const currentPrice = quote.regularMarketPrice;
    if (!currentPrice || currentPrice <= 0) return null;

    const histEnd   = new Date();
    const histStart = new Date();
    histStart.setDate(histStart.getDate() - 35);
    const chartResult = await yahooFinance.chart(symbol, {
      period1: histStart, period2: histEnd, interval: '1d'
    });
    const history = chartResult.quotes || [];
    const closes = history.map(h => h.close).filter(c => c > 0);
    const hv = computeHV(closes);

    const chain = await yahooFinance.options(symbol);
    if (!chain.expirationDates || chain.expirationDates.length === 0) return null;

    const closestDate = findClosestDate(chain.expirationDates, target);
    const dte = Math.round((closestDate - new Date()) / (1000 * 60 * 60 * 24));
    if (dte <= 0) return null;

    const dated = await yahooFinance.options(symbol, { date: closestDate });
    if (!dated.options || dated.options.length === 0 || !dated.options[0].puts) return null;

    const maxAllowedStrike = currentPrice; // Any OTM strike
    const puts = dated.options[0].puts.filter(p => {
      if (!p.strike || p.strike <= 0 || p.strike >= maxAllowedStrike) return false;
      return true;
    });
    if (puts.length === 0) return null;

    puts.sort((a, b) => b.strike - a.strike);
    const best      = puts[0];
    const currentIV = best.impliedVolatility || 0;

    const ivHvRatio           = hv && hv > 0 ? currentIV / hv : null;
    const score               = computeScore(null, ivHvRatio, false);

    const premium         = best.lastPrice;
    const strike          = best.strike;
    const capitalRequired = strike * 100;
    const marginOfSafety  = ((currentPrice - strike) / currentPrice) * 100;
    const breakEven       = strike - premium;
    const monthlyYield    = (premium / strike) * (30 / dte) * 100;
    const annualizedYield = monthlyYield * 12;
    const monthlyIncome   = premium * 100 * (30 / dte);

    return {
      symbol,
      companyName: quote.longName || quote.shortName || symbol,
      exchange:    quote.fullExchangeName || quote.exchange || '',
      currentPrice, strike, dte, premium, capitalRequired,
      monthlyYield, annualizedYield, monthlyIncome,
      marginOfSafety, breakEven,
      impliedVolatility: currentIV,
      hv:               hv || 0,
      ivHvRatio:        ivHvRatio || 0,
      score,
      volume:       best.volume || 0,
      openInterest: best.openInterest || 0,
      expirationDate: closestDate.toISOString().split('T')[0],
      date: new Date().toISOString().split('T')[0]
    };
  } catch (e) {
    console.error(`Error analyzing ${symbol}: ${e.message}`);
    return null;
  }
}

async function seed() {
  const screens = ['most_actives', 'day_losers', 'growth_technology_stocks'];
  const symbols = new Set();
  
  for (const scrId of screens) {
    console.log(`Fetching ${scrId}...`);
    try {
      const result = await yahooFinance.screener({ scrIds: scrId, count: 25 });
      (result.quotes || []).forEach(q => {
        if (q.symbol && /^[A-Z]{1,5}$/.test(q.symbol)) symbols.add(q.symbol);
      });
    } catch (e) {
      console.error(`Error fetching ${scrId}: ${e.message}`);
    }
  }

  const universe = Array.from(symbols);
  console.log(`Found ${universe.length} symbols. Starting analysis...`);

  const results = {};
  for (const symbol of universe) {
    const opp = await analyzeSingleSymbol(symbol);
    if (opp) {
      results[symbol] = {
        date: opp.date,
        opp: { ...opp, strategies: ['ivr', 'iv_hv', 'mean_reversion'] }
      };
    }
  }

  fs.writeFileSync(SEED_FILE, JSON.stringify(results, null, 2));
  console.log(`Seed file created with ${Object.keys(results).length} opportunities at ${SEED_FILE}`);
}

seed();
