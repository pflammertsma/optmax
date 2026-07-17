'use strict';

const assert = require('assert');
const { analyzeTicker, generatePortfolioGuidance, calculateHoldingRecommendation } = require('../lib/guidance');

console.log('Running test/guidance.test.js...');

// ── analyzeTicker tests ──
(function testAnalyzeTicker() {
  console.log('analyzeTicker');

  // USD Cash
  let r = analyzeTicker('USD');
  assert.strictEqual(r.type, 'cash');
  assert.strictEqual(r.suitability, 'excellent');
  assert.strictEqual(r.isPfic, false);

  // US ETF
  r = analyzeTicker('VTI');
  assert.strictEqual(r.type, 'etf');
  assert.strictEqual(r.domicile, 'United States');
  assert.strictEqual(r.isPfic, false);
  assert.strictEqual(r.suitability, 'excellent');

  // Known PFIC UCITS ETF
  r = analyzeTicker('CSPX');
  assert.strictEqual(r.type, 'etf');
  assert.strictEqual(r.isPfic, true);
  assert.strictEqual(r.suitability, 'danger');

  // Heuristic PFIC detection (4 letters, not in tech list)
  r = analyzeTicker('VWRL');
  assert.strictEqual(r.type, 'etf');
  assert.strictEqual(r.isPfic, true);
  assert.strictEqual(r.suitability, 'danger');

  // Suffix PFIC detection
  r = analyzeTicker('VUSA.SW');
  assert.strictEqual(r.type, 'etf');
  assert.strictEqual(r.isPfic, true);
  assert.strictEqual(r.suitability, 'danger');

  // Individual stock
  r = analyzeTicker('GOOG');
  assert.strictEqual(r.type, 'stock');
  assert.strictEqual(r.isPfic, false);
  assert.strictEqual(r.suitability, 'caution');

  // 4-letter US-listed stock held in USD must NOT be pattern-flagged as PFIC (SIDU regression)
  r = analyzeTicker('SIDU', [{ symbol: 'SIDU', marketValue: 1000, currency: 'USD' }], 0, null);
  assert.strictEqual(r.type, 'stock');
  assert.strictEqual(r.isPfic, false);

  // ...but an unknown 4-letter symbol held in a foreign currency still is
  r = analyzeTicker('XDWD', [{ symbol: 'XDWD', marketValue: 1000, currency: 'CHF' }], 0, null);
  assert.strictEqual(r.isPfic, true);

  // Dynamic Yahoo Finance Bond ETF
  r = analyzeTicker('BND', [], 0, {
    quoteType: 'ETF',
    longName: 'Vanguard Total Bond Market Index Fund',
    exchange: 'NGM',
    currency: 'USD'
  });
  assert.strictEqual(r.type, 'bond etf');
  assert.strictEqual(r.isPfic, false);
  assert.strictEqual(r.suitability, 'excellent');
  assert.match(r.details, /retirement glidepath target/);

  // Dynamic Yahoo Finance European ETF (PFIC)
  r = analyzeTicker('XYZ', [], 0, {
    quoteType: 'ETF',
    longName: 'Some Europe Fund',
    exchange: 'AMS',
    currency: 'EUR'
  });
  assert.strictEqual(r.type, 'etf');
  assert.strictEqual(r.isPfic, true);
  assert.strictEqual(r.suitability, 'danger');

  // Dynamic Yahoo Finance Stock
  r = analyzeTicker('AAPL', [], 0, {
    quoteType: 'EQUITY',
    longName: 'Apple Inc.',
    exchange: 'NMS',
    currency: 'USD'
  });
  assert.strictEqual(r.type, 'stock');
  assert.strictEqual(r.isPfic, false);
  assert.strictEqual(r.suitability, 'caution');

  console.log('  ✓ analyzeTicker tests passed');
})();

// ── generatePortfolioGuidance tests ──
(function testGeneratePortfolioGuidance() {
  console.log('generatePortfolioGuidance');

  // Clean portfolio
  let holdings = [
    { symbol: 'VTI', marketValue: 80000, isEmployerStock: false },
    { symbol: 'VXUS', marketValue: 20000, isEmployerStock: false }
  ];
  let items = generatePortfolioGuidance(holdings, 5000);
  assert.strictEqual(items.length, 0);

  // PFIC Presence
  holdings = [
    { symbol: 'VTI', marketValue: 80000, isEmployerStock: false },
    { symbol: 'CSPX', marketValue: 20000, isEmployerStock: false }
  ];
  items = generatePortfolioGuidance(holdings, 5000);
  assert.strictEqual(items.some(i => i.type === 'tax-pfic'), true);
  assert.strictEqual(items.find(i => i.type === 'tax-pfic').severity, 'error');

  // Employer stock concentration
  holdings = [
    { symbol: 'VTI', marketValue: 50000 },
    { symbol: 'GOOG', marketValue: 12000 }
  ];
  items = generatePortfolioGuidance(holdings, 0, [], { employerSymbols: 'GOOG' });
  // GOOG weight = 12/62 = 19.3% (>15% => error)
  assert.strictEqual(items.some(i => i.id === 'employer-concentration-hard'), true);

  holdings = [
    { symbol: 'VTI', marketValue: 50000 },
    { symbol: 'GOOG', marketValue: 7000 }
  ];
  items = generatePortfolioGuidance(holdings, 0, [], { employerSymbols: 'GOOG' });
  // GOOG weight = 7/57 = 12.2% (>10% => warning)
  assert.strictEqual(items.some(i => i.id === 'employer-concentration-soft'), true);

  // Cash drag
  holdings = [
    { symbol: 'VTI', marketValue: 20000, isEmployerStock: false }
  ];
  items = generatePortfolioGuidance(holdings, 10000);
  // Cash weight = 10/30 = 33.3% (>10% and >$5k => warning)
  assert.strictEqual(items.some(i => i.type === 'cash-drag'), true);

  // Swiss options risk
  holdings = [
    { symbol: 'VTI', marketValue: 20000, isEmployerStock: false },
    { symbol: 'GOOG  260717P00150000', marketValue: 500, assetCategory: 'OPT' }
  ];
  items = generatePortfolioGuidance(holdings, 0);
  assert.strictEqual(items.some(i => i.type === 'swiss-tax'), true);

  // Tax Loss Harvesting opportunity
  holdings = [
    {
      symbol: 'VTI',
      marketValue: 10000,
      lots: [
        { quantity: 100, costPrice: 120, costBasis: 12000, marketValue: 10000, unrealizedPnl: -2000 }
      ]
    }
  ];
  items = generatePortfolioGuidance(holdings, 0);
  assert.strictEqual(items.some(i => i.type === 'tax-loss-harvesting'), true);
  assert.strictEqual(items.find(i => i.type === 'tax-loss-harvesting').severity, 'info');

  // Rebalancing STCG warning
  const todayVal = new Date();
  const dateShort = new Date(todayVal.getTime() - 180 * 24 * 60 * 60 * 1000).toISOString().split('T')[0].replace(/-/g, '');
  holdings = [
    {
      symbol: 'VTI',
      marketValue: 15000,
      bucket: 'satellite',
      lots: [
        { quantity: 50, costPrice: 200, costBasis: 10000, marketValue: 15000, unrealizedPnl: 5000, acquisitionDate: dateShort }
      ]
    }
  ];
  let targets = [{ bucket: 'satellite', targetPct: 10 }];
  items = generatePortfolioGuidance(holdings, 0, targets);
  assert.strictEqual(items.some(i => i.id === 'rebalance-stcg-grouped-satellite'), true);
  assert.strictEqual(items.find(i => i.id === 'rebalance-stcg-grouped-satellite').severity, 'warning');

  // Rebalancing near long-term warning
  const dateNearLong = new Date(todayVal.getTime() - 340 * 24 * 60 * 60 * 1000).toISOString().split('T')[0].replace(/-/g, '');
  holdings = [
    {
      symbol: 'VTI',
      marketValue: 15000,
      bucket: 'satellite',
      lots: [
        { quantity: 50, costPrice: 200, costBasis: 10000, marketValue: 15000, unrealizedPnl: 5000, acquisitionDate: dateNearLong }
      ]
    }
  ];
  items = generatePortfolioGuidance(holdings, 0, targets);
  assert.strictEqual(items.some(i => i.id === 'rebalance-near-ltcg-grouped-satellite'), true);
  assert.strictEqual(items.find(i => i.id === 'rebalance-near-ltcg-grouped-satellite').severity, 'warning');

  // Glidepath allocation drift warning
  const currentYearVal = new Date().getFullYear();
  const birthYear = currentYearVal - 42; // age = 42
  // glidepathBase = 110 => target equity = 110 - 42 = 68%
  // holdings: VTI (100% of portfolio => actual equity = 100%)
  // Drift = 100% - 68% = 32% (>5% tolerance => triggers glidepath warning)
  holdings = [
    { symbol: 'VTI', marketValue: 10000, isEmployerStock: false }
  ];
  const testSettings = { birthYear, glidepathBase: 110, cashDragThreshold: 5000 };
  items = generatePortfolioGuidance(holdings, 0, [], testSettings);
  assert.strictEqual(items.some(i => i.type === 'glidepath'), true);
  assert.strictEqual(items.find(i => i.type === 'glidepath').severity, 'warning');

  // Watchlist-rebalance satellite underweight warning
  holdings = [
    { symbol: 'VTI', marketValue: 9000, bucket: 'core' },
    { symbol: 'AAPL', marketValue: 1000, bucket: 'satellite' }
  ];
  let mockTargets = [
    { bucket: 'core', targetPct: 80 },
    { bucket: 'satellite', targetPct: 20 }
  ];
  let mockWatchlistData = [
    { symbol: 'MSFT', score: 85, grade: 'A' },
    { symbol: 'GOOG', score: 75, grade: 'B' }
  ];
  items = generatePortfolioGuidance(holdings, 0, mockTargets, {}, {}, mockWatchlistData);
  assert.strictEqual(items.some(i => i.id === 'rebalance-watchlist-satellite'), true);
  assert.ok(items.find(i => i.id === 'rebalance-watchlist-satellite').message.includes('MSFT'));

  // Volatility Harvesting: Covered Call Opportunities (quantity >= 100, high IV/IVR)
  holdings = [
    { symbol: 'AAPL', marketValue: 18000, quantity: 100 }
  ];
  let mockQuotes = {
    AAPL: { impliedVolatility: 0.45 }
  };
  items = generatePortfolioGuidance(holdings, 0, [], {}, mockQuotes);
  assert.strictEqual(items.some(i => i.id === 'covered-call-AAPL'), true);
  assert.strictEqual(items.find(i => i.id === 'covered-call-AAPL').severity, 'info');

  // Volatility Harvesting: Cash-Secured Put Opportunities (excess cash + high grade put opps)
  holdings = [
    { symbol: 'VTI', marketValue: 20000 }
  ];
  items = generatePortfolioGuidance(holdings, 15000, [], { cashDragThreshold: 5000 }, {}, mockWatchlistData);
  assert.strictEqual(items.some(i => i.id === 'cash-secured-puts-deploy'), true);
  assert.strictEqual(items.find(i => i.id === 'cash-secured-puts-deploy').severity, 'info');

  console.log('  ✓ generatePortfolioGuidance tests passed');
})();

(function testCalculateHoldingRecommendation() {
  console.log('calculateHoldingRecommendation');

  // Options should get "—"
  assert.strictEqual(calculateHoldingRecommendation({ symbol: 'AAPL  260717P00150000', assetCategory: 'OPT' }).type, '—');

  // Core ETF underweight should get "Buy"
  let holding = { symbol: 'VTI', bucket: 'core', marketValue: 5000 };
  let drifts = [{ bucket: 'core', driftPct: -10, rebalance: true }];
  let res = calculateHoldingRecommendation(holding, null, null, drifts, 5, 10000);
  assert.strictEqual(res.type, 'Buy');
  assert.ok(res.reason.includes('underweight'));

  // Core ETF overweight should get "Trim"
  drifts = [{ bucket: 'core', driftPct: 15, rebalance: true }];
  res = calculateHoldingRecommendation(holding, null, null, drifts, 5, 10000);
  assert.strictEqual(res.type, 'Trim');
  assert.ok(res.reason.includes('overweight'));

  // Core ETF balanced should get "Hold"
  drifts = [{ bucket: 'core', driftPct: 2, rebalance: false }];
  res = calculateHoldingRecommendation(holding, null, null, drifts, 5, 10000);
  assert.strictEqual(res.type, 'Hold');
  assert.ok(res.reason.includes('balanced'));

  // Satellite stock exceeding 10% weight should get "Trim"
  holding = { symbol: 'AAPL', bucket: 'satellite', marketValue: 2000 };
  res = calculateHoldingRecommendation(holding, null, null, [], 5, 10000);
  assert.strictEqual(res.type, 'Trim');
  assert.ok(res.reason.includes('concentration'));

  // Individual stock in Core bucket should get "Trim" reclassification warning
  holding = { symbol: 'AAPL', bucket: 'core', marketValue: 500 };
  res = calculateHoldingRecommendation(holding, null, null, [], 5, 10000);
  assert.strictEqual(res.type, 'Trim');
  assert.ok(res.reason.includes('Core bucket'));

  // Satellite stock with poor screener grade should get "Trim"
  holding = { symbol: 'AAPL', bucket: 'satellite', marketValue: 500 };
  let watchlistInfo = { symbol: 'AAPL', score: 10, grade: 'E' };
  res = calculateHoldingRecommendation(holding, null, watchlistInfo, [], 5, 10000);
  assert.strictEqual(res.type, 'Trim');
  assert.ok(res.reason.includes('Low watchlist rating'));

  // Satellite stock underweight with good screener grade should get "Buy"
  drifts = [{ bucket: 'satellite', driftPct: -15, rebalance: true }];
  watchlistInfo = { symbol: 'AAPL', score: 85, grade: 'A' };
  res = calculateHoldingRecommendation(holding, null, watchlistInfo, drifts, 5, 10000);
  assert.strictEqual(res.type, 'Buy');
  assert.ok(res.reason.includes('underweight'));

  // Satellite stock underweight with technical pullback should get "Buy"
  let quote = { regularMarketPrice: 150, twoHundredDayAverage: 140, fiftyTwoWeekHigh: 180 }; // 150 is 16.6% below 180 (high), above 140 (ma200)
  res = calculateHoldingRecommendation(holding, quote, null, drifts, 5, 10000);
  assert.strictEqual(res.type, 'Buy');
  assert.ok(res.reason.includes('pullback'));

  // Satellite stock underweight with YFinance analyst target mean price discount should get "Buy"
  let quoteTargetBuy = { regularMarketPrice: 80, targetMeanPrice: 110 }; // 80 is 27.2% below 110 (20%+ discount)
  res = calculateHoldingRecommendation(holding, quoteTargetBuy, null, drifts, 5, 10000);
  assert.strictEqual(res.type, 'Buy');
  assert.ok(res.reason.includes('discount'));

  // Satellite stock exceeding target price should get "Trim"
  let quoteTargetTrim = { regularMarketPrice: 125, targetMeanPrice: 100 }; // 125 is 25% above 100
  res = calculateHoldingRecommendation(holding, quoteTargetTrim, null, drifts, 5, 10000);
  assert.strictEqual(res.type, 'Trim');
  assert.ok(res.reason.includes('exceeds'));

  // Volatility harvesting: Covered Call option (>= 100 shares, high IV) should get "Write Call"
  let holdingCc = { symbol: 'QCOM', quantity: 150, bucket: 'satellite', marketValue: 5000 };
  let quoteCc = { impliedVolatility: 0.69 };
  res = calculateHoldingRecommendation(holdingCc, quoteCc, null, [], 5, 100000);
  assert.strictEqual(res.type, 'Write Call');
  assert.ok(res.reason.includes('write covered calls'));

  console.log('  ✓ calculateHoldingRecommendation tests passed');
})();

console.log('All test/guidance.test.js passed!');
