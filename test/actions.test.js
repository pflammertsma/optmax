'use strict';

const assert = require('assert');
const { buildActionPlan, MAX_ACTIONS } = require('../lib/actions');

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

// ── Fixtures shaped like the real engines' outputs ───────────────────────────
const selldownDue = {
  plan: { symbol: 'GOOG', quartersToTarget: 8 },
  status: {
    status: 'on-track', sellThisQuarter: 375, estProceeds: 56250,
    currentQuarter: 2, quartersToTarget: 8,
    quarterEndsOn: '2026-10-17T00:00:00.000Z',
  },
};
const concHard = { id: 'employer-concentration-hard', type: 'concentration', title: 'Critical Employer Stock Concentration', message: 'msg', severity: 'error' };
const pficItem = { id: 'pfic-grouped', type: 'tax-pfic', title: 'PFIC Warning', message: 'msg', severity: 'error' };
const cashDrag = { id: 'cash-drag', type: 'cash-drag', title: 'Cash Drag Alert', message: 'msg', severity: 'warning' };
const glidepath = { id: 'glidepath-drift', type: 'glidepath', title: 'Glidepath Allocation Drift', message: 'msg', severity: 'warning' };

const buyRecs = {
  recommendations: [
    { symbol: 'AGG', name: 'iShares Core US Aggregate Bond', strategyReason: 'fills bond gap', suggestedUsd: 64500 },
    { symbol: 'VTI', name: 'Vanguard Total Market', strategyReason: 'core underweight', suggestedUsd: 12000 },
    { symbol: 'SCHG', name: 'Schwab Growth', strategyReason: 'core underweight', suggestedUsd: 0 },
  ],
  swaps: [
    { sell: 'IWDC', buy: 'VT', reason: 'PFIC' },
    { sell: 'IUSC', buy: 'VB', reason: 'PFIC' },
  ],
};

section('priority & ordering');

test('sell-down step comes first, then replacements, then buys', () => {
  const { actions } = buildActionPlan({
    selldown: selldownDue, buyRecs, guidanceItems: [pficItem, glidepath], holdings: [],
  });
  assert.strictEqual(actions[0].kind, 'sell');
  assert.ok(actions[0].title.includes('375') && actions[0].title.includes('GOOG'));
  assert.strictEqual(actions[1].kind, 'replace');
  assert.strictEqual(actions[2].kind, 'buy');
  assert.ok(actions[2].title.includes('AGG'));
});

test('behind-schedule sell-down is marked urgent with catch-up phrasing', () => {
  const behind = { ...selldownDue, status: { ...selldownDue.status, status: 'behind' } };
  const { actions } = buildActionPlan({ selldown: behind, guidanceItems: [], holdings: [] });
  assert.strictEqual(actions[0].urgent, true);
  assert.ok(actions[0].detail.includes('behind'));
});

test('nothing due this quarter ⇒ no sell-down row at all', () => {
  const ahead = { ...selldownDue, status: { ...selldownDue.status, sellThisQuarter: 0 } };
  const { actions } = buildActionPlan({ selldown: ahead, guidanceItems: [], holdings: [] });
  assert.strictEqual(actions.length, 0);
});

section('dedupe rules');

test('active plan suppresses the concentration alert and employer Trim rec', () => {
  const { actions } = buildActionPlan({
    selldown: selldownDue,
    guidanceItems: [concHard],
    holdings: [{ symbol: 'GOOG', recommendation: { type: 'Trim', reason: 'too big' } }],
  });
  assert.strictEqual(actions.length, 1); // just the sell-down step
  assert.ok(!actions.some(a => a.title.includes('Critical')));
  assert.ok(!actions.some(a => a.title.includes('Trim')));
});

test('no plan + concentration alert ⇒ "start a plan" action, alert not repeated', () => {
  const { actions } = buildActionPlan({ selldown: null, guidanceItems: [concHard], holdings: [] });
  assert.strictEqual(actions.length, 1);
  assert.ok(actions[0].title.toLowerCase().includes('sell-down plan'));
  assert.strictEqual(actions[0].urgent, true);
});

test('candidate over 10% triggers "start a plan" even without a guidance alert', () => {
  // Employer flag can live on the holding only (no settings.employerSymbols),
  // in which case guidance never emits a concentration item — the candidate
  // from the selldown IPC must carry the trigger on its own.
  const { actions } = buildActionPlan({
    selldown: { plan: null, candidate: { symbol: 'GOOG', weightPct: 38 } },
    guidanceItems: [],
    holdings: [{ symbol: 'GOOG', recommendation: { type: 'Trim', reason: 'too big' } }],
  });
  assert.strictEqual(actions.length, 1); // start-plan absorbs the GOOG Trim too
  assert.ok(actions[0].title.toLowerCase().includes('sell-down plan'));
  assert.ok(actions[0].detail.includes('38% of your portfolio rides on GOOG'));
  assert.strictEqual(actions[0].urgent, true); // >15%
});

test('candidate under 10% ⇒ no nudge', () => {
  const { actions } = buildActionPlan({
    selldown: { plan: null, candidate: { symbol: 'GOOG', weightPct: 7 } },
    guidanceItems: [], holdings: [],
  });
  assert.strictEqual(actions.length, 0);
});

test('swaps merge into one row and suppress the PFIC guidance item', () => {
  const { actions } = buildActionPlan({ buyRecs, guidanceItems: [pficItem], holdings: [] });
  const replaceRows = actions.filter(a => a.kind === 'replace');
  assert.strictEqual(replaceRows.length, 1);
  assert.ok(replaceRows[0].title.includes('2 foreign funds'));
  assert.ok(!actions.some(a => a.title === 'PFIC Warning'));
});

test('swap symbols suppress duplicate per-holding Replace recs', () => {
  const { actions } = buildActionPlan({
    buyRecs,
    guidanceItems: [],
    holdings: [
      { symbol: 'IWDC', recommendation: { type: 'Replace', reason: 'PFIC' } },
      { symbol: 'NUCL', recommendation: { type: 'Replace', reason: 'PFIC' } },
    ],
  });
  // IWDC is in the merged swap row; NUCL gets its own row
  const replaceRows = actions.filter(a => a.kind === 'replace');
  assert.strictEqual(replaceRows.length, 2);
  assert.ok(replaceRows.some(a => a.title.includes('NUCL')));
  assert.ok(!replaceRows.some(a => a.title === 'Replace IWDC'));
});

test('buy ideas suppress the cash-drag lecture', () => {
  const { actions } = buildActionPlan({ buyRecs, guidanceItems: [cashDrag], holdings: [] });
  assert.ok(!actions.some(a => a.title.includes('Cash Drag')));
});

test('cash-drag shows as review when there are no buy ideas', () => {
  const { actions } = buildActionPlan({ guidanceItems: [cashDrag], holdings: [] });
  assert.strictEqual(actions.length, 1);
  assert.strictEqual(actions[0].kind, 'review');
});

section('buys & caps');

test('only cash-sized buys appear, capped at 3 with an overflow row', () => {
  const many = {
    recommendations: [1, 2, 3, 4, 5].map(i => ({
      symbol: `ETF${i}`, name: `Fund ${i}`, strategyReason: 'gap', suggestedUsd: 1000 * i,
    })),
    swaps: [],
  };
  const { actions } = buildActionPlan({ buyRecs: many, guidanceItems: [], holdings: [] });
  const buyRows = actions.filter(a => a.kind === 'buy');
  assert.strictEqual(buyRows.length, 4); // 3 + "2 more"
  assert.ok(buyRows[3].title.includes('2 more'));
});

test('zero-dollar suggestions are dropped', () => {
  const { actions } = buildActionPlan({ buyRecs, guidanceItems: [], holdings: [] });
  assert.ok(!actions.some(a => a.title.includes('SCHG')));
});

test(`list is capped at ${MAX_ACTIONS} with moreCount`, () => {
  const items = Array.from({ length: 12 }, (_, i) => ({
    id: `w${i}`, title: `Warning ${i}`, message: 'm', severity: 'warning',
  }));
  const { actions, moreCount } = buildActionPlan({ guidanceItems: items, holdings: [] });
  assert.strictEqual(actions.length, MAX_ACTIONS);
  assert.strictEqual(moreCount, 12 - MAX_ACTIONS);
});

test('empty inputs ⇒ empty plan', () => {
  const { actions, moreCount } = buildActionPlan({});
  assert.deepStrictEqual(actions, []);
  assert.strictEqual(moreCount, 0);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
