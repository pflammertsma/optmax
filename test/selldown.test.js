'use strict';

const assert = require('assert');
const { buildPlan, computePlanStatus, QUARTER_MS } = require('../lib/selldown');

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

// Base scenario shaped like the real situation: 40% employer stock,
// sell down to 10% over 8 quarters.
// 4000 shares × $100 = $400k out of a $1m portfolio.
const START = '2026-01-01T00:00:00.000Z';
function makePlan(overrides = {}) {
  return buildPlan({
    symbol: 'GOOG',
    shares: 4000,
    price: 100,
    totalValue: 1000000,
    targetWeightPct: 10,
    quartersToTarget: 8,
    startDate: START,
    ...overrides,
  });
}
const daysAfterStart = d => new Date(new Date(START).getTime() + d * 24 * 60 * 60 * 1000);

section('buildPlan');

test('snapshots weight and derives the quarterly share pace', () => {
  const p = makePlan();
  assert.strictEqual(p.symbol, 'GOOG');
  assert.strictEqual(p.startWeightPct, 40);
  // Target shares: 10/40 of the position = 1000 shares ⇒ sell 3000 over 8 quarters
  assert.strictEqual(p.targetSharesAtStart, 1000);
  assert.strictEqual(p.sharesPerQuarter, 375);
});

test('uppercases the symbol', () => {
  assert.strictEqual(makePlan({ symbol: 'goog' }).symbol, 'GOOG');
});

test('already at/below target ⇒ zero shares per quarter, not negative', () => {
  const p = makePlan({ targetWeightPct: 50 });
  assert.strictEqual(p.sharesPerQuarter, 0);
});

test('rejects bad inputs', () => {
  assert.throws(() => makePlan({ shares: 0 }));
  assert.throws(() => makePlan({ price: -1 }));
  assert.throws(() => makePlan({ totalValue: 0 }));
  assert.throws(() => makePlan({ quartersToTarget: 0 }));
  assert.throws(() => makePlan({ quartersToTarget: 2.5 }));
  assert.throws(() => buildPlan({ shares: 1, price: 1, totalValue: 1, targetWeightPct: 1, quartersToTarget: 1 }));
});

section('computePlanStatus — schedule states');

test('day one, nothing sold yet ⇒ on-track, sell one quarter\'s worth', () => {
  const p = makePlan();
  const s = computePlanStatus(p, { shares: 4000, price: 100, totalValue: 1000000 }, daysAfterStart(1));
  assert.strictEqual(s.status, 'on-track');
  assert.strictEqual(s.currentQuarter, 1);
  assert.strictEqual(s.sellThisQuarter, 375);
  assert.strictEqual(s.estProceeds, 37500);
  assert.strictEqual(s.progressPct, 0);
});

test('sold this quarter\'s tranche early ⇒ ahead, nothing more due', () => {
  const p = makePlan();
  // Sold 375 shares; proceeds stayed in the portfolio (total unchanged)
  const s = computePlanStatus(p, { shares: 3625, price: 100, totalValue: 1000000 }, daysAfterStart(10));
  assert.strictEqual(s.status, 'ahead');
  assert.strictEqual(s.sellThisQuarter, 0);
});

test('quarter 2 with quarter-1 tranche done ⇒ on-track, next tranche due', () => {
  const p = makePlan();
  const s = computePlanStatus(p, { shares: 3625, price: 100, totalValue: 1000000 }, daysAfterStart(100));
  assert.strictEqual(s.status, 'on-track');
  assert.strictEqual(s.currentQuarter, 2);
  assert.strictEqual(s.sellThisQuarter, 375);
});

test('quarter 2 with nothing sold ⇒ behind, catch-up amount is two tranches', () => {
  const p = makePlan();
  const s = computePlanStatus(p, { shares: 4000, price: 100, totalValue: 1000000 }, daysAfterStart(100));
  assert.strictEqual(s.status, 'behind');
  assert.strictEqual(s.sellThisQuarter, 750);
});

test('past plan end but not at target ⇒ behind, sell whatever remains', () => {
  const p = makePlan();
  // 2 years + a bit later, only half sold
  const s = computePlanStatus(p, { shares: 2500, price: 100, totalValue: 1000000 }, daysAfterStart(750));
  assert.strictEqual(s.status, 'behind');
  assert.strictEqual(s.pastEnd, true);
  // Live target at $100/$1m is 1000 shares ⇒ 1500 left
  assert.strictEqual(s.sellThisQuarter, 1500);
});

test('weight at/below target ⇒ complete regardless of schedule', () => {
  const p = makePlan();
  const s = computePlanStatus(p, { shares: 1000, price: 100, totalValue: 1000000 }, daysAfterStart(30));
  assert.strictEqual(s.status, 'complete');
  assert.strictEqual(s.sellThisQuarter, 0);
  assert.strictEqual(s.progressPct, 100);
});

section('computePlanStatus — live recalculation');

test('price rally moves the live goalpost (more shares to sell)', () => {
  const p = makePlan();
  // Price doubles; position is now 8000/1400 ≈ 57% of a $1.4m portfolio.
  const s = computePlanStatus(p, { shares: 4000, price: 200, totalValue: 1400000 }, daysAfterStart(1));
  // Live target: 10% × 1.4m / $200 = 700 shares
  assert.ok(Math.abs(s.liveTargetShares - 700) < 1e-9);
  assert.ok(s.sharesRemainingToTarget > 3000);
  assert.ok(s.currentWeightPct > 55);
});

test('crash can complete the plan without selling', () => {
  const p = makePlan();
  // Stock down 80%, rest of portfolio flat: 4000×$20 = $80k of $680k ≈ 11.8%… not quite.
  // Down 85%: $60k of $660k ≈ 9.1% ⇒ complete.
  const s = computePlanStatus(p, { shares: 4000, price: 15, totalValue: 660000 }, daysAfterStart(1));
  assert.strictEqual(s.status, 'complete');
});

test('sellThisQuarter never exceeds what the live target requires', () => {
  const p = makePlan();
  // Stock fell: at $50 in a $800k portfolio the position is 25%; live target 1600 shares.
  // Schedule (quarter 1) says 375 — that's fine; but in quarter 8 the schedule
  // would say 3000 while only 2400 are needed.
  const s = computePlanStatus(p, { shares: 4000, price: 50, totalValue: 800000 }, daysAfterStart(700));
  assert.ok(s.sellThisQuarter <= Math.ceil(s.sharesRemainingToTarget));
});

test('new vests are detected as position growth', () => {
  const p = makePlan();
  const s = computePlanStatus(p, { shares: 4200, price: 100, totalValue: 1020000 }, daysAfterStart(30));
  assert.strictEqual(s.positionGrew, true);
  assert.strictEqual(s.status, 'on-track'); // quarter 1 isn't over yet — not judged behind
  // Catch-up includes the newly vested shares: planned 375 + 200 grown = 575
  assert.strictEqual(s.sellThisQuarter, 575);
});

test('quarter end and plan end dates derive from the start date', () => {
  const p = makePlan();
  const s = computePlanStatus(p, { shares: 4000, price: 100, totalValue: 1000000 }, daysAfterStart(1));
  assert.strictEqual(new Date(s.quarterEndsOn).getTime(), new Date(START).getTime() + QUARTER_MS);
  assert.strictEqual(new Date(s.planEndsOn).getTime(), new Date(START).getTime() + 8 * QUARTER_MS);
});

test('progress reflects the closed weight gap', () => {
  const p = makePlan();
  // At 25% weight the gap 40→10 is half closed
  const s = computePlanStatus(p, { shares: 2500, price: 100, totalValue: 1000000 }, daysAfterStart(200));
  assert.strictEqual(s.progressPct, 50);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
