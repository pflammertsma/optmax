'use strict';

// ─── Application Global State ────────────────────────────────────────────────
let allData       = [];
let screenerData  = [];
let watchlist     = [];
let starredList   = [];
let scoringConfig = {
  gradeA: 50, gradeB: 40, gradeC: 30,
  blockEarnings: true, blockBidAsk: true, blockHighIV: true,
  deltaMin: 0.25, deltaMax: 0.35,
};

let currentModal = null;
let priceChart   = null;
let currentGuidanceFilter = 'all';
let currentGuidanceItems = [];

// Single-stock/employer concentration limit (%), mirrored from settings so
// render paths can colour/threshold without an extra IPC. Critical = 1.5×.
let concentrationLimit = 10;

// Inputs to the per-security lens scores (buy-hold / dividend / trading),
// mirrored from settings so applyScore can run without a DOM/IPC round-trip.
// usPerson drives the PFIC penalty; the tax rate drives after-tax dividend yield.
let lensUsPerson = true;
let lensDividendTaxRate = 30;

// Symbols just added to the watchlist whose options data is still being
// fetched — shown as placeholder rows in the screener so the ticker appears
// immediately instead of after the full watchlist re-scan completes.
const pendingSymbols = new Set();

const tableSortState = {};

let screenerFilters = {
  minScore:  0,
  minYield:  0,
  minPrice:  0,
  maxPrice:  Infinity,
  minMarketCap: 0,
  grade:     'all',
  cleanOnly: false,
  starredOnly: false,
};

let screenerSort = { col: 'score', dir: 'desc' };

let portfolio = null;
let pfSort = { col: 'marketValue', dir: 'desc' };
let ibkrState = 'unreachable';
let ibkrConnectMode = 'gateway';
let lastFlexSync = null;

let isPrivacyMode = localStorage.getItem('privacyMode') === 'true';
const progressCharts = {};

let ibkrReason = null;
let ibkrCompeting = false;
let ibkrSawConnected = false;
let refreshIbkrStatus = () => {};
