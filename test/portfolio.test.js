'use strict';

const assert = require('assert');
const {
  totalValue,
  allocationByHolding,
  allocationByBucket,
  computeDrift,
  employerConcentration,
  topConcentrations,
  glidepathEquityTarget,
  parsePositionsCsv,
} = require('../lib/portfolio');

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

function approx(actual, expected, eps = 0.001) {
  assert.ok(Math.abs(actual - expected) < eps, `expected ~${expected}, got ${actual}`);
}

// ─── Fixtures ────────────────────────────────────────────────────────────────
const H = (symbol, marketValue, extra = {}) => ({ symbol, marketValue, ...extra });

const sample = [
  H('VTI',  40000, { bucket: 'core' }),
  H('VEA',  20000, { bucket: 'core' }),
  H('QQQ',  15000, { bucket: 'satellite' }),
  H('ASML', 10000, { bucket: 'satellite' }),
  H('EMPL', 15000, { isEmployerStock: true }),
];

// ─── totalValue ──────────────────────────────────────────────────────────────
section('totalValue');

test('sums market values', () => {
  assert.strictEqual(totalValue(sample), 100000);
});

test('includes cash', () => {
  assert.strictEqual(totalValue(sample, 5000), 105000);
});

test('empty and null inputs return 0', () => {
  assert.strictEqual(totalValue([]), 0);
  assert.strictEqual(totalValue(null), 0);
});

// ─── allocationByHolding ─────────────────────────────────────────────────────
section('allocationByHolding');

test('computes per-holding weights', () => {
  const alloc = allocationByHolding(sample);
  approx(alloc.find(a => a.symbol === 'VTI').weightPct, 40);
  approx(alloc.find(a => a.symbol === 'EMPL').weightPct, 15);
});

test('cash dilutes holding weights', () => {
  const alloc = allocationByHolding(sample, 100000);
  approx(alloc.find(a => a.symbol === 'VTI').weightPct, 20);
});

test('returns [] for zero-value portfolio', () => {
  assert.deepStrictEqual(allocationByHolding([]), []);
  assert.deepStrictEqual(allocationByHolding([H('X', 0)]), []);
});

// ─── allocationByBucket ──────────────────────────────────────────────────────
section('allocationByBucket');

test('aggregates by bucket with unassigned fallback', () => {
  const alloc = allocationByBucket(sample);
  approx(alloc.find(b => b.bucket === 'core').weightPct, 60);
  approx(alloc.find(b => b.bucket === 'satellite').weightPct, 25);
  approx(alloc.find(b => b.bucket === 'unassigned').weightPct, 15);
});

test('cash appears as its own bucket', () => {
  const alloc = allocationByBucket(sample, 25000);
  approx(alloc.find(b => b.bucket === 'cash').weightPct, 20);
});

// ─── computeDrift ────────────────────────────────────────────────────────────
section('computeDrift');

const targets = [
  { bucket: 'core',      targetPct: 70 },
  { bucket: 'satellite', targetPct: 20 },
  { bucket: 'cash',      targetPct: 5 },
];

test('flags buckets outside tolerance', () => {
  const drift = computeDrift(sample, targets, 0, 5);
  const core = drift.find(d => d.bucket === 'core');
  approx(core.actualPct, 60);
  approx(core.driftPct, -10);
  assert.strictEqual(core.rebalance, true);
});

test('does not flag buckets inside tolerance', () => {
  const drift = computeDrift(sample, targets, 0, 5);
  const sat = drift.find(d => d.bucket === 'satellite');
  approx(sat.driftPct, 5);
  assert.strictEqual(sat.rebalance, false); // exactly at tolerance is not beyond it
});

test('missing target bucket reports actual 0', () => {
  const drift = computeDrift(sample, targets, 0, 5);
  const cash = drift.find(d => d.bucket === 'cash');
  approx(cash.actualPct, 0);
  approx(cash.driftPct, -5);
});

test('untargeted portfolio bucket gets implicit 0% target', () => {
  const drift = computeDrift(sample, targets, 0, 5);
  const un = drift.find(d => d.bucket === 'unassigned');
  assert.ok(un, 'expected unassigned bucket row');
  approx(un.targetPct, 0);
  approx(un.driftPct, 15);
  assert.strictEqual(un.rebalance, true);
});

test('tradeValue restores target (buy positive, sell negative)', () => {
  const drift = computeDrift(sample, targets, 0, 5);
  const core = drift.find(d => d.bucket === 'core');
  approx(core.tradeValue, 10000); // buy $10k of core to reach 70% of $100k
  const un = drift.find(d => d.bucket === 'unassigned');
  approx(un.tradeValue, -15000);
});

// ─── employerConcentration ───────────────────────────────────────────────────
section('employerConcentration');

test('uses isEmployerStock flag', () => {
  const c = employerConcentration(sample);
  approx(c.pct, 15);
  assert.strictEqual(c.value, 15000);
});

test('also matches explicit symbol list case-insensitively', () => {
  const c = employerConcentration(sample, 0, ['asml']);
  approx(c.pct, 25); // EMPL flag + ASML symbol
});

test('cash dilutes concentration', () => {
  const c = employerConcentration(sample, 50000);
  approx(c.pct, 10);
});

test('empty portfolio returns zeros', () => {
  assert.deepStrictEqual(employerConcentration([]), { value: 0, pct: 0 });
});

// ─── topConcentrations ───────────────────────────────────────────────────────
section('topConcentrations');

test('returns largest positions first, limited by count', () => {
  const top = topConcentrations(sample, 0, 2);
  assert.strictEqual(top.length, 2);
  assert.strictEqual(top[0].symbol, 'VTI');
  assert.strictEqual(top[1].symbol, 'VEA');
});

// ─── glidepathEquityTarget ───────────────────────────────────────────────────
section('glidepathEquityTarget');

test('caps at maxPct for young ages', () => {
  assert.strictEqual(glidepathEquityTarget(10), 100);
});

test('declines with age from base', () => {
  assert.strictEqual(glidepathEquityTarget(42), 68);
  assert.strictEqual(glidepathEquityTarget(65), 45);
});

test('never negative and handles invalid age', () => {
  assert.strictEqual(glidepathEquityTarget(200), 0);
  assert.strictEqual(glidepathEquityTarget(null), null);
  assert.strictEqual(glidepathEquityTarget(-1), null);
});

test('respects custom base', () => {
  assert.strictEqual(glidepathEquityTarget(42, 120), 78);
});

// ─── parsePositionsCsv ───────────────────────────────────────────────────────
section('parsePositionsCsv');

const simpleCsv = [
  'Symbol,Quantity,Market Value,Cost Basis,Currency',
  'VTI,100,"30,000.50","25,000.00",USD',
  'ASML,10,8000.25,7500,USD',
].join('\n');

test('parses a simple positions CSV', () => {
  const { holdings, cash, errors } = parsePositionsCsv(simpleCsv);
  assert.strictEqual(errors.length, 0);
  assert.strictEqual(cash, 0);
  assert.strictEqual(holdings.length, 2);
  assert.strictEqual(holdings[0].symbol, 'VTI');
  approx(holdings[0].marketValue, 30000.50);
  approx(holdings[0].costBasis, 25000);
  assert.strictEqual(holdings[0].quantity, 100);
  assert.strictEqual(holdings[1].currency, 'USD');
});

test('skips preamble rows before the header', () => {
  const csv = 'Statement,Data\nAccount,U1234567\n' + simpleCsv;
  const { holdings, errors } = parsePositionsCsv(csv);
  assert.strictEqual(errors.length, 0);
  assert.strictEqual(holdings.length, 2);
});

test('routes cash asset-class rows into cash, not holdings', () => {
  const csv = [
    'Symbol,Quantity,Market Value,Asset Class',
    'VTI,100,30000,Stocks',
    'USD,5000,5000,Cash',
  ].join('\n');
  const { holdings, cash } = parsePositionsCsv(csv);
  assert.strictEqual(holdings.length, 1);
  assert.strictEqual(cash, 5000);
});

test('ignores total rows', () => {
  const csv = simpleCsv + '\nTOTAL,,38000.75,,';
  const { holdings } = parsePositionsCsv(csv);
  assert.strictEqual(holdings.length, 2);
});

test('handles quoted fields containing commas', () => {
  const csv = 'Symbol,Quantity,Market Value\nBRK.B,5,"2,345.67"';
  const { holdings } = parsePositionsCsv(csv);
  approx(holdings[0].marketValue, 2345.67);
});

test('reports error for unparsable rows without dying', () => {
  const csv = 'Symbol,Quantity,Market Value\nVTI,abc,xyz\nVEA,10,5000';
  const { holdings, errors } = parsePositionsCsv(csv);
  assert.strictEqual(holdings.length, 1);
  assert.strictEqual(errors.length, 1);
});

test('empty input returns an error', () => {
  const { errors } = parsePositionsCsv('');
  assert.strictEqual(errors.length, 1);
});

test('missing header returns a clear error', () => {
  const { errors } = parsePositionsCsv('foo,bar\n1,2');
  assert.ok(errors[0].includes('header'));
});

test('multi-section CSV: re-maps columns at each section header', () => {
  const csv = [
    'Symbol,Quantity,Market Value',
    'VTI,100,30000',
    'Quantity,Market Value,Symbol',   // second section, different column order
    '10,8000,ASML',
  ].join('\n');
  const { holdings, errors } = parsePositionsCsv(csv);
  assert.strictEqual(errors.length, 0);
  assert.strictEqual(holdings.length, 2);
  const asml = holdings.find(h => h.symbol === 'ASML');
  assert.ok(asml, 'ASML should be parsed from the re-mapped section');
  approx(asml.marketValue, 8000);
  assert.strictEqual(asml.quantity, 10);
});

test('multi-section CSV: skips sections without a value/quantity column', () => {
  const csv = [
    'Symbol,Quantity,Market Value',
    'VTI,100,30000',
    'Symbol,Description,Exchange',    // metadata section — no value column
    'VTI,Vanguard Total Market,ARCA',
    'ASML,ASML Holding,NASDAQ',
  ].join('\n');
  const { holdings } = parsePositionsCsv(csv);
  assert.strictEqual(holdings.length, 1);
  assert.strictEqual(holdings[0].symbol, 'VTI');
});

test('skips rows with non-ticker symbols (misaligned artifacts)', () => {
  const csv = [
    'Symbol,Quantity,Market Value',
    'VTI,100,30000',
    '"1,070",2.3,0',                  // shifted junk row
    '50,109.86,0',
  ].join('\n');
  const { holdings } = parsePositionsCsv(csv);
  assert.strictEqual(holdings.length, 1);
  assert.strictEqual(holdings[0].symbol, 'VTI');
});

test('duplicate symbol across sections keeps the row with a real value', () => {
  const csv = [
    'Symbol,Quantity,Market Value',
    'VTI,100,0',
    'Symbol,Quantity,Market Value',
    'VTI,100,30000',
  ].join('\n');
  const { holdings, errors } = parsePositionsCsv(csv);
  assert.strictEqual(holdings.length, 1);
  approx(holdings[0].marketValue, 30000);
  assert.strictEqual(errors.length, 0);
});

// ─── parseActivityStatementCsv ───────────────────────────────────────────────
section('parseActivityStatementCsv');

const activityCsv = [
  'Statement,Header,Field Name,Field Value',
  'Statement,Data,Title,Activity Statement',
  'Account Information,Header,Field Name,Field Value',
  'Account Information,Data,Base Currency,USD',
  'Open Positions,Header,DataDiscriminator,Asset Category,Currency,Symbol,Quantity,Mult,Cost Price,Cost Basis,Close Price,Value,Unrealized P/L,Unrealized P/L %,Code',
  'Open Positions,Data,Summary,Stocks,CHF,IUSC,50,1,110.29,5514.5,109.86,5493,-21.5,-0.39,',
  'Open Positions,Data,Summary,Stocks,USD,VTI,100,1,250,25000,300,30000,5000,20,',
  'Open Positions,Data,Lot,Stocks,USD,VTI,60,1,240,14400,300,18000,3600,25,',
  'Open Positions,Total,,Stocks,USD,,,,,25000,,30000,5000,,',
  'Mark-to-Market Performance Summary,Header,Asset Category,Symbol,Prior Quantity,Current Quantity',
  'Mark-to-Market Performance Summary,Data,Stocks,VTI,100,100',
  'Cash Report,Header,Currency Summary,Currency,Total,Securities,Futures',
  'Cash Report,Data,Starting Cash,Base Currency Summary,1000,1000,0',
  'Cash Report,Data,Ending Cash,Base Currency Summary,13555.22780545,13555.22780545,0',
  'Base Currency Exchange Rate,Header,Currency,Rate',
  'Base Currency Exchange Rate,Data,CHF,1.235700',
  'Base Currency Exchange Rate,Data,EUR,1.142000',
].join('\n');

test('detects and parses the activity-statement format via parsePositionsCsv', () => {
  const r = parsePositionsCsv(activityCsv);
  assert.strictEqual(r.errors.length, 0);
  assert.strictEqual(r.baseCurrency, 'USD');
  assert.strictEqual(r.holdings.length, 2);
});

test('converts non-base-currency positions using statement FX rates', () => {
  const r = parsePositionsCsv(activityCsv);
  const iusc = r.holdings.find(h => h.symbol === 'IUSC');
  approx(iusc.marketValue, 5493 * 1.2357, 0.01);
  approx(iusc.costBasis, 5514.5 * 1.2357, 0.01);
  assert.strictEqual(iusc.currency, 'CHF');
});

test('keeps base-currency positions unconverted', () => {
  const r = parsePositionsCsv(activityCsv);
  const vti = r.holdings.find(h => h.symbol === 'VTI');
  approx(vti.marketValue, 30000);
});

test('skips lot-level rows, totals, and other sections mentioning symbols', () => {
  const r = parsePositionsCsv(activityCsv);
  assert.strictEqual(r.holdings.filter(h => h.symbol === 'VTI').length, 1);
});

test('reads ending cash from the Cash Report section', () => {
  const r = parsePositionsCsv(activityCsv);
  approx(r.cash, 13555.23, 0.01);
});

test('missing FX rate imports unconverted with a warning', () => {
  const csv = activityCsv.replace('Base Currency Exchange Rate,Data,CHF,1.235700\n', '');
  const r = parsePositionsCsv(csv);
  const iusc = r.holdings.find(h => h.symbol === 'IUSC');
  approx(iusc.marketValue, 5493);
  assert.ok(r.errors.some(e => e.includes('CHF')));
});

test('parses and populates individual lot data for holdings', () => {
  const r = parsePositionsCsv(activityCsv);
  const vti = r.holdings.find(h => h.symbol === 'VTI');
  assert.ok(vti);
  assert.strictEqual(vti.lots.length, 1);
  assert.strictEqual(vti.lots[0].quantity, 60);
  approx(vti.lots[0].costBasis, 14400);
  approx(vti.lots[0].costPrice, 240);
  approx(vti.lots[0].marketValue, 18000);
  approx(vti.lots[0].unrealizedPnl, 3600);
});

// ─── Summary ─────────────────────────────────────────────────────────────────
console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
