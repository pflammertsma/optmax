'use strict';

const assert = require('assert');
const { scanInvestments } = require('../lib/investments');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  ✓  ${name}`); passed++; }
  catch (err) { console.error(`  ✗  ${name}`); console.error(`     ${err.message}`); failed++; }
}
function section(name) { console.log(`\n${name}`); }

// A US person in CH, equity-heavy (triggers the glidepath bonds-first overlay),
// holding an employer stock and a PFIC fund that must be excluded from buys.
const base = {
  holdings: [
    { symbol: 'GOOG', marketValue: 400000, quantity: 1000, bucket: 'satellite', isEmployerStock: true },
    { symbol: 'VTI', marketValue: 200000, quantity: 600, bucket: 'core' },
    { symbol: 'IWDA', marketValue: 50000, quantity: 500, bucket: 'core', currency: 'CHF' }, // PFIC
  ],
  cash: 60000,
  targets: [{ bucket: 'core', targetPct: 80 }, { bucket: 'satellite', targetPct: 15 }, { bucket: 'cash', targetPct: 5 }],
  settings: { employerSymbols: 'GOOG', birthYear: 1984, glidepathBase: 110, dividendTaxRatePct: 35, cashDragThreshold: 5000 },
  quotes: {},
  watchlistData: [{ symbol: 'MSFT', grade: 'A', score: 88 }, { symbol: 'PENNY', grade: 'D', score: 20 }],
};

section('scanInvestments');

test('returns the four categories', () => {
  const r = scanInvestments(base);
  ['etf', 'bond', 'stock', 'dividend'].forEach(k => assert.ok(Array.isArray(r.categories[k]), `${k} missing`));
});

test('excludes employer stock and PFIC funds from every category', () => {
  const r = scanInvestments(base);
  const all = [].concat(...Object.values(r.categories)).map(x => x.symbol);
  assert.ok(!all.includes('GOOG'), 'employer stock leaked in');
  assert.ok(!all.includes('IWDA'), 'PFIC fund leaked in');
});

test('ETFs are ranked, US-broad-market names present', () => {
  const r = scanInvestments(base);
  assert.ok(r.categories.etf.length > 0);
  assert.ok(r.categories.etf.some(x => x.symbol === 'VTI' || x.symbol === 'VOO'));
  // sorted by buy-hold score descending
  for (let i = 1; i < r.categories.etf.length; i++) {
    assert.ok(r.categories.etf[i - 1].buyHoldScore >= r.categories.etf[i].buyHoldScore);
  }
});

test('bonds category holds fixed-income ETFs', () => {
  const r = scanInvestments(base);
  const syms = r.categories.bond.map(x => x.symbol);
  assert.ok(syms.includes('BND') || syms.includes('AGG') || syms.includes('SGOV'));
  assert.ok(r.categories.bond.every(x => x.kind === 'bond'));
});

test('equity-heavy portfolio flips bonds-first with a glidepath note', () => {
  const r = scanInvestments(base);
  assert.strictEqual(r.bondsFirst, true);
  assert.ok(/glidepath/i.test(r.glidepathNote || ''));
});

test('a low-yield broad ETF outranks a high-yield one on the buy-hold lens', () => {
  const r = scanInvestments(base);
  const vti = r.categories.etf.find(x => x.symbol === 'VTI');
  const jepq = r.categories.etf.find(x => x.symbol === 'JEPQ');
  if (vti && jepq) assert.ok(vti.buyHoldScore >= jepq.buyHoldScore);
});

test('dividend category ranks by the dividend lens and only includes payers', () => {
  const r = scanInvestments(base);
  assert.ok(r.categories.dividend.every(x => x.yieldPct >= 1));
  for (let i = 1; i < r.categories.dividend.length; i++) {
    assert.ok(r.categories.dividend[i - 1].dividendScore >= r.categories.dividend[i].dividendScore);
  }
});

test('only A/B watchlist names become stock candidates', () => {
  const r = scanInvestments(base);
  const stockSyms = r.categories.stock.map(x => x.symbol);
  assert.ok(!stockSyms.includes('PENNY'), 'a D-grade name leaked in');
});

test('suggests cash amounts only up to the deployable buffer', () => {
  const r = scanInvestments(base);
  // A row can appear in more than one category (e.g. VTI is an ETF and a
  // dividend payer) as the same object — dedupe by symbol before summing.
  const bySym = new Map();
  [].concat(...Object.values(r.categories)).forEach(x => bySym.set(x.symbol, x.suggestedUsd || 0));
  const suggested = [...bySym.values()].reduce((s, v) => s + v, 0);
  assert.ok(suggested <= r.deployableCash + 1, `suggested ${suggested} exceeded deployable ${r.deployableCash}`);
  assert.strictEqual(r.deployableCash, 55000); // 60000 cash - 5000 buffer
});

test('empty portfolio returns empty categories', () => {
  const r = scanInvestments({ holdings: [], cash: 0 });
  assert.deepStrictEqual(r.categories, { etf: [], bond: [], stock: [], dividend: [] });
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
