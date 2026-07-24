'use strict';

const assert = require('assert');
const { axisDecimals, priceSeries, formatDateLabel } = require('../lib/chartaxis');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.log(`  ✗ ${name}\n      ${e.message}`); failed++; }
}

console.log('\nPrice Chart Axis Unit Tests');
console.log('─'.repeat(60));

// ── axisDecimals ─────────────────────────────────────────────────────────────
test('a narrow band gets cents, so ticks cannot repeat', () => {
  // VTIP: the whole 30-day window sits inside $49.50–$50.30. Rounding to whole
  // dollars drew five identical "$50" labels.
  assert.strictEqual(axisDecimals(49.52, 50.29), 2);
});

test('a mid-range stock gets one decimal', () => {
  assert.strictEqual(axisDecimals(180, 197), 1);
});

test('a wide-ranging stock gets whole units', () => {
  assert.strictEqual(axisDecimals(400, 900), 0);
});

test('a completely flat series still renders readable ticks', () => {
  assert.strictEqual(axisDecimals(50, 50), 2);
});

test('missing bounds fall back to cents rather than throwing', () => {
  assert.strictEqual(axisDecimals(null, undefined), 2);
});

test('ticks across the chosen precision are always distinguishable', () => {
  // The property that actually matters: for any span, five evenly spaced ticks
  // must produce five different labels.
  for (const [lo, hi] of [[49.52, 50.29], [180, 197], [400, 900], [9.98, 10.11]]) {
    const dp = axisDecimals(lo, hi);
    const labels = new Set();
    for (let i = 0; i < 5; i++) labels.add((lo + ((hi - lo) * i) / 4).toFixed(dp));
    assert.strictEqual(labels.size, 5, `span ${lo}–${hi} at ${dp}dp collapsed to ${[...labels]}`);
  }
});

// ── priceSeries ──────────────────────────────────────────────────────────────
// The real VTIP window: a $0.68 distribution went ex on 2026-07-01.
const VTIP = [
  { date: '2026-06-29', close: 50.29, adjClose: 49.61 },
  { date: '2026-06-30', close: 50.23, adjClose: 49.55 },
  { date: '2026-07-01', close: 49.52, adjClose: 49.52 },
  { date: '2026-07-02', close: 49.58, adjClose: 49.58 },
];

test('the series uses the adjusted close, so a payout is not drawn as a crash', () => {
  const s = priceSeries(VTIP);
  assert.deepStrictEqual(s.values, [49.61, 49.55, 49.52, 49.58]);
  // Raw closes would have shown a 1.4% overnight drop that never happened.
  const rawDrop = (VTIP[2].close - VTIP[1].close) / VTIP[1].close * 100;
  const adjDrop = (s.values[2] - s.values[1]) / s.values[1] * 100;
  assert.ok(rawDrop < -1.3, `sanity: raw close really does cliff (${rawDrop.toFixed(2)}%)`);
  assert.ok(Math.abs(adjDrop) < 0.1, `adjusted series should be flat, got ${adjDrop.toFixed(2)}%`);
});

test('an adjusted window is flagged so the tooltip can say so', () => {
  assert.strictEqual(priceSeries(VTIP).adjusted, true);
});

test('a window with no distributions is not flagged as adjusted', () => {
  const s = priceSeries([
    { date: '2026-07-01', close: 100, adjClose: 100 },
    { date: '2026-07-02', close: 101, adjClose: 101 },
  ]);
  assert.strictEqual(s.adjusted, false);
});

test('history without an adjusted close still charts', () => {
  const s = priceSeries([{ date: '2026-07-01', close: 100 }, { date: '2026-07-02', close: 102 }]);
  assert.deepStrictEqual(s.values, [100, 102]);
  assert.strictEqual(s.adjusted, false);
});

test('rows with no usable price are dropped, not charted as zero', () => {
  const s = priceSeries([
    { date: '2026-07-01', close: 100, adjClose: 100 },
    { date: '2026-07-02', close: null, adjClose: null },
    { date: '2026-07-03', close: 102, adjClose: 102 },
    null,
  ]);
  assert.deepStrictEqual(s.values, [100, 102]);
  assert.strictEqual(s.labels.length, 2);
});

test('empty history yields an empty, non-throwing series', () => {
  const s = priceSeries([]);
  assert.deepStrictEqual(s.values, []);
  assert.strictEqual(s.min, null);
  assert.strictEqual(s.changePct, null);
  assert.strictEqual(priceSeries(undefined).values.length, 0);
});

test('change over the window is measured on the adjusted series', () => {
  const s = priceSeries(VTIP);
  // 49.61 → 49.58 is a hair negative; on raw closes it would look like -1.4%.
  assert.ok(s.changePct < 0 && s.changePct > -0.5, `got ${s.changePct}`);
});

test('bounds and precision come from the charted values', () => {
  const s = priceSeries(VTIP);
  assert.strictEqual(s.min, 49.52);
  assert.strictEqual(s.max, 49.61);
  assert.strictEqual(s.decimals, 2);
});

// ── formatDateLabel ──────────────────────────────────────────────────────────
test('ISO dates become readable', () => {
  assert.strictEqual(formatDateLabel('2026-06-24'), '24 Jun 2026');
  assert.strictEqual(formatDateLabel('2026-12-01'), '1 Dec 2026');
});

test('anything that is not an ISO date is passed through untouched', () => {
  assert.strictEqual(formatDateLabel('Q3'), 'Q3');
  assert.strictEqual(formatDateLabel(null), '');
});

console.log('─'.repeat(60));
console.log(`  ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
