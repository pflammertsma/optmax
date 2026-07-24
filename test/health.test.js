'use strict';

const assert = require('assert');
const { computePortfolioHealth, projectAnnualDividends, healthInputMaterial } = require('../lib/health');

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

function approx(actual, expected, eps = 0.01) {
  assert.ok(Math.abs(actual - expected) < eps, `expected ~${expected}, got ${actual}`);
}

// ─── Fixtures ────────────────────────────────────────────────────────────────
const etfQuote = sym => ({ symbol: sym, quoteType: 'ETF', currency: 'USD' });
const stockQuote = sym => ({ symbol: sym, quoteType: 'EQUITY', currency: 'USD' });

// A healthy, diversified portfolio
const healthy = {
  holdings: [
    { symbol: 'VTI', marketValue: 60000, quantity: 200, bucket: 'core' },
    { symbol: 'VEA', marketValue: 25000, quantity: 480, bucket: 'core' },
    { symbol: 'AAPL', marketValue: 4000, quantity: 16, bucket: 'satellite' },
    { symbol: 'NVO', marketValue: 4000, quantity: 40, bucket: 'satellite' },
  ],
  cash: 5000,
  targets: [
    { bucket: 'core', targetPct: 85 },
    { bucket: 'satellite', targetPct: 10 },
    { bucket: 'cash', targetPct: 5 },
  ],
  tolerancePct: 5,
  quotes: { VTI: etfQuote('VTI'), VEA: etfQuote('VEA'), AAPL: stockQuote('AAPL'), NVO: stockQuote('NVO') },
};

// Employer-concentrated portfolio (like a fresh RSU-heavy account)
const concentrated = {
  holdings: [
    { symbol: 'EMPL', marketValue: 45000, quantity: 200 },
    { symbol: 'VTI', marketValue: 45000, quantity: 150, bucket: 'core' },
  ],
  cash: 10000,
  targets: [],
  quotes: { EMPL: stockQuote('EMPL'), VTI: etfQuote('VTI') },
  settings: { employerSymbols: 'EMPL' },
};

// ─── computePortfolioHealth ──────────────────────────────────────────────────
section('computePortfolioHealth');

test('returns null for an empty portfolio', () => {
  assert.strictEqual(computePortfolioHealth({ holdings: [], cash: 0 }), null);
  assert.strictEqual(computePortfolioHealth(), null);
});

test('healthy diversified portfolio grades A', () => {
  const h = computePortfolioHealth(healthy);
  assert.strictEqual(h.grade, 'A');
  assert.ok(h.totalScore >= 85, `expected ≥85, got ${h.totalScore}`);
  assert.strictEqual(h.caps.length, 0);
});

test('breakdown has seven dimensions, each score within its max', () => {
  const h = computePortfolioHealth(healthy);
  assert.strictEqual(h.breakdown.length, 7);
  for (const b of h.breakdown) {
    assert.ok(b.score >= 0 && b.score <= b.max, `${b.key}: ${b.score}/${b.max}`);
    assert.ok('applicable' in b, `${b.key} missing applicable flag`);
  }
});

test('totalScore normalizes over applicable dimensions only (0–100)', () => {
  const h = computePortfolioHealth(healthy);
  assert.ok(h.totalScore >= 0 && h.totalScore <= 100);
  const app = h.breakdown.filter(b => b.applicable);
  const earned = app.reduce((s, b) => s + b.score, 0);
  const possible = app.reduce((s, b) => s + b.max, 0);
  assert.strictEqual(h.totalScore, Math.round((earned / possible) * 100));
});

test('a not-applicable dimension is excluded, never scored as a failure', () => {
  // No birth year and no targets → allocation + drift are N/A, not 0-drags.
  const h = computePortfolioHealth(concentrated);
  const alloc = h.breakdown.find(b => b.key === 'allocation');
  const drift = h.breakdown.find(b => b.key === 'drift');
  assert.strictEqual(alloc.applicable, false);
  assert.strictEqual(drift.applicable, false);
  const possible = h.breakdown.filter(b => b.applicable).reduce((s, b) => s + b.max, 0);
  assert.ok(!h.breakdown.filter(b => b.applicable).some(b => b.key === 'allocation'));
  assert.ok(possible < 100, 'N/A dims should shrink the denominator');
});

test('employer stock >25% caps the grade at C', () => {
  const h = computePortfolioHealth(concentrated);
  assert.ok(h.caps.some(c => c.grade === 'C'), 'expected a C cap');
  assert.ok(['C', 'D', 'E'].includes(h.grade), `expected ≤C, got ${h.grade}`);
});

test('concentration dimension scores 0 above 30%', () => {
  const h = computePortfolioHealth(concentrated);
  const conc = h.breakdown.find(b => b.key === 'concentration');
  assert.strictEqual(conc.score, 0);
  assert.ok(conc.detail.includes('EMPL'));
});

test('ETF-only portfolio maxes diversification', () => {
  const h = computePortfolioHealth({
    holdings: [{ symbol: 'VTI', marketValue: 100000, quantity: 300, bucket: 'core' }],
    cash: 0,
    targets: [{ bucket: 'core', targetPct: 100 }],
    quotes: { VTI: etfQuote('VTI') },
  });
  const div = h.breakdown.find(b => b.key === 'diversification');
  assert.strictEqual(div.score, 15);
});

test('diversification ignores employer stock (no double-count with concentration)', () => {
  // Employer 40% + one broad ETF 60%. Excluding the employer position, the
  // remaining equity is 100% fund → diversification should be full marks even
  // though concentration is already penalising the employer stake.
  const h = computePortfolioHealth({
    holdings: [
      { symbol: 'EMPL', marketValue: 40000, quantity: 100 },
      { symbol: 'VTI', marketValue: 60000, quantity: 200, bucket: 'core' },
    ],
    cash: 0,
    quotes: { EMPL: stockQuote('EMPL'), VTI: etfQuote('VTI') },
    settings: { employerSymbols: 'EMPL' },
  });
  const conc = h.breakdown.find(b => b.key === 'concentration');
  const div = h.breakdown.find(b => b.key === 'diversification');
  assert.ok(conc.score < conc.max, 'concentration should be penalised');
  assert.strictEqual(div.score, 15, 'diversification measured on non-employer equity');
});

test('age-appropriate mix scores the stock/bond split against a glidepath', () => {
  const h = computePortfolioHealth({
    holdings: [
      { symbol: 'VTI', marketValue: 70000, quantity: 200, bucket: 'core' },
      { symbol: 'BND', marketValue: 30000, quantity: 300, bucket: 'core' },
    ],
    cash: 0,
    quotes: { VTI: etfQuote('VTI'), BND: etfQuote('BND') },
    settings: { birthYear: 1970, glidepathBase: 110 }, // age ~56 → ~54% equity target
  });
  const alloc = h.breakdown.find(b => b.key === 'allocation');
  assert.strictEqual(alloc.applicable, true);
  // 70% equity vs ~54% target → over-weight, partial credit, not full.
  assert.ok(alloc.score < alloc.max && alloc.score > 0, `got ${alloc.score}`);
});

test('no targets set scores drift 0 with a set-targets action', () => {
  const h = computePortfolioHealth(concentrated);
  const drift = h.breakdown.find(b => b.key === 'drift');
  assert.strictEqual(drift.score, 0);
  assert.ok(drift.action.toLowerCase().includes('target'));
});

test('a large PFIC position zeroes tax hygiene and caps at B', () => {
  const h = computePortfolioHealth({
    holdings: [
      { symbol: 'VTI', marketValue: 82000, quantity: 300, bucket: 'core' },
      { symbol: 'IWDA', marketValue: 18000, quantity: 100, currency: 'CHF' },
    ],
    cash: 0,
    targets: [{ bucket: 'core', targetPct: 100 }],
    quotes: { VTI: etfQuote('VTI') },  // IWDA unresolved → static fallback flags PFIC
  });
  const tax = h.breakdown.find(b => b.key === 'taxHygiene');
  assert.strictEqual(tax.score, 0);           // 18% > 15% band → 0
  assert.ok(tax.detail.includes('IWDA'));
  assert.ok(h.caps.some(c => c.grade === 'B')); // 18% > 10% → material, caps grade
});

test('a small PFIC position is a scored deduction, not a grade cap', () => {
  const h = computePortfolioHealth({
    holdings: [
      { symbol: 'VTI', marketValue: 98000, quantity: 300, bucket: 'core' },
      { symbol: 'IWDA', marketValue: 2000, quantity: 20, currency: 'CHF' },
    ],
    cash: 0,
    targets: [{ bucket: 'core', targetPct: 100 }],
    quotes: { VTI: etfQuote('VTI') },
  });
  const tax = h.breakdown.find(b => b.key === 'taxHygiene');
  assert.ok(tax.score > 0 && tax.score < 15, `expected partial, got ${tax.score}`); // 2% → 11
  assert.ok(!h.caps.some(c => c.grade === 'B'), 'a 2% PFIC should not cap the grade');
});

test('fund costs dimension scores a weighted expense ratio', () => {
  const h = computePortfolioHealth({
    holdings: [
      { symbol: 'PRICEY', marketValue: 100000, quantity: 100, bucket: 'core' },
    ],
    cash: 0,
    targets: [{ bucket: 'core', targetPct: 100 }],
    quotes: { PRICEY: { ...etfQuote('PRICEY'), annualReportExpenseRatio: 0.0095 } }, // 0.95%
  });
  const cost = h.breakdown.find(b => b.key === 'cost');
  assert.strictEqual(cost.applicable, true);
  assert.strictEqual(cost.score, 0); // 0.95% > 0.75% band
  assert.ok(cost.detail.includes('0.95%'));
});

test('fund costs are N/A when no expense data is present (backfilled point)', () => {
  const h = computePortfolioHealth({
    holdings: [{ symbol: 'VTI', marketValue: 100000, quantity: 300, bucket: 'core' }],
    cash: 0,
    targets: [{ bucket: 'core', targetPct: 100 }],
    quotes: {}, // no quotes at all → no TER known
  });
  const cost = h.breakdown.find(b => b.key === 'cost');
  assert.strictEqual(cost.applicable, false);
});

test('excess cash reduces the cash dimension', () => {
  const h = computePortfolioHealth({
    holdings: [{ symbol: 'VTI', marketValue: 50000, quantity: 150, bucket: 'core' }],
    cash: 50000,
    targets: [{ bucket: 'core', targetPct: 100 }],
    quotes: { VTI: etfQuote('VTI') },
  });
  const cashDim = h.breakdown.find(b => b.key === 'cashDrag');
  assert.ok(cashDim.score < 10, `expected <10, got ${cashDim.score}`);
});

test('fund detection falls back to static lists without quotes', () => {
  const h = computePortfolioHealth({
    holdings: [
      { symbol: 'VTI', marketValue: 80000, quantity: 250, bucket: 'core' },
      { symbol: 'AAPL', marketValue: 20000, quantity: 80, bucket: 'satellite' },
    ],
    cash: 0,
    targets: [{ bucket: 'core', targetPct: 80 }, { bucket: 'satellite', targetPct: 20 }],
    quotes: {},
  });
  const div = h.breakdown.find(b => b.key === 'diversification');
  assert.strictEqual(div.score, 15); // VTI recognized as fund statically: 80% share
});

// ─── projectAnnualDividends ──────────────────────────────────────────────────
section('projectAnnualDividends');

test('sums quantity × trailing dividend rate', () => {
  const r = projectAnnualDividends(
    [
      { symbol: 'VTI', quantity: 100 },
      { symbol: 'JEPQ', quantity: 1000 },
      { symbol: 'GOOG', quantity: 50 },
    ],
    {
      VTI:  { trailingAnnualDividendRate: 3.5 },
      JEPQ: { trailingAnnualDividendRate: 5.2 },
      GOOG: { trailingAnnualDividendRate: 0.8 },
    }
  );
  approx(r.annual, 350 + 5200 + 40);
  assert.strictEqual(r.perHolding[0].symbol, 'JEPQ'); // largest first
});

test('holdings without rates or quantity contribute nothing', () => {
  const r = projectAnnualDividends(
    [{ symbol: 'X', quantity: null }, { symbol: 'Y', quantity: 10 }],
    { Y: {} }
  );
  assert.strictEqual(r.annual, 0);
  assert.strictEqual(r.perHolding.length, 0);
});

// ─── Cache-invalidation inputs ───────────────────────────────────────────────
// The health score is cached; the cache decides whether to recompute by hashing
// healthInputMaterial. Anything the score reads but this omits leaves a stale
// score after the user changes it — which is exactly what happened to
// glidepathBase and birthYear.
const serialize = m => JSON.stringify(m);

test('changing the glidepath base changes the cache material', () => {
  const p = { holdings: [{ symbol: 'VTI', marketValue: 100 }], cash: 0, targets: [] };
  const before = serialize(healthInputMaterial(p, { glidepathBase: 110, birthYear: 1984 }));
  const after  = serialize(healthInputMaterial(p, { glidepathBase: 140, birthYear: 1984 }));
  assert.notStrictEqual(before, after, 'glidepathBase must be part of the fingerprint');
});

test('changing the birth year changes the cache material', () => {
  const p = { holdings: [{ symbol: 'VTI', marketValue: 100 }], cash: 0, targets: [] };
  assert.notStrictEqual(
    serialize(healthInputMaterial(p, { birthYear: 1984 })),
    serialize(healthInputMaterial(p, { birthYear: 1990 })),
    'birthYear must be part of the fingerprint');
});

test('changing the dividend tax rate changes the cache material', () => {
  const p = { holdings: [{ symbol: 'VTI', marketValue: 100 }], cash: 0, targets: [] };
  assert.notStrictEqual(
    serialize(healthInputMaterial(p, { dividendTaxRatePct: 30 })),
    serialize(healthInputMaterial(p, { dividendTaxRatePct: 15 })),
    'dividendTaxRatePct must be part of the fingerprint');
});

test('identical inputs produce identical material (cache stays warm)', () => {
  const p = { holdings: [{ symbol: 'VTI', marketValue: 100 }], cash: 500, targets: [] };
  const s = { glidepathBase: 110, birthYear: 1984, dividendTaxRatePct: 30 };
  assert.strictEqual(serialize(healthInputMaterial(p, s)), serialize(healthInputMaterial(p, s)));
});

test('the material actually feeds the score it guards', () => {
  // The whole point: every guarded setting must move the computed health score,
  // or guarding it is pointless. glidepathBase drives Age-Appropriate Mix.
  const holdings = [
    { symbol: 'VTI', marketValue: 90000, quantity: 300, quoteType: 'ETF' },
    { symbol: 'BND', marketValue: 10000, quantity: 120, quoteType: 'ETF' },
  ];
  const quotes = { VTI: etfQuote('VTI'), BND: { ...etfQuote('BND'), quoteType: 'ETF' } };
  const base = { holdings, cash: 0, targets: [], quotes };
  const a = computePortfolioHealth({ ...base, settings: { birthYear: 1984, glidepathBase: 110 } });
  const b = computePortfolioHealth({ ...base, settings: { birthYear: 1984, glidepathBase: 140 } });
  const alloc = h => (h.dimensions || h.breakdown || []).find(d => d.key === 'allocation');
  if (alloc(a) && alloc(b)) {
    assert.notStrictEqual(alloc(a).score, alloc(b).score,
      'glidepathBase must move the Age-Appropriate Mix score');
  }
});

// ─── Summary ─────────────────────────────────────────────────────────────────
console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
