'use strict';

const assert = require('assert');
const { instrumentVerdict, fundBreadth, holdingPeriod, qualityStrengths } = require('../lib/verdict');
const { buyHoldScore } = require('../lib/lensscores');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.log(`  ✗ ${name}\n      ${e.message}`); failed++; }
}

console.log('\nInstrument Verdict Unit Tests');
console.log('─'.repeat(60));

const CH = { usPerson: true, dividendTaxRatePct: 30 };

// ── fundBreadth ──────────────────────────────────────────────────────────────
test('a whole-market fund is broad', () => {
  assert.strictEqual(fundBreadth('VTI', { isFund: true }), 'broad');
});

test('a single-sector fund is sector', () => {
  assert.strictEqual(fundBreadth('VGT', { isFund: true }), 'sector');
});

test('a style tilt is neither broad nor sector', () => {
  assert.strictEqual(fundBreadth('VUG', { isFund: true }), 'tilt');
});

test('an unrecognised fund defaults to tilt, not bedrock', () => {
  assert.strictEqual(fundBreadth('ZZZZ', { isFund: true }), 'tilt');
});

test('a single company is never a fund', () => {
  assert.strictEqual(fundBreadth('AAPL', { isFund: false }), 'single');
});

test('bond funds are their own breadth', () => {
  assert.strictEqual(fundBreadth('BND', { isFund: true, kind: 'bond' }), 'bond');
});

// ── The tie the old scoring couldn't break ───────────────────────────────────
test('a whole-market fund now outscores a single-sector fund', () => {
  // Both are cheap, US-domiciled and diversified — the old score gave both 91.
  const vti = buyHoldScore({ quoteType: 'ETF', analysis: { type: 'etf', domicile: 'United States' }, expenseRatioPct: 0.03, breadth: 'broad' }, CH);
  const vgt = buyHoldScore({ quoteType: 'ETF', analysis: { type: 'etf', domicile: 'United States' }, expenseRatioPct: 0.10, breadth: 'sector' }, CH);
  assert.ok(vti.score > vgt.score, `expected broad (${vti.score}) > sector (${vgt.score})`);
});

test('an expensive sector fund drops out of grade A', () => {
  const nlr = buyHoldScore({ quoteType: 'ETF', analysis: { type: 'etf', domicile: 'United States' }, expenseRatioPct: 0.60, breadth: 'sector' }, CH);
  assert.notStrictEqual(nlr.grade, 'A');
});

test('the breadth factor is explained to the user', () => {
  const s = buyHoldScore({ quoteType: 'ETF', analysis: { type: 'etf', domicile: 'United States' }, expenseRatioPct: 0.03, breadth: 'broad' }, CH);
  const f = s.factors.find(x => x.label === 'Breadth');
  assert.ok(f, 'expected a Breadth factor for a fund');
  assert.match(f.detail, /whole market/i);
});

test('a single stock still reports Stability, not Breadth', () => {
  const s = buyHoldScore({ quoteType: 'EQUITY', analysis: { type: 'stock', domicile: 'United States' }, marketCap: 3e12 }, CH);
  assert.ok(s.factors.find(x => x.label === 'Stability'));
});

// ── instrumentVerdict: role ──────────────────────────────────────────────────
test('a broad US fund is a Core holding', () => {
  const v = instrumentVerdict({ symbol: 'VTI', isFund: true, kind: 'equity', expenseRatioPct: 0.03, yieldPct: 1.05, buyHoldScore: 100 }, CH);
  assert.strictEqual(v.role.key, 'core');
  assert.strictEqual(v.rating.key, 'strong');
});

test('a sector fund is a Satellite, never Core', () => {
  const v = instrumentVerdict({ symbol: 'VGT', isFund: true, kind: 'equity', expenseRatioPct: 0.10, yieldPct: 0.36, buyHoldScore: 91 }, CH);
  assert.strictEqual(v.role.key, 'satellite');
});

test('a bond fund is a Diversifier', () => {
  const v = instrumentVerdict({ symbol: 'BND', isFund: true, kind: 'bond', expenseRatioPct: 0.03, yieldPct: 4.2, buyHoldScore: 100 }, CH);
  assert.strictEqual(v.role.key, 'diversifier');
});

test('a high-yield fund with a strong income score is an Income holding', () => {
  const v = instrumentVerdict({ symbol: 'SCHD', isFund: true, kind: 'equity', expenseRatioPct: 0.06, yieldPct: 3.5, buyHoldScore: 91, dividendScore: 80 }, CH);
  assert.strictEqual(v.role.key, 'income');
});

// ── instrumentVerdict: rating ────────────────────────────────────────────────
test('a PFIC is an outright avoid for a US person', () => {
  const v = instrumentVerdict({ symbol: 'VWRL', isFund: true, isPfic: true, buyHoldScore: 30 }, CH);
  assert.strictEqual(v.rating.key, 'avoid');
  assert.match(v.headline, /PFIC/);
});

test('the same PFIC is not disqualifying for a non-US person', () => {
  const v = instrumentVerdict(
    { symbol: 'VWRL', isFund: true, isPfic: true, expenseRatioPct: 0.22, yieldPct: 1.8, buyHoldScore: 80 },
    { usPerson: false, dividendTaxRatePct: 30 });
  assert.notStrictEqual(v.rating.key, 'avoid');
});

test('an expensive fund is flagged "only with care"', () => {
  const v = instrumentVerdict({ symbol: 'ARKK', isFund: true, kind: 'equity', expenseRatioPct: 0.75, yieldPct: 0, buyHoldScore: 77 }, CH);
  assert.strictEqual(v.rating.key, 'careful');
  assert.match(v.headline, /0\.75% fee/);
});

test('a double-digit yield on one company is treated as a warning sign', () => {
  const v = instrumentVerdict({ symbol: 'XYZ', isFund: false, yieldPct: 15, marketCap: 5e9, buyHoldScore: 60 }, CH);
  assert.strictEqual(v.rating.key, 'careful');
  assert.ok(v.watch.some(w => /distress/i.test(w)));
});

// ── instrumentVerdict: watch list is distinguishing, not boilerplate ─────────
test('a cheap broad fund has nothing notable to warn about', () => {
  const v = instrumentVerdict({ symbol: 'VTI', isFund: true, kind: 'equity', expenseRatioPct: 0.03, yieldPct: 1.05, buyHoldScore: 100 }, CH);
  assert.deepStrictEqual(v.watch, []);
});

test('a high fee is quoted in dollars per $10k, not just a percentage', () => {
  const v = instrumentVerdict({ symbol: 'SMH', isFund: true, kind: 'equity', expenseRatioPct: 0.35, yieldPct: 0.5, buyHoldScore: 80 }, CH);
  assert.ok(v.watch.some(w => /\$35 a year/.test(w)), `got: ${JSON.stringify(v.watch)}`);
});

test('a taxable yield is called out with the actual drag', () => {
  const v = instrumentVerdict({ symbol: 'VXUS', isFund: true, kind: 'equity', expenseRatioPct: 0.08, yieldPct: 3.4, buyHoldScore: 100 }, CH);
  assert.ok(v.watch.some(w => /1\.0%\/yr lost to dividend tax/.test(w)), `got: ${JSON.stringify(v.watch)}`);
});

test('single-company risk is always stated for a stock', () => {
  const v = instrumentVerdict({ symbol: 'AAPL', isFund: false, yieldPct: 0.4, marketCap: 3e12, buyHoldScore: 60 }, CH);
  assert.ok(v.watch.some(w => /single company/i.test(w)));
});

test('a high-yield fund whose tax bill eats the return is not "solid"', () => {
  // JEPQ: passes every individual check (fee under 0.50, quality 82, diversified)
  // yet hands back 3.3%/yr once the Swiss dividend tax is applied.
  const v = instrumentVerdict({ symbol: 'JEPQ', isFund: true, kind: 'equity', expenseRatioPct: 0.35, yieldPct: 9.9, buyHoldScore: 82 }, CH);
  assert.strictEqual(v.rating.key, 'careful');
  assert.match(v.headline, /3\.3%\/yr/);
  assert.ok(v.watch.some(w => /high bar for the returns to clear/.test(w)));
});

test('the same fund is fine for someone who is not taxed on dividends', () => {
  const v = instrumentVerdict(
    { symbol: 'JEPQ', isFund: true, kind: 'equity', expenseRatioPct: 0.35, yieldPct: 9.9, buyHoldScore: 82 },
    { usPerson: true, dividendTaxRatePct: 0 });
  assert.strictEqual(v.rating.key, 'solid');
});

test('a cap-segment fund does not claim to be the whole market', () => {
  const s = qualityStrengths({ symbol: 'VB', isFund: true, kind: 'equity', expenseRatioPct: 0.05 }, CH);
  assert.ok(s.some(x => /one size band/.test(x)), `got: ${JSON.stringify(s)}`);
  assert.ok(!s.some(x => /whole market/i.test(x)));
});

// ── Recommended holding period ───────────────────────────────────────────────
test('broad equity wants a full business cycle', () => {
  const h = holdingPeriod({ breadth: 'broad' });
  assert.strictEqual(h.minYears, 7);
  assert.match(h.rationale, /business cycle/i);
});

test('a single sector needs longer than the market, being concentrated', () => {
  assert.strictEqual(holdingPeriod({ breadth: 'sector' }).minYears, 5);
});

test('a single company is the longest hold and never for a dated goal', () => {
  const h = holdingPeriod({ breadth: 'single' });
  assert.strictEqual(h.minYears, 10);
  assert.match(h.rationale, /never money you need on a date/i);
});

test('a T-bill fund is a parking space, not a multi-year hold', () => {
  const h = holdingPeriod({ kind: 'bond', symbol: 'SGOV' });
  assert.strictEqual(h.minYears, 0);
  assert.strictEqual(h.label, 'Any time');
});

test('a long bond fund is NOT treated like a T-bill fund', () => {
  assert.strictEqual(holdingPeriod({ kind: 'bond', symbol: 'TLT' }).minYears, 3);
});

test('the verdict carries the holding period', () => {
  const v = instrumentVerdict({ symbol: 'VTI', isFund: true, kind: 'equity', expenseRatioPct: 0.03, yieldPct: 1.05, buyHoldScore: 100 }, CH);
  assert.strictEqual(v.hold.label, '7+ yrs');
  // The short label is for the table; the reason has to stay reachable.
  assert.match(v.hold.rationale, /business cycle/i);
});

test('the verdict carries a short label for what the instrument is', () => {
  const vti = instrumentVerdict({ symbol: 'VTI', isFund: true, kind: 'equity', expenseRatioPct: 0.03, yieldPct: 1.05, buyHoldScore: 100 }, CH);
  const vb  = instrumentVerdict({ symbol: 'VB',  isFund: true, kind: 'equity', expenseRatioPct: 0.05, yieldPct: 1.19, buyHoldScore: 100 }, CH);
  const vgt = instrumentVerdict({ symbol: 'VGT', isFund: true, kind: 'equity', expenseRatioPct: 0.10, yieldPct: 0.36, buyHoldScore: 91 }, CH);
  assert.strictEqual(vti.breadthLabel, 'Whole market');
  assert.strictEqual(vb.breadthLabel, 'One size band');
  assert.strictEqual(vgt.breadthLabel, 'One sector');
  // Short enough to sit in a table cell without wrapping.
  for (const v of [vti, vb, vgt]) assert.ok(v.breadthLabel.length <= 16, v.breadthLabel);
});

test('a T-bill fund is labelled as cash-like, not generic fixed income', () => {
  const v = instrumentVerdict({ symbol: 'SGOV', isFund: true, kind: 'bond', expenseRatioPct: 0.07, yieldPct: 3.9, buyHoldScore: 100 }, CH);
  assert.strictEqual(v.breadthLabel, 'Cash-like bonds');
});

// ── Why the quality score is high ────────────────────────────────────────────
test('a broad cheap US fund explains its own A grade', () => {
  const s = qualityStrengths({ symbol: 'VTI', isFund: true, kind: 'equity', expenseRatioPct: 0.03, yieldPct: 1.05 }, CH);
  assert.ok(s.some(x => /whole market/i.test(x)), `got: ${JSON.stringify(s)}`);
  assert.ok(s.some(x => /PFIC/.test(x)), `got: ${JSON.stringify(s)}`);
  assert.ok(s.some(x => /Very low fee/.test(x)), `got: ${JSON.stringify(s)}`);
});

test('a sector fund does not claim to be the whole market', () => {
  const s = qualityStrengths({ symbol: 'VGT', isFund: true, kind: 'equity', expenseRatioPct: 0.10 }, CH);
  assert.ok(s.some(x => /One sector/.test(x)), `got: ${JSON.stringify(s)}`);
  assert.ok(!s.some(x => /whole market/i.test(x)));
});

test('a mega-cap stock is credited for its size, not fund breadth', () => {
  const s = qualityStrengths({ symbol: 'AAPL', isFund: false, marketCap: 3e12 }, CH);
  assert.ok(s.some(x => /Mega-cap/.test(x)), `got: ${JSON.stringify(s)}`);
});

test('the PFIC credit is withheld from a fund that is one', () => {
  const s = qualityStrengths({ symbol: 'VWRL', isFund: true, isPfic: true, expenseRatioPct: 0.22 }, CH);
  assert.ok(!s.some(x => /PFIC/.test(x)));
});

test('a PFIC verdict has no strengths and no holding period', () => {
  const v = instrumentVerdict({ symbol: 'VWRL', isFund: true, isPfic: true, buyHoldScore: 30 }, CH);
  assert.deepStrictEqual(v.strengths, []);
  assert.strictEqual(v.hold.label, 'Don\'t buy');
});

console.log('─'.repeat(60));
console.log(`  ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
