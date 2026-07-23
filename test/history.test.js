'use strict';

const assert = require('assert');
const { parseStatementMeta, buildProfileSnapshot, appendSnapshot } = require('../lib/history');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  ✓  ${name}`); passed++; }
  catch (err) { console.error(`  ✗  ${name}`); console.error(`     ${err.message}`); failed++; }
}
function section(name) { console.log(`\n${name}`); }

section('parseStatementMeta');

const STMT = [
  'Statement,Header,Field Name,Field Value',
  'Statement,Data,Title,Activity Statement',
  'Statement,Data,Period,"July 14, 2026"',
  'Net Asset Value,Header,Asset Class,Prior Total,Current Long,Current Short,Current Total,Change',
  'Net Asset Value,Data,Cash ,1029.29,13555.22,0,13555.22,12525.93',
  'Net Asset Value,Data,Stock,1800999.25,1811260.02,0,1811260.02,10260.76',
  'Net Asset Value,Data,Dividend Accruals,84.3,84.3,0,84.3,0',
  'Net Asset Value,Data,Total,1802112.85,1824899.55,0,1824899.55,22786.70',
  'Net Asset Value,Header,Time Weighted Rate of Return',
  'Net Asset Value,Data,1.264443666%',
  'Cash Report,Header,Currency Summary,Currency,Total,Securities,Futures,Month to Date,Year to Date',
  'Cash Report,Data,Dividends,Base Currency Summary,0,0,0,978.92,8234.15',
  'Cash Report,Data,Dividends,EUR,0,0,0,0,100',
  'Cash Report,Data,Dividends,USD,0,0,0,978.92,8116.91',
  'Cash Report,Data,Withholding Tax,Base Currency Summary,0,0,0,-3.04,-271.512',
  'Cash Report,Data,Withholding Tax,EUR,0,0,0,0,-30',
  'Cash Report,Data,Withholding Tax,USD,0,0,0,-3.04,-236.34',
].join('\n');

test('extracts the statement date as local YYYY-MM-DD', () => {
  assert.strictEqual(parseStatementMeta(STMT).statementDate, '2026-07-14');
});

test('extracts the NAV block (total/cash/stock/accruals/twr)', () => {
  const { nav } = parseStatementMeta(STMT);
  assert.strictEqual(nav.total, 1824899.55);
  assert.strictEqual(nav.cash, 13555.22);
  assert.strictEqual(nav.stock, 1811260.02);
  assert.strictEqual(nav.dividendAccruals, 84.3);
  assert.strictEqual(nav.twrPct, 1.264443666);
});

test('handles a date-range Period by taking the last date', () => {
  const t = 'Statement,Data,Period,"January 1, 2026 - July 14, 2026"';
  assert.strictEqual(parseStatementMeta(t).statementDate, '2026-07-14');
});

test('returns nulls for a non-statement text', () => {
  const m = parseStatementMeta('hello,world');
  assert.strictEqual(m.statementDate, null);
  assert.strictEqual(m.nav, null);
  assert.strictEqual(m.dividendsPaid, null);
});

test('extracts dividends actually paid (gross + withholding, MTD + YTD)', () => {
  const { dividendsPaid } = parseStatementMeta(STMT);
  assert.strictEqual(dividendsPaid.grossYtd, 8234.15);
  assert.strictEqual(dividendsPaid.grossMtd, 978.92);
  assert.strictEqual(dividendsPaid.whYtd, -271.512);
  assert.strictEqual(dividendsPaid.whMtd, -3.04);
});

test('breaks dividends down by currency', () => {
  const { dividendsPaid } = parseStatementMeta(STMT);
  assert.strictEqual(dividendsPaid.byCurrency.USD.grossYtd, 8116.91);
  assert.strictEqual(dividendsPaid.byCurrency.EUR.grossYtd, 100);
  assert.strictEqual(dividendsPaid.byCurrency.USD.whYtd, -236.34);
});

test('snapshot carries net-of-withholding dividends paid', () => {
  const { dividendsPaid } = parseStatementMeta(STMT);
  const snap = buildProfileSnapshot({
    date: '2026-07-14',
    holdings: [{ symbol: 'VTI', quantity: 10, marketValue: 1000 }],
    cash: 1000, dividendsPaid,
  });
  assert.strictEqual(snap.dividendsPaidYtd, 8234.15);
  assert.strictEqual(snap.dividendsWithheldYtd, -271.51);
  assert.strictEqual(snap.dividendsPaidNetYtd, 7962.64); // 8234.15 - 271.51
});

section('buildProfileSnapshot');

const holdings = [
  { symbol: 'GOOG', quantity: 100, marketValue: 400000, costBasis: 150000, currency: 'USD', bucket: 'satellite', isEmployerStock: true },
  { symbol: 'VTI',  quantity: 200, marketValue: 80000,  costBasis: 60000,  currency: 'USD', bucket: 'core' },
  { symbol: 'IUSC', quantity: 50,  marketValue: 20000,  costBasis: 22000,  currency: 'CHF', bucket: 'core' },
];
const baseOpts = {
  date: '2026-07-14', source: 'statement',
  holdings, cash: 100000, targets: [{ bucket: 'core', targetPct: 85 }],
  settings: { employerSymbols: 'GOOG' }, age: 42, glidepathBase: 110,
};

test('computes structural metrics with no quotes (backfill-safe)', () => {
  const s = buildProfileSnapshot(baseOpts);
  assert.strictEqual(s.totalValue, 600000);      // 500k holdings + 100k cash
  assert.strictEqual(s.cashPct, round2(100000 / 600000 * 100));
  assert.strictEqual(s.employerPctDirect, round2(400000 / 600000 * 100)); // ~66.67
  assert.strictEqual(s.topSymbol, 'GOOG');
  assert.strictEqual(s.targetEquityPct, 68); // 110 - 42
  assert.deepStrictEqual(s.buckets.map(b => b.bucket).sort(), ['cash', 'core', 'satellite']);
});

test('picks up holding-level employer flags, not just the settings list', () => {
  const s = buildProfileSnapshot({ ...baseOpts, settings: {} }); // GOOG flagged on the holding
  assert.ok(s.employerSymbols.includes('GOOG'));
  assert.ok(s.employerPctDirect > 60);
});

test('retains a compact per-holding breakdown for future recompute', () => {
  const s = buildProfileSnapshot(baseOpts);
  assert.strictEqual(s.holdings.length, 3);
  assert.deepStrictEqual(Object.keys(s.holdings[0]).sort(),
    ['bucket', 'costBasis', 'currency', 'isEmployerStock', 'marketValue', 'quantity', 'symbol']);
});

test('quote-dependent fields are null unless supplied (honest gaps)', () => {
  const s = buildProfileSnapshot(baseOpts);
  assert.strictEqual(s.healthScore, null);
  assert.strictEqual(s.employerPctTotal, null);
  assert.strictEqual(s.pficValue, null);
});

test('live enrichments flow through when provided', () => {
  const s = buildProfileSnapshot({
    ...baseOpts, source: 'live',
    health: { totalScore: 19, grade: 'E' }, dividends: { annual: 15000 },
    employerViaFundsPct: 1.6, pfic: { value: 20000, count: 1, symbols: ['IUSC'] },
    nav: { stock: 500000, dividendAccruals: 84.3, twrPct: 1.26 },
  });
  assert.strictEqual(s.healthScore, 19);
  assert.strictEqual(s.healthGrade, 'E');
  assert.strictEqual(s.dividendAnnual, 15000);
  assert.strictEqual(s.employerPctTotal, round2(s.employerPctDirect + 1.6));
  assert.strictEqual(s.pficValue, 20000);
  assert.strictEqual(s.twrPct, 1.26);
});

section('appendSnapshot');

const snap = d => ({ date: d, source: 'live', totalValue: 1 });

test('appends and keeps ascending date order', () => {
  let h = [];
  h = appendSnapshot(h, snap('2026-07-14'));
  h = appendSnapshot(h, snap('2026-07-20'));
  h = appendSnapshot(h, snap('2026-07-16'));
  assert.deepStrictEqual(h.map(s => s.date), ['2026-07-14', '2026-07-16', '2026-07-20']);
});

test('same-date append replaces (newer wins)', () => {
  let h = appendSnapshot([], { date: '2026-07-14', source: 'seed', totalValue: 1 });
  h = appendSnapshot(h, { date: '2026-07-14', source: 'statement', totalValue: 2 });
  assert.strictEqual(h.length, 1);
  assert.strictEqual(h[0].source, 'statement');
  assert.strictEqual(h[0].totalValue, 2);
});

test('caps to maxPoints, keeping the most recent', () => {
  let h = [];
  for (let i = 1; i <= 10; i++) h = appendSnapshot(h, snap(`2026-07-${String(i).padStart(2, '0')}`), { maxPoints: 5 });
  assert.strictEqual(h.length, 5);
  assert.strictEqual(h[0].date, '2026-07-06');
  assert.strictEqual(h[4].date, '2026-07-10');
});

test('ignores a snapshot with no date', () => {
  assert.deepStrictEqual(appendSnapshot([snap('2026-07-14')], { totalValue: 9 }).length, 1);
});

function round2(v) { return Math.round(v * 100) / 100; }

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
