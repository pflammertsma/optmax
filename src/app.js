'use strict';

// ─── Scoring Helper ───────────────────────────────────────────────────────────
function applyScore(d) {
  if (window.scoreStock) d._score = window.scoreStock(d, scoringConfig);
  if (window.lensScores) {
    d._lenses = window.lensScores.scoreLenses(d, {
      usPerson: lensUsPerson,
      dividendTaxRatePct: d.dividendTaxRatePct ?? lensDividendTaxRate,
    });
  }
}

// ─── Navigation ───────────────────────────────────────────────────────────────
function navigate(viewId) {
  let finalViewId = viewId;
  let subviewId = null;
  if (['top25', 'under10k', 'megacaps', 'discover'].includes(viewId)) {
    finalViewId = 'options-scanner';
    subviewId = viewId;
  }

  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));
  const view = el('view-' + finalViewId);
  if (view) view.classList.add('active');
  const link = document.querySelector(`.nav-link[data-view="${finalViewId}"]`);
  if (link) link.classList.add('active');
  localStorage.setItem('activeView', finalViewId);

  if (subviewId) {
    const btn = document.querySelector(`.subview-btn[data-subview="${subviewId}"]`);
    if (btn) btn.click();
  }

  if (finalViewId === 'progress' && typeof renderProgressView === 'function') renderProgressView();
  if (finalViewId === 'investment-scanner' && typeof renderInvestmentScanner === 'function') renderInvestmentScanner();
  if (finalViewId === 'sell-scanner' && typeof renderSellScanner === 'function') renderSellScanner();

  if (view && window.glossaryController && typeof window.glossaryController.wrapTerms === 'function') {
    setTimeout(() => window.glossaryController.wrapTerms(view), 50);
  }
}

document.querySelectorAll('.nav-link').forEach(link => {
  link.addEventListener('click', () => {
    navigate(link.dataset.view);
    if (link.dataset.view === 'portfolio' && typeof refreshIbkrStatus === 'function') refreshIbkrStatus();
    if (link.dataset.view === 'health' && typeof loadPortfolioHealth === 'function') {
      loadPortfolioHealth();
    }
  });
});

// ─── Privacy Mode ─────────────────────────────────────────────────────────────
function updatePrivacyMode() {
  const btn = el('wc-privacy');
  if (btn) btn.innerHTML = isPrivacyMode ? EYE_CLOSED : EYE_OPEN;
  if (isPrivacyMode) {
    document.body.classList.add('privacy-active');
  } else {
    document.body.classList.remove('privacy-active');
  }
}
updatePrivacyMode();

const privacyBtn = el('wc-privacy');
if (privacyBtn) {
  privacyBtn.addEventListener('click', () => {
    isPrivacyMode = !isPrivacyMode;
    localStorage.setItem('privacyMode', isPrivacyMode);
    updatePrivacyMode();
  });
}

// ─── Data Fetching ────────────────────────────────────────────────────────────
async function loadInitialData() {
  setStatus('loading', 'Loading cache…');
  try {
    try {
      const s0 = await window.electronAPI.getSettings();
      if (typeof setIbkrModeUI === 'function') setIbkrModeUI(s0.ibkrConnectMode || 'gateway');
    } catch {}
    try {
      watchlist = await window.electronAPI.getWatchlists();
      starredList = await window.electronAPI.getStarred();
    } catch (e) {
      console.error('Boot configuration load failed:', e);
    }

    const result = await window.electronAPI.loadInitialData();
    if (result?.data?.length) {
      renderAll(result.data);
      if (typeof refreshIbkrStatus === 'function') await refreshIbkrStatus();
      setListLabels(result.fetchedAt, result.minMarginPct, result.nextRefresh);
      setPriceLabels(result.pricedAt, result.nextPriceUpdate);
      setStatus('live', 'Live');
    } else {
      renderAll([]);
      if (typeof refreshIbkrStatus === 'function') await refreshIbkrStatus();
      setStatus('live', 'Live');
    }
  } catch {
    setStatus('error', 'Cache error');
  }
}

function showSettingsProgress(wrapId, fillId, countId, symbolId) {
  el(wrapId)?.classList.remove('hidden');
  if (el(fillId)) el(fillId).style.width = '0%';
  if (el(countId)) el(countId).textContent = '';
  if (el(symbolId)) el(symbolId).textContent = '';
}

function updateSettingsProgress(fillId, countId, symbolId, done, total, symbol) {
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  if (el(fillId)) el(fillId).style.width = pct + '%';
  if (el(countId)) el(countId).textContent = total > 0 ? `${done} / ${total}` : '';
  if (el(symbolId)) el(symbolId).textContent = symbol || '';
}

function hideSettingsProgress(wrapId) {
  el(wrapId)?.classList.add('hidden');
}

async function refreshData() {
  setListBtnsState(true);
  setStatus('loading', 'Scanning options chains…');
  showSettingsProgress('fetch-progress-wrap', 'fetch-progress-fill', 'fetch-progress-count', 'fetch-progress-symbol');
  window.electronAPI.onFetchProgress(({ done, total, symbol }) => {
    updateSettingsProgress('fetch-progress-fill', 'fetch-progress-count', 'fetch-progress-symbol', done, total, symbol);
  });
  try {
    const result = await window.electronAPI.fetchData();
    if (result.success) {
      renderAll(result.data);
      setListLabels(result.fetchedAt, result.minMarginPct, result.nextRefresh);
      setPriceLabels(result.pricedAt, result.nextPriceUpdate);
      setStatus(result.data.length ? 'live' : '', result.data.length ? 'Live' : 'No results — add stocks to your watchlist');
    } else {
      setStatus('error', result.error || 'Fetch failed');
    }
  } catch {
    setStatus('error', 'Network error');
  } finally {
    window.electronAPI.offFetchProgress();
    hideSettingsProgress('fetch-progress-wrap');
    setListBtnsState(false);
  }
}

async function updatePrices() {
  setPriceBtnState(true);
  setStatus('loading', 'Updating prices…');
  showSettingsProgress('price-progress-wrap', 'price-progress-fill', 'price-progress-count', 'price-progress-symbol');
  window.electronAPI.onPriceProgress(({ done, total, symbol }) => {
    updateSettingsProgress('price-progress-fill', 'price-progress-count', 'price-progress-symbol', done, total, symbol);
  });
  try {
    const result = await window.electronAPI.fetchPrices();
    if (result.success) {
      renderAll(result.data);
      setStatus('live', 'Live');
      setPriceLabels(result.pricedAt, result.nextPriceUpdate);
    } else {
      setStatus('error', result.error || 'Price update failed');
    }
  } catch {
    setStatus('error', 'Network error');
  } finally {
    window.electronAPI.offPriceProgress();
    hideSettingsProgress('price-progress-wrap');
    setPriceBtnState(false);
  }
}

// ─── Push Events from Main Process ───────────────────────────────────────────
window.electronAPI.onAutoFetchStart(() => {
  setListBtnsState(true);
  setStatus('loading', 'Auto-scanning…');
});
window.electronAPI.onAutoFetchDone(({ data, fetchedAt, pricedAt, minMarginPct, nextRefresh, nextPriceUpdate }) => {
  renderAll(data);
  setStatus('live', 'Live');
  setListLabels(fetchedAt, minMarginPct, nextRefresh);
  setPriceLabels(pricedAt, nextPriceUpdate);
  setListBtnsState(false);
});
window.electronAPI.onAutoFetchError(() => { setStatus('error', 'Auto-refresh failed'); setListBtnsState(false); });

window.electronAPI.onAutoPriceStart(() => { setPriceBtnState(true); });
window.electronAPI.onAutoPriceDone(({ data, pricedAt, nextPriceUpdate }) => {
  renderAll(data);
  setPriceLabels(pricedAt, nextPriceUpdate);
  setPriceBtnState(false);
});
window.electronAPI.onAutoPriceError(() => { setPriceBtnState(false); });

// ─── Button Wiring ───────────────────────────────────────────────────────────
const dashboardRefreshBtn = el('refresh-btn');
if (dashboardRefreshBtn) dashboardRefreshBtn.addEventListener('click', refreshData);
const sidebarRefreshBtn = el('sidebar-refresh-btn');
if (sidebarRefreshBtn) sidebarRefreshBtn.addEventListener('click', refreshData);
const priceRefreshBtn = el('price-refresh-btn');
if (priceRefreshBtn) priceRefreshBtn.addEventListener('click', updatePrices);

// ─── Window Controls ─────────────────────────────────────────────────────────
const winMin = el('wc-minimize');
if (winMin) winMin.addEventListener('click', () => window.electronAPI.minimizeWindow());
const winMax = el('wc-maximize');
if (winMax) winMax.addEventListener('click', () => window.electronAPI.maximizeWindow());
const winClose = el('wc-close');
if (winClose) winClose.addEventListener('click', () => window.electronAPI.closeWindow());

// ─── Application Boot ─────────────────────────────────────────────────────────
initSettingsUI();
initScreenerWatchlist();
initScreenerFilters();
initScreenerSorting();
initDiscoverView();
if (typeof initPortfolioView === 'function') initPortfolioView();
if (typeof initProgressView === 'function') initProgressView();
initOptionsScannerView();
initSortableTable('table-top25',    () => allData.filter(d => d._score && d._score.totalScore > 0));
initSortableTable('table-under10k', () => allData.filter(d => d._score && d._score.totalScore > 0 && d.currentPrice <= 100));
initSortableTable('table-megacaps', () => allData.filter(d => d.marketCap != null && d.marketCap >= 200e9));
loadInitialData();
loadScreenerData();

const savedView = localStorage.getItem('activeView');
if (savedView) {
  navigate(savedView);
}
