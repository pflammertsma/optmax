'use strict';

const assert = require('assert');
const { computePortfolioHealth, projectAnnualDividends } = require('../lib/health');

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
    { symbol: 'EMPL', marketValue: 45000, quantity: 200, isEmployerStock: true },
    { symbol: 'VTI', marketValue: 45000, quantity: 150, bucket: 'core' },
  ],
  cash: 10000,
  targets: [],
  quotes: { EMPL: stockQuote('EMPL'), VTI: etfQuote('VTI') },
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

test('breakdown has five dimensions summing to totalScore', () => {
  const h = computePortfolioHealth(healthy);
  assert.strictEqual(h.breakdown.length, 5);
  const sum = h.breakdown.reduce((s, b) => s + b.score, 0);
  assert.strictEqual(sum, h.totalScore);
  const max = h.breakdown.reduce((s, b) => s + b.max, 0);
  assert.strictEqual(max, 100);
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
  assert.strictEqual(div.score, 25);
});

test('no targets set scores drift 0 with a set-targets action', () => {
  const h = computePortfolioHealth(concentrated);
  const drift = h.breakdown.find(b => b.key === 'drift');
  assert.strictEqual(drift.score, 0);
  assert.ok(drift.action.toLowerCase().includes('target'));
});

test('PFIC holding zeroes tax hygiene and caps at B', () => {
  const h = computePortfolioHealth({
    holdings: [
      { symbol: 'VTI', marketValue: 90000, quantity: 300, bucket: 'core' },
      { symbol: 'IWDA', marketValue: 10000, quantity: 100, currency: 'CHF' },
    ],
    cash: 0,
    targets: [{ bucket: 'core', targetPct: 100 }],
    quotes: { VTI: etfQuote('VTI') },  // IWDA unresolved → static fallback flags PFIC
  });
  const tax = h.breakdown.find(b => b.key === 'taxHygiene');
  assert.strictEqual(tax.score, 0);
  assert.ok(tax.detail.includes('IWDA'));
  assert.ok(h.caps.some(c => c.grade === 'B'));
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
  assert.strictEqual(div.score, 25); // VTI recognized as fund statically: 80% share
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

// ─── Summary ─────────────────────────────────────────────────────────────────
console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
