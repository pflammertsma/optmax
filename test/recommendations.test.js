'use strict';

const assert = require('assert');
const { generateBuyRecommendations, PFIC_REPLACEMENTS } = require('../lib/recommendations');

// ─── Minimal test runner ──────────────────────────────────────────────────────
let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓  ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ✗  ${name}`);
    console.error(`     ${err.message}`);
    failed++;
  }
}

function section(name) {
  console.log(`\n${name}`);
}

// ─── Fixtures ─────────────────────────────────────────────────────────────────
// A portfolio shaped like the real one: concentrated employer stock, an
// underweight core bucket, a PFIC holding, and deployable cash.
function baseInput(overrides = {}) {
  return {
    holdings: [
      { symbol: 'GOOG', marketValue: 400000, quantity: 100, currency: 'USD', bucket: 'satellite' },
      { symbol: 'VTI',  marketValue: 80000,  quantity: 250, currency: 'USD', bucket: 'core' },
      { symbol: 'IUSC', marketValue: 20000,  quantity: 180, currency: 'CHF', bucket: 'core' },
    ],
    cash: 100000,
    targets: [
      { bucket: 'core', targetPct: 60 },
      { bucket: 'satellite', targetPct: 30 },
      { bucket: 'cash', targetPct: 10 },
    ],
    settings: { employerSymbols: 'GOOG', cashDragThreshold: 5000, dividendTaxRatePct: 30 },
    quotes: {},
    watchlistData: [],
    ...overrides,
  };
}

// ─── PFIC & employer exclusion ────────────────────────────────────────────────
section('exclusions');

test('never recommends employer stock', () => {
  const r = generateBuyRecommendations(baseInput());
  assert.ok(!r.recommendations.some(x => x.symbol === 'GOOG'));
  assert.ok(r.excluded.some(x => x.symbol === 'GOOG' && /employer/i.test(x.reason)));
});

test('never recommends PFICs and proposes a US-domiciled swap for held ones', () => {
  const r = generateBuyRecommendations(baseInput());
  assert.ok(!r.recommendations.some(x => x.symbol === 'IUSC'));
  assert.ok(r.excluded.some(x => x.symbol === 'IUSC' && /PFIC/.test(x.reason)));
  const swap = r.swaps.find(s => s.sell === 'IUSC');
  assert.ok(swap, 'expected a swap suggestion for held PFIC');
  assert.strictEqual(swap.buy, PFIC_REPLACEMENTS.IUSC);
});

test('excludes single stocks already at concentration risk', () => {
  const input = baseInput();
  // NVO at 9% of the portfolio — above the 8% "stop adding" line
  input.holdings.push({ symbol: 'NVO', marketValue: 54000, quantity: 700, currency: 'USD', bucket: 'satellite' });
  const r = generateBuyRecommendations(input);
  assert.ok(!r.recommendations.some(x => x.symbol === 'NVO'));
});

// ─── Tax-drag ranking ─────────────────────────────────────────────────────────
section('dividend tax drag');

test('low-yield fund outranks high-yield fund for the same underweight bucket', () => {
  const r = generateBuyRecommendations(baseInput());
  const syms = r.recommendations.map(x => x.symbol);
  const vti = syms.indexOf('VTI');
  const jepq = syms.indexOf('JEPQ');
  assert.ok(vti !== -1, 'VTI should be recommended (core underweight)');
  if (jepq !== -1) assert.ok(vti < jepq, `VTI (${vti}) should rank above JEPQ (${jepq})`);
});

test('tax drag is yield × dividend tax rate', () => {
  // Low live yield keeps SCHG top-ranked so the cap can't hide it
  const quotes = { SCHG: { trailingAnnualDividendYield: 0.001, currency: 'USD', quoteType: 'ETF', exchange: 'PCX' } };
  const r = generateBuyRecommendations(baseInput({ quotes }));
  const schg = r.recommendations.find(x => x.symbol === 'SCHG');
  assert.ok(schg, 'SCHG should make the core top-4');
  assert.strictEqual(schg.yieldPct, 0.1);
  assert.strictEqual(schg.taxDragPct, 0.03); // 0.1% × 30%
});

test('live quote yield overrides the static fallback', () => {
  const quotes = { JEPQ: { trailingAnnualDividendYield: 0.11, currency: 'USD', quoteType: 'ETF', exchange: 'NMS' } };
  const r = generateBuyRecommendations(baseInput({ quotes }));
  const jepq = r.recommendations.find(x => x.symbol === 'JEPQ');
  if (jepq) assert.strictEqual(jepq.yieldPct, 11);
});

test('every recommendation carries tax notes', () => {
  const r = generateBuyRecommendations(baseInput());
  assert.ok(r.recommendations.length > 0);
  for (const rec of r.recommendations) {
    assert.ok(Array.isArray(rec.taxNotes) && rec.taxNotes.length > 0, `${rec.symbol} missing tax notes`);
  }
});

// ─── Glidepath direction ──────────────────────────────────────────────────────
section('glidepath');

test('bonds rank first when equity exceeds the age-based target', () => {
  const input = baseInput();
  input.settings.birthYear = 1984; // ~age 42 → target equity ~68%; portfolio is ~83% equity
  input.settings.glidepathBase = 110;
  const r = generateBuyRecommendations(input);
  assert.ok(r.glidepathNote, 'expected a glidepath note');
  const firstBond = r.recommendations.findIndex(x => x.kind === 'bond');
  const firstEquity = r.recommendations.findIndex(x => x.kind === 'equity');
  assert.ok(firstBond !== -1, 'expected at least one bond recommendation');
  if (firstEquity !== -1) assert.ok(firstBond < firstEquity, 'bonds should rank before equities');
});

test('bond recommendations warn about CH interest taxation', () => {
  const input = baseInput();
  input.settings.birthYear = 1984;
  const r = generateBuyRecommendations(input);
  const bond = r.recommendations.find(x => x.kind === 'bond');
  assert.ok(bond);
  assert.ok(bond.taxNotes.some(n => /interest.*taxed/i.test(n)));
});

// ─── Cash-aware sizing ────────────────────────────────────────────────────────
section('suggested amounts');

test('suggestions never exceed deployable cash (cash minus buffer)', () => {
  const r = generateBuyRecommendations(baseInput());
  const totalSuggested = r.recommendations.reduce((s, x) => s + x.suggestedUsd, 0);
  assert.strictEqual(r.deployableCash, 95000); // 100k − 5k buffer
  assert.ok(totalSuggested <= r.deployableCash + 1, `suggested ${totalSuggested} > deployable ${r.deployableCash}`);
});

test('no cash means zero-dollar suggestions but ideas still listed', () => {
  const r = generateBuyRecommendations(baseInput({ cash: 0 }));
  assert.ok(r.recommendations.length > 0, 'ideas should still surface');
  assert.ok(r.recommendations.every(x => x.suggestedUsd === 0));
});

test('watchlist A/B names appear for an underweight satellite bucket', () => {
  const input = baseInput();
  // Make satellite underweight: shrink GOOG, grow target
  input.holdings[0].marketValue = 50000;
  input.watchlistData = [
    { symbol: 'QCOM', grade: 'A', score: 55 },
    { symbol: 'PGEN', grade: 'E', score: 12 },
  ];
  const r = generateBuyRecommendations(input);
  assert.ok(r.recommendations.some(x => x.symbol === 'QCOM'), 'grade-A watchlist name should appear');
  assert.ok(!r.recommendations.some(x => x.symbol === 'PGEN'), 'grade-E name must not appear');
});

test('empty portfolio returns empty results without crashing', () => {
  const r = generateBuyRecommendations({ holdings: [], cash: 0, targets: [], settings: {} });
  assert.deepStrictEqual(r.recommendations, []);
});

// ─── Summary ──────────────────────────────────────────────────────────────────
console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
