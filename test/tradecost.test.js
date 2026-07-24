'use strict';

const assert = require('assert');
const {
  IBKR_TIERED, commissionUsd, tradeCost, minSensibleOrderUsd,
  annualHoldingCostPct, daysToCoverTradeCost, costSummary,
} = require('../lib/tradecost');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.log(`  ✗ ${name}\n      ${e.message}`); failed++; }
}

console.log('\nTrade Cost Unit Tests');
console.log('─'.repeat(60));

// ── commissionUsd ────────────────────────────────────────────────────────────
test('a normal order pays the per-share rate', () => {
  // $5,000 of a $250 share = 20 shares × $0.0035 = $0.07, but the $0.35 floor wins.
  assert.strictEqual(commissionUsd(5000, 250), 0.35);
});

test('a large order pays per-share, above the floor', () => {
  // $100,000 of a $50 share = 2,000 shares × $0.0035 = $7.00.
  assert.strictEqual(commissionUsd(100000, 50), 7);
});

test('the $0.35 minimum applies to small orders', () => {
  assert.strictEqual(commissionUsd(200, 100), IBKR_TIERED.minUsd);
});

test('the 1%-of-trade cap beats the minimum on tiny orders', () => {
  // $20 order: floor says $0.35, but the cap is 1% = $0.20.
  assert.strictEqual(commissionUsd(20, 100), 0.20);
});

test('a zero or missing amount costs nothing', () => {
  assert.strictEqual(commissionUsd(0, 100), 0);
  assert.strictEqual(commissionUsd(null, 100), 0);
});

test('an unknown price still returns a sane fee', () => {
  assert.strictEqual(commissionUsd(5000, null), 0.35);
});

// ── tradeCost ────────────────────────────────────────────────────────────────
test('round trip is buy + sell', () => {
  const t = tradeCost({ amountUsd: 5000, price: 250 });
  assert.strictEqual(t.buyUsd, 0.35);
  assert.strictEqual(t.sellUsd, 0.35);
  assert.strictEqual(t.roundTripUsd, 0.70);
});

test('round trip on a healthy order is a rounding error', () => {
  const t = tradeCost({ amountUsd: 5000, price: 250 });
  assert.ok(t.roundTripPct < 0.05, `expected <0.05%, got ${t.roundTripPct}%`);
});

test('round trip on a tiny order is painful', () => {
  // $100 order: $0.35 each way = $0.70 = 0.70% of the position.
  const t = tradeCost({ amountUsd: 100, price: 50 });
  assert.strictEqual(t.roundTripPct, 0.7);
});

// ── minSensibleOrderUsd ──────────────────────────────────────────────────────
test('minimum sensible order keeps commission under 0.1%', () => {
  const min = minSensibleOrderUsd(250);
  assert.strictEqual(min, 700);
  const t = tradeCost({ amountUsd: min, price: 250 });
  assert.ok(t.roundTripPct <= 0.1, `expected <=0.1%, got ${t.roundTripPct}%`);
});

test('low-priced shares can never hit the target — returns null', () => {
  // At $3/share the per-share fee alone is 2×0.0035/3 = 0.23% round trip,
  // no matter how large the order is.
  assert.strictEqual(minSensibleOrderUsd(3), null);
});

test('an unknown price still yields a floor-driven minimum', () => {
  assert.strictEqual(minSensibleOrderUsd(null), 700);
});

// ── annualHoldingCostPct ─────────────────────────────────────────────────────
test('annual cost adds the expense ratio to the dividend tax drag', () => {
  const a = annualHoldingCostPct({ expenseRatioPct: 0.03, yieldPct: 1.05, dividendTaxRatePct: 30 });
  assert.strictEqual(a.expenseRatioPct, 0.03);
  assert.strictEqual(a.taxDragPct, 0.32);   // 1.05 × 30%
  assert.strictEqual(a.totalPct, 0.35);
});

test('a stock with no dividend and no fund fee costs nothing to hold', () => {
  const a = annualHoldingCostPct({ expenseRatioPct: null, yieldPct: 0, dividendTaxRatePct: 30 });
  assert.strictEqual(a.totalPct, 0);
});

// ── daysToCoverTradeCost ─────────────────────────────────────────────────────
test('a 0.7% round trip needs about five weeks of typical growth', () => {
  const d = daysToCoverTradeCost(0.7, 7);
  assert.ok(d > 30 && d < 40, `expected ~36 days, got ${d}`);
});

test('a free trade needs no holding period', () => {
  assert.strictEqual(daysToCoverTradeCost(0), 0);
});

// ── costSummary ──────────────────────────────────────────────────────────────
test('a sensible order reports no commission-driven hold period', () => {
  const c = costSummary({ amountUsd: 5000, price: 250, expenseRatioPct: 0.03, yieldPct: 1.05, dividendTaxRatePct: 30 });
  assert.strictEqual(c.holdLevel, 'ok');
  assert.match(c.holdNote, /negligible/i);
});

test('a too-small order is called out as too small', () => {
  const c = costSummary({ amountUsd: 100, price: 50, expenseRatioPct: 0.03, yieldPct: 1.05, dividendTaxRatePct: 30 });
  assert.strictEqual(c.holdLevel, 'warn');
  assert.match(c.holdNote, /days/);
});

test('without an order size we still get the minimum-order guidance', () => {
  const c = costSummary({ price: 250, expenseRatioPct: 0.03, yieldPct: 1.05, dividendTaxRatePct: 30 });
  assert.strictEqual(c.trade, null);
  assert.strictEqual(c.minOrderUsd, 700);
  assert.match(c.holdNote, /\$700/);
});

test('annual cost per $10k is the headline number', () => {
  // 0.35%/yr of $10,000 = $35.
  const c = costSummary({ expenseRatioPct: 0.03, yieldPct: 1.05, dividendTaxRatePct: 30 });
  assert.strictEqual(c.annualCostPer10kUsd, 35);
});

test('for a long-term holding the recurring cost dominates the commission', () => {
  const c = costSummary({ amountUsd: 5000, price: 250, expenseRatioPct: 0.60, yieldPct: 2, dividendTaxRatePct: 30 });
  assert.strictEqual(c.dominantCost, 'holding');
});

console.log('─'.repeat(60));
console.log(`  ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
