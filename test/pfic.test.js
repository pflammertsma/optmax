'use strict';

const assert = require('assert');
const { isUSPerson, estimatePficExitCost } = require('../lib/pfic');

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

section('isUSPerson');

test('US citizenship in either slot, US residence, or green card ⇒ true', () => {
  assert.strictEqual(isUSPerson({ citizenship1: 'US' }), true);
  assert.strictEqual(isUSPerson({ citizenship1: 'NL', citizenship2: 'US' }), true);
  assert.strictEqual(isUSPerson({ citizenship1: 'NL', residenceCountry: 'US' }), true);
  assert.strictEqual(isUSPerson({ citizenship1: 'DE', usGreenCard: true }), true);
});

test('filled-in profile without US ⇒ false', () => {
  assert.strictEqual(isUSPerson({ citizenship1: 'NL', citizenship2: 'CH', residenceCountry: 'CH' }), false);
  assert.strictEqual(isUSPerson({ citizenship1: 'DE' }), false);
});

test('empty profile defaults to US person (fail-safe direction)', () => {
  assert.strictEqual(isUSPerson({}), true);
  assert.strictEqual(isUSPerson(), true);
});

section('estimatePficExitCost — known values');

const NOW = new Date('2026-07-01T00:00:00Z'); // currentYear 2026

test('worked example: $20k gain held 4 calendar years', () => {
  // acq 2023 ⇒ n=4, per-year slice $5k.
  // Current-year: 5000×32% = 1600.
  // Prior years 2023/24/25 at 37% = 1850 each (deferred 5550).
  // Interest at 8%: 1850×(1.08³−1) + 1850×(1.08²−1) + 1850×(1.08−1)
  //               ≈ 480.47 + 307.84 + 148.00 = 936.31
  const e = estimatePficExitCost({
    lots: [{ acquisitionDate: '2023-03-15', costBasis: 30000, marketValue: 50000 }],
    marginalRatePct: 32, topRatePct: 37, interestRatePct: 8, now: NOW,
  });
  assert.strictEqual(e.gainUsd, 20000);
  assert.strictEqual(e.currentYearTax, 1600);
  assert.strictEqual(e.deferredTax, 5550);
  assert.ok(Math.abs(e.interestCharge - 936) <= 1, `interest ${e.interestCharge}`);
  assert.ok(Math.abs(e.totalTax - 8086) <= 2, `total ${e.totalTax}`);
  assert.ok(Math.abs(e.effectiveRatePct - 40.4) < 0.2, `eff ${e.effectiveRatePct}`);
  assert.strictEqual(e.ltcgComparisonTax, 3000);
  assert.strictEqual(e.usedAssumedAge, false);
});

test('waiting a year costs more even with zero growth', () => {
  const e = estimatePficExitCost({
    lots: [{ acquisitionDate: '2023-03-15', costBasis: 30000, marketValue: 50000 }],
    marginalRatePct: 32, now: NOW,
  });
  assert.ok(e.waitOneYearExtra > 0, `waitOneYearExtra ${e.waitOneYearExtra}`);
  // Next year: one more throwback year at 37% + another year of interest,
  // partly offset by the gain spreading across more years ⇒ ~$400 here.
  assert.ok(e.waitOneYearExtra > 200 && e.waitOneYearExtra < 1000, `got ${e.waitOneYearExtra}`);
});

test('bought this year ⇒ everything is current-year slice at marginal rate', () => {
  const e = estimatePficExitCost({
    lots: [{ acquisitionDate: '2026-02-01', costBasis: 10000, marketValue: 12000 }],
    marginalRatePct: 32, now: NOW,
  });
  assert.strictEqual(e.totalTax, 640); // 2000 × 32%
  assert.strictEqual(e.deferredTax, 0);
  assert.strictEqual(e.interestCharge, 0);
});

test('loss position ⇒ zero tax, loss reported separately (not deductible)', () => {
  const e = estimatePficExitCost({
    lots: [{ acquisitionDate: '2024-01-01', costBasis: 10000, marketValue: 8000 }],
    now: NOW,
  });
  assert.strictEqual(e.totalTax, 0);
  assert.strictEqual(e.gainUsd, 0);
  assert.strictEqual(e.lossUsd, -2000);
});

test('mixed lots: losses excluded, gains taxed per their own holding period', () => {
  const e = estimatePficExitCost({
    lots: [
      { acquisitionDate: '2023-03-15', costBasis: 30000, marketValue: 50000 },
      { acquisitionDate: '2025-06-01', costBasis: 5000, marketValue: 4000 },
    ],
    marginalRatePct: 32, now: NOW,
  });
  assert.strictEqual(e.gainUsd, 20000);
  assert.strictEqual(e.lossUsd, -1000);
  assert.ok(Math.abs(e.totalTax - 8086) <= 2);
});

test('IBKR YYYYMMDD lot dates parse correctly', () => {
  const e = estimatePficExitCost({
    lots: [{ acquisitionDate: '20230315', costBasis: 30000, marketValue: 50000 }],
    marginalRatePct: 32, now: NOW,
  });
  assert.strictEqual(e.usedAssumedAge, false);
  assert.ok(Math.abs(e.totalTax - 8086) <= 2, `total ${e.totalTax}`); // same 4-year example
});

test('no lot dates ⇒ synthetic lot at the assumed age, flagged', () => {
  const e = estimatePficExitCost({
    currentValue: 50000, costBasis: 30000,
    lots: [{ costBasis: 30000, marketValue: 50000 }], // no acquisitionDate
    marginalRatePct: 32, assumedYearsHeld: 4, now: NOW,
  });
  assert.strictEqual(e.usedAssumedAge, true);
  assert.strictEqual(e.gainUsd, 20000);
  assert.ok(Math.abs(e.totalTax - 8086) <= 2); // same as the 4-year example
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
