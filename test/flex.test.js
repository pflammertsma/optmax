'use strict';

const assert = require('assert');
const {
  sendRequestUrl, getStatementUrl, parseControlResponse, isGeneratingError,
  isLockoutError, describeFlexError, parseFlexStatement, mapAssetCategory,
} = require('../lib/flex');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  ✓  ${name}`); passed++; }
  catch (err) { console.error(`  ✗  ${name}`); console.error(`     ${err.message}`); failed++; }
}
function section(name) { console.log(`\n${name}`); }

section('URL builders');

test('sendRequestUrl encodes token + query id with v=3', () => {
  const u = sendRequestUrl('TOK EN', '12345');
  assert.ok(u.includes('.SendRequest?'));
  assert.ok(u.includes('t=TOK%20EN'));
  assert.ok(u.includes('q=12345'));
  assert.ok(u.endsWith('v=3'));
});

test('getStatementUrl uses the returned base and appends the reference code', () => {
  const u = getStatementUrl('https://gdcdyn.interactivebrokers.com/Universal/servlet/FlexStatementService.GetStatement', 'TOK', 'REF99');
  assert.ok(u.includes('.GetStatement?t=TOK&q=REF99&v=3'));
});

test('getStatementUrl falls back to the known endpoint when no base given', () => {
  const u = getStatementUrl(null, 'TOK', 'REF99');
  assert.ok(u.includes('/FlexStatementService.GetStatement?t=TOK&q=REF99&v=3'));
});

section('parseControlResponse');

const SEND_OK = `<FlexStatementResponse timestamp='16 July, 2026 10:00 AM EDT'>
<Status>Success</Status>
<ReferenceCode>1234567890</ReferenceCode>
<Url>https://ndcdyn.interactivebrokers.com/AccountManagement/FlexWebService/GetStatement</Url>
</FlexStatementResponse>`;

const SEND_FAIL = `<FlexStatementResponse timestamp='16 July, 2026 10:00 AM EDT'>
<Status>Fail</Status>
<ErrorCode>1012</ErrorCode>
<ErrorMessage>Token has expired.</ErrorMessage>
</FlexStatementResponse>`;

const GENERATING = `<FlexStatementResponse timestamp='...'>
<Status>Fail</Status>
<ErrorCode>1019</ErrorCode>
<ErrorMessage>Statement generation in progress. Please try again shortly.</ErrorMessage>
</FlexStatementResponse>`;

test('parses a successful SendRequest into referenceCode + url', () => {
  const c = parseControlResponse(SEND_OK);
  assert.strictEqual(c.ok, true);
  assert.strictEqual(c.referenceCode, '1234567890');
  assert.ok(c.url.endsWith('/GetStatement'));
});

test('parses a failure with error code + message', () => {
  const c = parseControlResponse(SEND_FAIL);
  assert.strictEqual(c.ok, false);
  assert.strictEqual(c.errorCode, '1012');
  assert.strictEqual(c.errorMessage, 'Token has expired.');
});

test('returns null for a data payload (not a control response)', () => {
  assert.strictEqual(parseControlResponse('<FlexQueryResponse><FlexStatements/></FlexQueryResponse>'), null);
});

test('flags the 1019 "generation in progress" retry case', () => {
  assert.strictEqual(isGeneratingError(parseControlResponse(GENERATING)), true);
  assert.strictEqual(isGeneratingError(parseControlResponse(SEND_FAIL)), false);
});

const HEAVY_LOAD = `<FlexStatementResponse>
<Status>Fail</Status>
<ErrorCode>1009</ErrorCode>
<ErrorMessage>Statement could not be generated at this time. Please try again shortly.</ErrorMessage>
</FlexStatementResponse>`;

test('treats 1009 "heavy load / could not be generated" as transient', () => {
  assert.strictEqual(isGeneratingError(parseControlResponse(HEAVY_LOAD)), true);
});

test('does NOT treat an expired token as transient', () => {
  assert.strictEqual(isGeneratingError(parseControlResponse(SEND_FAIL)), false);
});

const TOO_MANY = `<FlexStatementResponse>
<Status>Fail</Status>
<ErrorCode>1025</ErrorCode>
<ErrorMessage>Too many failed attempts. Please review your configuration.</ErrorMessage>
</FlexStatementResponse>`;

section('isLockoutError');

test('flags rate-limit codes (1018/1025) as lockouts, not transient', () => {
  assert.strictEqual(isLockoutError(parseControlResponse(TOO_MANY)), true);
  assert.strictEqual(isGeneratingError(parseControlResponse(TOO_MANY)), false); // must NOT retry
});

test('does not flag heavy-load (1009) as a lockout', () => {
  assert.strictEqual(isLockoutError(parseControlResponse(HEAVY_LOAD)), false);
});

section('describeFlexError');

test('gives a wait-it-out hint for a 1025 lockout', () => {
  const msg = describeFlexError('request', parseControlResponse(TOO_MANY));
  assert.ok(msg.includes('code 1025'));
  assert.ok(/temporary lockout|wait/i.test(msg));
});

test('includes the error code, message, step, and an actionable hint', () => {
  const msg = describeFlexError('retrieve', parseControlResponse(HEAVY_LOAD));
  assert.ok(msg.includes('code 1009'));
  assert.ok(/could not be generated/i.test(msg));
  assert.ok(/retrieving/i.test(msg));
  assert.ok(/heavy load|try again/i.test(msg));
});

test('gives a token-specific hint for expired tokens', () => {
  const msg = describeFlexError('request', parseControlResponse(SEND_FAIL));
  assert.ok(/token/i.test(msg));
  assert.ok(msg.includes('code 1012'));
});

section('mapAssetCategory');

test('maps Flex asset categories to app buckets', () => {
  assert.strictEqual(mapAssetCategory('STK'), 'Stocks');
  assert.strictEqual(mapAssetCategory('BOND'), 'Bond');
  assert.strictEqual(mapAssetCategory('BILL'), 'Bond');
  assert.strictEqual(mapAssetCategory('OPT'), 'OPT');
  assert.strictEqual(mapAssetCategory('FUND'), 'Stocks');
});

section('parseFlexStatement');

const STMT = `<FlexQueryResponse queryName="PortMax" type="AF">
<FlexStatements count="1">
<FlexStatement accountId="U1234567" fromDate="20260101" toDate="20260716" period="YearToDate">
<AccountInformation accountId="U1234567" currency="USD" name="Test" />
<EquitySummaryByReportDateInBase reportDate="20260716" total="1824899.55" cash="13555.22" stock="1811260.02" dividendAccruals="84.3" />
<OpenPositions>
<OpenPosition accountId="U1234567" currency="USD" fxRateToBase="1" symbol="AAPL" conid="265598" assetCategory="STK" position="100" markPrice="200" positionValue="20000" costBasisPrice="150" costBasisMoney="15000" />
<OpenPosition accountId="U1234567" currency="EUR" fxRateToBase="1.1" symbol="ASML" conid="117589" assetCategory="STK" position="10" markPrice="900" positionValue="9000" costBasisMoney="8000" />
<OpenPosition accountId="U1234567" currency="USD" fxRateToBase="1" symbol="TBILL" conid="999" assetCategory="BOND" position="50" positionValue="5000" costBasisMoney="4900" />
<OpenPosition accountId="U1234567" currency="USD" fxRateToBase="1" symbol="ZERO" conid="111" assetCategory="STK" position="0" positionValue="0" />
</OpenPositions>
<CashReport>
<CashReportCurrency accountId="U1234567" currency="BASE_SUMMARY" endingCash="13555.22" dividends="8234.15" withholdingTax="-271.51" />
<CashReportCurrency accountId="U1234567" currency="USD" endingCash="13000" dividends="8116.91" withholdingTax="-236.34" />
<CashReportCurrency accountId="U1234567" currency="EUR" endingCash="500" dividends="100" withholdingTax="-30" />
</CashReport>
</FlexStatement>
</FlexStatements>
</FlexQueryResponse>`;

const parsed = parseFlexStatement(STMT);

test('extracts account id, base currency, and statement date', () => {
  assert.strictEqual(parsed.accountId, 'U1234567');
  assert.strictEqual(parsed.baseCurrency, 'USD');
  assert.strictEqual(parsed.statementDate, '2026-07-16');
});

test('skips zero-quantity positions', () => {
  assert.ok(!parsed.holdings.some(h => h.symbol === 'ZERO'));
  assert.strictEqual(parsed.holdings.length, 3);
});

test('converts non-base positions to base currency via fxRateToBase', () => {
  const asml = parsed.holdings.find(h => h.symbol === 'ASML');
  assert.strictEqual(asml.marketValue, 9900); // 9000 EUR * 1.1
  assert.strictEqual(asml.costBasis, 8800);   // 8000 EUR * 1.1
  assert.strictEqual(asml.currency, 'EUR');
});

test('classifies bonds vs stocks', () => {
  assert.strictEqual(parsed.holdings.find(h => h.symbol === 'TBILL').assetCategory, 'Bond');
  assert.strictEqual(parsed.holdings.find(h => h.symbol === 'AAPL').assetCategory, 'Stocks');
});

test('derives cost basis from price*qty when costBasisMoney is absent', () => {
  const aapl = parsed.holdings.find(h => h.symbol === 'AAPL');
  assert.strictEqual(aapl.costBasis, 15000); // costBasisMoney present here
});

test('reads base-currency cash from the BASE_SUMMARY row', () => {
  assert.strictEqual(parsed.cash, 13555.22);
});

test('reads dividends paid (gross + withholding) YTD + per currency', () => {
  assert.strictEqual(parsed.dividendsPaid.grossYtd, 8234.15);
  assert.strictEqual(parsed.dividendsPaid.whYtd, -271.51);
  assert.strictEqual(parsed.dividendsPaid.byCurrency.USD.grossYtd, 8116.91);
  assert.strictEqual(parsed.dividendsPaid.byCurrency.EUR.whYtd, -30);
});

test('parses the NAV block for the history snapshot', () => {
  assert.strictEqual(parsed.nav.total, 1824899.55);
  assert.strictEqual(parsed.nav.stock, 1811260.02);
});

test('surfaces a control error (expired token) instead of throwing', () => {
  const r = parseFlexStatement(SEND_FAIL);
  assert.ok(/expired/i.test(r.error));
  assert.strictEqual(r.errorCode, '1012');
});

test('flags the generating case so the caller can retry', () => {
  const r = parseFlexStatement(GENERATING);
  assert.strictEqual(r.generating, true);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
