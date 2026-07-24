'use strict';

const assert = require('assert');
const { dividendYieldPct } = require('../lib/yield');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  ✓  ${name}`); passed++; }
  catch (err) { console.error(`  ✗  ${name}`); console.error(`     ${err.message}`); failed++; }
}
function section(name) { console.log(`\n${name}`); }

section('dividendYieldPct');

// Real quotes captured 2026-07-24.
const O   = { regularMarketPrice: 64.72,  trailingAnnualDividendRate: 3.234, trailingAnnualDividendYield: 0.049730893, dividendYield: 5 };
const JNJ = { regularMarketPrice: 259.27, trailingAnnualDividendRate: 5.24,  trailingAnnualDividendYield: 0.020498374, dividendYield: 2.07 };
const VTI = { regularMarketPrice: 364.69, trailingAnnualDividendRate: 2.802, trailingAnnualDividendYield: 0.0075961724, dividendYield: 1.05 };
// The ADR trap: rate is 145 JPY against a USD price → Yahoo's own ratio is 13.81.
const MFG = { regularMarketPrice: 10.57,  trailingAnnualDividendRate: 145,   trailingAnnualDividendYield: 13.809524,   dividendYield: 1.75 };

test('normal US names resolve to their real yield', () => {
  assert.strictEqual(dividendYieldPct(O), 5);
  assert.strictEqual(dividendYieldPct(JNJ), 2.07);
  assert.strictEqual(dividendYieldPct(VTI), 1.05);
});

test('MFG (JPY dividend vs USD ADR price) no longer yields 1380.95%', () => {
  const y = dividendYieldPct(MFG);
  assert.strictEqual(y, 1.75);
  assert.ok(y < 60, `implausible yield leaked through: ${y}`);
});

test('a fraction-form trailing yield is scaled to percent when it is the only field', () => {
  // ETFs where Yahoo omits dividendYield but populates the fraction field.
  assert.ok(Math.abs(dividendYieldPct({ trailingAnnualDividendYield: 0.0342 }) - 3.42) < 1e-9);
});

test('a >= 1 trailing yield is never multiplied by 100', () => {
  // Would have been 1380.95% under the old logic.
  assert.strictEqual(dividendYieldPct({ trailingAnnualDividendYield: 13.809524 }), 13.809524);
});

test('falls back to rate/price when the yield fields are absent', () => {
  const y = dividendYieldPct({ trailingAnnualDividendRate: 3.234, regularMarketPrice: 64.72 });
  assert.ok(Math.abs(y - 4.997) < 0.01, `got ${y}`);
});

test('rejects an implausible rate/price (currency mismatch) and uses the fallback', () => {
  // 145 JPY / $10.57 = 1371% → implausible, no other field available.
  const y = dividendYieldPct({ trailingAnnualDividendRate: 145, regularMarketPrice: 10.57 }, 2.2);
  assert.strictEqual(y, 2.2);
});

test('non-payers and missing quotes return the fallback (or 0)', () => {
  assert.strictEqual(dividendYieldPct(null), 0);
  assert.strictEqual(dividendYieldPct({}), 0);
  assert.strictEqual(dividendYieldPct({ dividendYield: 0 }, 1.3), 1.3);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
