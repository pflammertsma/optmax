'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    console.log(`  ✓  ${name}`);
    passed++;
  } catch (err) {
    console.error(`  ✗  ${name}`);
    console.error(`     ${err.stack || err.message}`);
    failed++;
  }
}

function section(name) {
  console.log(`\n${name}`);
}

// ── Lightweight Mock DOM Environment ──────────────────────────────────────────
class MockElement {
  constructor(tagName = 'div', id = '') {
    this.tagName = tagName.toUpperCase();
    this.id = id;
    this.className = '';
    this.style = {};
    this.dataset = {};
    this._innerHTML = '';
    this._textContent = '';
    this.value = '';
    this.disabled = false;
    this.children = [];
    this.parentElement = null;
    this.listeners = {};
    this._attributes = {};

    const self = this;
    this.classList = {
      _classes: new Set(),
      add(...cls) { cls.forEach(c => self.classList._classes.add(c)); self.className = Array.from(self.classList._classes).join(' '); },
      remove(...cls) { cls.forEach(c => self.classList._classes.delete(c)); self.className = Array.from(self.classList._classes).join(' '); },
      toggle(cls, force) {
        if (force === true) self.classList.add(cls);
        else if (force === false) self.classList.remove(cls);
        else if (self.classList.contains(cls)) self.classList.remove(cls);
        else self.classList.add(cls);
      },
      contains(cls) { return self.classList._classes.has(cls); }
    };
  }

  get innerHTML() { return this._innerHTML; }
  set innerHTML(val) {
    this._innerHTML = String(val);
    this.children = [];
    // Simple parser for data-col, data-subview, data-bucket, data-view, data-nav, class, id in innerHTML
    const matches = String(val).matchAll(/<([a-z0-9]+)([^>]*)>/gi);
    for (const match of matches) {
      const child = new MockElement(match[1]);
      child.parentElement = this;
      const attrs = match[2].matchAll(/([a-z0-9-]+)=(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi);
      for (const attr of attrs) {
        const key = attr[1].toLowerCase();
        const value = attr[2] ?? attr[3] ?? attr[4] ?? '';
        if (key === 'id') child.id = value;
        else if (key === 'class') child.classList.add(...value.split(/\s+/).filter(Boolean));
        else if (key.startsWith('data-')) {
          const prop = key.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
          child.dataset[prop] = value;
        } else {
          child._attributes[key] = value;
        }
      }
      this.children.push(child);
    }
  }

  get textContent() { return this._textContent || this._innerHTML.replace(/<[^>]*>/g, ''); }
  set textContent(val) { this._textContent = String(val); this._innerHTML = String(val); }

  setAttribute(k, v) { this._attributes[k] = String(v); }
  getAttribute(k) { return this._attributes[k] || null; }
  removeAttribute(k) { delete this._attributes[k]; }

  addEventListener(event, fn) {
    if (!this.listeners[event]) this.listeners[event] = [];
    this.listeners[event].push(fn);
  }

  click() {
    (this.listeners['click'] || []).forEach(fn => fn({ target: this, preventDefault: () => {} }));
  }

  trigger(event, eventObj = {}) {
    (this.listeners[event] || []).forEach(fn => fn({ target: this, ...eventObj }));
  }

  closest(selector) {
    let curr = this;
    while (curr) {
      if (selector.startsWith('.') && curr.classList.contains(selector.slice(1))) return curr;
      if (selector.startsWith('#') && curr.id === selector.slice(1)) return curr;
      if (curr.tagName === selector.toUpperCase()) return curr;
      curr = curr.parentElement;
    }
    return null;
  }

  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null;
  }

  querySelectorAll(selector) {
    const results = [];
    const check = (el) => {
      let match = false;
      if (selector.startsWith('.')) {
        const cls = selector.slice(1);
        match = el.classList.contains(cls);
      } else if (selector.startsWith('#')) {
        match = el.id === selector.slice(1);
      } else if (selector.includes('[data-')) {
        const m = selector.match(/\[data-([a-z0-9-]+)(?:=(?:"([^"]*)"|'([^']*)'|([^\s>\]]+)))?\]/i);
        if (m) {
          const prop = m[1].replace(/-([a-z])/g, (_, c) => c.toUpperCase());
          const val = m[2] ?? m[3] ?? m[4];
          match = val !== undefined ? el.dataset[prop] === val : el.dataset[prop] !== undefined;
        }
      } else if (/^[a-z0-9]+$/i.test(selector)) {
        match = el.tagName === selector.toUpperCase();
      }
      if (match) results.push(el);
      el.children.forEach(check);
    };
    this.children.forEach(check);
    return results;
  }
}

function createDOM() {
  const elements = new Map();
  const getOrCreate = (id) => {
    if (!elements.has(id)) {
      elements.set(id, new MockElement('div', id));
    }
    return elements.get(id);
  };

  // Pre-seed known app element IDs from index.html
  const knownIds = [
    'view-dashboard', 'view-portfolio', 'view-targets', 'view-guidance',
    'view-health', 'view-progress', 'view-screener', 'view-investment-scanner',
    'view-options-scanner', 'view-settings', 'view-help', 'dashboard-vitals', 'dashboard-vitals-card',
    'dashboard-actionable-steps-wrap', 'dashboard-actionable-steps-list',
    'dashboard-action-plan-card', 'dashboard-action-plan-list', 'dashboard-ap-count',
    'metric-cards', 'preview-starred', 'dashboard-income-chips', 'dashboard-income-strip',
    'pf-holdings-table', 'pf-holdings-tbody', 'pf-empty-state', 'pf-content',
    'pf-source-badge', 'pf-total-value', 'pf-cash', 'pf-cash-label', 'pf-employer-pct',
    'pf-largest', 'pf-drift-count', 'pf-drift-tbody', 'pf-targets-fields', 'pf-tolerance-input',
    'pf-recommendation-box', 'pf-rec-age-label', 'pf-rec-core', 'pf-rec-sat', 'pf-rec-cash',
    'pf-apply-rec-btn', 'pf-autobucket-btn', 'pf-import-btn', 'pf-prices-btn', 'pf-ibkr-sync-btn',
    'pf-lookup-input', 'pf-lookup-btn', 'pf-lookup-result', 'pf-guidance-list',
    'badge-count-all', 'badge-count-tax', 'badge-count-rebalance', 'badge-count-options',
    'pf-health-card', 'pf-health-empty-state', 'pf-health-grade', 'pf-health-badge',
    'pf-health-caption', 'pf-health-breakdown', 'pf-dividends', 'nav-health-badge',
    'progress-kpis', 'progress-empty-state', 'progress-content', 'progress-footnote',
    'progress-import-btn', 'progress-conc-chart', 'progress-health-chart', 'progress-value-chart',
    'inv-scan-root', 'inv-scan-refresh', 'help-overlay', 'help-nav', 'help-close',
    'status-bar-btn', 'status-detail-overlay', 'status-detail-close', 'status-detail-body',
    'status-detail-retry', 'status-detail-stopgw', 'status-detail-action-note',
    'status-detail-subtitle', 'wc-privacy', 'status-dot', 'status-text',
    'tbody-top25', 'tbody-under10k', 'tbody-megacaps', 'table-top25', 'table-under10k', 'table-megacaps',
    'empty-state', 'dashboard-stats-subtitle', 'screener-tbody', 'screener-total-count',
    'ibkr-gateway-settings', 'ibkr-flex-settings', 'ibkr-mode-desc',
    // Symbol details dialog — needed so its close/tab listeners actually bind.
    'modal-overlay', 'modal-close', 'modal-live', 'modal-details-body',
    'modal-tab-recommendation', 'modal-tab-compliance', 'modal-tab-options',
    'modal-content-recommendation', 'modal-content-compliance', 'modal-content-options',
    'si-recommendation', 'si-goal-scores', 'si-essentials', 'si-compliance',
    'modal-options-wrap', 'modal-sidebar-no-options',
    // Long-Term Portfolio Settings inputs — needed so their change handlers bind.
    'settings-glidepath-base', 'settings-cash-drag-threshold', 'settings-birth-year',
    'settings-conc-limit',
  ];

  knownIds.forEach(id => getOrCreate(id));

  const body = new MockElement('body');
  knownIds.forEach(id => body.children.push(elements.get(id)));

  const doc = {
    body,
    getElementById(id) { return elements.get(id) || null; },
    querySelector(sel) {
      if (sel.startsWith('#')) return elements.get(sel.slice(1)) || null;
      return body.querySelector(sel);
    },
    querySelectorAll(sel) {
      return body.querySelectorAll(sel);
    },
    createElement(tag) { return new MockElement(tag); },
    addEventListener() {}
  };

  return { doc, elements };
}

// Setup VM Context
const { doc, elements } = createDOM();

const mockElectronAPIBase = {
  getSettings: async () => ({ ibkrConnectMode: 'gateway', taxProfile: { birthYear: '1988' } }),
  getWatchlists: async () => ['VTI', 'VXUS'],
  getStarred: async () => ['AAPL'],
  getPortfolio: async () => ({
    holdings: [
      { symbol: 'VTI', marketValue: 50000, costBasis: 40000, bucket: 'core' },
      { symbol: 'AAPL', marketValue: 30000, costBasis: 20000, bucket: 'satellite' },
    ],
    cash: 20000,
    targets: [{ bucket: 'core', targetPct: 60 }, { bucket: 'satellite', targetPct: 30 }, { bucket: 'cash', targetPct: 10 }],
    tolerancePct: 5,
    derived: {
      totalValue: 100000,
      concentration: { pct: 30 },
      topPositions: [{ symbol: 'VTI', weightPct: 50 }],
      drift: [
        { bucket: 'core', targetPct: 60, actualPct: 50, driftPct: -10, deltaUsd: 10000, action: 'buy' },
        { bucket: 'satellite', targetPct: 30, actualPct: 30, driftPct: 0, deltaUsd: 0, action: 'hold' },
        { bucket: 'cash', targetPct: 10, actualPct: 20, driftPct: 10, deltaUsd: -10000, action: 'sell' },
      ]
    }
  }),
  getPortfolioHealth: async () => ({
    health: {
      grade: 'A',
      totalScore: 92,
      gradeLabel: 'Excellent portfolio hygiene',
      caps: [],
      breakdown: [
        { label: 'Diversification', score: 20, max: 20, detail: 'Well diversified', action: 'Keep it up' },
        { label: 'Tax Hygiene', score: 15, max: 15, detail: 'No PFIC funds', action: 'US funds only' }
      ]
    },
    dividends: { annual: 1500 }
  }),
  getProfileHistory: async () => ({
    history: [
      { date: '2026-01-01', totalValue: 90000, employerPctDirect: 35, healthScore: 80, pficValue: 0 },
      { date: '2026-06-01', totalValue: 100000, employerPctDirect: 30, healthScore: 92, pficValue: 0 }
    ]
  }),
  scanInvestments: async () => ({
    categories: {
      etf: [{ symbol: 'VTI', buyHoldGrade: 'A', buyHoldScore: 95, yieldPct: 1.5, taxDragPct: 0.2, suggestedUsd: 5000 }],
      bond: [{ symbol: 'BND', buyHoldGrade: 'B', buyHoldScore: 85, yieldPct: 4.0, taxDragPct: 1.0, suggestedUsd: 2000 }],
      stock: [{ symbol: 'AAPL', buyHoldGrade: 'A', buyHoldScore: 90, yieldPct: 0.5, taxDragPct: 0.1, suggestedUsd: 0 }],
      dividend: [{ symbol: 'SCHD', dividendGrade: 'A', dividendScore: 92, yieldPct: 3.5, taxDragPct: 0.5 }]
    }
  }),
  getActionPlan: async () => ({
    actions: [
      { kind: 'sell', title: 'Trim GOOG', detail: 'Quarterly tranche', urgent: true, amountUsd: 5000, nav: 'portfolio' },
      { kind: 'buy', title: 'Buy VTI', detail: 'Deploy cash', urgent: false, amountUsd: 5000, nav: 'guidance' }
    ],
    moreCount: 1
  }),
  savePortfolio: async (update) => ({ holdings: [], cash: 20000, targets: [], tolerancePct: 5, derived: { totalValue: 100000, concentration: { pct: 0 }, topPositions: [], drift: [] }, ...update }),
  saveSellDownPlan: async () => ({ success: true }),
  clearSellDownPlan: async () => ({ success: true }),
  ibkrStatus: async () => ({ state: 'connected', reason: null }),
  ibkrGatewayStop: async () => ({ stopped: 1 }),
  getEmployerExposure: async () => ({ totalPct: 30, directPct: 30, impliedPct: 0, impliedUsd: 0, perFund: [] }),
  getPortfolioGuidance: async () => [],
  analyzeTicker: async () => ({ symbol: 'VTI', suitability: 'good', type: 'etf', domicile: 'US', isPfic: false, weightPct: 50, reason: 'Core broad ETF', details: 'Low tax drag' }),
  loadInitialData: async () => ({ data: [{ symbol: 'VTI', currentPrice: 220, strike: 210, dte: 30, monthlyYield: 0.015, annualizedYield: 0.18, _score: { totalScore: 85, grade: 'A' } }] }),
  saveSettings: async () => ({ success: true }),
  refreshPrices: async () => ({ success: true })
};

const mockElectronAPI = new Proxy(mockElectronAPIBase, {
  get(target, prop) {
    if (prop in target) return target[prop];
    if (typeof prop === 'string' && prop.startsWith('on')) return () => {};
    return async () => ({});
  }
});

const mockLocalStorage = {
  _store: {},
  getItem(k) { return this._store[k] || null; },
  setItem(k, v) { this._store[k] = String(v); }
};

const mockGetComputedStyle = () => ({ getPropertyValue: () => '#888' });

const sandbox = {
  console,
  document: doc,
  fetch: async () => ({ text: async () => '<svg></svg>' }),
  localStorage: mockLocalStorage,
  getComputedStyle: mockGetComputedStyle,
  window: {
    electronAPI: mockElectronAPI,
    Scanner: { create: (root, config) => ({ root, config }) },
    Chart: function MockChart() {},
    localStorage: mockLocalStorage,
    getComputedStyle: mockGetComputedStyle
  },
  setTimeout,
  clearTimeout,
  setInterval,
  clearInterval,
  parseFloat,
  parseInt,
  Math,
  Date,
  Array,
  Object,
  Set,
  Map,
  Number,
  String
};

vm.createContext(sandbox);

// Load source files in order
const srcFiles = [
  'constants.js',
  'utils.js',
  'state.js',
  'ibkr_connection.js',
  'modal.js',
  'portfolio_view.js',
  'screener_view.js',
  'settings_view.js',
  'dashboard_view.js',
  'app.js'
];

srcFiles.forEach(file => {
  const code = fs.readFileSync(path.join(__dirname, '../src', file), 'utf8');
  vm.runInContext(code, sandbox, { filename: file });
});

// Helper getter in sandbox context
const getEl = id => elements.get(id);

// ─── TESTS ───────────────────────────────────────────────────────────────────

section('Dashboard View Unit Tests');

test('renderDashboardVitals populates total, stock, cash, and position metrics', () => {
  sandbox.renderDashboardVitals({ totalValue: 100000, cash: 20000, holdings: [{}, {}], employerPct: 30 });
  const container = getEl('dashboard-vitals');
  assert.strictEqual(container.style.display, '');
  assert.ok(container.innerHTML.includes('100,000'));
  assert.ok(container.innerHTML.includes('80,000'));
  assert.ok(container.innerHTML.includes('20,000'));
  assert.ok(container.innerHTML.includes('30.0%'));
});

test('renderDashboardActionPlan renders prioritized to-do steps', async () => {
  await sandbox.renderDashboardActionPlan(['VTI'], true);
  const wrap = getEl('dashboard-actionable-steps-wrap');
  const list = getEl('dashboard-actionable-steps-list');
  assert.strictEqual(wrap.classList.contains('hidden'), false);
  assert.ok(list.innerHTML.includes('Trim GOOG'));
  assert.ok(list.innerHTML.includes('Buy VTI'));
  assert.ok(list.innerHTML.includes('+ 1 more on the Guidance page'));
});

test('renderDashboardIncomeStrip renders top options income chips', () => {
  const mockData = [{ symbol: 'VTI', currentPrice: 220, monthlyYield: 2.0, _score: { grade: 'A' } }];
  sandbox.renderDashboardIncomeStrip(mockData);
  const container = getEl('dashboard-income-chips');
  assert.ok(container.innerHTML.includes('VTI'));
  assert.ok(container.innerHTML.includes('2.00%/mo'));
});

section('Portfolio & Targets View Unit Tests');

test('renderPortfolio renders holdings table, totals, P&L, and drift table', async () => {
  const p = await mockElectronAPI.getPortfolio();
  sandbox.renderPortfolio(p);
  await new Promise(r => setTimeout(r, 20));

  const tbody = getEl('pf-holdings-tbody');
  assert.ok(tbody.innerHTML.includes('VTI'));
  assert.ok(tbody.innerHTML.includes('AAPL'));

  const driftTbody = getEl('pf-drift-tbody');
  assert.ok(driftTbody.innerHTML.includes('core'));
  assert.ok(driftTbody.innerHTML.includes('60%'));
  assert.ok(driftTbody.innerHTML.includes('50.0%'));
  assert.ok(driftTbody.innerHTML.includes('-10.0%'));
  assert.ok(driftTbody.innerHTML.includes('Buy'));
  assert.ok(driftTbody.innerHTML.includes('10,000'));

  const driftCount = getEl('pf-drift-count');
  assert.strictEqual(driftCount.textContent, '2');
});

test('Age-Indexed Recommendation box calculates target allocation based on birth year', async () => {
  const p = await mockElectronAPI.getPortfolio();
  sandbox.renderPortfolio(p);
  // Wait for internal async age calc block
  await new Promise(r => setTimeout(r, 20));

  const recBox = getEl('pf-recommendation-box');
  assert.strictEqual(recBox.style.display, 'flex');
  const coreEl = getEl('pf-rec-core');
  assert.ok(parseInt(coreEl.textContent, 10) > 0);
});

section('Portfolio Health View Unit Tests');

test('loadPortfolioHealth populates health grade, score breakdown bars, and unhides card', async () => {
  await sandbox.loadPortfolioHealth(true);
  const card = getEl('pf-health-card');
  assert.strictEqual(card.style.display, '');
  await new Promise(r => setTimeout(r, 20));

  const caption = getEl('pf-health-caption');
  assert.ok(caption.textContent.includes('92/100'));

  const breakdown = getEl('pf-health-breakdown');
  assert.ok(breakdown.innerHTML.includes('Diversification'));
  assert.ok(breakdown.innerHTML.includes('Tax Hygiene'));
  assert.ok(breakdown.innerHTML.includes('Keep it up'));
});

section('Progress Trajectory View Unit Tests');

test('renderProgressView unhides content, calculates KPIs, and generates date labels', async () => {
  await sandbox.renderProgressView();

  const emptyEl = getEl('progress-empty-state');
  const contentEl = getEl('progress-content');
  assert.strictEqual(emptyEl.style.display, 'none');
  assert.strictEqual(contentEl.style.display, '');

  const kpis = getEl('progress-kpis');
  assert.ok(kpis.innerHTML.includes('Employer concentration'));
  assert.ok(kpis.innerHTML.includes('Health score'));
  assert.ok(kpis.innerHTML.includes('100,000'));
});

section('Opportunities (Investment Scanner) Unit Tests');

test('renderInvestmentScanner configures category tabs and column definitions', async () => {
  await sandbox.renderInvestmentScanner();

  assert.ok(sandbox.window.investmentScanner != null);
  const cfg = sandbox.window.investmentScanner.config;
  // Recommendation leads — it holds the actionable buys.
  assert.strictEqual(cfg.tabs.length, 5);
  assert.strictEqual(cfg.tabs[0].id, 'recommendation');
  assert.strictEqual(cfg.tabs[1].id, 'etf');
  assert.strictEqual(cfg.tabs[2].id, 'bond');
  assert.strictEqual(cfg.tabs[3].id, 'stock');
  assert.strictEqual(cfg.tabs[4].id, 'dividend');
});

section('Help & Status Modals Unit Tests');

test('openHelp navigates to the help view', () => {
  const viewHelp = getEl('view-help');
  viewHelp.classList.remove('active');

  sandbox.openHelp();
  assert.strictEqual(viewHelp.classList.contains('active'), true);
});

test('setIbkrModeUI updates connection mode and displays gateway vs flex settings', () => {
  const gw = getEl('ibkr-gateway-settings');
  const fx = getEl('ibkr-flex-settings');

  sandbox.setIbkrModeUI('flex');
  assert.strictEqual(gw.style.display, 'none');
  assert.strictEqual(fx.style.display, '');

  sandbox.setIbkrModeUI('gateway');
  assert.strictEqual(gw.style.display, '');
  assert.strictEqual(fx.style.display, 'none');
});

section('Regression Tests for Visual & Boot Fixes');

test('loadInitialData updates status indicator from loading cache to live', async () => {
  vm.runInContext('ibkrState = "connected";', sandbox);
  await sandbox.loadInitialData();
  const statusText = getEl('status-text');
  assert.strictEqual(statusText.textContent, 'Live');
});

test('age-indexed target box follows the glidepath base, not a hardcoded 110', () => {
  // birthYear lives at the TOP LEVEL of settings, not under taxProfile (which
  // was the read path, and is undefined). And the core % must track the
  // configured glidepath base — it was pinned to 110 regardless of the setting.
  const birthYear = 1984;
  const age = new Date().getFullYear() - birthYear;   // derived, so the test survives the calendar
  const clamp = c => Math.min(95, Math.max(20, c));
  const at110 = sandbox.ageIndexedTargets({ birthYear, glidepathBase: 110 });
  const at140 = sandbox.ageIndexedTargets({ birthYear, glidepathBase: 140 });
  assert.ok(at110, 'top-level birthYear must be recognised');
  assert.strictEqual(at110.coreRec, clamp(110 - age), 'base 110 must drive the core %');
  assert.strictEqual(at140.coreRec, clamp(140 - age), 'base 140 must drive the core %');
  assert.notStrictEqual(at110.coreRec, at140.coreRec, 'core % must move with the glidepath base');
  assert.strictEqual(at110.coreRec + at110.satRec, 95); // 5% reserved for cash
});

test('age-indexed target box hides when no birth year is known', () => {
  assert.strictEqual(sandbox.ageIndexedTargets({ glidepathBase: 110 }), null);
  assert.strictEqual(sandbox.ageIndexedTargets({}), null);
});

test('renderPortfolio triggers loadPortfolioHealth to display Health Grade in portfolio header', async () => {
  const p = await mockElectronAPI.getPortfolio();
  sandbox.renderPortfolio(p);
  await new Promise(r => setTimeout(r, 20));

  const pfGrade = getEl('pf-health-grade');
  assert.ok(pfGrade.innerHTML.includes('92/100'));
});

test('privacy button renders eye SVG icon on startup without needing to be clicked', () => {
  sandbox.updatePrivacyMode();
  const privacyBtn = getEl('wc-privacy');
  assert.ok(privacyBtn.innerHTML.includes('<svg'));
});

// Async tests are queued here and run SEQUENTIALLY at the end. The plain
// `test()` helper is fire-and-forget, and every async test below mutates state
// the others read — window.Scanner, window.electronAPI.ibkrFlexSync,
// ibkrConnectMode. Run concurrently they clobber each other: a later test's
// mock reassignment lands before an earlier test's await resolves, so the
// earlier one never sees its own stub called.
const pendingAsync = [];
function testAsync(name, fn) { pendingAsync.push({ name, fn }); }
async function runAsyncTests() {
  for (const { name, fn } of pendingAsync) {
    try { await fn(); console.log(`  ✓  ${name}`); passed++; }
    catch (err) { console.error(`  ✗  ${name}`); console.error(`     ${err.stack || err.message}`); failed++; }
  }
}

testAsync('Sync IBKR button triggers sync handler when clicked', async () => {
  let synced = false;
  sandbox.window.electronAPI.ibkrFlexSync = async () => {
    synced = true;
    return { success: true, portfolio: { holdings: [], derived: { totalValue: 0, concentration: { pct: 0 }, topPositions: [], drift: [] } } };
  };
  sandbox.setIbkrModeUI('flex');

  const btn = getEl('pf-ibkr-sync-btn');
  btn.click();
  await new Promise(r => setTimeout(r, 20));
  assert.strictEqual(synced, true);
});

testAsync('renderStatusDetail renders Recent Flex requests log entries in flex mode', async () => {
  sandbox.window.electronAPI.ibkrHasFlex = async () => ({ hasToken: true, queryId: '1581403' });
  sandbox.window.electronAPI.ibkrFlexLog = async () => ({
    entries: [
      { ts: Date.now(), kind: 'sync', step: 'SendRequest', outcome: 'error', errorCode: 1025, lockout: true }
    ]
  });
  sandbox.setIbkrModeUI('flex');
  await sandbox.renderStatusDetail();

  const body = getEl('status-detail-body');
  assert.ok(body.innerHTML.includes('Recent Flex requests'));
  assert.ok(body.innerHTML.includes('error 1025 (lockout)'));
});

testAsync('Status dialog Sync now button triggers Flex sync when clicked in flex mode', async () => {
  let syncCalled = false;
  sandbox.window.electronAPI.ibkrFlexSync = async () => {
    syncCalled = true;
    return { success: true, portfolio: { holdings: [], derived: { totalValue: 0, concentration: { pct: 0 }, topPositions: [], drift: [] } } };
  };
  sandbox.setIbkrModeUI('flex');

  const retryBtn = getEl('status-detail-retry');
  assert.strictEqual(retryBtn.textContent, 'Sync now');

  retryBtn.click();
  await new Promise(r => setTimeout(r, 20));
  assert.strictEqual(syncCalled, true);
});

// ─────────────────────────────────────────────────────────────────────────────
// Regression guards for wiring lost during the app.js modularization. Each of
// these shipped broken once: the dialog could not be closed, its tabs did not
// respond, the Opportunities "Recommendation" tab vanished, and rows for symbols
// with no option-scanner data silently did nothing when clicked.
// ─────────────────────────────────────────────────────────────────────────────
section('Regression Guards — modular wiring');

test('symbol dialog close button + overlay are wired', () => {
  const closeBtn = getEl('modal-close');
  assert.ok(closeBtn, 'modal-close element missing');
  assert.ok((closeBtn.listeners['click'] || []).length > 0,
    'modal-close has no click listener — the dialog would be unclosable');

  const overlay = getEl('modal-overlay');
  assert.ok((overlay.listeners['click'] || []).length > 0,
    'modal-overlay has no click listener — click-outside-to-close is broken');
});

test('all three symbol dialog tabs are wired and switch content', () => {
  ['recommendation', 'compliance', 'options'].forEach(tab => {
    const btn = getEl(`modal-tab-${tab}`);
    assert.ok(btn, `modal-tab-${tab} element missing`);
    assert.ok((btn.listeners['click'] || []).length > 0,
      `modal-tab-${tab} has no click listener — that tab would be unclickable`);
  });

  // Clicking a tab must actually reveal its panel and hide the others.
  getEl('modal-tab-compliance').click();
  assert.strictEqual(getEl('modal-content-compliance').style.display, 'block');
  assert.strictEqual(getEl('modal-content-recommendation').style.display, 'none');
  assert.strictEqual(getEl('modal-content-options').style.display, 'none');

  getEl('modal-tab-options').click();
  assert.strictEqual(getEl('modal-content-options').style.display, 'block');
  assert.strictEqual(getEl('modal-content-compliance').style.display, 'none');

  getEl('modal-tab-recommendation').click();
  assert.strictEqual(getEl('modal-content-recommendation').style.display, 'block');
});

test('closing the dialog hides the overlay', () => {
  const overlay = getEl('modal-overlay');
  overlay.classList.remove('hidden');
  getEl('modal-close').click();
  assert.ok(overlay.classList.contains('hidden'), 'close button did not hide the dialog');
});

// Render the scanner once and hand back the config the shared renderer got.
// The mock + state reset are injected via runInContext because the view's
// `let` bindings live in the sandbox's lexical scope, not on the global object.
async function captureScannerConfig() {
  let captured = null;
  sandbox.window.Scanner = { create: (root, config) => { captured = config; return { root, config }; } };
  const coreVerdict = {
    breadth: 'broad',
    role: { key: 'core', label: 'Core', blurb: 'Portfolio bedrock.' },
    rating: { key: 'strong', label: 'Strong buy-and-hold', tone: 'good' },
    headline: 'Broad, cheap and tax-clean for you — the kind of fund to buy and forget.',
    breadthLabel: 'Whole market',
    strengths: ['Whole market in one fund', 'US-domiciled — no PFIC exposure', 'Very low fee (0.03%)'],
    hold: { minYears: 7, label: '7+ yrs', rationale: 'Broad equity needs a full business cycle.' },
    watch: [],
  };
  const sectorVerdict = {
    breadth: 'sector',
    role: { key: 'satellite', label: 'Satellite', blurb: 'A side bet around the core.' },
    rating: { key: 'careful', label: 'Only with care', tone: 'warn' },
    headline: 'Usable, but the 0.60% fee is a permanent drag.',
    breadthLabel: 'One sector',
    strengths: ['One sector', 'US-domiciled — no PFIC exposure'],
    hold: { minYears: 5, label: '5+ yrs', rationale: 'One sector can lag the market for years.' },
    watch: ['0.60%/yr fund fee — about $60 a year on every $10,000', 'One sector only'],
  };
  const cheapCost = { expenseRatioPct: 0.03, taxDragPct: 0.32, totalPct: 0.35, annualCostPer10kUsd: 35,
    minOrderUsd: 700, trade: { roundTripUsd: 0.7, roundTripPct: 0.001 }, daysToCoverTradeCost: 0.05,
    holdNote: 'Commission is negligible here — no minimum hold period for cost reasons.',
    holdLevel: 'ok', dominantCost: 'holding' };
  const dearCost = { ...cheapCost, expenseRatioPct: 0.60, totalPct: 0.92, annualCostPer10kUsd: 92 };

  const payload = {
    categories: {
      recommendation: [{ symbol: 'BNDX', suggestedUsd: 75000, estFeeUsd: 2.63, buyHoldGrade: 'A', buyHoldScore: 90,
        reasons: [], bucket: 'core', bucketNeedUsd: 396616, verdict: coreVerdict, cost: cheapCost }],
      etf: [
        { symbol: 'VTI', buyHoldGrade: 'A', buyHoldScore: 100, yieldPct: 1.05, taxDragPct: 0.32, expenseRatioPct: 0.03,
          reasons: [], bucket: 'core', bucketNeedUsd: 396616, verdict: coreVerdict, cost: cheapCost },
        { symbol: 'NLR', buyHoldGrade: 'B', buyHoldScore: 77, yieldPct: 1.2, taxDragPct: 0.36, expenseRatioPct: 0.60,
          reasons: [], bucket: 'satellite', bucketNeedUsd: 396616, verdict: sectorVerdict, cost: dearCost },
      ],
      bond: [], stock: [], dividend: [],
    },
    deployableCash: 75000, bondsFirst: false, glidepathNote: null,
  };
  vm.runInContext(`window.electronAPI.scanInvestments = async () => (${JSON.stringify(payload)});`, sandbox);

  // An earlier fire-and-forget test can leave a render in flight; let it settle
  // and discard its capture so we measure only our own render.
  await new Promise(r => setTimeout(r, 0));
  captured = null;
  vm.runInContext('investmentScanner = null; investmentScanLoading = false;', sandbox);

  await sandbox.renderInvestmentScanner();
  if (!captured) throw new Error('Scanner.create was never called');
  return captured;
}

testAsync('Opportunities scanner exposes all five tabs, Recommendation first', async () => {
  const cfg = await captureScannerConfig();
  // Joined rather than deepStrictEqual: arrays built inside the vm sandbox have
  // a different Array prototype and would fail a strict deep comparison.
  const ids = cfg.tabs.map(t => t.id).join(',');
  assert.strictEqual(ids, 'recommendation,etf,bond,stock,dividend', `unexpected tab set: ${ids}`);
  assert.strictEqual(cfg.tabs[0].label, 'Recommendation');
  assert.strictEqual(cfg.tabs[0].badge, 1);
});

testAsync('Recommendation tab renders an actionable Buy amount + estimated fee', async () => {
  const cfg = await captureScannerConfig();
  const cols = cfg.columns('recommendation');
  assert.ok(cols.some(c => c.key === 'action'), 'Recommendation tab is missing its Action column');

  const html = cols.find(c => c.key === 'action')
    .render({ symbol: 'BNDX', suggestedUsd: 75000, estFeeUsd: 2.63 });
  assert.ok(/Buy/.test(html), 'Action cell does not show a Buy amount');
  assert.ok(/Est\. fee/.test(html), 'Action cell does not show the estimated IBKR fee');

  // The sizing hint moved into the Recommendation tab — it must not linger on
  // the hold-oriented tabs.
  assert.ok(!cfg.columns('etf').some(c => c.key === 'suggestedUsd'),
    'stale "Suggested" column is still on the ETF tab');
});

// The scanner used to show five near-identical numeric columns, which answered
// neither question a buyer has. These guard the two that do.
testAsync('every tab leads with a plain-language verdict, not just numbers', async () => {
  const cfg = await captureScannerConfig();
  for (const tab of ['recommendation', 'etf', 'dividend']) {
    const col = cfg.columns(tab).find(c => c.key === 'verdict');
    assert.ok(col, `"${tab}" tab is missing the verdict column`);
    const html = col.render(cfg.getRows('etf')[0]);
    assert.ok(/Core/.test(html), `verdict cell on "${tab}" does not name the role`);
    assert.ok(/Broad, cheap and tax-clean/.test(html), `verdict cell on "${tab}" does not show the headline`);
  }
});

testAsync('the quality grade explains what earned it', async () => {
  const cfg = await captureScannerConfig();
  const col = cfg.columns('etf').find(c => c.key === 'buyHoldScore');
  const html = col.render(cfg.getRows('etf')[0]);
  // A column of identical "A 91" badges is what this replaced.
  assert.ok(/Whole market in one fund/.test(html), `quality cell gives no rationale: ${html}`);
  assert.ok(/Very low fee/.test(html) || /PFIC/.test(html), 'quality cell shows only one reason');
  // Falls back to a bare badge rather than breaking when there is no verdict.
  assert.doesNotThrow(() => col.render({ buyHoldGrade: 'A', buyHoldScore: 91 }));
});

testAsync('each row says how long to plan to hold it', async () => {
  const cfg = await captureScannerConfig();
  const col = cfg.columns('etf').find(c => c.key === 'verdict');
  const broad = col.render(cfg.getRows('etf')[0]);
  const sector = col.render(cfg.getRows('etf')[1]);
  assert.ok(/7\+ yrs/.test(broad), `broad fund missing its holding period: ${broad}`);
  assert.ok(/5\+ yrs/.test(sector), `sector fund missing its holding period: ${sector}`);
  // The reason stays reachable on hover rather than taking a column of prose.
  assert.ok(/full business cycle/.test(broad), 'the reason for the holding period is not available');
});

testAsync('the verdict cell stays compact — no repeated prose in the table', async () => {
  const cfg = await captureScannerConfig();
  const col = cfg.columns('etf').find(c => c.key === 'verdict');
  const html = col.render(cfg.getRows('etf')[0]);
  // The headline is identical on every broad ETF, so it must not be rendered as
  // visible text — tooltip only. Strip attributes, then check what is left.
  const visible = html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
  assert.ok(!/kind of fund to buy and forget/.test(visible),
    `repeated headline prose is being rendered as cell text: "${visible}"`);
  assert.ok(visible.length < 60, `verdict cell text is too long to scan: "${visible}"`);
  assert.ok(/Core/.test(visible) && /Whole market/.test(visible),
    `verdict cell lost its differentiating labels: "${visible}"`);
});

testAsync('cost to own is shown as a yearly percentage AND in dollars', async () => {
  const cfg = await captureScannerConfig();
  const col = cfg.columns('etf').find(c => c.key === 'costTotal');
  assert.ok(col, 'ETF tab is missing the cost-to-own column');

  const cheap = col.render(cfg.getRows('etf')[0]);
  assert.ok(/0\.35%\/yr/.test(cheap), `cost cell missing the annual percentage: ${cheap}`);
  assert.ok(/\$35\/yr per \$10k/.test(cheap), `cost cell missing the dollar figure: ${cheap}`);
  // The commission answer ("do I need to hold it a while?") lives in the tooltip.
  assert.ok(/\$700/.test(cheap), 'cost cell does not explain the minimum sensible order');

  // An expensive fund must read differently — that is the whole point.
  const dear = col.render(cfg.getRows('etf')[1]);
  assert.ok(/0\.92%\/yr/.test(dear), `expensive fund shows the wrong cost: ${dear}`);
  assert.notStrictEqual(cheap, dear);
});

testAsync('watch-outs list real caveats and stay silent when there are none', async () => {
  const cfg = await captureScannerConfig();
  const col = cfg.columns('etf').find(c => c.key === 'watch');
  assert.ok(col, 'ETF tab is missing the watch-out column');
  // Silent when there is nothing to say — a green "Nothing notable" repeated
  // down 30 rows is the same noise the caveats were meant to stand out from.
  assert.ok(/—/.test(col.render(cfg.getRows('etf')[0])));
  assert.ok(!/Nothing notable/.test(col.render(cfg.getRows('etf')[0])));
  assert.ok(/0\.60%\/yr fund fee/.test(col.render(cfg.getRows('etf')[1])));
});

testAsync('a fact shared by every row is stated once in the intro, not per row', async () => {
  const cfg = await captureScannerConfig();
  // The bucket-underweight figure was previously repeated verbatim down a "Why"
  // column on every single row, where it carried no information.
  const etfTab = cfg.tabs.find(t => t.id === 'etf');
  assert.ok(/396,616/.test(etfTab.intro), `intro does not carry the allocation gap: ${etfTab.intro}`);
  assert.ok(!cfg.columns('etf').some(c => c.key === 'why'),
    'the repetitive "Why" column is back on the ETF tab');
});

testAsync('the Refresh button forces a fresh discovery pass', async () => {
  let seenArg = null;
  vm.runInContext(
    'window.electronAPI.scanInvestments = async (arg) => { window.__scanArg = arg; return { categories: {} }; };',
    sandbox);
  vm.runInContext('investmentScanner = null; investmentScanLoading = false;', sandbox);
  await sandbox.renderInvestmentScanner(true);
  seenArg = sandbox.window.__scanArg;
  assert.ok(seenArg && !Array.isArray(seenArg), 'scanInvestments was called with the legacy array signature');
  assert.strictEqual(seenArg.force, true, 'Refresh did not request a forced discovery');
});

testAsync('Long-Term settings persist glidepath (incl. >130) and the cash-drag buffer', async () => {
  // Two real bugs: the glidepath handler silently rejected anything over 130
  // (so a typed 140 never saved), and the cash-drag field had no handler at all.
  const saved = [];
  vm.runInContext(
    'window.electronAPI.getSettings = async () => ({ glidepathBase: 110, cashDragThreshold: 5000 });',
    sandbox);
  sandbox.window.electronAPI.saveSettings = async (patch) => { saved.push(patch); return { success: true }; };

  await sandbox.initSettingsUI();

  const glide = getEl('settings-glidepath-base');
  const cash = getEl('settings-cash-drag-threshold');

  // A value the old handler rejected (>130) must now persist.
  glide.value = '140';
  glide.trigger('change');
  await new Promise(r => setTimeout(r, 0));
  assert.ok(saved.some(p => p.glidepathBase === 140), `140 was not saved: ${JSON.stringify(saved)}`);

  // Out of range is clamped and written back, never a silent no-op.
  glide.value = '200';
  glide.trigger('change');
  await new Promise(r => setTimeout(r, 0));
  assert.ok(saved.some(p => p.glidepathBase === 150), 'over-max should clamp to 150 and save');
  assert.strictEqual(String(glide.value), '150', 'field should reflect the clamped value');

  // The previously-unwired cash-drag buffer now saves.
  cash.value = '8000';
  cash.trigger('change');
  await new Promise(r => setTimeout(r, 0));
  assert.ok(saved.some(p => p.cashDragThreshold === 8000), `cash-drag was not saved: ${JSON.stringify(saved)}`);
});

testAsync('every scanner row opens the dialog, even without option-scanner data', async () => {
  const cfg = await captureScannerConfig();
  let openedWith = null;
  sandbox.openSymbolDetails = (arg, tab) => { openedWith = { arg, tab }; };

  // A symbol absent from the option-scanner dataset (the INTR case).
  sandbox.allData = [];
  cfg.onRowClick({ symbol: 'INTR' });
  assert.ok(openedWith, 'clicking a non-option-scanned row did nothing');
  assert.strictEqual(openedWith.arg, 'INTR', 'should fall back to opening by ticker');
  assert.strictEqual(openedWith.tab, 'recommendation', 'should land on the Recommendation tab');
});

test('renderTables populates Option Scanner tables with valid option metrics', () => {
  const mockData = [
    { symbol: 'AAPL', currentPrice: 180, strike: 175, dte: 30, premium: 3.5, capitalRequired: 17500, monthlyYield: 2.0, annualizedYield: 24, monthlyIncome: 350, marketCap: 2.8e12, _score: { totalScore: 82, grade: 'A' } },
    { symbol: 'F', currentPrice: 12, strike: 11, dte: 30, premium: 0.4, capitalRequired: 1100, monthlyYield: 3.6, annualizedYield: 43, monthlyIncome: 40, marketCap: 48e9, _score: { totalScore: 0, grade: 'F' } }
  ];

  sandbox.renderTables(mockData);

  const top25Rows = getEl('tbody-top25').querySelectorAll('tr');
  const under10kRows = getEl('tbody-under10k').querySelectorAll('tr');
  const megacapRows = getEl('tbody-megacaps').querySelectorAll('tr');

  assert.strictEqual(top25Rows.length, 2, 'Top 25 should render both option candidates');
  assert.strictEqual(under10kRows.length, 1, 'Under 10k should include candidate with capital <= $10,000 (F)');
  assert.strictEqual(megacapRows.length, 1, 'Mega caps should include candidate with marketCap >= 200B or mega cap symbol (AAPL)');
});

runAsyncTests().then(() => {
  console.log(`\nUI Views Test Suite Summary: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
});
