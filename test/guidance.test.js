'use strict';

const assert = require('assert');
const { analyzeTicker, generatePortfolioGuidance } = require('../lib/guidance');

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
    { symbol: 'VTI', marketValue: 50000, isEmployerStock: false },
    { symbol: 'GOOG', marketValue: 12000, isEmployerStock: true }
  ];
  items = generatePortfolioGuidance(holdings, 0);
  // GOOG weight = 12/62 = 19.3% (>15% => error)
  assert.strictEqual(items.some(i => i.id === 'employer-concentration-hard'), true);

  holdings = [
    { symbol: 'VTI', marketValue: 50000, isEmployerStock: false },
    { symbol: 'GOOG', marketValue: 7000, isEmployerStock: true }
  ];
  items = generatePortfolioGuidance(holdings, 0);
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

  console.log('  ✓ generatePortfolioGuidance tests passed');
})();

console.log('All test/guidance.test.js passed!');
