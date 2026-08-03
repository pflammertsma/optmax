'use strict';

const assert = require('assert');
const { scanSellCandidates, exitEconomics, SELL_ACTIONS } = require('../lib/sellscan');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.log(`  ✗ ${name}\n      ${e.message}`); failed++; }
}

console.log('\nSell Scanner Unit Tests');
console.log('─'.repeat(60));

const US = { citizenship1: 'US', residenceCountry: 'CH', dividendTaxRatePct: 30, usLtcgRatePct: 15, concentrationLimitPct: 10 };
const CH = { citizenship1: 'CH', residenceCountry: 'CH', dividendTaxRatePct: 30, concentrationLimitPct: 10 };
const etfQuote = (sym, extra = {}) => ({ symbol: sym, quoteType: 'ETF', currency: 'USD', regularMarketPrice: 100, marketCap: 5e11, ...extra });
const stockQuote = (sym, extra = {}) => ({ symbol: sym, quoteType: 'EQUITY', currency: 'USD', regularMarketPrice: 100, marketCap: 3e9, ...extra });

// ── exitEconomics ─────────────────────────────────────────────────────────────
test('a gain is taxed at the US long-term rate for a US person', () => {
  const e = exitEconomics(
    { symbol: 'X', marketValue: 10000, costBasis: 6000 },
    stockQuote('X'), { isPfic: false },
    { usPerson: true, ltcgRatePct: 15, pficOpts: {} });
  assert.strictEqual(e.embeddedGainUsd, 4000);
  assert.strictEqual(e.exitTaxUsd, 600);          // 4000 × 15%
  assert.strictEqual(e.harvestableLoss, false);
});

test('the same gain is tax-free for a non-US person (CH has no CGT)', () => {
  const e = exitEconomics(
    { symbol: 'X', marketValue: 10000, costBasis: 6000 },
    stockQuote('X'), { isPfic: false },
    { usPerson: false, ltcgRatePct: 15, pficOpts: {} });
  assert.strictEqual(e.exitTaxUsd, 0);
});

test('a loss costs no tax and is flagged harvestable for a US person', () => {
  const e = exitEconomics(
    { symbol: 'X', marketValue: 6000, costBasis: 10000 },
    stockQuote('X'), { isPfic: false },
    { usPerson: true, ltcgRatePct: 15, pficOpts: {} });
  assert.strictEqual(e.exitTaxUsd, 0);
  assert.strictEqual(e.harvestableLoss, true);
  assert.ok(e.embeddedGainUsd < 0);
});

test('net cash freed is proceeds minus tax and commission', () => {
  const e = exitEconomics(
    { symbol: 'X', marketValue: 10000, costBasis: 6000 },
    stockQuote('X'), { isPfic: false },
    { usPerson: true, ltcgRatePct: 15, pficOpts: {} });
  assert.strictEqual(e.netCashUsd, 10000 - e.exitTaxUsd - Math.round(e.commissionUsd));
});

test('a PFIC exit uses the punitive §1291 path, not the LTCG rate', () => {
  const e = exitEconomics(
    { symbol: 'VWRL', marketValue: 20000, costBasis: 10000 },
    etfQuote('VWRL'), { isPfic: true },
    { usPerson: true, ltcgRatePct: 15, pficOpts: { assumedYearsHeld: 5 } });
  assert.ok(e.pfic, 'expected a PFIC estimate');
  // §1291 on a $10k gain must exceed the plain 15% LTCG ($1,500).
  assert.ok(e.exitTaxUsd > 1500, `PFIC tax ${e.exitTaxUsd} should exceed LTCG 1500`);
});

// ── scanSellCandidates ────────────────────────────────────────────────────────
const holdings = [
  { symbol: 'GOOG', marketValue: 300000, costBasis: 60000, bucket: 'satellite', isEmployerStock: true },
  { symbol: 'JUNK', marketValue: 8000, costBasis: 20000, bucket: 'satellite' },   // deep loss, weak
  { symbol: 'VTI', marketValue: 100000, costBasis: 40000, bucket: 'core' },        // quality core, big gain
  { symbol: 'KO', marketValue: 15000, costBasis: 14000, bucket: 'satellite' },     // fine, small gain
];
const quotes = {
  GOOG: stockQuote('GOOG', { marketCap: 2e12 }),
  JUNK: stockQuote('JUNK', { marketCap: 4e8, regularMarketPrice: 4 }),
  VTI: etfQuote('VTI', { marketCap: 4e11 }),
  KO: stockQuote('KO', { marketCap: 2.6e11, trailingAnnualDividendRate: 1.9 }),
};
const targets = [{ bucket: 'core', targetPct: 50 }, { bucket: 'satellite', targetPct: 45 }, { bucket: 'cash', targetPct: 5 }];
const run = (settings = US) => scanSellCandidates({ holdings, cash: 20000, targets, settings, quotes });

test('an empty portfolio returns empty categories, no throw', () => {
  const r = scanSellCandidates({ holdings: [], cash: 0 });
  assert.deepStrictEqual(r.categories.recommendation, []);
});

test('employer over-concentration is surfaced as a trim, with its gain tax shown', () => {
  const goog = run().categories.recommendation.find(r => r.symbol === 'GOOG');
  assert.ok(goog, 'GOOG should be a sell candidate');
  assert.strictEqual(goog.action, 'trim');
  assert.ok(goog.reasons.some(x => /concentrated/i.test(x)));
  assert.ok(goog.reasons.some(x => /Employer/i.test(x)));
  assert.ok(goog.exitTaxUsd > 0, 'a gain must carry an exit tax');
  assert.ok(goog.watch.some(w => /realizes .* of gains/i.test(w)));
});

test('a weak, deeply-underwater holding is an exit and cheap to sell', () => {
  const junk = run().categories.recommendation.find(r => r.symbol === 'JUNK');
  assert.ok(junk, 'JUNK should be recommended');
  assert.strictEqual(junk.exitTaxUsd, 0);
  assert.strictEqual(junk.harvestableLoss, true);
  assert.ok(junk.reasons[0].includes('loss'), 'the loss should lead the reasons');
});

test('a quality core holding is NOT pushed as a sell', () => {
  const rec = run().categories.recommendation.find(r => r.symbol === 'VTI');
  assert.strictEqual(rec, undefined, 'VTI should not be a recommended sell');
  const vti = run().categories.weak.find(r => r.symbol === 'VTI');
  assert.strictEqual(vti.action, 'keep');
});

test('recommendations are ranked by attractiveness as a funding source', () => {
  const rec = run().categories.recommendation;
  for (let i = 1; i < rec.length; i++) {
    assert.ok(rec[i - 1].rankValue >= rec[i].rankValue, 'recommendation must be sorted by rankValue desc');
  }
});

test('the weak tab is ordered worst-quality first', () => {
  const weak = run().categories.weak;
  for (let i = 1; i < weak.length; i++) {
    assert.ok(weak[i - 1].buyHoldScore <= weak[i].buyHoldScore);
  }
});

test('tax-smart lists harvestable losses ahead of low-friction gains', () => {
  const ts = run().categories.taxsmart;
  const firstGainIdx = ts.findIndex(r => !r.harvestableLoss);
  const lastLossIdx = ts.map(r => r.harvestableLoss).lastIndexOf(true);
  if (firstGainIdx !== -1 && lastLossIdx !== -1) {
    assert.ok(lastLossIdx < firstGainIdx || firstGainIdx === -1, 'all losses should precede gains');
  }
});

test('recommended liquidity is the sum of net cash across the recommendations', () => {
  const r = run();
  const sum = r.categories.recommendation.reduce((s, x) => s + x.netCashUsd, 0);
  assert.strictEqual(r.recommendedLiquidityUsd, Math.round(sum));
});

test('option positions are skipped and counted, not scored', () => {
  const r = scanSellCandidates({
    holdings: [
      { symbol: 'AAPL 250117C', marketValue: 5000, costBasis: 3000, assetCategory: 'OPT', bucket: 'satellite' },
      { symbol: 'JUNK', marketValue: 8000, costBasis: 20000, bucket: 'satellite' },
    ],
    cash: 0, targets, settings: US,
    quotes: { JUNK: stockQuote('JUNK', { marketCap: 4e8, regularMarketPrice: 4 }) },
  });
  assert.strictEqual(r.skippedOptions, 1);
  assert.ok(!r.categories.weak.some(x => x.symbol.includes('250117C')));
});

test('for a non-US person, gains carry no exit tax and nothing is "harvestable"', () => {
  const r = run(CH);
  assert.ok(r.categories.recommendation.every(x => x.exitTaxUsd === 0));
  assert.ok(r.categories.recommendation.every(x => x.harvestableLoss === false));
});

console.log('─'.repeat(60));
console.log(`  ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
