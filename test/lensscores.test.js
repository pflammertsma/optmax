'use strict';

const assert = require('assert');
const { scoreLenses, buyHoldScore, dividendScore, tradingScore, LENS_META } = require('../lib/lensscores');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  ✓  ${name}`); passed++; }
  catch (err) { console.error(`  ✗  ${name}`); console.error(`     ${err.message}`); failed++; }
}
function section(name) { console.log(`\n${name}`); }

// ── Fixtures ──────────────────────────────────────────────────────────────────
const vti = {                       // broad, cheap, US ETF — the ideal core holding
  symbol: 'VTI', quoteType: 'ETF', marketCap: 400e9, expenseRatioPct: 0.03,
  yieldPct: 1.3, analysis: { type: 'etf', domicile: 'United States', isPfic: false },
};
const goog = {                      // great single company, but concentrated
  symbol: 'GOOG', quoteType: 'EQUITY', marketCap: 2.1e12, yieldPct: 0.5,
  analysis: { type: 'stock', domicile: 'United States', isPfic: false },
};
const iwda = {                      // foreign-domiciled fund → PFIC for a US person
  symbol: 'IWDA', quoteType: 'ETF', marketCap: 80e9, expenseRatioPct: 0.20,
  yieldPct: 1.6, analysis: { type: 'etf', domicile: 'Ireland', isPfic: true },
};
const highYield = {                 // small-cap double-digit yield — likely unsustainable
  symbol: 'YLD', quoteType: 'EQUITY', marketCap: 400e6, yieldPct: 14,
  analysis: { type: 'stock', domicile: 'United States', isPfic: false },
};
const volStock = {                  // liquid, volatile, trending — a trader's name
  symbol: 'TSLA', quoteType: 'EQUITY', marketCap: 700e9, ivr: 62, aboveMA50: true,
  openInterest: 5000, analysis: { type: 'stock', domicile: 'United States', isPfic: false },
};

// ── Buy-and-hold ────────────────────────────────────────────────────────────
section('buyHoldScore');

test('broad cheap US ETF grades A', () => {
  const r = buyHoldScore(vti, { usPerson: true });
  assert.strictEqual(r.grade, 'A', `got ${r.grade} (${r.score})`);
  assert.ok(r.score >= 90, `expected ≥90, got ${r.score}`);
});

test('single stock scores below a diversified fund', () => {
  const stock = buyHoldScore(goog, { usPerson: true });
  const fund = buyHoldScore(vti, { usPerson: true });
  assert.ok(stock.score < fund.score, `stock ${stock.score} should be < fund ${fund.score}`);
  assert.ok(stock.factors.some(f => /single company/i.test(f.detail)));
});

test('PFIC fund is capped to a failing/weak grade for a US person', () => {
  const r = buyHoldScore(iwda, { usPerson: true });
  assert.ok(r.score <= 30, `expected ≤30, got ${r.score}`);
  assert.ok(['D', 'F'].includes(r.grade));
  assert.ok(r.factors.some(f => /pfic/i.test(f.detail)));
});

test('same fund is NOT PFIC-penalized for a non-US person', () => {
  const us = buyHoldScore(iwda, { usPerson: true });
  const nonUs = buyHoldScore(iwda, { usPerson: false });
  assert.ok(nonUs.score > us.score, `non-US ${nonUs.score} should beat US ${us.score}`);
});

test('unknown profile fails safe to US-person treatment', () => {
  const dflt = buyHoldScore(iwda, {});
  const asUs = buyHoldScore(iwda, { usPerson: true });
  assert.strictEqual(dflt.score, asUs.score);
});

// ── Dividend ────────────────────────────────────────────────────────────────
section('dividendScore');

test('a zero-yield growth stock scores poorly for income', () => {
  const r = dividendScore({ symbol: 'X', yieldPct: 0, marketCap: 50e9 }, { dividendTaxRatePct: 35 });
  assert.strictEqual(r.grade, 'F');
});

test('a solid large-cap payer beats an unsustainable small-cap yield', () => {
  const payer = dividendScore({ symbol: 'KO', quoteType: 'EQUITY', marketCap: 260e9, yieldPct: 3.0, analysis: {} }, { dividendTaxRatePct: 35 });
  const unsustainable = dividendScore(highYield, { dividendTaxRatePct: 35 });
  assert.ok(payer.score > unsustainable.score, `payer ${payer.score} should beat unsustainable ${unsustainable.score}`);
});

test('tax drag lowers the after-tax yield score', () => {
  const security = { symbol: 'D', quoteType: 'EQUITY', marketCap: 50e9, yieldPct: 4.5, analysis: {} };
  const lowTax = dividendScore(security, { dividendTaxRatePct: 0 });
  const highTax = dividendScore(security, { dividendTaxRatePct: 40 });
  assert.ok(highTax.score < lowTax.score, `highTax ${highTax.score} should be < lowTax ${lowTax.score}`);
});

// ── Trading ─────────────────────────────────────────────────────────────────
section('tradingScore');

test('volatile liquid trending name scores high for trading', () => {
  const r = tradingScore(volStock);
  assert.ok(r.score >= 65, `expected ≥65, got ${r.score}`);
});

test('calm mega-cap fund scores low for trading', () => {
  const r = tradingScore(vti);
  assert.ok(r.score < 55, `expected <55, got ${r.score}`);
});

// ── scoreLenses + meta ──────────────────────────────────────────────────────
section('scoreLenses / LENS_META');

test('scoreLenses returns all three lenses with grades', () => {
  const r = scoreLenses(vti, { usPerson: true, dividendTaxRatePct: 35 });
  assert.ok(r.buyHold && r.dividend && r.trading);
  ['buyHold', 'dividend', 'trading'].forEach(k => assert.ok(/^[ABCDF]$/.test(r[k].grade)));
});

test('the trading lens is flagged advanced, the core lenses are not', () => {
  assert.strictEqual(LENS_META.trading.advanced, true);
  assert.strictEqual(LENS_META.buyHold.advanced, false);
  assert.strictEqual(LENS_META.dividend.advanced, false);
});

test('VTI reads opposite through hold vs trade lenses (the whole point)', () => {
  const r = scoreLenses(vti, { usPerson: true, dividendTaxRatePct: 35 });
  assert.ok(r.buyHold.score > r.trading.score, 'VTI should be a better hold than a trade');
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
