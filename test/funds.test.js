'use strict';

const assert = require('assert');
const { computeFundOverlap, canonicalSymbol } = require('../lib/funds');

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

// Shaped like Yahoo's topHoldings: holdingPercent is a fraction
const voLikeHoldings = [
  { symbol: 'MSFT',  holdingName: 'Microsoft',   holdingPercent: 0.072 },
  { symbol: 'AAPL',  holdingName: 'Apple',       holdingPercent: 0.065 },
  { symbol: 'NVDA',  holdingName: 'NVIDIA',      holdingPercent: 0.061 },
  { symbol: 'GOOGL', holdingName: 'Alphabet A',  holdingPercent: 0.024 },
  { symbol: 'GOOG',  holdingName: 'Alphabet C',  holdingPercent: 0.020 },
  { symbol: 'META',  holdingName: 'Meta',        holdingPercent: 0.024 },
];

const portfolio = [
  { symbol: 'GOOG', marketValue: 400000, currency: 'USD' },
  { symbol: 'META', marketValue: 30000,  currency: 'USD' },
  { symbol: 'VTI',  marketValue: 80000,  currency: 'USD' },
];
const TOTAL = 1000000;

section('canonicalSymbol');

test('maps share classes to one canonical symbol', () => {
  assert.strictEqual(canonicalSymbol('GOOGL'), 'GOOG');
  assert.strictEqual(canonicalSymbol('googl'), 'GOOG');
  assert.strictEqual(canonicalSymbol('BRK-B'), 'BRK-A');
  assert.strictEqual(canonicalSymbol('MSFT'), 'MSFT');
});

section('computeFundOverlap');

test('merges GOOGL + GOOG fund lines into one employer row', () => {
  const r = computeFundOverlap(voLikeHoldings, portfolio, 'GOOG', TOTAL);
  const goog = r.rows.find(x => x.symbol === 'GOOG');
  assert.ok(goog);
  assert.strictEqual(goog.fundPct, 4.4); // 2.4 + 2.0
  assert.strictEqual(goog.isEmployer, true);
  assert.strictEqual(goog.alreadyHeld, true);
  assert.strictEqual(goog.directWeightPct, 40);
});

test('employer exposure is aggregated and expressed per $10k', () => {
  const r = computeFundOverlap(voLikeHoldings, portfolio, 'GOOG', TOTAL);
  assert.strictEqual(r.employerFundPct, 4.4);
  assert.strictEqual(r.employerUsdPer10k, 440); // $440 hidden GOOG per $10k
});

test('overlap covers every fund holding the user owns directly', () => {
  const r = computeFundOverlap(voLikeHoldings, portfolio, 'GOOG', TOTAL);
  assert.strictEqual(r.overlapCount, 2); // GOOG (merged) + META
  assert.ok(Math.abs(r.overlapFundPct - (4.4 + 2.4)) < 0.01);
});

test('rows are sorted by fund weight descending', () => {
  const r = computeFundOverlap(voLikeHoldings, portfolio, 'GOOG', TOTAL);
  const pcts = r.rows.map(x => x.fundPct);
  for (let i = 1; i < pcts.length; i++) assert.ok(pcts[i] <= pcts[i - 1]);
});

test('no employer symbols means zero employer exposure', () => {
  const r = computeFundOverlap(voLikeHoldings, portfolio, '', TOTAL);
  assert.strictEqual(r.employerFundPct, 0);
  assert.strictEqual(r.employerUsdPer10k, 0);
});

test('option positions and empty inputs are ignored gracefully', () => {
  const withOpt = [...portfolio, { symbol: 'GOOG 260116C150', marketValue: 5000, assetCategory: 'OPT' }];
  const r = computeFundOverlap(voLikeHoldings, withOpt, 'GOOG', TOTAL);
  const goog = r.rows.find(x => x.symbol === 'GOOG');
  assert.strictEqual(goog.directWeightPct, 40); // option line not double-counted
  const empty = computeFundOverlap([], [], '', 0);
  assert.deepStrictEqual(empty.rows, []);
  assert.strictEqual(empty.overlapCount, 0);
});

section('computeIndexImpliedEmployer');

const { computeIndexImpliedEmployer } = require('../lib/funds');

const lookthroughs = [
  { symbol: 'VOO', marketValue: 100000, topHoldings: [
    { symbol: 'GOOGL', holdingPercent: 0.024 },
    { symbol: 'GOOG',  holdingPercent: 0.020 },
    { symbol: 'MSFT',  holdingPercent: 0.072 },
  ]},
  { symbol: 'QQQ', marketValue: 130000, topHoldings: [
    { symbol: 'GOOGL', holdingPercent: 0.050 },
    { symbol: 'NVDA',  holdingPercent: 0.090 },
  ]},
  { symbol: 'DBA', marketValue: 30000, topHoldings: [
    { symbol: 'CORN', holdingPercent: 0.10 },
  ]},
];

test('sums employer stock across every held fund', () => {
  const r = computeIndexImpliedEmployer(lookthroughs, 400000, 'GOOG', 1000000);
  // VOO: 4.4% × 100k = 4400; QQQ: 5% × 130k = 6500; DBA: 0
  assert.strictEqual(r.impliedUsd, 10900);
  assert.strictEqual(r.impliedPct, 1.09);
  assert.strictEqual(r.directPct, 40);
  assert.strictEqual(r.totalPct, 41.09);
});

test('per-fund breakdown sorted by implied dollars, zero-exposure funds omitted', () => {
  const r = computeIndexImpliedEmployer(lookthroughs, 400000, 'GOOG', 1000000);
  assert.deepStrictEqual(r.perFund.map(f => f.symbol), ['QQQ', 'VOO']);
  assert.strictEqual(r.perFund[0].impliedUsd, 6500);
  assert.strictEqual(r.perFund[1].employerFundPct, 4.4);
});

test('no funds or no employer symbols yields zeros without crashing', () => {
  const none = computeIndexImpliedEmployer([], 0, 'GOOG', 1000000);
  assert.strictEqual(none.totalPct, 0);
  const noEmp = computeIndexImpliedEmployer(lookthroughs, 400000, '', 1000000);
  assert.strictEqual(noEmp.impliedUsd, 0);
  assert.strictEqual(noEmp.directPct, 40);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
