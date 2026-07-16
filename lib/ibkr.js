'use strict';

// IBKR Client Portal Web API client (Phase 2 — see docs/planning/ibkr-integration.md).
//
// Talks to the locally running Client Portal Gateway (a Java process the user
// starts and logs into via browser at e.g. https://localhost:5000). The gateway
// uses a self-signed certificate, so TLS verification is disabled for these
// requests only — the traffic never leaves localhost.
//
// Layering: pure mapping functions (unit-tested, no network) + a thin request
// layer (injectable for tests).

const https = require('https');
const { URL } = require('url');

const DEFAULT_GATEWAY_URL = 'https://localhost:5000';
const API_BASE = '/v1/api';
const REQUEST_TIMEOUT_MS = 10_000;
const POSITIONS_PAGE_SIZE = 30; // gateway returns up to 30–100/page depending on version; loop until a short page

// ── Transport ─────────────────────────────────────────────────────────────────

function gatewayRequest(baseUrl, method, apiPath) {
  return new Promise((resolve, reject) => {
    const url = new URL(API_BASE + apiPath, baseUrl || DEFAULT_GATEWAY_URL);
    const req = https.request(url, {
      method,
      rejectUnauthorized: false, // gateway's localhost self-signed cert
      headers: { 'Content-Type': 'application/json', 'User-Agent': 'PortMax' },
      timeout: REQUEST_TIMEOUT_MS,
    }, res => {
      let body = '';
      res.on('data', d => { body += d; });
      res.on('end', () => {
        let json = null;
        try { json = body ? JSON.parse(body) : null; } catch {}
        resolve({ status: res.statusCode, json, body });
      });
    });
    req.on('timeout', () => { req.destroy(new Error('Gateway request timed out')); });
    req.on('error', reject);
    req.end();
  });
}

// ── Pure mapping (no network) ─────────────────────────────────────────────────

// Client Portal position objects → the app's holding shape.
// fxRates: { CCY: rate-to-base }; positions in unknown currencies are imported
// unconverted with a warning, mirroring the Activity Statement parser.
function mapIbkrPositions(rawPositions, baseCurrency = 'USD', fxRates = {}) {
  const holdings = [];
  const errors = [];
  const base = (baseCurrency || 'USD').toUpperCase();

  for (const pos of rawPositions || []) {
    const qty = pos.position;
    if (qty == null || qty === 0) continue;

    const assetClass = (pos.assetClass || pos.secType || '').toUpperCase();
    if (assetClass === 'CASH' || assetClass === 'FUND.MONEY') continue; // cash comes from the ledger

    const symbol = (pos.ticker || String(pos.contractDesc || '').split(' ')[0] || '').toUpperCase().trim();
    if (!symbol) { errors.push(`Position conid ${pos.conid}: no symbol`); continue; }

    const currency = (pos.currency || base).toUpperCase();
    let fx = 1;
    if (currency !== base) {
      fx = fxRates[currency];
      if (fx == null) {
        errors.push(`No FX rate for ${currency} (${symbol}) — imported unconverted`);
        fx = 1;
      }
    }

    // avgCost is per share (already multiplier-adjusted for derivatives).
    const costBasis = pos.avgCost != null ? pos.avgCost * qty : null;

    holdings.push({
      symbol,
      quantity:      qty,
      marketValue:   pos.mktValue != null ? pos.mktValue * fx : 0,
      costBasis:     costBasis != null ? costBasis * fx : null,
      currency,
      assetCategory: assetClass === 'OPT' ? 'OPT' : (assetClass === 'BOND' ? 'Bond' : 'Stocks'),
      conid:         pos.conid ?? null,
    });
  }

  return { holdings, errors };
}

// Ledger → base-currency cash. The gateway keys the ledger by currency with a
// BASE entry holding base-currency totals.
function mapIbkrLedger(ledger) {
  const baseEntry = ledger?.BASE || ledger?.base;
  if (!baseEntry) return { cash: 0, found: false };
  const cash = baseEntry.settledcash ?? baseEntry.cashbalance ?? 0;
  return { cash, found: true };
}

// Auth status payload → a simple tri-state the UI can render.
function interpretAuthStatus(status, json) {
  if (status !== 200 || !json) return { state: 'unreachable', authenticated: false };
  if (json.authenticated) return { state: 'connected', authenticated: true, competing: !!json.competing };
  return { state: 'needs-login', authenticated: false };
}

// ── Gateway client ────────────────────────────────────────────────────────────

function createIbkrClient(baseUrl = DEFAULT_GATEWAY_URL, request = gatewayRequest) {
  const req = (method, apiPath) => request(baseUrl, method, apiPath);

  async function getStatus() {
    try {
      const { status, json } = await req('POST', '/iserver/auth/status');
      return interpretAuthStatus(status, json);
    } catch (err) {
      return { state: 'unreachable', authenticated: false, error: err.message };
    }
  }

  async function tickle() {
    try {
      const { status } = await req('POST', '/tickle');
      return status === 200;
    } catch {
      return false;
    }
  }

  // Must be called before other /portfolio endpoints (gateway requirement).
  async function getAccounts() {
    const { status, json } = await req('GET', '/portfolio/accounts');
    if (status !== 200 || !Array.isArray(json)) {
      throw new Error(`portfolio/accounts failed (HTTP ${status})`);
    }
    return json.map(a => ({
      accountId: a.accountId || a.id,
      currency: (a.currency || 'USD').toUpperCase(),
    }));
  }

  async function getPositions(accountId) {
    const all = [];
    for (let page = 0; page < 40; page++) {
      const { status, json } = await req('GET', `/portfolio/${accountId}/positions/${page}`);
      if (status !== 200 || !Array.isArray(json)) {
        throw new Error(`positions page ${page} failed (HTTP ${status})`);
      }
      all.push(...json);
      if (json.length < POSITIONS_PAGE_SIZE) break;
    }
    return all;
  }

  async function getLedger(accountId) {
    const { status, json } = await req('GET', `/portfolio/${accountId}/ledger`);
    if (status !== 200 || !json) throw new Error(`ledger failed (HTTP ${status})`);
    return json;
  }

  // Full sync: status → accounts → positions + ledger.
  // getFxRate(currency, base) is injected (main process uses Yahoo '=X' pairs)
  // so this module stays free of quote-provider knowledge.
  async function syncPortfolio({ accountId = null, getFxRate = null } = {}) {
    const auth = await getStatus();
    if (auth.state !== 'connected') {
      return { success: false, state: auth.state, error: auth.state === 'needs-login'
        ? 'Gateway is running but the session is not authenticated — log in via the browser.'
        : `Gateway unreachable at ${baseUrl}. Start the Client Portal Gateway first.` };
    }

    const accounts = await getAccounts();
    if (!accounts.length) return { success: false, state: 'connected', error: 'No accounts visible to this session' };
    const account = accountId ? accounts.find(a => a.accountId === accountId) : accounts[0];
    if (!account) return { success: false, state: 'connected', error: `Account ${accountId} not found` };

    const [rawPositions, ledger] = await Promise.all([
      getPositions(account.accountId),
      getLedger(account.accountId),
    ]);

    // Collect FX rates for any non-base currencies present
    const base = account.currency;
    const fxRates = {};
    if (getFxRate) {
      const foreign = [...new Set(
        rawPositions.map(p => (p.currency || base).toUpperCase()).filter(c => c !== base)
      )];
      for (const ccy of foreign) {
        try {
          const rate = await getFxRate(ccy, base);
          if (rate > 0) fxRates[ccy] = rate;
        } catch {}
      }
    }

    const { holdings, errors } = mapIbkrPositions(rawPositions, base, fxRates);
    const { cash } = mapIbkrLedger(ledger);

    return {
      success: true,
      state: 'connected',
      accountId: account.accountId,
      baseCurrency: base,
      holdings,
      cash,
      errors,
      accounts: accounts.map(a => a.accountId),
    };
  }

  return { getStatus, tickle, getAccounts, getPositions, getLedger, syncPortfolio, baseUrl };
}

module.exports = {
  createIbkrClient,
  mapIbkrPositions,
  mapIbkrLedger,
  interpretAuthStatus,
  DEFAULT_GATEWAY_URL,
};
