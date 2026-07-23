'use strict';

const { app, BrowserWindow, ipcMain, dialog, safeStorage, session } = require('electron');
const path = require('path');
const fs = require('fs');

if (process.argv.includes('--smoke-test')) {
  app.setPath('userData', path.join(__dirname, 'test', 'mock-userData'));
}
const YahooFinance = require('yahoo-finance2').default;
const yahooFinance = new YahooFinance({ suppressNotices: ['yahooSurvey'] });

const quoteCache = new Map();
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

// A quote is only trustworthy for a holding if it's for the same exchange
// listing — Yahoo resolves bare tickers like ETL/UMI/IUSC to US instruments,
// not the SIX/Euronext listings IBKR reports. Currency mismatch → null.
async function fetchQuoteForHolding(holding) {
  const quote = await fetchCachedQuote(holding.symbol);
  if (!quote) return null;
  const hCcy = (holding.currency || 'USD').toUpperCase();
  const qCcy = (quote.currency || 'USD').toUpperCase();
  return qCcy === hCcy ? quote : null;
}

async function fetchCachedQuote(symbol) {
  if (!symbol) return null;
  const key = symbol.toUpperCase().trim();
  const cached = quoteCache.get(key);
  const now = Date.now();
  if (cached && (now - cached.timestamp < CACHE_TTL_MS)) {
    return cached.quote;
  }
  const quote = await yahooFinance.quote(symbol);
  if (quote) {
    quoteCache.set(key, { quote, timestamp: now });
    saveQuoteCache();
  }
  return quote;
}

function loadQuoteCache() {
  try {
    if (fs.existsSync(QUOTE_CACHE_FILE)) {
      const data = JSON.parse(fs.readFileSync(QUOTE_CACHE_FILE, 'utf8'));
      for (const k in data) {
        quoteCache.set(k, data[k]);
      }
    }
  } catch (err) {
    console.error('Failed to load quote cache:', err);
  }
}

function saveQuoteCache() {
  try {
    const data = {};
    for (const [k, v] of quoteCache.entries()) {
      data[k] = v;
    }
    fs.writeFileSync(QUOTE_CACHE_FILE, JSON.stringify(data), 'utf8');
  } catch (err) {
    console.error('Failed to save quote cache:', err);
  }
}

// ── quoteSummary cache (fund holdings / profile — changes slowly) ────────────
const FUND_INSIGHTS_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const fundInsightsCache = new Map();

function loadFundInsightsCache() {
  try {
    if (fs.existsSync(FUND_INSIGHTS_CACHE_FILE)) {
      const data = JSON.parse(fs.readFileSync(FUND_INSIGHTS_CACHE_FILE, 'utf8'));
      for (const k in data) fundInsightsCache.set(k, data[k]);
    }
  } catch {}
}

function saveFundInsightsCache() {
  try {
    const data = {};
    for (const [k, v] of fundInsightsCache.entries()) data[k] = v;
    fs.writeFileSync(FUND_INSIGHTS_CACHE_FILE, JSON.stringify(data), 'utf8');
  } catch {}
}

async function fetchCachedQuoteSummary(symbol) {
  const key = symbol.toUpperCase().trim();
  const cached = fundInsightsCache.get(key);
  if (cached && Date.now() - cached.timestamp < FUND_INSIGHTS_TTL_MS) return cached.summary;
  let summary = null;
  try {
    summary = await yahooFinance.quoteSummary(symbol, {
      modules: ['topHoldings', 'fundProfile', 'summaryDetail', 'assetProfile'],
    });
  } catch {
    // Stocks miss the fund modules entirely on some Yahoo backends; retry
    // with the stock-relevant subset before giving up.
    try {
      summary = await yahooFinance.quoteSummary(symbol, { modules: ['summaryDetail', 'assetProfile'] });
    } catch {}
  }
  if (summary) {
    fundInsightsCache.set(key, { summary, timestamp: Date.now() });
    saveFundInsightsCache();
  }
  return summary;
}

const { findClosestDate, computeHV, computeIVR, detectMeanReversion } = require('./lib/strategies');
const {
  parsePositionsCsv, totalValue, allocationByHolding, allocationByBucket,
  computeDrift, employerConcentration, topConcentrations,
} = require('./lib/portfolio');
const { analyzeTicker, generatePortfolioGuidance, calculateHoldingRecommendation } = require('./lib/guidance');
const { generateBuyRecommendations, CURATED_CANDIDATES } = require('./lib/recommendations');
const { scanInvestments } = require('./lib/investments');
const { computePortfolioHealth, projectAnnualDividends } = require('./lib/health');
const { createIbkrClient, isLoopbackGatewayUrl, gatewayLaunchSpec, treeKillSpec,
  gatewayHostPort, listGatewayPidsSpec, parsePids } = require('./lib/ibkr');
const net = require('net');
const { execFile } = require('child_process');
const { computeFundOverlap, computeIndexImpliedEmployer } = require('./lib/funds');
const { buildPlan, computePlanStatus } = require('./lib/selldown');
const { buildActionPlan } = require('./lib/actions');
const { isUSPerson, estimatePficExitCost } = require('./lib/pfic');
const { parseStatementMeta, buildProfileSnapshot, appendSnapshot } = require('./lib/history');
const { spawn } = require('child_process');

const CACHE_FILE      = path.join(app.getPath('userData'), 'data.json');
const PORTFOLIO_FILE    = path.join(app.getPath('userData'), 'portfolio.json');
const HEALTH_CACHE_FILE = path.join(app.getPath('userData'), 'health-cache.json');
const SETTINGS_FILE   = path.join(app.getPath('userData'), 'settings.json');
const DISC_CACHE_FILE = path.join(app.getPath('userData'), 'discovery-cache.json');
const SEED_CACHE_FILE = path.join(__dirname, 'lib', 'discovery-seed.json');
const QUOTE_CACHE_FILE = path.join(app.getPath('userData'), 'quote-cache.json');
const FUND_INSIGHTS_CACHE_FILE = path.join(app.getPath('userData'), 'fund-insights-cache.json');
const PROFILE_HISTORY_FILE = path.join(app.getPath('userData'), 'profile-history.json');

const DEFAULT_SETTINGS = {
  refreshIntervalDays: 1,
  minMarginPct: 5,
  priceRefreshHours: 4,
  watchlist: [],
  starred: [],
  gradeA: 51,
  gradeB: 40,
  gradeC: 30,
  gradeD: 20,
  gradeE: 1,
  blockEarnings: true,
  blockBidAsk: true,
  blockHighIV: true,
  monthlyYieldTarget: 1.0,
  deltaMin: 0.25,
  deltaMax: 0.35,
  birthYear: 1984,
  glidepathBase: 110,
  cashDragThreshold: 5000,
  concentrationLimitPct: 10, // single-stock/employer ceiling; critical = 1.5×
  employerSymbols: '',
  dividendTaxRatePct: 30, // effective rate on dividends (CH income tax × US qualified-rate/FTC interplay)
  ibkrGatewayUrl: 'https://localhost:5000',
  ibkrGatewayDir: '',
  ibkrAutoStart: false,
  ibkrUsername: '',
  ibkrPasswordEncrypted: '', // base64 ciphertext from Electron safeStorage — never plaintext
  // Tax profile: drives which tax rules the guidance engines apply (PFIC
  // relevance in particular) + the §1291 exit-cost estimator. Defaults match
  // the app's original persona (US/NL citizen resident in CH) so existing
  // behavior is unchanged until the user edits them.
  residenceCountry: 'CH',
  employmentCountry: 'CH',
  citizenship1: 'US',
  citizenship2: 'NL',
  usGreenCard: false,
  filingStatus: 'single',
  usMarginalRatePct: 32,
  pficInterestRatePct: 8,
  pficAssumedYears: 3,
};

function loadSettings() {
  try {
    if (fs.existsSync(SETTINGS_FILE)) {
      const saved = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
      const result = { ...DEFAULT_SETTINGS, ...saved };

      // Migrate old 3-strategy watchlists → unified watchlist
      if ((!saved.watchlist || saved.watchlist.length === 0) && saved.watchlists) {
        const w = saved.watchlists;
        const merged = [...new Set([...(w.ivr || []), ...(w.iv_hv || []), ...(w.mean_reversion || [])])];
        if (merged.length) result.watchlist = merged;
      }

      // Auto-reset local grading if they are set to the old defaults or previously migrated 51
      if ((saved.gradeA === 90 && saved.gradeB === 75 && saved.gradeC === 60) || saved.gradeA === 51) {
        result.gradeA = DEFAULT_SETTINGS.gradeA;
        result.gradeB = DEFAULT_SETTINGS.gradeB;
        result.gradeC = DEFAULT_SETTINGS.gradeC;
        result.gradeD = DEFAULT_SETTINGS.gradeD;
        result.gradeE = DEFAULT_SETTINGS.gradeE;
        fs.writeFileSync(SETTINGS_FILE, JSON.stringify(result), 'utf8');
      }

      return result;
    }
  } catch {}
  return { ...DEFAULT_SETTINGS };
}

function saveSettings(s) {
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(s), 'utf8');
}

function loadCache() {
  try {
    if (fs.existsSync(CACHE_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
      if (Array.isArray(parsed)) return {
        fetchedAt: new Date().toISOString(),
        pricedAt:  new Date().toISOString(),
        ivHistory: {},
        data: parsed
      };
      return { ivHistory: {}, ...parsed };
    }
  } catch {}
  return null;
}

function saveCache(data, ivHistory) {
  const settings = loadSettings();
  const now = new Date().toISOString();
  const payload = {
    fetchedAt: now, pricedAt: now,
    minMarginPct: settings.minMarginPct,
    ivHistory: ivHistory || {},
    data
  };
  fs.writeFileSync(CACHE_FILE, JSON.stringify(payload), 'utf8');
}

function savePriceUpdate(data) {
  const cache = loadCache() || {};
  const payload = { ...cache, pricedAt: new Date().toISOString(), data };
  fs.writeFileSync(CACHE_FILE, JSON.stringify(payload), 'utf8');
}

// ── Portfolio (long-term module) ──────────────────────────────────────────────
const DEFAULT_PORTFOLIO = {
  holdings: [],          // { symbol, quantity, marketValue, costBasis, currency, bucket, isEmployerStock }
  cash: 0,
  targets: [],           // { bucket, targetPct }
  employerSymbols: [],
  tolerancePct: 5,
  baseCurrency: null,
  updatedAt: null,
  source: null,          // 'manual' | 'csv' | 'ibkr'
};

function loadPortfolio() {
  try {
    if (fs.existsSync(PORTFOLIO_FILE)) {
      return { ...DEFAULT_PORTFOLIO, ...JSON.parse(fs.readFileSync(PORTFOLIO_FILE, 'utf8')) };
    }
  } catch {}
  return { ...DEFAULT_PORTFOLIO };
}

function savePortfolio(p) {
  fs.writeFileSync(PORTFOLIO_FILE, JSON.stringify(p), 'utf8');
}

// ── Health cache ──────────────────────────────────────────────────────────────
// The health score is a pure function of these inputs, so a fingerprint over
// them is the single source of truth for "did the portfolio change" — it
// catches every write path (CSV import, price refresh, bucket/target edits,
// even external edits to portfolio.json) without per-caller bookkeeping.
const HEALTH_CACHE_MAX_AGE_MS = 24 * 60 * 60 * 1000; // quotes drift; refresh daily regardless

function portfolioFingerprint(p, settings) {
  const crypto = require('crypto');
  const material = JSON.stringify({
    holdings: p.holdings,
    cash: p.cash,
    targets: p.targets,
    tolerancePct: p.tolerancePct,
    employerSymbols: p.employerSymbols,
    cashDragThreshold: settings.cashDragThreshold ?? null,
    concentrationLimitPct: settings.concentrationLimitPct ?? null,
  });
  return crypto.createHash('sha1').update(material).digest('hex');
}

function loadHealthCache() {
  try {
    if (fs.existsSync(HEALTH_CACHE_FILE)) {
      return JSON.parse(fs.readFileSync(HEALTH_CACHE_FILE, 'utf8'));
    }
  } catch {}
  return null;
}

function saveHealthCache(payload) {
  fs.writeFileSync(HEALTH_CACHE_FILE, JSON.stringify(payload), 'utf8');
}

// ── Profile history ─────────────────────────────────────────────────────────
// Dated snapshots of the portfolio's shape, appended whenever it actually
// changes (health recompute) or backfilled from a dated Activity Statement.
function loadProfileHistory() {
  try {
    if (fs.existsSync(PROFILE_HISTORY_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(PROFILE_HISTORY_FILE, 'utf8'));
      if (Array.isArray(parsed)) return parsed;
    }
  } catch {}
  return [];
}

function saveProfileHistory(list) {
  fs.writeFileSync(PROFILE_HISTORY_FILE, JSON.stringify(list), 'utf8');
}

function localToday() {
  const d = new Date();
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function ageFromSettings(settings) {
  return settings.birthYear ? new Date().getFullYear() - settings.birthYear : null;
}

// PFIC value/symbols + equity value, classified from symbol/quote data. Works
// with quotes={} (backfill) since analyzeTicker falls back to known-symbol sets.
function snapshotEnrichments(holdings, cash, quotes, settings) {
  const usPerson = isUSPerson(settings);
  let pficValue = 0, equityValue = 0;
  const pficSymbols = [];
  for (const h of holdings || []) {
    if (h.assetCategory === 'OPT' || (h.symbol || '').length > 8) continue;
    const q = quotes[(h.symbol || '').toUpperCase()];
    const a = analyzeTicker(h.symbol, holdings, cash, q);
    if (a && a.isPfic && usPerson) { pficValue += h.marketValue || 0; pficSymbols.push(h.symbol); }
    if (!a || (a.type !== 'bond etf' && a.type !== 'cash')) equityValue += h.marketValue || 0;
  }
  return { pfic: { value: pficValue, count: pficSymbols.length, symbols: pficSymbols }, equityValue };
}

// Build + persist one snapshot. Dedupes to one point per date.
function captureProfileSnapshot({ p, settings, health = null, dividends = null, quotes = {}, employerViaFundsPct = null, nav = null, dividendsPaid = null, date, source = 'live' }) {
  const enr = snapshotEnrichments(p.holdings || [], p.cash || 0, quotes || {}, settings);
  // The health SCORE degrades gracefully without live quotes (ETF/PFIC
  // detection falls back to static classification; dividends aren't part of
  // the score) — so backfilled statement + seed points get a real, graphable
  // score, not a null gap. Only when we can't score at all do we leave it null.
  if (!health && (p.holdings || []).length) {
    try {
      health = computePortfolioHealth({
        holdings: p.holdings, cash: p.cash || 0, targets: p.targets || [],
        tolerancePct: p.tolerancePct ?? 5, quotes: quotes || {}, settings,
      });
    } catch (err) {
      console.warn('History health compute failed:', err.message);
    }
  }
  const snap = buildProfileSnapshot({
    date: date || localToday(),
    source,
    holdings: p.holdings || [],
    cash: p.cash || 0,
    targets: p.targets || [],
    settings,
    age: ageFromSettings(settings),
    glidepathBase: settings.glidepathBase ?? 110,
    health, dividends, employerViaFundsPct,
    equityValue: enr.equityValue, pfic: enr.pfic, nav, dividendsPaid,
  });
  const history = appendSnapshot(loadProfileHistory(), snap);
  saveProfileHistory(history);
  return history;
}

// Give a first-time user a non-empty chart: a current structural snapshot,
// plus (if a sell-down plan exists) its start point so employer concentration
// already shows a start→now line.
function seedProfileHistoryIfEmpty() {
  const existing = loadProfileHistory();
  if (existing.length) return existing;
  const p = loadPortfolio();
  if (!p.holdings || !p.holdings.length) return existing;
  const settings = loadSettings();
  let history = captureProfileSnapshot({ p, settings, source: 'seed' });

  const plan = p.sellDownPlan;
  if (plan && plan.startDate && plan.startWeightPct != null) {
    const startDate = plan.startDate.slice(0, 10);
    if (!history.some(h => h.date === startDate)) {
      history = appendSnapshot(history, {
        date: startDate,
        source: 'seed',
        capturedAt: plan.createdAt || plan.startDate,
        totalValue: plan.startTotalValue ?? null,
        cash: null, cashPct: null,
        stockValue: null, dividendAccruals: null, twrPct: null,
        buckets: [],
        employerPctDirect: Math.round(plan.startWeightPct * 100) / 100,
        employerPctTotal: null,
        employerSymbols: [plan.symbol],
        topSymbol: plan.symbol, topPct: Math.round(plan.startWeightPct * 100) / 100,
        equityPct: null, targetEquityPct: null,
        pficValue: null, pficCount: null, pficSymbols: null,
        healthScore: null, healthGrade: null, dividendAnnual: null,
        holdings: [],
      });
      saveProfileHistory(history);
    }
  }
  return history;
}

// Portfolio plus derived metrics the renderer needs (math stays in lib/portfolio.js).
function portfolioView(p) {
  const settings = loadSettings();
  const employerSyms = (settings.employerSymbols || '').split(',').map(s => s.trim()).filter(Boolean);

  const cache = loadDiscoveryCache() || {};
  const cacheData = cache.data || [];
  const watchlistMap = new Map(cacheData.map(d => [d.symbol?.toUpperCase(), d]));

  const quotesMap = new Map();
  for (const [k, v] of quoteCache.entries()) {
    quotesMap.set(k, v.quote);
  }

  const total = totalValue(p.holdings, p.cash);
  const drifts = computeDrift(p.holdings, p.targets, p.cash, p.tolerancePct);

  const holdingsWithRecs = (p.holdings || []).map(h => {
    const symbolUpper = h.symbol?.toUpperCase();
    const q = quotesMap.get(symbolUpper);
    const watchlistInfo = watchlistMap.get(symbolUpper);
    const rec = calculateHoldingRecommendation(h, q, watchlistInfo, drifts, p.tolerancePct, total,
      { usPerson: isUSPerson(settings), concentrationLimitPct: settings.concentrationLimitPct ?? 10 });
    return { ...h, recommendation: rec };
  });

  return {
    ...p,
    holdings: holdingsWithRecs,
    derived: {
      totalValue:     total,
      byHolding:      allocationByHolding(holdingsWithRecs, p.cash),
      byBucket:       allocationByBucket(holdingsWithRecs, p.cash),
      drift:          drifts,
      concentration:  employerConcentration(holdingsWithRecs, p.cash, employerSyms),
      topPositions:   topConcentrations(holdingsWithRecs, p.cash, 5),
    },
  };
}

// ── Discovery cache ───────────────────────────────────────────────────────────
function loadDiscoveryCache() {
  let raw = {};
  try {
    if (fs.existsSync(DISC_CACHE_FILE)) {
      raw = JSON.parse(fs.readFileSync(DISC_CACHE_FILE, 'utf8'));
    } else if (fs.existsSync(SEED_CACHE_FILE)) {
      raw = JSON.parse(fs.readFileSync(SEED_CACHE_FILE, 'utf8'));
    }

    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - 3);
    const cutoffStr = cutoff.toISOString().split('T')[0];
    const pruned = {};
    for (const [sym, entry] of Object.entries(raw)) {
      if (entry.date >= cutoffStr || !fs.existsSync(DISC_CACHE_FILE)) {
        pruned[sym] = entry;
      }
    }
    return pruned;
  } catch {}
  return {};
}

function saveDiscoveryCache(cache) {
  fs.writeFileSync(DISC_CACHE_FILE, JSON.stringify(cache), 'utf8');
}

// ── Per-symbol analysis ───────────────────────────────────────────────────────
async function analyzeSingleSymbol(symbol, minMarginMultiplier, ivHistory) {
  const target = new Date();
  target.setDate(target.getDate() + 30);

  const quote = await yahooFinance.quote(symbol);
  const currentPrice = quote.regularMarketPrice;
  if (!currentPrice || currentPrice <= 0) return null;

  const histEnd   = new Date();
  const histStart = new Date();
  histStart.setDate(histStart.getDate() - 60);
  const chartResult = await yahooFinance.chart(symbol, {
    period1: histStart, period2: histEnd, interval: '1d'
  });
  const history = chartResult.quotes || [];
  const closes = history.map(h => h.close).filter(c => c > 0);
  const hv = computeHV(closes);

  // Compute MA50
  const ma50 = closes.length >= 50
    ? closes.slice(-50).reduce((s, v) => s + v, 0) / 50
    : null;
  const aboveMA50 = ma50 !== null ? currentPrice > ma50 : false;

  const chain = await yahooFinance.options(symbol);
  if (!chain.expirationDates || chain.expirationDates.length === 0) return null;

  const closestDate = findClosestDate(chain.expirationDates, target);
  const dte = Math.round((closestDate - new Date()) / (1000 * 60 * 60 * 24));
  if (dte <= 0) return null;

  const earningsTs = quote.earningsTimestamp;
  if (earningsTs && earningsTs > 0) {
    const earningsDate = new Date(earningsTs * 1000);
    if (earningsDate >= new Date() && earningsDate <= closestDate) return null;
  }

  const dated = await yahooFinance.options(symbol, { date: closestDate });
  if (!dated.options || dated.options.length === 0 || !dated.options[0].puts) return null;

  const maxAllowedStrike = currentPrice * minMarginMultiplier;
  const puts = dated.options[0].puts.filter(p => {
    if (!p.strike || p.strike <= 0 || p.strike > maxAllowedStrike) return false;
    if (!p.lastPrice || p.lastPrice <= 0) return false;
    if ((p.openInterest || 0) < 5) return false;
    if ((p.impliedVolatility || 0) <= 0.05) return false;
    if (p.bid > 0 && p.ask > 0 && (p.ask - p.bid) > 2.00) return false;
    return true;
  });
  if (puts.length === 0) return null;

  puts.sort((a, b) => b.strike - a.strike);
  const best      = puts[0];
  const currentIV = best.impliedVolatility || 0;

  // Extract new fields
  const bidAskSpread = (best.bid > 0 && best.ask > 0) ? +(best.ask - best.bid).toFixed(2) : null;
  const delta = best.delta != null ? best.delta : null;

  if (!ivHistory[symbol]) ivHistory[symbol] = [];
  const today = new Date().toISOString().split('T')[0];
  if (!ivHistory[symbol].some(h => h.date === today)) {
    ivHistory[symbol].push({ date: today, iv: currentIV });
    if (ivHistory[symbol].length > 104) ivHistory[symbol] = ivHistory[symbol].slice(-104);
  }

  const ivr                 = computeIVR(currentIV, ivHistory[symbol]);
  const ivHvRatio           = hv && hv > 0 ? currentIV / hv : null;
  const meanReversionSignal = detectMeanReversion(currentIV, ivHistory[symbol]);

  const premium         = best.lastPrice;
  const strike          = best.strike;
  const capitalRequired = strike * 100;
  const marginOfSafety  = ((currentPrice - strike) / currentPrice) * 100;
  const breakEven       = strike - premium;
  const monthlyYield    = (premium / strike) * (30 / dte) * 100;
  const annualizedYield = monthlyYield * 12;
  const monthlyIncome   = premium * 100 * (30 / dte);

  const yieldPct = quote?.trailingAnnualDividendYield > 0
    ? Math.round(quote.trailingAnnualDividendYield * 10000) / 100
    : (quote?.trailingAnnualDividendRate > 0 && currentPrice > 0
      ? Math.round((quote.trailingAnnualDividendRate / currentPrice) * 10000) / 100
      : (quote?.dividendYield > 0 ? Math.round(quote.dividendYield * 100) / 100 : (quote?.trailingAnnualDividendRate === 0 || quote?.dividendYield === 0 ? 0 : null)));

  const dividendTaxRatePct = settings.dividendTaxRatePct ?? 30;
  const taxDragPct = yieldPct != null ? Math.round(yieldPct * dividendTaxRatePct) / 100 : null;
  const analysis = analyzeTicker(symbol, [], 0, quote);

  return {
    symbol,
    companyName: quote.longName || quote.shortName || symbol,
    exchange:    quote.fullExchangeName || quote.exchange || '',
    marketCap:   quote.marketCap || null,
    currentPrice, strike, dte, premium, capitalRequired,
    monthlyYield, annualizedYield, monthlyIncome,
    marginOfSafety, breakEven,
    impliedVolatility: currentIV,
    hv:               hv || 0,
    ivHvRatio:        ivHvRatio || 0,
    ivr, meanReversionSignal,
    volume:       best.volume || 0,
    openInterest: best.openInterest || 0,
    expirationDate: closestDate.toISOString().split('T')[0],
    delta,
    bidAskSpread,
    aboveMA50,
    earningsClear: true,
    atSupport: false,
    yieldPct,
    taxDragPct,
    dividendTaxRatePct,
    analysis,
  };
}

// ── Full options scan ─────────────────────────────────────────────────────────
async function fetchOptionsData(symbolsOverride = null, onProgress = null) {
  const settings = loadSettings();
  const minMarginMultiplier = 1 - (parseFloat(settings.minMarginPct) / 100);

  const isDiscovery = symbolsOverride !== null;
  const allSymbols = isDiscovery
    ? symbolsOverride
    : [...new Set(settings.watchlist || [])];

  const cache = loadCache() || {};
  const ivHistory = cache.ivHistory || {};
  const cachedOpps = cache.data || [];
  const nowStr = new Date().toISOString();

  const opportunities = [];
  let processed = 0;

  for (const symbol of allSymbols) {
    try {
      const existingOpp = cachedOpps.find(o => o.symbol === symbol);
      
      const fetchedAtStr = existingOpp ? (existingOpp.fetchedAt || cache.fetchedAt) : null;
      const isFresh = !isDiscovery && 
                      existingOpp && 
                      existingOpp.marketCap !== undefined && 
                      existingOpp.marketCap !== null && 
                      existingOpp.yieldPct !== undefined &&
                      fetchedAtStr && 
                      (Date.now() - new Date(fetchedAtStr).getTime()) < 60 * 60 * 1000;

      let opp = null;
      if (isFresh) {
        console.log(`Reusing fresh cached opportunity for ${symbol}`);
        opp = existingOpp;
      } else {
        opp = await analyzeSingleSymbol(symbol, minMarginMultiplier, ivHistory);
        if (opp) {
          opp.fetchedAt = nowStr;
        }
      }

      if (opp) {
        opp.strategies = isDiscovery ? ['ivr', 'iv_hv', 'mean_reversion'] : [];
        opportunities.push(opp);
      }
    } catch (err) {
      console.warn(`Skipping ${symbol}:`, err.message);
    }
    processed++;
    if (onProgress) onProgress({ done: processed, total: allSymbols.length, symbol });
  }

  opportunities.sort((a, b) => b.annualizedYield - a.annualizedYield);
  return { opportunities, ivHistory };
}

// Batch quote enrichment helper for dividend yields, tax drag, expense ratios, and compliance
async function enrichOpportunitiesWithQuotes(opportunities, settings) {
  if (!opportunities || !opportunities.length) return opportunities;
  const symbols = opportunities.map(o => o.symbol);
  const dividendTaxRatePct = settings?.dividendTaxRatePct ?? 30;
  
  const chunkSize = 100;
  for (let i = 0; i < symbols.length; i += chunkSize) {
    const chunk = symbols.slice(i, i + chunkSize);
    try {
      const quotes = await yahooFinance.quote(chunk);
      const quoteMap = new Map();
      if (Array.isArray(quotes)) {
        quotes.forEach(q => { if (q && q.symbol) quoteMap.set(q.symbol.toUpperCase(), q); });
      } else if (quotes && quotes.symbol) {
        quoteMap.set(quotes.symbol.toUpperCase(), quotes);
      }

      opportunities.forEach(d => {
        const q = quoteMap.get((d.symbol || '').toUpperCase());
        if (q) {
          const price = q.regularMarketPrice || d.currentPrice;
          const yieldPct = q.trailingAnnualDividendYield > 0
            ? Math.round(q.trailingAnnualDividendYield * 10000) / 100
            : (q.trailingAnnualDividendRate > 0 && price > 0
              ? Math.round((q.trailingAnnualDividendRate / price) * 10000) / 100
              : (q.dividendYield > 0 ? Math.round(q.dividendYield * 100) / 100 : (q.trailingAnnualDividendRate === 0 || q.dividendYield === 0 ? 0 : null)));

          d.quoteType = q.quoteType;
          d.yieldPct = yieldPct;
          d.taxDragPct = yieldPct != null ? Math.round(yieldPct * dividendTaxRatePct) / 100 : null;
          d.dividendTaxRatePct = dividendTaxRatePct;
          if (q.annualReportExpenseRatio != null) {
            d.expenseRatioPct = Math.round(q.annualReportExpenseRatio * 10000) / 100;
          } else if (q.expenseRatio != null) {
            d.expenseRatioPct = Math.round(q.expenseRatio * 10000) / 100;
          }
          d.analysis = analyzeTicker(d.symbol, [], 0, q);
        } else if (!d.analysis) {
          d.analysis = analyzeTicker(d.symbol, [], 0, null);
        }
      });
    } catch (err) {
      console.warn(`Chunk quote enrichment failed (${chunk[0]}…):`, err.message);
    }
  }
  return opportunities;
}

// ── Lightweight price update ──────────────────────────────────────────────────
async function fetchCurrentPrices(onProgress = null) {
  const cache = loadCache();
  if (!cache?.data?.length) return null;

  const updatedData = [...cache.data];
  const now = new Date().toISOString();

  for (let i = 0; i < updatedData.length; i++) {
    const item = updatedData[i];
    if (onProgress) onProgress({ done: i, total: updatedData.length, symbol: item.symbol });

    // Check if price is fresh (less than 1 hour old) and marketCap is not missing
    const pricedAtStr = item.pricedAt || item.fetchedAt || cache.pricedAt || cache.fetchedAt;
    const isFresh = pricedAtStr && 
                    item.marketCap !== undefined && 
                    item.marketCap !== null && 
                    (Date.now() - new Date(pricedAtStr).getTime()) < 60 * 60 * 1000;

    if (isFresh) {
      console.log(`Price update skipped (fresh): ${item.symbol}`);
      continue;
    }

    try {
      const quote    = await yahooFinance.quote(item.symbol);
      const newPrice = quote.regularMarketPrice;
      if (!newPrice || newPrice <= 0) continue;
      
      updatedData[i] = {
        ...item,
        currentPrice:   newPrice,
        marginOfSafety: ((newPrice - item.strike) / newPrice) * 100,
        marketCap:      quote.marketCap || item.marketCap || null,
        pricedAt:       now
      };
    } catch (err) {
      console.warn(`Price update skipped for ${item.symbol}:`, err.message);
    }
  }
  if (onProgress) onProgress({ done: updatedData.length, total: updatedData.length, symbol: '' });
  return updatedData;
}

// ── Broadcast helpers ─────────────────────────────────────────────────────────
function broadcast(channel, payload) {
  BrowserWindow.getAllWindows().forEach(w => w.webContents.send(channel, payload));
}

function getNextDate(fromNow_days) {
  const d = new Date();
  d.setDate(d.getDate() + fromNow_days);
  return d.toISOString();
}

function getNextHour(fromNow_hours) {
  const d = new Date();
  d.setHours(d.getHours() + fromNow_hours);
  return d.toISOString();
}

// ── Scheduled full scan ───────────────────────────────────────────────────────
async function runScheduledFetch() {
  console.log('Running scheduled list refresh...');
  broadcast('auto-fetch-start', null);
  try {
    const { opportunities, ivHistory } = await fetchOptionsData();
    saveCache(opportunities, ivHistory);
    const settings = loadSettings();
    broadcast('auto-fetch-done', {
      data:           opportunities,
      fetchedAt:      new Date().toISOString(),
      pricedAt:       new Date().toISOString(),
      minMarginPct:   settings.minMarginPct,
      nextRefresh:    getNextDate(settings.refreshIntervalDays),
      nextPriceUpdate: getNextHour(settings.priceRefreshHours)
    });
  } catch (e) {
    console.error('Scheduled fetch failed:', e.message);
    broadcast('auto-fetch-error', e.message);
  }
}

// ── Scheduled price update ────────────────────────────────────────────────────
async function runScheduledPriceUpdate() {
  console.log('Running scheduled price update...');
  broadcast('auto-price-start', null);
  try {
    const updatedData = await fetchCurrentPrices();
    if (!updatedData) { broadcast('auto-price-error', 'No cached list'); return; }
    savePriceUpdate(updatedData);
    const settings = loadSettings();
    broadcast('auto-price-done', {
      data:           updatedData,
      pricedAt:       new Date().toISOString(),
      nextPriceUpdate: getNextHour(settings.priceRefreshHours)
    });
  } catch (e) {
    console.error('Scheduled price update failed:', e.message);
    broadcast('auto-price-error', e.message);
  }
}

// ── Schedulers ────────────────────────────────────────────────────────────────
function initScheduler() {
  const settings = loadSettings();
  const cache     = loadCache();
  const listMs    = settings.refreshIntervalDays * 24 * 60 * 60 * 1000;
  const lastFetch = cache?.fetchedAt ? new Date(cache.fetchedAt) : null;

  if (!lastFetch || (Date.now() - lastFetch) >= listMs)
    setTimeout(() => runScheduledFetch(), 3000);

  setInterval(() => {
    const s    = loadSettings();
    const c    = loadCache();
    const ms   = s.refreshIntervalDays * 24 * 60 * 60 * 1000;
    const last = c?.fetchedAt ? new Date(c.fetchedAt) : null;
    if (!last || (Date.now() - last) >= ms) runScheduledFetch();
  }, 60 * 60 * 1000);
}

function initPriceScheduler() {
  const settings    = loadSettings();
  const cache       = loadCache();
  if (!cache?.data?.length) return;

  const priceMs     = settings.priceRefreshHours * 60 * 60 * 1000;
  const lastPriced  = cache?.pricedAt ? new Date(cache.pricedAt) : null;

  if (!lastPriced || (Date.now() - lastPriced) >= priceMs)
    setTimeout(() => runScheduledPriceUpdate(), 5000);

  setInterval(() => {
    const s    = loadSettings();
    if (s.priceRefreshHours === 0) return;
    const c    = loadCache();
    const ms   = s.priceRefreshHours * 60 * 60 * 1000;
    const last = c?.pricedAt ? new Date(c.pricedAt) : null;
    if (!last || (Date.now() - last) >= ms) runScheduledPriceUpdate();
  }, 30 * 60 * 1000);
}

// ── Window ────────────────────────────────────────────────────────────────────
function createWindow() {
  const win = new BrowserWindow({
    width: 1600, height: 1040, minWidth: 960, minHeight: 600,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'hidden',
    frame: false,
    icon: path.join(__dirname, 'assets', 'icon.png'),
    backgroundColor: '#070911',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true, // for the embedded IBKR gateway login page
    }
  });
  win.loadFile(path.join(__dirname, 'src', 'index.html'));
}

// ── IBKR gateway process manager ────────────────────────────────────────────
// The Client Portal Gateway is a Java program the user unzips locally. We start
// it as a child process so they never touch a terminal, and tree-kill it on
// quit so no orphaned Java lingers.
//
// stdout/stderr MUST be drained: the gateway logs heavily at startup, and an
// unread 'pipe' fills its 64KB buffer and blocks the Java process mid-boot
// (which presents as "starting…" forever). We stream everything to
// gateway.log in userData — that both prevents the deadlock and gives the
// user something to look at when startup fails.
const GATEWAY_LOG_FILE = path.join(app.getPath('userData'), 'gateway.log');
let gatewayProc = null;
let gatewayLastExit = null;   // { code, at } of the most recent unexpected exit

function isGatewayRunning() {
  return gatewayProc != null;
}

function gatewayLogTail(lines = 15) {
  try {
    const text = fs.readFileSync(GATEWAY_LOG_FILE, 'utf8');
    return text.split(/\r?\n/).filter(Boolean).slice(-lines);
  } catch {
    return [];
  }
}

// Is something already listening on the gateway's port? A fast TCP probe — this
// is how we recognize a gateway from a previous (possibly crashed) run, or one
// the user started by hand, and reuse it instead of spawning a duplicate.
function probeGatewayPort(url, timeoutMs = 700) {
  const { host, port } = gatewayHostPort(url);
  return new Promise(resolve => {
    const sock = new net.Socket();
    let done = false;
    const finish = (up) => { if (done) return; done = true; try { sock.destroy(); } catch {} resolve(up); };
    sock.setTimeout(timeoutMs);
    sock.once('connect', () => finish(true));
    sock.once('timeout', () => finish(false));
    sock.once('error', () => finish(false));
    sock.connect(port, host);
  });
}

async function startGateway() {
  if (gatewayProc) return { success: true, alreadyRunning: true };
  // Reuse an already-running gateway (orphan from a crash, or a manual launch)
  // rather than stacking a second one that would compete for the IBKR session.
  if (await probeGatewayPort(loadSettings().ibkrGatewayUrl)) {
    return { success: true, alreadyRunning: true, external: true };
  }
  const dir = loadSettings().ibkrGatewayDir;
  if (!dir || !fs.existsSync(dir)) {
    return { success: false, error: 'Gateway folder is not set (or missing). Point it at your unzipped clientportal.gw folder in Settings.' };
  }
  const spec = gatewayLaunchSpec(process.platform, dir);
  if (!fs.existsSync(path.join(dir, spec.batPath))) {
    return { success: false, error: `${spec.batPath} not found in ${dir} — is this the clientportal.gw folder?` };
  }
  try {
    const log = fs.createWriteStream(GATEWAY_LOG_FILE, { flags: 'w' });
    log.write(`[PortMax] launching gateway: ${spec.command} ${spec.args.join(' ')} (cwd ${spec.cwd}) at ${new Date().toISOString()}\n`);
    gatewayProc = spawn(spec.command, spec.args, {
      cwd: spec.cwd, shell: false, windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    gatewayLastExit = null;
    gatewayProc.stdout.pipe(log, { end: false });
    gatewayProc.stderr.pipe(log, { end: false });
    gatewayProc.on('exit', (code) => {
      gatewayLastExit = { code, at: new Date().toISOString() };
      log.write(`\n[PortMax] gateway exited with code ${code} at ${gatewayLastExit.at}\n`);
      log.end();
      gatewayProc = null;
    });
    gatewayProc.on('error', (err) => {
      gatewayLastExit = { code: null, error: err.message, at: new Date().toISOString() };
      log.write(`\n[PortMax] gateway spawn error: ${err.message}\n`);
      log.end();
      gatewayProc = null;
    });
    return { success: true, pid: gatewayProc.pid, logFile: GATEWAY_LOG_FILE };
  } catch (err) {
    gatewayProc = null;
    return { success: false, error: err.message };
  }
}

// Kill the gateway we launched (tree-kill so the Java child dies too).
function stopGateway() {
  if (!gatewayProc) return;
  const { command, args } = treeKillSpec(process.platform, gatewayProc.pid);
  try {
    if (process.platform === 'win32') spawn(command, args, { windowsHide: true });
    else gatewayProc.kill('SIGTERM');
  } catch {}
  gatewayProc = null;
}

// List every Client Portal gateway PID currently running — ours, orphans from a
// crashed run, and manually-started ones alike.
function listGatewayPids() {
  return new Promise(resolve => {
    const { command, args } = listGatewayPidsSpec(process.platform);
    execFile(command, args, { windowsHide: true, timeout: 5000 }, (err, stdout) => {
      // pgrep exits non-zero when nothing matches — that's "no gateways", not an error.
      resolve(parsePids(stdout));
    });
  });
}

// Stop ALL gateways, however many and however they were started. This is the
// clean-slate the login flow needs when orphans are competing for the session.
async function stopAllGateways() {
  const pids = await listGatewayPids();
  for (const pid of pids) {
    try {
      const { command, args } = treeKillSpec(process.platform, pid);
      spawn(command, args, { windowsHide: true });
    } catch {}
  }
  // Best-effort: also drop our tracked handle so state is consistent.
  stopGateway();
  return { stopped: pids.length, pids };
}

// ── IPC ───────────────────────────────────────────────────────────────────────
app.whenReady().then(() => {
  loadQuoteCache();
  loadFundInsightsCache();
  ipcMain.handle('load-initial-data', async () => {
    const cache    = loadCache();
    const settings = loadSettings();
    if (!cache) return null;

    const daysAgo  = Math.floor((Date.now() - new Date(cache.fetchedAt)) / (24 * 60 * 60 * 1000));
    const hoursAgo = Math.floor((Date.now() - new Date(cache.pricedAt || cache.fetchedAt)) / (60 * 60 * 1000));

    if (cache.data && Array.isArray(cache.data) && cache.data.length > 0) {
      await enrichOpportunitiesWithQuotes(cache.data, settings);
      saveCache(cache.data, cache.ivHistory);
    }

    return {
      data:           cache.data,
      fetchedAt:      cache.fetchedAt,
      pricedAt:       cache.pricedAt || cache.fetchedAt,
      minMarginPct:   cache.minMarginPct ?? null,
      nextRefresh:    getNextDate(settings.refreshIntervalDays - daysAgo),
      nextPriceUpdate: settings.priceRefreshHours > 0
        ? getNextHour(settings.priceRefreshHours - hoursAgo)
        : null
    };
  });

  ipcMain.handle('fetch-data', async (event) => {
    try {
      const onProgress = (p) => event.sender.send('fetch-progress', p);
      const { opportunities, ivHistory } = await fetchOptionsData(null, onProgress);
      saveCache(opportunities, ivHistory);
      const settings = loadSettings();
      const now = new Date().toISOString();
      return {
        success: true, data: opportunities,
        fetchedAt: now, pricedAt: now,
        minMarginPct:   settings.minMarginPct,
        nextRefresh:    getNextDate(settings.refreshIntervalDays),
        nextPriceUpdate: getNextHour(settings.priceRefreshHours)
      };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle('fetch-prices', async (event) => {
    try {
      const onProgress = (p) => event.sender.send('price-progress', p);
      const updatedData = await fetchCurrentPrices(onProgress);
      if (!updatedData) return { success: false, error: 'No cached list to update' };
      savePriceUpdate(updatedData);
      const settings = loadSettings();
      const pricedAt = new Date().toISOString();
      return {
        success: true, data: updatedData, pricedAt,
        nextPriceUpdate: getNextHour(settings.priceRefreshHours)
      };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });

  ipcMain.on('window-minimize', () => BrowserWindow.getFocusedWindow()?.minimize());
  ipcMain.on('window-maximize', () => {
    const win = BrowserWindow.getFocusedWindow();
    if (win) win.isMaximized() ? win.unmaximize() : win.maximize();
  });
  ipcMain.on('window-close', () => BrowserWindow.getFocusedWindow()?.close());

  ipcMain.handle('get-discovery-opps', () => {
    const cache = loadDiscoveryCache();
    return Object.values(cache).filter(e => e.opp).map(e => e.opp);
  });

  ipcMain.handle('get-settings', () => loadSettings());
  ipcMain.handle('save-settings', (_event, newSettings) => {
    const merged = { ...loadSettings(), ...newSettings };
    saveSettings(merged);
    return merged;
  });

  ipcMain.handle('reset-all-data', () => {
    try {
      saveSettings(DEFAULT_SETTINGS);
      if (fs.existsSync(CACHE_FILE)) {
        fs.unlinkSync(CACHE_FILE);
      }
      if (fs.existsSync(DISC_CACHE_FILE)) {
        fs.unlinkSync(DISC_CACHE_FILE);
      }
      return { success: true };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('fetch-history', async (_event, symbol) => {
    try {
      const end   = new Date();
      const start = new Date();
      start.setDate(start.getDate() - 30);
      const chartResult = await yahooFinance.chart(symbol, { period1: start, period2: end, interval: '1d' });
      const result = chartResult.quotes || [];
      return result
        .filter(d => d.date && d.close != null)
        .map(d => ({ date: d.date.toISOString().split('T')[0], close: d.close }));
    } catch { return []; }
  });

  // ── Unified watchlist management ──────────────────────────────────────────
  ipcMain.handle('get-watchlists', () => {
    return loadSettings().watchlist || [];
  });

  ipcMain.handle('add-to-watchlist', async (_event, { symbol }) => {
    const sym = (symbol || '').toUpperCase().trim();
    if (!sym) return { success: false, error: 'Symbol is required' };
    try {
      const quote = await yahooFinance.quote(sym);
      if (!quote || !quote.regularMarketPrice) return { success: false, error: 'Symbol not found' };
    } catch {
      return { success: false, error: 'Could not validate symbol' };
    }
    const settings = loadSettings();
    const watchlist = [...new Set([...(settings.watchlist || []), sym])];
    saveSettings({ ...settings, watchlist });
    return { success: true, watchlist };
  });

  ipcMain.handle('remove-from-watchlist', (_event, { symbol }) => {
    const settings = loadSettings();
    const watchlist = (settings.watchlist || []).filter(s => s !== symbol);
    saveSettings({ ...settings, watchlist });
    return { success: true, watchlist };
  });

  ipcMain.handle('scan-single-symbol', async (_event, symbol) => {
    const sym = (symbol || '').toUpperCase().trim();
    if (!sym) return { success: false, error: 'Symbol is required' };
    try {
      const { opportunities, ivHistory } = await fetchOptionsData([sym]);
      const cache = loadCache() || {};
      const existing = cache.data || [];
      const updatedData = [
        ...existing.filter(o => o.symbol !== sym),
        ...opportunities
      ];
      saveCache(updatedData, { ...(cache.ivHistory || {}), ...ivHistory });
      return { success: true, data: updatedData };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('get-starred', () => {
    return loadSettings().starred || [];
  });

  ipcMain.handle('toggle-starred', (_event, { symbol }) => {
    const sym = (symbol || '').toUpperCase().trim();
    if (!sym) return { success: false, error: 'Symbol is required' };
    const settings = loadSettings();
    let starred = settings.starred || [];
    if (starred.includes(sym)) {
      starred = starred.filter(s => s !== sym);
    } else {
      starred = [...starred, sym];
    }
    saveSettings({ ...settings, starred });
    return { success: true, starred };
  });

  // ── Discovery ────────────────────────────────────────────────────────────────
  let discoveryRunning = false;
  ipcMain.handle('run-discovery', async (event, options = {}) => {
    if (discoveryRunning) return { success: false, error: 'Scan already in progress' };
    discoveryRunning = true;
    try {
      const screens = [
        'most_actives', 'day_gainers', 'day_losers',
        'growth_technology_stocks', 'undervalued_large_caps', 'aggressive_small_caps',
      ];
      const batches = await Promise.allSettled(
        screens.map(scrId => yahooFinance.screener({ scrIds: scrId, count: 150 }))
      );
      const universe = [...new Set(
        batches
          .filter(r => r.status === 'fulfilled')
          .flatMap(r => (r.value?.quotes || []).map(q => q.symbol))
          .filter(s => s && /^[A-Z]{1,5}$/.test(s))
      )];

      if (universe.length === 0)
        return { success: false, error: 'Screener returned no results — try again later' };

      const discCache = loadDiscoveryCache();
      const today     = new Date().toISOString().split('T')[0];
      const oneHourMs = 60 * 60 * 1000;

      let cached, toFetch;
      if (options.force) {
        // Force: only skip symbols fetched within the last hour
        cached  = universe.filter(s => {
          const e = discCache[s];
          if (!e) return false;
          const ts = e.fetchedAt ? new Date(e.fetchedAt) : null;
          return ts && (Date.now() - ts) < oneHourMs;
        });
        toFetch = universe.filter(s => !cached.includes(s));
      } else {
        cached    = universe.filter(s => discCache[s]?.date === today);
        toFetch   = universe.filter(s => discCache[s]?.date !== today);
      }

      event.sender.send('discovery-progress', {
        phase: 'scanning', done: cached.length, total: universe.length,
        symbol: '', fromCache: cached.length, toFetch: toFetch.length, fetched: 0,
      });

      const cachedOpps = cached.map(s => discCache[s].opp).filter(Boolean);

      const settings           = loadSettings();
      const minMarginMultiplier = 1 - (parseFloat(settings.minMarginPct) / 100);
      const mainCache          = loadCache() || {};
      const ivHistory          = mainCache.ivHistory || {};
      const freshOpps          = [];
      let fetched              = 0;

      for (const symbol of toFetch) {
        let opp = null;
        try {
          opp = await analyzeSingleSymbol(symbol, minMarginMultiplier, ivHistory);
          if (opp) {
            opp.strategies = ['ivr', 'iv_hv', 'mean_reversion'];
            freshOpps.push(opp);
          }
        } catch (err) {
          console.warn(`Discovery skipping ${symbol}:`, err.message);
        }
        discCache[symbol] = { date: today, fetchedAt: new Date().toISOString(), opp };
        fetched++;
        event.sender.send('discovery-progress', {
          phase: 'scanning',
          done: cached.length + fetched, total: universe.length,
          symbol, fromCache: cached.length, toFetch: toFetch.length, fetched,
        });
      }

      saveDiscoveryCache(discCache);
      if (Object.keys(ivHistory).length > 0) {
        const mc = loadCache() || {};
        fs.writeFileSync(CACHE_FILE, JSON.stringify({ ...mc, ivHistory }), 'utf8');
      }

      const opportunities = [...cachedOpps, ...freshOpps];
      const top = 25;
      const results = {
        ivr: [...opportunities]
          .sort((a, b) => (b.ivr ?? b.impliedVolatility * 100) - (a.ivr ?? a.impliedVolatility * 100))
          .slice(0, top),
        iv_hv: [...opportunities]
          .sort((a, b) => (b.ivHvRatio || 0) - (a.ivHvRatio || 0))
          .slice(0, top),
        mean_reversion: [...opportunities]
          .sort((a, b) => {
            if (b.meanReversionSignal !== a.meanReversionSignal) return b.meanReversionSignal ? 1 : -1;
            return b.annualizedYield - a.annualizedYield;
          })
          .slice(0, top),
      };

      // Auto-add discovered stocks to unified watchlist (use ALL valid opportunities, not just top 25 sliced)
      const settings2 = loadSettings();
      const existing = new Set(settings2.watchlist || []);
      let totalAdded = 0;
      const allOpps = [...new Set(opportunities.map(o => o.symbol))];
      for (const sym of allOpps) {
        if (!existing.has(sym)) { existing.add(sym); totalAdded++; }
      }
      const watchlist = [...existing];
      saveSettings({ ...settings2, watchlist });

      // Merge and save these opportunities directly into the main watchlist cache (data.json)
      const mc = loadCache() || {};
      const mainOpps = mc.data || [];
      const mergedOppsMap = new Map();
      
      // Load existing cached opportunities
      for (const o of mainOpps) {
        mergedOppsMap.set(o.symbol, o);
      }
      // Insert / overwrite with newly discovered opportunities
      const now = new Date().toISOString();
      for (const o of opportunities) {
        mergedOppsMap.set(o.symbol, {
          ...o,
          fetchedAt: now,
          pricedAt: now
        });
      }
      
      saveCache([...mergedOppsMap.values()], { ...(mc.ivHistory || {}), ...ivHistory });

      return {
        success: true, results, watchlist,
        scanned: universe.length, found: opportunities.length,
        fromCache: cached.length, fetched: toFetch.length, totalAdded,
      };
    } catch (err) {
      return { success: false, error: err.message };
    } finally {
      discoveryRunning = false;
    }
  });

  ipcMain.handle('get-portfolio', () => {
    try {
      return portfolioView(loadPortfolio());
    } catch (err) {
      console.error('IPC get-portfolio error:', err);
      throw err;
    }
  });

  ipcMain.handle('save-portfolio', (_event, updates) => {
    const merged = { ...loadPortfolio(), ...updates, updatedAt: new Date().toISOString() };
    savePortfolio(merged);
    return portfolioView(merged);
  });

  ipcMain.handle('import-portfolio-csv', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const { canceled, filePaths } = await dialog.showOpenDialog(win, {
      title: 'Import IBKR positions CSV',
      filters: [{ name: 'CSV files', extensions: ['csv'] }],
      properties: ['openFile'],
    });
    if (canceled || !filePaths.length) return { success: false, canceled: true };

    try {
      const text = fs.readFileSync(filePaths[0], 'utf8');
      const { holdings, cash, errors, baseCurrency } = parsePositionsCsv(text);
      if (!holdings.length && errors.length) {
        return { success: false, error: errors.join('; ') };
      }

      // Preserve manual annotations (bucket, employer flag) across re-imports
      const prev = loadPortfolio();
      const prevBySymbol = new Map(prev.holdings.map(h => [h.symbol, h]));
      const employerSyms = new Set((prev.employerSymbols || []).map(s => s.toUpperCase()));
      for (const h of holdings) {
        const old = prevBySymbol.get(h.symbol);
        if (old) {
          h.bucket = old.bucket;
          h.isEmployerStock = old.isEmployerStock;
        }
        // employerSymbols is the durable source of truth — it survives imports
        // even when the holding itself is new (e.g. a fresh RSU transfer).
        if (employerSyms.has(h.symbol)) h.isEmployerStock = true;
      }

      const merged = {
        ...prev, holdings, cash,
        baseCurrency: baseCurrency || prev.baseCurrency || null,
        updatedAt: new Date().toISOString(),
        source: 'csv',
      };
      savePortfolio(merged);
      return { success: true, portfolio: portfolioView(merged), warnings: errors };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // ── IBKR Client Portal Gateway (Phase 2) ───────────────────────────────────
  const ibkrClientFor = () => createIbkrClient(loadSettings().ibkrGatewayUrl);
  let ibkrLastAuthOk = 0;

  // FX via Yahoo currency pairs — same source the price refresh uses.
  async function yahooFxRate(source, target) {
    const q = await fetchCachedQuote(`${source}${target}=X`);
    return q?.regularMarketPrice || null;
  }

  ipcMain.handle('ibkr-status', async () => {
    const status = await ibkrClientFor().getStatus();
    if (status.authenticated) ibkrLastAuthOk = Date.now();
    return { ...status, gatewayUrl: loadSettings().ibkrGatewayUrl };
  });

  ipcMain.handle('ibkr-sync', async () => {
    try {
      const result = await ibkrClientFor().syncPortfolio({ getFxRate: yahooFxRate });
      if (!result.success) return result;
      ibkrLastAuthOk = Date.now();

      // Same annotation-preserving merge as the CSV import
      const prev = loadPortfolio();
      const prevBySymbol = new Map(prev.holdings.map(h => [h.symbol, h]));
      const settings = loadSettings();
      const employerSyms = new Set((settings.employerSymbols || '').toUpperCase().split(',').map(s => s.trim()).filter(Boolean));
      for (const h of result.holdings) {
        const old = prevBySymbol.get(h.symbol);
        if (old) h.bucket = old.bucket;
        if (employerSyms.has(h.symbol)) h.isEmployerStock = true;
      }

      const merged = {
        ...prev,
        holdings: result.holdings,
        cash: result.cash,
        baseCurrency: result.baseCurrency || prev.baseCurrency || null,
        ibkrAccountId: result.accountId,
        updatedAt: new Date().toISOString(),
        source: 'ibkr',
      };
      savePortfolio(merged);
      return {
        success: true,
        portfolio: portfolioView(merged),
        accountId: result.accountId,
        warnings: result.errors,
      };
    } catch (err) {
      return { success: false, state: 'error', error: err.message };
    }
  });

  ipcMain.handle('ibkr-open-login', () => {
    const { shell } = require('electron');
    shell.openExternal(loadSettings().ibkrGatewayUrl);
    return { success: true };
  });

  // Gateway process lifecycle
  ipcMain.handle('ibkr-gateway-start', () => startGateway());
  // Stop ALL gateways (ours + any orphans) so a fresh login starts clean.
  ipcMain.handle('ibkr-gateway-stop', async () => {
    const res = await stopAllGateways();
    return { success: true, ...res };
  });
  // "Running" now reflects reality: our tracked process OR any gateway already
  // answering on the port (an orphan or a manual launch).
  ipcMain.handle('ibkr-gateway-running', async () => ({
    running: isGatewayRunning() || await probeGatewayPort(loadSettings().ibkrGatewayUrl),
    external: !isGatewayRunning() && await probeGatewayPort(loadSettings().ibkrGatewayUrl),
    lastExit: gatewayLastExit,
  }));
  ipcMain.handle('ibkr-gateway-log', (_event, lines) => ({
    logFile: GATEWAY_LOG_FILE,
    tail: gatewayLogTail(lines || 15),
    lastExit: gatewayLastExit,
  }));

  ipcMain.handle('ibkr-pick-gateway-dir', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const { canceled, filePaths } = await dialog.showOpenDialog(win, {
      title: 'Select the clientportal.gw folder',
      properties: ['openDirectory'],
    });
    if (canceled || !filePaths.length) return { canceled: true };
    const dir = filePaths[0];
    const spec = gatewayLaunchSpec(process.platform, dir);
    const valid = fs.existsSync(path.join(dir, spec.command));
    const merged = { ...loadSettings(), ibkrGatewayDir: dir };
    saveSettings(merged);
    return { dir, valid, expected: spec.command };
  });

  // ── IBKR credentials (encrypted, OS-backed) ────────────────────────────────
  // safeStorage ties encryption to the OS user account (DPAPI on Windows,
  // Keychain on macOS, libsecret on Linux) — the same posture as a browser's
  // saved-password store. The password is a dedicated path, deliberately NOT
  // routed through the generic save-settings handler, so it can never end up
  // as plaintext in settings.json by accident.
  ipcMain.handle('ibkr-save-credentials', (_event, { username, password }) => {
    if (!safeStorage.isEncryptionAvailable()) {
      return { success: false, error: 'OS-level credential encryption is unavailable on this machine.' };
    }
    const settings = loadSettings();
    const updates = {};
    if (username != null) updates.ibkrUsername = username;
    if (password) {
      updates.ibkrPasswordEncrypted = safeStorage.encryptString(password).toString('base64');
    }
    saveSettings({ ...settings, ...updates });
    return { success: true };
  });

  ipcMain.handle('ibkr-clear-credentials', () => {
    saveSettings({ ...loadSettings(), ibkrUsername: '', ibkrPasswordEncrypted: '' });
    return { success: true };
  });

  ipcMain.handle('ibkr-has-credentials', () => {
    const settings = loadSettings();
    return {
      hasUsername: !!settings.ibkrUsername,
      hasPassword: !!settings.ibkrPasswordEncrypted,
      encryptionAvailable: safeStorage.isEncryptionAvailable(),
    };
  });

  // Returns plaintext — used only by the renderer immediately before filling
  // the embedded login webview. Never persisted outside main; never logged.
  ipcMain.handle('ibkr-get-credentials', () => {
    const settings = loadSettings();
    let password = null;
    if (settings.ibkrPasswordEncrypted && safeStorage.isEncryptionAvailable()) {
      try {
        password = safeStorage.decryptString(Buffer.from(settings.ibkrPasswordEncrypted, 'base64'));
      } catch (err) {
        console.warn('Failed to decrypt stored IBKR password:', err.message);
      }
    }
    return { username: settings.ibkrUsername || '', password };
  });

  // Keep the gateway session alive while the app is open — but only when a
  // recent status check actually saw an authenticated session, so a stopped
  // gateway doesn't produce a request-error every minute.
  setInterval(async () => {
    if (Date.now() - ibkrLastAuthOk > 15 * 60 * 1000) return;
    const ok = await ibkrClientFor().tickle();
    if (ok) ibkrLastAuthOk = Date.now();
  }, 60 * 1000);

  ipcMain.handle('analyze-ticker', async (_event, symbol, holdings, cash) => {
    let quote = null;
    try {
      if (symbol) {
        quote = await fetchCachedQuote(symbol);
      }
    } catch (err) {
      console.warn(`Failed to fetch quote for ${symbol} in analyze-ticker:`, err.message);
    }
    return analyzeTicker(symbol, holdings, cash, quote);
  });

  // ── Live price refresh for portfolio holdings ─────────────────────────────
  ipcMain.handle('refresh-portfolio-prices', async () => {
    const p = loadPortfolio();
    const base = (p.baseCurrency || 'USD').toUpperCase();
    const fxCache = {};
    let updated = 0;
    const skipped = [];

    for (const h of p.holdings || []) {
      if (!h.quantity || h.quantity <= 0) { skipped.push(h.symbol); continue; }
      try {
        const quote = await fetchCachedQuote(h.symbol);
        const price = quote?.regularMarketPrice;
        if (!price || price <= 0) { skipped.push(h.symbol); continue; }

        // Only trust the quote when its listing currency matches the holding's —
        // a mismatch usually means Yahoo resolved a different exchange listing
        // of the same ticker. Those keep their imported value.
        const qCcy = (quote.currency || 'USD').toUpperCase();
        const hCcy = (h.currency || base).toUpperCase();
        if (qCcy !== hCcy) { skipped.push(h.symbol); continue; }

        let fx = 1;
        if (qCcy !== base) {
          if (!(qCcy in fxCache)) {
            const fxq = await fetchCachedQuote(`${qCcy}${base}=X`);
            fxCache[qCcy] = fxq?.regularMarketPrice || null;
          }
          fx = fxCache[qCcy];
          if (!fx) { skipped.push(h.symbol); continue; }
        }

        h.marketValue = h.quantity * price * fx;
        h.priceUpdatedAt = new Date().toISOString();
        updated++;
      } catch {
        skipped.push(h.symbol);
      }
    }

    if (updated > 0) {
      p.pricesUpdatedAt = new Date().toISOString();
      savePortfolio(p);
    }
    return { success: true, portfolio: portfolioView(p), updated, skipped };
  });

  // ── Portfolio health grade + dividend projection ──────────────────────────
  ipcMain.handle('get-portfolio-health', async (_event, opts = {}) => {
    const p = loadPortfolio();
    if (!p.holdings || p.holdings.length === 0) return null;
    const settings = loadSettings();

    // Recompute only when the inputs actually changed (or the cache is stale —
    // quote-derived data like dividends drifts even with an unchanged portfolio).
    const fingerprint = portfolioFingerprint(p, settings);
    if (!opts.force) {
      const cached = loadHealthCache();
      if (cached?.health &&
          cached.fingerprint === fingerprint &&
          Date.now() - new Date(cached.computedAt).getTime() < HEALTH_CACHE_MAX_AGE_MS) {
        return { ...cached, fromCache: true };
      }
    }

    const quotes = {};
    await Promise.all(p.holdings.map(async h => {
      try {
        const q = await fetchQuoteForHolding(h);
        if (!q) return;
        // Attach the fund expense ratio (the Cost health dimension needs it).
        // The plain quote() rarely carries it; the 7-day-cached quoteSummary
        // does, under fundProfile. Stocks simply won't have one. Copy rather
        // than mutate the shared quote-cache object.
        let enriched = q;
        if (q.annualReportExpenseRatio == null && q.expenseRatio == null) {
          try {
            const summary = await fetchCachedQuoteSummary(h.symbol);
            const er = summary?.fundProfile?.feesExpensesInvestment?.annualReportExpenseRatio;
            if (er != null) enriched = { ...q, annualReportExpenseRatio: er };
          } catch {}
        }
        quotes[h.symbol.toUpperCase()] = enriched;
      } catch (err) {
        console.warn(`Health quote fetch failed for ${h.symbol}:`, err.message);
      }
    }));

    const health = computePortfolioHealth({
      holdings: p.holdings,
      cash: p.cash,
      targets: p.targets,
      tolerancePct: p.tolerancePct,
      quotes,
      settings,
    });
    const dividends = projectAnnualDividends(p.holdings, quotes);
    const payload = { fingerprint, computedAt: new Date().toISOString(), health, dividends };
    saveHealthCache(payload);

    // A real recompute means the portfolio changed (fingerprint-gated) — the
    // natural moment to record a history point. Reuses the quotes we just
    // fetched, so no extra network. Failures here never break the health call.
    try {
      captureProfileSnapshot({ p, settings, health, dividends, quotes, source: 'live' });
    } catch (err) {
      console.warn('Profile-history capture failed:', err.message);
    }
    return payload;
  });

  ipcMain.handle('get-portfolio-guidance', async (_event, holdings, cash, targets, watchlistData) => {
    const settings = loadSettings();
    const quotes = {};
    if (Array.isArray(holdings)) {
      await Promise.all(holdings.map(async h => {
        try {
          if (h.symbol) {
            const q = await fetchQuoteForHolding(h);
            if (q) quotes[h.symbol.toUpperCase()] = q;
          }
        } catch (err) {
          console.warn(`Failed to fetch quote for ${h.symbol} in get-portfolio-guidance:`, err.message);
        }
      }));
    }
    return generatePortfolioGuidance(holdings, cash, targets, settings, quotes, watchlistData);
  });

  // Tax-aware buy ideas: rules-based output of the user's own targets + tax
  // profile (US citizen / NL citizen / CH resident) — never generic stock tips.
  ipcMain.handle('get-buy-recommendations', async (_event, watchlistData) => {
    const p = loadPortfolio();
    const settings = loadSettings();
    const quotes = {};

    // Holdings: currency-validated quotes (guards against wrong-exchange listings)
    await Promise.all(p.holdings.map(async h => {
      try {
        const q = await fetchQuoteForHolding(h);
        if (q) quotes[h.symbol.toUpperCase()] = q;
      } catch {}
    }));

    // Curated candidates are all US-listed; accept only USD quotes for them
    await Promise.all(CURATED_CANDIDATES.map(async c => {
      if (quotes[c.symbol]) return;
      try {
        const q = await fetchCachedQuote(c.symbol);
        if (q && (q.currency || 'USD').toUpperCase() === 'USD') quotes[c.symbol] = q;
      } catch {}
    }));

    return generateBuyRecommendations({
      holdings: p.holdings,
      cash: p.cash,
      targets: p.targets,
      settings,
      quotes,
      watchlistData: watchlistData || [],
    });
  });

  // Investment Scanner: full per-category ranked "what to buy" lists (ETFs,
  // bonds, stocks, dividend income). Same quote-gathering as buy-recs.
  ipcMain.handle('scan-investments', async (_event, watchlistData) => {
    const p = loadPortfolio();
    const settings = loadSettings();
    const quotes = {};
    await Promise.all(p.holdings.map(async h => {
      try { const q = await fetchQuoteForHolding(h); if (q) quotes[h.symbol.toUpperCase()] = q; } catch {}
    }));
    await Promise.all(CURATED_CANDIDATES.map(async c => {
      if (quotes[c.symbol]) return;
      try { const q = await fetchCachedQuote(c.symbol); if (q && (q.currency || 'USD').toUpperCase() === 'USD') quotes[c.symbol] = q; } catch {}
    }));
    return scanInvestments({
      holdings: p.holdings, cash: p.cash, targets: p.targets,
      settings, quotes, watchlistData: watchlistData || [],
    });
  });

  // True employer exposure: direct position + the slices hiding inside every
  // held index fund (topHoldings look-through). Reported as a floor — only a
  // fund's top ~10 holdings are visible to us.
  ipcMain.handle('get-employer-exposure', async () => {
    const p = loadPortfolio();
    const settings = loadSettings();
    const employerSyms = new Set((settings.employerSymbols || '').toUpperCase().split(',').map(s => s.trim()).filter(Boolean));
    if (employerSyms.size === 0) return null;

    const total = p.holdings.reduce((s, h) => s + (h.marketValue || 0), 0) + (p.cash || 0);
    const directValue = p.holdings
      .filter(h => employerSyms.has((h.symbol || '').toUpperCase()))
      .reduce((s, h) => s + (h.marketValue || 0), 0);

    // Look through only what quotes say is a fund — no point hammering
    // quoteSummary for single stocks.
    const lookthroughs = [];
    await Promise.all(p.holdings.map(async h => {
      const sym = (h.symbol || '').toUpperCase();
      if (!sym || h.assetCategory === 'OPT' || sym.length > 8 || employerSyms.has(sym)) return;
      try {
        const q = await fetchQuoteForHolding(h);
        const qType = (q?.quoteType || '').toUpperCase();
        if (qType !== 'ETF' && qType !== 'MUTUALFUND') return;
        const summary = await fetchCachedQuoteSummary(sym);
        const topHoldings = summary?.topHoldings?.holdings;
        if (topHoldings?.length) lookthroughs.push({ symbol: sym, marketValue: h.marketValue || 0, topHoldings });
      } catch {}
    }));

    return computeIndexImpliedEmployer(lookthroughs, directValue, settings.employerSymbols, total);
  });

  // ── Employer-stock sell-down plan (Phase 4) ────────────────────────────────
  // Turns the standing "Trim" advice into a tracked quarterly schedule. Still
  // read-only: the plan records intent and progress; trades happen at the broker.
  async function selldownCurrentPosition(p, symbol) {
    const h = p.holdings.find(x => (x.symbol || '').toUpperCase() === symbol);
    if (!h || !(h.quantity > 0)) return null;
    let price = null;
    try {
      const q = await fetchQuoteForHolding(h);
      price = q?.regularMarketPrice || null;
    } catch {}
    if (!price && h.marketValue > 0) price = h.marketValue / h.quantity;
    if (!price) return null;
    // Keep the weight math consistent: if we price this position live, the
    // portfolio total must count it at the same live value, not the stored one.
    const total = totalValue(p.holdings, p.cash) - (h.marketValue || 0) + h.quantity * price;
    return { shares: h.quantity, price, totalValue: total };
  }

  ipcMain.handle('selldown-status', async () => {
    const p = loadPortfolio();
    const settings = loadSettings();
    const plan = p.sellDownPlan || null;

    if (plan) {
      const current = await selldownCurrentPosition(p, plan.symbol);
      // Position gone entirely (sold out or symbol changed) — treat as done.
      if (!current) return { plan, current: null, status: null, positionGone: true };
      return { plan, current, status: computePlanStatus(plan, current) };
    }

    // No plan yet: propose one for the largest employer position.
    const employerSyms = new Set([
      ...(settings.employerSymbols || '').toUpperCase().split(',').map(s => s.trim()).filter(Boolean),
      ...p.holdings.filter(h => h.isEmployerStock).map(h => (h.symbol || '').toUpperCase()),
    ]);
    const employerHoldings = p.holdings.filter(h =>
      employerSyms.has((h.symbol || '').toUpperCase()) && h.quantity > 0);
    if (!employerHoldings.length) return { plan: null, candidate: null };

    const biggest = employerHoldings.reduce((a, b) => ((b.marketValue || 0) > (a.marketValue || 0) ? b : a));
    const sym = biggest.symbol.toUpperCase();
    const current = await selldownCurrentPosition(p, sym);
    if (!current) return { plan: null, candidate: null };
    const weightPct = current.totalValue > 0
      ? ((current.shares * current.price) / current.totalValue) * 100 : 0;
    return { plan: null, candidate: { symbol: sym, ...current, weightPct } };
  });

  ipcMain.handle('selldown-save-plan', async (_event, { symbol, targetWeightPct, quartersToTarget }) => {
    try {
      const p = loadPortfolio();
      const sym = (symbol || '').toUpperCase();
      const current = await selldownCurrentPosition(p, sym);
      if (!current) return { success: false, error: `No position found for ${sym}` };
      const plan = buildPlan({
        symbol: sym,
        shares: current.shares,
        price: current.price,
        totalValue: current.totalValue,
        targetWeightPct: Number(targetWeightPct),
        quartersToTarget: Number(quartersToTarget),
      });
      savePortfolio({ ...p, sellDownPlan: plan, updatedAt: new Date().toISOString() });
      return { success: true, plan, current, status: computePlanStatus(plan, current) };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('selldown-clear-plan', () => {
    const p = loadPortfolio();
    delete p.sellDownPlan;
    savePortfolio({ ...p, updatedAt: new Date().toISOString() });
    return { success: true };
  });

  // ── PFIC exit-cost estimates (§1291, planning only — not tax advice) ───────
  // Per held PFIC: what selling today would cost in US tax vs. waiting.
  // Uses per-lot acquisition dates from the Activity Statement import when
  // available; otherwise the assumed-years-held setting.
  ipcMain.handle('get-pfic-estimates', async () => {
    const p = loadPortfolio();
    const settings = loadSettings();
    if (!isUSPerson(settings)) return { relevant: false, estimates: [] };

    const estimates = [];
    await Promise.all((p.holdings || []).map(async h => {
      const sym = (h.symbol || '').toUpperCase();
      if (!sym || h.assetCategory === 'OPT' || sym.length > 8) return;
      let quote = null;
      try { quote = await fetchQuoteForHolding(h); } catch {}
      const analysis = analyzeTicker(sym, p.holdings, p.cash, quote);
      if (!analysis?.isPfic) return;
      const est = estimatePficExitCost({
        currentValue: h.marketValue || 0,
        costBasis: h.costBasis ?? (h.marketValue || 0), // unknown basis ⇒ no gain to model
        lots: h.lots || [],
        marginalRatePct: settings.usMarginalRatePct ?? 32,
        interestRatePct: settings.pficInterestRatePct ?? 8,
        assumedYearsHeld: settings.pficAssumedYears ?? 3,
      });
      estimates.push({ symbol: sym, marketValue: h.marketValue || 0, unknownBasis: h.costBasis == null, ...est });
    }));

    estimates.sort((a, b) => b.totalTax - a.totalTax);
    return {
      relevant: true,
      estimates,
      assumptions: {
        marginalRatePct: settings.usMarginalRatePct ?? 32,
        interestRatePct: settings.pficInterestRatePct ?? 8,
        assumedYears: settings.pficAssumedYears ?? 3,
      },
    };
  });

  // ── Profile history (trajectory of the portfolio's shape over time) ────────
  ipcMain.handle('get-profile-history', () => {
    try {
      return { history: seedProfileHistoryIfEmpty() };
    } catch (err) {
      return { history: [], error: err.message };
    }
  });

  // Backfill a historical point from a dated IBKR Activity Statement. Adds the
  // snapshot at the statement's own date WITHOUT touching current holdings.
  ipcMain.handle('import-history-csv', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const { canceled, filePaths } = await dialog.showOpenDialog(win, {
      title: 'Import a dated IBKR Activity Statement for history',
      filters: [{ name: 'CSV files', extensions: ['csv'] }],
      properties: ['openFile'],
    });
    if (canceled || !filePaths.length) return { success: false, canceled: true };

    try {
      const text = fs.readFileSync(filePaths[0], 'utf8');
      const { statementDate, nav, dividendsPaid } = parseStatementMeta(text);
      if (!statementDate) {
        return { success: false, error: 'No statement date found. This needs an IBKR Activity Statement (which carries a "Period" date), not a plain positions export.' };
      }
      const { holdings, cash, errors } = parsePositionsCsv(text);
      if (!holdings.length) {
        return { success: false, error: errors.join('; ') || 'No positions found in the statement.' };
      }

      // Carry over employer flags/buckets from the current portfolio so the
      // historical point classifies concentration the same way.
      const prev = loadPortfolio();
      const prevBySymbol = new Map(prev.holdings.map(h => [h.symbol, h]));
      const settings = loadSettings();
      const employerSyms = new Set((settings.employerSymbols || '').toUpperCase().split(',').map(s => s.trim()).filter(Boolean));
      for (const h of holdings) {
        const old = prevBySymbol.get(h.symbol);
        if (old) { h.bucket = old.bucket; if (old.isEmployerStock) h.isEmployerStock = true; }
        if (employerSyms.has((h.symbol || '').toUpperCase())) h.isEmployerStock = true;
      }

      const history = captureProfileSnapshot({
        p: { holdings, cash, targets: prev.targets },
        settings, quotes: {}, nav, dividendsPaid,
        date: statementDate, source: 'statement',
      });
      return { success: true, statementDate, history, warnings: errors };
    } catch (err) {
      return { success: false, error: err.message };
    }
  });

  // ── Dashboard action plan ──────────────────────────────────────────────────
  // One prioritized to-do list assembled from every advice engine; the
  // arbitration/dedupe logic lives in lib/actions.js (pure, unit-tested).
  ipcMain.handle('get-action-plan', async (_event, watchlistData) => {
    const p = loadPortfolio();
    if (!p.holdings || !p.holdings.length) return { actions: [], moreCount: 0 };
    const settings = loadSettings();

    // Same quote policy as the guidance/buy-recs handlers: currency-validated
    // for holdings, USD-only for curated candidates. All cached, so cheap.
    const quotes = {};
    await Promise.all(p.holdings.map(async h => {
      try {
        const q = await fetchQuoteForHolding(h);
        if (q) quotes[h.symbol.toUpperCase()] = q;
      } catch {}
    }));
    await Promise.all(CURATED_CANDIDATES.map(async c => {
      if (quotes[c.symbol]) return;
      try {
        const q = await fetchCachedQuote(c.symbol);
        if (q && (q.currency || 'USD').toUpperCase() === 'USD') quotes[c.symbol] = q;
      } catch {}
    }));

    const wl = watchlistData || [];
    const guidanceItems = generatePortfolioGuidance(p.holdings, p.cash, p.targets, settings, quotes, wl);
    const buyRecs = generateBuyRecommendations({
      holdings: p.holdings, cash: p.cash, targets: p.targets, settings, quotes, watchlistData: wl,
    });

    let selldown = null;
    if (p.sellDownPlan) {
      const current = await selldownCurrentPosition(p, p.sellDownPlan.symbol);
      if (current) selldown = { plan: p.sellDownPlan, status: computePlanStatus(p.sellDownPlan, current) };
    } else {
      // No plan yet: surface the largest employer position so the action plan
      // can nudge toward starting one (holding-level flags + settings both count).
      const employerSyms = new Set((settings.employerSymbols || '').toUpperCase().split(',').map(s => s.trim()).filter(Boolean));
      const employerHoldings = p.holdings.filter(h =>
        (h.isEmployerStock || employerSyms.has((h.symbol || '').toUpperCase())) && h.quantity > 0);
      if (employerHoldings.length) {
        const biggest = employerHoldings.reduce((a, b) => ((b.marketValue || 0) > (a.marketValue || 0) ? b : a));
        const total = totalValue(p.holdings, p.cash);
        if (total > 0) {
          selldown = {
            plan: null,
            candidate: {
              symbol: (biggest.symbol || '').toUpperCase(),
              weightPct: ((biggest.marketValue || 0) / total) * 100,
            },
          };
        }
      }
    }

    return buildActionPlan({
      selldown, buyRecs, guidanceItems,
      holdings: portfolioView(p).holdings, // carries per-holding .recommendation
    });
  });

  // Everything the Symbol Insights dialog needs for one symbol: identity,
  // yield/tax drag, compliance classification, and — for funds — a
  // look-through of top holdings overlapped against the user's portfolio
  // (surfaces hidden employer exposure inside "diversified" index funds).
  ipcMain.handle('get-symbol-insights', async (_event, symbol) => {
    const sym = (symbol || '').toUpperCase().trim();
    if (!sym) return { error: 'no symbol' };
    const p = loadPortfolio();
    const settings = loadSettings();
    const total = p.holdings.reduce((s, h) => s + (h.marketValue || 0), 0) + (p.cash || 0);

    let quote = null;
    try { quote = await fetchCachedQuote(sym); } catch {}
    const summary = await fetchCachedQuoteSummary(sym);

    const analysis = analyzeTicker(sym, p.holdings, p.cash, quote);

    const topHoldings = summary?.topHoldings?.holdings || [];
    const overlap = topHoldings.length
      ? computeFundOverlap(topHoldings, p.holdings, settings.employerSymbols || '', total)
      : null;

    // Sector weights: Yahoo returns [{ technology: 0.31 }, { realestate: 0.02 }, ...]
    const sectorWeights = (summary?.topHoldings?.sectorWeightings || [])
      .map(o => {
        const k = Object.keys(o)[0];
        return k ? { sector: k, pct: Math.round(o[k] * 10000) / 100 } : null;
      })
      .filter(s => s && s.pct > 0)
      .sort((a, b) => b.pct - a.pct);

    const expenseRatioPct = summary?.fundProfile?.feesExpensesInvestment?.annualReportExpenseRatio != null
      ? Math.round(summary.fundProfile.feesExpensesInvestment.annualReportExpenseRatio * 10000) / 100
      : null;

    // Yahoo zeroes trailingAnnualDividendYield for many ETFs but still fills
    // dividendYield (already in percent) — same quirk handled in lib/recommendations.
    const yieldPct = quote?.trailingAnnualDividendYield > 0
      ? Math.round(quote.trailingAnnualDividendYield * 10000) / 100
      : (quote?.trailingAnnualDividendRate > 0 && quote?.regularMarketPrice > 0
        ? Math.round((quote.trailingAnnualDividendRate / quote.regularMarketPrice) * 10000) / 100
        : (quote?.dividendYield > 0 ? Math.round(quote.dividendYield * 100) / 100 : null));
    const dividendTaxRatePct = settings.dividendTaxRatePct ?? 30;

    const held = p.holdings.find(h => (h.symbol || '').toUpperCase() === sym);

    return {
      symbol: sym,
      name: quote?.longName || quote?.shortName || summary?.price?.longName || sym,
      exchange: quote?.fullExchangeName || quote?.exchange || null,
      currency: quote?.currency || null,
      price: quote?.regularMarketPrice ?? null,
      changePct: quote?.regularMarketChangePercent ?? null,
      fiftyTwoWeekLow: quote?.fiftyTwoWeekLow ?? null,
      fiftyTwoWeekHigh: quote?.fiftyTwoWeekHigh ?? null,
      marketCap: quote?.marketCap ?? summary?.summaryDetail?.totalAssets ?? null,
      yieldPct,
      taxDragPct: yieldPct != null ? Math.round(yieldPct * dividendTaxRatePct) / 100 : null,
      dividendTaxRatePct,
      expenseRatioPct,
      sector: summary?.assetProfile?.sector || null,
      industry: summary?.assetProfile?.industry || null,
      analysis,       // PFIC/domicile/suitability from the compliance engine
      overlap,        // null for non-funds
      sectorWeights,  // [] for non-funds
      held: held ? {
        marketValue: held.marketValue,
        weightPct: total > 0 ? Math.round(((held.marketValue || 0) / total) * 10000) / 100 : 0,
        bucket: held.bucket || 'unassigned',
      } : null,
    };
  });

  // Trust ONLY the loopback gateway's self-signed cert — so the embedded login
  // webview (and our REST calls) load without a browser security interstitial.
  // Every other certificate error is still rejected normally.
  app.on('certificate-error', (event, _webContents, url, _error, _cert, callback) => {
    if (isLoopbackGatewayUrl(url, loadSettings().ibkrGatewayUrl)) {
      event.preventDefault();
      callback(true);
    } else {
      callback(false);
    }
  });

  // The 'certificate-error' event above only reliably covers the webview's
  // top-level navigation. IBKR's login page keeps polling itself in the
  // background (checking for phone-push approval / challenge-code result)
  // via XHR/fetch on the same self-signed origin — and those subresource
  // requests need to be trusted too, or the page never learns you approved.
  // setCertificateVerifyProc, scoped to just the login webview's own
  // partition, covers every request type uniformly. This partition is used
  // for nothing else, and setCertificateVerifyProc gets no port info, so we
  // just check the hostname is loopback rather than matching the exact
  // configured gateway host:port.
  const IBKR_WEBVIEW_LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);
  session.fromPartition('persist:ibkr').setCertificateVerifyProc((request, callback) => {
    if (IBKR_WEBVIEW_LOOPBACK_HOSTS.has(request.hostname)) {
      callback(0); // 0 = trust
    } else {
      callback(-3); // -3 = fall back to Chromium's normal verification
    }
  });

  createWindow();
  initScheduler();
  initPriceScheduler();

  // Auto-start the gateway if the user opted in and pointed us at the folder.
  if (loadSettings().ibkrAutoStart) {
    setTimeout(() => startGateway(), 2000);
  }

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('before-quit', () => stopGateway());

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
