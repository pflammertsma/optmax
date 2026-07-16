'use strict';

const { app, BrowserWindow, ipcMain, dialog, safeStorage } = require('electron');
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
  }
  return quote;
}

const { findClosestDate, computeHV, computeIVR, detectMeanReversion } = require('./lib/strategies');
const {
  parsePositionsCsv, totalValue, allocationByHolding, allocationByBucket,
  computeDrift, employerConcentration, topConcentrations,
} = require('./lib/portfolio');
const { analyzeTicker, generatePortfolioGuidance } = require('./lib/guidance');
const { computePortfolioHealth, projectAnnualDividends } = require('./lib/health');
const { createIbkrClient, isLoopbackGatewayUrl, gatewayLaunchSpec, treeKillSpec } = require('./lib/ibkr');
const { spawn } = require('child_process');

const CACHE_FILE      = path.join(app.getPath('userData'), 'data.json');
const PORTFOLIO_FILE    = path.join(app.getPath('userData'), 'portfolio.json');
const HEALTH_CACHE_FILE = path.join(app.getPath('userData'), 'health-cache.json');
const SETTINGS_FILE   = path.join(app.getPath('userData'), 'settings.json');
const DISC_CACHE_FILE = path.join(app.getPath('userData'), 'discovery-cache.json');
const SEED_CACHE_FILE = path.join(__dirname, 'lib', 'discovery-seed.json');

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
  employerSymbols: '',
  ibkrGatewayUrl: 'https://localhost:5000',
  ibkrGatewayDir: '',
  ibkrAutoStart: false,
  ibkrUsername: '',
  ibkrPasswordEncrypted: '', // base64 ciphertext from Electron safeStorage — never plaintext
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

// Portfolio plus derived metrics the renderer needs (math stays in lib/portfolio.js).
function portfolioView(p) {
  const settings = loadSettings();
  const employerSyms = (settings.employerSymbols || '').split(',').map(s => s.trim()).filter(Boolean);
  return {
    ...p,
    derived: {
      totalValue:     totalValue(p.holdings, p.cash),
      byHolding:      allocationByHolding(p.holdings, p.cash),
      byBucket:       allocationByBucket(p.holdings, p.cash),
      drift:          computeDrift(p.holdings, p.targets, p.cash, p.tolerancePct),
      concentration:  employerConcentration(p.holdings, p.cash, employerSyms),
      topPositions:   topConcentrations(p.holdings, p.cash, 5),
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

function startGateway() {
  if (gatewayProc) return { success: true, alreadyRunning: true };
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

function stopGateway() {
  if (!gatewayProc) return;
  const { command, args } = treeKillSpec(process.platform, gatewayProc.pid);
  try {
    if (process.platform === 'win32') {
      spawn(command, args, { windowsHide: true });
    } else {
      gatewayProc.kill('SIGTERM');
    }
  } catch {}
  gatewayProc = null;
}

// ── IPC ───────────────────────────────────────────────────────────────────────
app.whenReady().then(() => {
  ipcMain.handle('load-initial-data', () => {
    const cache    = loadCache();
    const settings = loadSettings();
    if (!cache) return null;

    const daysAgo  = Math.floor((Date.now() - new Date(cache.fetchedAt)) / (24 * 60 * 60 * 1000));
    const hoursAgo = Math.floor((Date.now() - new Date(cache.pricedAt || cache.fetchedAt)) / (60 * 60 * 1000));

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
  ipcMain.handle('ibkr-gateway-stop', () => { stopGateway(); return { success: true }; });
  ipcMain.handle('ibkr-gateway-running', () => ({
    running: isGatewayRunning(),
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
        if (q) quotes[h.symbol.toUpperCase()] = q;
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
