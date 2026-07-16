'use strict';

const assert = require('assert');
const {
  createIbkrClient,
  mapIbkrPositions,
  mapIbkrLedger,
  interpretAuthStatus,
  isLoopbackGatewayUrl,
  gatewayLaunchSpec,
  treeKillSpec,
} = require('../lib/ibkr');

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

async function testAsync(name, fn) {
  try {
    await fn();
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

function approx(actual, expected, eps = 0.01) {
  assert.ok(Math.abs(actual - expected) < eps, `expected ~${expected}, got ${actual}`);
}

// ─── mapIbkrPositions ────────────────────────────────────────────────────────
section('mapIbkrPositions');

const rawPositions = [
  { conid: 1, contractDesc: 'GOOG', ticker: 'GOOG', position: 100, mktValue: 35000, avgCost: 150, currency: 'USD', assetClass: 'STK' },
  { conid: 2, contractDesc: 'IUSC', position: 50, mktValue: 5493, avgCost: 110.29, currency: 'CHF', assetClass: 'STK' },
  { conid: 3, contractDesc: 'USD.CHF', position: 1000, mktValue: 1000, currency: 'CHF', assetClass: 'CASH' },
  { conid: 4, contractDesc: 'VTI', position: 0, mktValue: 0, currency: 'USD', assetClass: 'STK' },
];

test('maps stock positions to holdings shape', () => {
  const { holdings, errors } = mapIbkrPositions(rawPositions, 'USD', { CHF: 1.2357 });
  assert.strictEqual(errors.length, 0);
  assert.strictEqual(holdings.length, 2); // cash + zero-qty rows dropped
  const goog = holdings.find(h => h.symbol === 'GOOG');
  assert.strictEqual(goog.quantity, 100);
  approx(goog.marketValue, 35000);
  approx(goog.costBasis, 15000);
  assert.strictEqual(goog.assetCategory, 'Stocks');
  assert.strictEqual(goog.conid, 1);
});

test('converts non-base currencies with provided FX rates', () => {
  const { holdings } = mapIbkrPositions(rawPositions, 'USD', { CHF: 1.2357 });
  const iusc = holdings.find(h => h.symbol === 'IUSC');
  approx(iusc.marketValue, 5493 * 1.2357);
  approx(iusc.costBasis, 50 * 110.29 * 1.2357);
  assert.strictEqual(iusc.currency, 'CHF');
});

test('missing FX rate imports unconverted with a warning', () => {
  const { holdings, errors } = mapIbkrPositions(rawPositions, 'USD', {});
  const iusc = holdings.find(h => h.symbol === 'IUSC');
  approx(iusc.marketValue, 5493);
  assert.ok(errors.some(e => e.includes('CHF')));
});

test('falls back to contractDesc first token when ticker is absent', () => {
  const { holdings } = mapIbkrPositions(
    [{ conid: 9, contractDesc: 'ASML NA', position: 10, mktValue: 8000, currency: 'USD', assetClass: 'STK' }],
    'USD', {}
  );
  assert.strictEqual(holdings[0].symbol, 'ASML');
});

test('marks option positions with OPT asset category', () => {
  const { holdings } = mapIbkrPositions(
    [{ conid: 5, contractDesc: 'AAPL 19DEC26 250 P', position: -1, mktValue: -127, avgCost: 314, currency: 'USD', assetClass: 'OPT' }],
    'USD', {}
  );
  assert.strictEqual(holdings[0].assetCategory, 'OPT');
  assert.strictEqual(holdings[0].symbol, 'AAPL');
});

test('empty input yields empty result', () => {
  const { holdings, errors } = mapIbkrPositions([], 'USD', {});
  assert.strictEqual(holdings.length, 0);
  assert.strictEqual(errors.length, 0);
  assert.strictEqual(mapIbkrPositions(null, 'USD', {}).holdings.length, 0);
});

// ─── mapIbkrLedger ───────────────────────────────────────────────────────────
section('mapIbkrLedger');

test('reads settled cash from the BASE entry', () => {
  const { cash, found } = mapIbkrLedger({
    BASE: { settledcash: 13555.23, cashbalance: 13600 },
    USD: { settledcash: 12000 },
    CHF: { settledcash: 1200 },
  });
  approx(cash, 13555.23);
  assert.strictEqual(found, true);
});

test('falls back to cashbalance when settledcash is absent', () => {
  const { cash } = mapIbkrLedger({ BASE: { cashbalance: 500 } });
  approx(cash, 500);
});

test('missing BASE entry reports not found', () => {
  assert.deepStrictEqual(mapIbkrLedger({}), { cash: 0, found: false });
  assert.deepStrictEqual(mapIbkrLedger(null), { cash: 0, found: false });
});

// ─── interpretAuthStatus ─────────────────────────────────────────────────────
section('interpretAuthStatus');

test('authenticated session is connected', () => {
  const s = interpretAuthStatus(200, { authenticated: true, connected: true, competing: false });
  assert.strictEqual(s.state, 'connected');
  assert.strictEqual(s.authenticated, true);
});

test('unauthenticated session needs login', () => {
  const s = interpretAuthStatus(200, { authenticated: false, connected: true });
  assert.strictEqual(s.state, 'needs-login');
});

test('non-200 or empty body is unreachable', () => {
  assert.strictEqual(interpretAuthStatus(500, null).state, 'unreachable');
  assert.strictEqual(interpretAuthStatus(200, null).state, 'unreachable');
});

// ─── isLoopbackGatewayUrl (TLS bypass guard) ─────────────────────────────────
section('isLoopbackGatewayUrl');

test('trusts the configured loopback gateway origin', () => {
  assert.strictEqual(isLoopbackGatewayUrl('https://localhost:5000/sso/Login', 'https://localhost:5000'), true);
  assert.strictEqual(isLoopbackGatewayUrl('https://127.0.0.1:5000/', 'https://127.0.0.1:5000'), true);
});

test('rejects a different port than configured', () => {
  assert.strictEqual(isLoopbackGatewayUrl('https://localhost:5001/', 'https://localhost:5000'), false);
});

test('never trusts a non-loopback host, even if it matches the setting', () => {
  assert.strictEqual(isLoopbackGatewayUrl('https://evil.example.com/', 'https://evil.example.com'), false);
  assert.strictEqual(isLoopbackGatewayUrl('https://10.0.0.5:5000/', 'https://10.0.0.5:5000'), false);
});

test('rejects malformed input', () => {
  assert.strictEqual(isLoopbackGatewayUrl('not-a-url', 'https://localhost:5000'), false);
});

// ─── gatewayLaunchSpec / treeKillSpec ────────────────────────────────────────
section('gatewayLaunchSpec / treeKillSpec');

test('windows launch uses run.bat through a shell', () => {
  const spec = gatewayLaunchSpec('win32', 'C:\\IBKR\\clientportal.gw');
  assert.strictEqual(spec.command, 'bin\\run.bat');
  assert.deepStrictEqual(spec.args, ['root/conf.yaml']);
  assert.strictEqual(spec.cwd, 'C:\\IBKR\\clientportal.gw');
  assert.strictEqual(spec.shell, true);
});

test('unix launch uses run.sh without a shell', () => {
  const spec = gatewayLaunchSpec('linux', '/opt/clientportal.gw');
  assert.strictEqual(spec.command, './bin/run.sh');
  assert.strictEqual(spec.shell, false);
});

test('windows tree-kill uses taskkill /T /F', () => {
  const spec = treeKillSpec('win32', 4242);
  assert.strictEqual(spec.command, 'taskkill');
  assert.deepStrictEqual(spec.args, ['/pid', '4242', '/T', '/F']);
});

test('unix kill sends SIGTERM', () => {
  const spec = treeKillSpec('linux', 4242);
  assert.strictEqual(spec.command, 'kill');
  assert.deepStrictEqual(spec.args, ['-TERM', '4242']);
});

// ─── createIbkrClient (mock transport) ───────────────────────────────────────
section('createIbkrClient with mock transport');

function mockTransport(routes) {
  const calls = [];
  const fn = async (_base, method, apiPath) => {
    calls.push(`${method} ${apiPath}`);
    for (const [pattern, response] of routes) {
      if (apiPath.startsWith(pattern)) return typeof response === 'function' ? response(apiPath) : response;
    }
    return { status: 404, json: null };
  };
  fn.calls = calls;
  return fn;
}

const happyRoutes = [
  ['/iserver/auth/status', { status: 200, json: { authenticated: true, connected: true } }],
  ['/portfolio/accounts', { status: 200, json: [{ accountId: 'U1234567', currency: 'USD' }] }],
  ['/portfolio/U1234567/positions/', (p) => {
    const page = parseInt(p.split('/').pop(), 10);
    return { status: 200, json: page === 0
      ? [{ conid: 1, ticker: 'GOOG', contractDesc: 'GOOG', position: 100, mktValue: 35000, avgCost: 150, currency: 'USD', assetClass: 'STK' }]
      : [] };
  }],
  ['/portfolio/U1234567/ledger', { status: 200, json: { BASE: { settledcash: 5000 } } }],
];

(async () => {
  await testAsync('syncPortfolio happy path returns holdings + cash', async () => {
    const transport = mockTransport(happyRoutes);
    const client = createIbkrClient('https://localhost:5000', transport);
    const r = await client.syncPortfolio();
    assert.strictEqual(r.success, true);
    assert.strictEqual(r.accountId, 'U1234567');
    assert.strictEqual(r.baseCurrency, 'USD');
    assert.strictEqual(r.holdings.length, 1);
    approx(r.cash, 5000);
    // accounts must be fetched before positions (gateway requirement)
    const accountsIdx = transport.calls.findIndex(c => c.includes('/portfolio/accounts'));
    const positionsIdx = transport.calls.findIndex(c => c.includes('/positions/'));
    assert.ok(accountsIdx < positionsIdx, 'accounts must be called before positions');
  });

  await testAsync('syncPortfolio reports needs-login without touching portfolio endpoints', async () => {
    const transport = mockTransport([
      ['/iserver/auth/status', { status: 200, json: { authenticated: false, connected: true } }],
    ]);
    const client = createIbkrClient('https://localhost:5000', transport);
    const r = await client.syncPortfolio();
    assert.strictEqual(r.success, false);
    assert.strictEqual(r.state, 'needs-login');
    assert.ok(!transport.calls.some(c => c.includes('/portfolio/')));
  });

  await testAsync('syncPortfolio reports unreachable on transport error', async () => {
    const client = createIbkrClient('https://localhost:5000', async () => { throw new Error('ECONNREFUSED'); });
    const r = await client.syncPortfolio();
    assert.strictEqual(r.success, false);
    assert.strictEqual(r.state, 'unreachable');
  });

  await testAsync('getPositions paginates until a short page', async () => {
    const fullPage = Array.from({ length: 30 }, (_, i) => ({
      conid: i, ticker: `S${i}`, contractDesc: `S${i}`, position: 1, mktValue: 100, currency: 'USD', assetClass: 'STK',
    }));
    const transport = mockTransport([
      ['/portfolio/U1/positions/', (p) => {
        const page = parseInt(p.split('/').pop(), 10);
        return { status: 200, json: page === 0 ? fullPage : fullPage.slice(0, 5) };
      }],
    ]);
    const client = createIbkrClient('https://localhost:5000', transport);
    const positions = await client.getPositions('U1');
    assert.strictEqual(positions.length, 35);
    assert.strictEqual(transport.calls.length, 2);
  });

  await testAsync('syncPortfolio fetches FX rates for foreign currencies via injected getFxRate', async () => {
    const routes = [
      ['/iserver/auth/status', { status: 200, json: { authenticated: true, connected: true } }],
      ['/portfolio/accounts', { status: 200, json: [{ accountId: 'U1', currency: 'USD' }] }],
      ['/portfolio/U1/positions/', { status: 200, json: [
        { conid: 1, ticker: 'IUSC', contractDesc: 'IUSC', position: 50, mktValue: 5493, avgCost: 110, currency: 'CHF', assetClass: 'STK' },
      ] }],
      ['/portfolio/U1/ledger', { status: 200, json: { BASE: { settledcash: 0 } } }],
    ];
    const client = createIbkrClient('https://localhost:5000', mockTransport(routes));
    const fxCalls = [];
    const r = await client.syncPortfolio({ getFxRate: async (ccy, base) => { fxCalls.push(`${ccy}${base}`); return 1.2; } });
    assert.deepStrictEqual(fxCalls, ['CHFUSD']);
    approx(r.holdings[0].marketValue, 5493 * 1.2);
  });

  // ─── Summary ───────────────────────────────────────────────────────────────
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
})();
