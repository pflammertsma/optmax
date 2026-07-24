'use strict';

// ─── Screener & Watchlist View ────────────────────────────────────────────────

function renderWatchlistChips() {
  const countEl = el('watchlist-count');
  if (countEl) countEl.textContent = watchlist.length ? `${watchlist.length} stocks in your watchlist` : '';
}

async function addToWatchlist(symbol) {
  const errEl = el('add-error-screener');
  const okEl  = el('add-success-screener');
  const btn   = el('add-btn-screener');
  const input = el('add-input-screener');
  if (!symbol || !symbol.trim()) return;

  if (btn) { btn.disabled = true; btn.textContent = '…'; }
  if (errEl) errEl.textContent = '';
  if (okEl) okEl.textContent = '';

  try {
    const result = await window.electronAPI.addToWatchlist({ symbol });
    if (result.success) {
      watchlist = result.watchlist;
      if (input) input.value = '';
      renderWatchlistChips();

      pendingSymbols.add(symbol);
      renderScreener();
      flashScreenerRow(symbol, okEl);

      setStatus('loading', `Fetching ${symbol} data…`);
      try {
        await window.electronAPI.fetchHistory(symbol);
        const scanRes = await window.electronAPI.scanSingleSymbol(symbol);
        if (scanRes && scanRes.success && scanRes.data) {
          renderAll(scanRes.data);
        }
      } finally {
        pendingSymbols.delete(symbol);
        renderScreener();
        setStatus('live', 'Live');
      }
    } else {
      if (errEl) errEl.textContent = result.error || 'Invalid symbol';
    }
  } catch (e) {
    if (errEl) errEl.textContent = 'Failed to add';
    console.error('Add failed:', e);
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = '+ Add'; }
  }
}

function flashScreenerRow(symbol, okEl) {
  const cell = [...document.querySelectorAll('#tbody-screener .td-symbol')]
    .find(td => td.textContent.trim().toUpperCase() === symbol.toUpperCase());
  if (cell) {
    const row = cell.closest('tr');
    row.scrollIntoView({ behavior: 'smooth', block: 'center' });
    row.classList.add('row-flash');
    setTimeout(() => row.classList.remove('row-flash'), 2000);
    if (okEl) okEl.textContent = `✓ Added ${symbol} — highlighted in the table below.`;
  } else if (okEl) {
    okEl.textContent = `✓ Added ${symbol} to your watchlist. It's hidden by your current screener filters — clear them to see it.`;
  }
  if (okEl) setTimeout(() => { okEl.textContent = ''; }, 6000);
}

async function removeFromWatchlist(symbol) {
  try {
    const result = await window.electronAPI.removeFromWatchlist({ symbol });
    if (result.success) {
      watchlist = result.watchlist;
      allData = allData.filter(d => d.symbol !== symbol);
      renderWatchlistChips();
      renderAll(allData);
    }
  } catch (e) {
    console.warn('Remove failed:', e);
  }
}

async function initScreenerWatchlist() {
  try {
    watchlist = await window.electronAPI.getWatchlists();
    starredList = await window.electronAPI.getStarred();
  } catch {}
  renderWatchlistChips();

  const btn   = el('add-btn-screener');
  const input = el('add-input-screener');
  if (btn)   btn.addEventListener('click', () => addToWatchlist(input?.value.trim().toUpperCase() || ''));
  if (input) input.addEventListener('keydown', e => { if (e.key === 'Enter') addToWatchlist(input.value.trim().toUpperCase()); });
}

async function loadScreenerData() {
  try {
    const opps = await window.electronAPI.getDiscoveryOpps();
    screenerData = opps || [];
    screenerData.forEach(d => applyScore(d));
  } catch {
    screenerData = [];
  }
  renderScreener();
}

function getScreenerData() {
  let items = allData.filter(d => d._score);
  if (screenerFilters.cleanOnly) items = items.filter(d => d._score.killSwitches.length === 0);
  if (screenerFilters.starredOnly) items = items.filter(d => starredList.includes(d.symbol));
  if (screenerFilters.grade !== 'all') items = items.filter(d => d._score.grade === screenerFilters.grade);
  items = items.filter(d => d._score.totalScore >= screenerFilters.minScore);
  
  if (screenerFilters.minYield > 0) items = items.filter(d => d.monthlyYield >= screenerFilters.minYield);
  if (screenerFilters.minPrice > 0) items = items.filter(d => d.currentPrice >= screenerFilters.minPrice);
  if (screenerFilters.maxPrice < Infinity) items = items.filter(d => d.currentPrice <= screenerFilters.maxPrice);
  if (screenerFilters.minMarketCap > 0) items = items.filter(d => d.marketCap != null && d.marketCap >= screenerFilters.minMarketCap);

  const sort = screenerSort;
  if (sort && sort.col) {
    const col = sort.col;
    const dir = sort.dir === 'asc' ? 1 : -1;
    items.sort((a, b) => {
      let valA, valB;
      if (col === 'score') {
        valA = a._score?.totalScore ?? 0;
        valB = b._score?.totalScore ?? 0;
      } else if (col === 'grade') {
        valA = a._score?.grade ?? 'F';
        valB = b._score?.grade ?? 'F';
        return valA.localeCompare(valB) * -dir;
      } else {
        valA = a[col];
        valB = b[col];
      }
      
      if (valA == null) return 1;
      if (valB == null) return -1;
      
      if (typeof valA === 'string') return valA.localeCompare(valB) * dir;
      return (valA - valB) * dir;
    });
  } else {
    items.sort((a, b) => (b._score?.totalScore ?? 0) - (a._score?.totalScore ?? 0));
  }

  return items;
}

function renderScreener() {
  const tbody = el('tbody-screener');
  if (!tbody) return;

  const items = getScreenerData();
  const renderedSyms = new Set(items.map(d => d.symbol));
  const pendingHtml = [...pendingSymbols]
    .filter(s => !renderedSyms.has(s))
    .map(s => `
      <tr class="pending-row">
        <td></td>
        <td class="td-symbol">${s}</td>
        <td colspan="9" style="color:var(--text-muted); font-size:12px;">Fetching data…</td>
      </tr>`).join('');

  if (!items.length && !pendingHtml) {
    tbody.innerHTML = `<tr><td colspan="11" class="empty-row">${
      allData.length > 0 ? 'No stocks match the current filters.' : 'Add a stock above to build your watchlist and populate the screener.'
    }</td></tr>`;
    return;
  }

  tbody.innerHTML = pendingHtml + items.map((d, i) => {
    const sc      = d._score;
    const ivrStr  = d.ivr != null ? d.ivr.toFixed(0) : '—';
    const ivhvStr = d.ivHvRatio > 0 ? d.ivHvRatio.toFixed(2) + 'x' : '—';
    const isStarred = starredList.includes(d.symbol);
    const starIcon = isStarred ? '★' : '☆';
    const starClass = isStarred ? 'star-btn starred' : 'star-btn';

    const divYieldStr = d.yieldPct != null && d.yieldPct > 0 ? d.yieldPct.toFixed(2) + '%' : (d.yieldPct === 0 ? '0.00%' : '—');
    
    let taxDragHtml = '—';
    if (d.taxDragPct != null && d.taxDragPct > 0) {
      const color = d.taxDragPct >= 1.5 ? '#f43f5e' : d.taxDragPct >= 0.5 ? '#f59e0b' : '#10b981';
      taxDragHtml = `<span style="color:${color}; font-weight:600;" data-glossary="dividend-tax" title="Annual tax drag based on your dividend tax rate. Click for glossary.">${d.taxDragPct.toFixed(2)}%/yr</span>`;
    } else if (d.yieldPct === 0) {
      taxDragHtml = `<span style="color:var(--text-muted);" title="0% dividend yield means 0 tax drag. Highly tax efficient in CH.">0.00%/yr</span>`;
    }

    let expRatioStr = '<span style="color:var(--text-muted);" title="Individual stock — no fund expense ratio">N/A</span>';
    if (d.expenseRatioPct != null) {
      expRatioStr = d.expenseRatioPct.toFixed(2) + '%';
    } else if (d.analysis?.type === 'etf' || d.analysis?.type === 'bond etf' || d.quoteType === 'ETF' || d.overlap) {
      expRatioStr = '0.00%';
    }

    let taxStatusHtml = '';
    if (d.analysis?.isPfic || d.isPfic) {
      taxStatusHtml = `<span style="color:#f43f5e; background:rgba(244,63,94,0.12); border:1px solid rgba(244,63,94,0.25); border-radius:4px; padding:1px 6px; font-size:10px; font-weight:600; text-transform:uppercase;" data-glossary="pfic" title="PFIC (Passive Foreign Investment Company) — onerous US taxation under §1291. Severe punitive tax rates apply. Click for glossary.">PFIC Hazard</span>`;
    } else if (d.analysis?.domicile === 'US' || d.analysis?.domicile === 'USA') {
      taxStatusHtml = `<span style="color:var(--green); background:rgba(16,185,129,0.12); border:1px solid rgba(16,185,129,0.25); border-radius:4px; padding:1px 6px; font-size:10px; font-weight:600; text-transform:uppercase;" title="US-domiciled asset. Standard US tax treatment, fully compliant for US expats.">US Tax-Clean</span>`;
    } else {
      taxStatusHtml = `<span style="color:var(--text-secondary); background:rgba(255,255,255,0.04); border:1px solid rgba(255,255,255,0.08); border-radius:4px; padding:1px 6px; font-size:10px; font-weight:600; text-transform:uppercase;">Non-US</span>`;
    }

    return `
      <tr class="screener-row ${sc?.killSwitches.length ? 'blocked-row' : ''}" data-symbol="${d.symbol}">
        <td><button class="${starClass}" data-symbol="${d.symbol}">${starIcon}</button></td>
        <td class="td-symbol">
          <div style="display:flex; flex-direction:column;">
            <span style="font-weight:600; color:var(--cyan); font-family:'JetBrains Mono', monospace; font-size:13px;">${d.symbol}</span>
            <span style="font-size:11.5px; color:var(--text-muted); font-family:'Outfit', sans-serif; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:200px;">${d.companyName || d.name || ''}</span>
          </div>
        </td>
        <td class="td-score">${sc ? sc.totalScore : '—'}</td>
        <td>${sc ? renderGradeBadge(sc.grade) : '—'}</td>
        <td class="td-price">${fmt.currency(d.currentPrice)}</td>
        <td class="td-strike options-metric">${fmt.currency(d.strike)}</td>
        <td class="td-dte options-metric">${d.dte != null ? d.dte + 'd' : '—'}</td>
        <td class="td-yield-mo options-metric">${fmt.pct(d.monthlyYield)}</td>
        <td class="td-yield-ann options-metric">${fmt.pct(d.annualizedYield)}</td>
        <td class="td-ivr options-metric">${ivrStr}</td>
        <td class="td-ivhv options-metric">${ivhvStr}</td>
        <td class="td-div-yield std-metric">${divYieldStr}</td>
        <td class="td-tax-drag std-metric">${taxDragHtml}</td>
        <td class="td-exp-ratio std-metric" style="font-family:'JetBrains Mono',monospace;">${expRatioStr}</td>
        <td class="td-tax-status std-metric">${taxStatusHtml}</td>
      </tr>
    `;
  }).join('');

  tbody.querySelectorAll('.star-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const symbol = btn.dataset.symbol;
      const result = await window.electronAPI.toggleStarred({ symbol });
      if (result.success) {
        starredList = result.starred;
        renderScreener();
        renderDashboardStarred();
        renderTables(allData);
      }
    });
  });

  tbody.querySelectorAll('.screener-row').forEach(row => {
    row.addEventListener('click', (e) => {
      if (e.target.closest('.star-btn')) return;
      const symbol = row.dataset.symbol;
      const d = allData.find(x => x.symbol === symbol) || screenerData.find(x => x.symbol === symbol);
      openSymbolDetails(d || symbol);
    });
  });
}

function initScreenerFilters() {
  const minScoreInp = el('filter-min-score');
  const gradeSel    = el('filter-grade');
  const cleanChk    = el('filter-clean-only');
  const starChk     = el('filter-starred-only');

  if (minScoreInp) minScoreInp.addEventListener('input', e => {
    screenerFilters.minScore = parseInt(e.target.value, 10) || 0;
    renderScreener();
  });
  if (gradeSel) gradeSel.addEventListener('change', e => {
    screenerFilters.grade = e.target.value;
    renderScreener();
  });
  if (cleanChk) cleanChk.addEventListener('change', e => {
    screenerFilters.cleanOnly = e.target.checked;
    renderScreener();
  });
  if (starChk) starChk.addEventListener('change', e => {
    screenerFilters.starredOnly = e.target.checked;
    renderScreener();
  });
}

function initScreenerSorting() {
  const table = el('table-screener');
  if (!table) return;
  table.querySelectorAll('thead th[data-col]').forEach(th => {
    th.classList.add('sortable-th');
    th.addEventListener('click', () => {
      const col = th.dataset.col;
      const dir = (screenerSort.col === col && screenerSort.dir === 'desc') ? 'asc' : 'desc';
      screenerSort = { col, dir };

      table.querySelectorAll('thead th').forEach(h => h.removeAttribute('data-sort'));
      th.setAttribute('data-sort', dir);
      renderScreener();
    });
  });
}

function buildTableRows(items, tbodyId, sortState) {
  const tbody = el(tbodyId);
  if (!items.length) {
    tbody.innerHTML = '<tr><td colspan="12" class="empty-row">No opportunities found.</td></tr>';
    return;
  }

  let sorted = items.slice(0, 25);
  if (sortState?.col && sortState.col !== 'rank') {
    const { col, dir } = sortState;
    sorted = [...sorted].sort((a, b) => {
      let av, bv;
      if (col === 'score') {
        av = a._score?.totalScore ?? -Infinity;
        bv = b._score?.totalScore ?? -Infinity;
      } else if (col === 'symbol') {
        av = (a[col] || '').toLowerCase();
        bv = (b[col] || '').toLowerCase();
      } else {
        av = a[col] ?? -Infinity;
        bv = b[col] ?? -Infinity;
      }

      if (av < bv) return dir === 'asc' ? -1 : 1;
      if (av > bv) return dir === 'asc' ? 1 : -1;
      return 0;
    });
  }

  tbody.innerHTML = sorted.map((d, i) => {
    const sc = d._score;
    const scoreTd = sc ? `${sc.totalScore} ${renderGradeBadge(sc.grade)}` : '—';
    const symbolCell = `<div style="display:flex; flex-direction:column;">
      <span style="font-weight:600; color:var(--cyan); font-family:'JetBrains Mono', monospace; font-size:13px;">${d.symbol}</span>
      <span style="font-size:11.5px; color:var(--text-muted); font-family:'Outfit', sans-serif; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:200px;">${d.companyName || d.name || ''}</span>
    </div>`;
    return `
      <tr class="opt-row" data-idx="${sorted.indexOf(d)}">
        <td class="td-symbol">${symbolCell}</td>
        <td class="td-score">${scoreTd}</td>
        <td class="td-price">${fmt.currency(d.currentPrice)}</td>
        <td class="td-strike options-metric">${fmt.currency(d.strike)}</td>
        <td class="td-dte options-metric">${d.dte}d</td>
        <td class="td-premium options-metric">${fmt.currency(d.premium)}</td>
        <td class="td-capital options-metric">${fmt.currency(d.capitalRequired)}</td>
        <td class="td-yield-mo options-metric">${fmt.pct(d.monthlyYield)}</td>
        <td class="td-yield-ann options-metric">${fmt.pct(d.annualizedYield)}</td>
        <td class="td-income options-metric">${fmt.currency(d.monthlyIncome)}</td>
      </tr>
    `;
  }).join('');

  tbody.querySelectorAll('tr').forEach((tr, idx) => {
    tr.style.cursor = 'pointer';
    const item = sorted[idx];
    if (item) tr.addEventListener('click', () => openModal(item));
  });
}

function renderTables(data) {
  const active = data.filter(d => d._score && d._score.totalScore > 0);
  const under10k = active.filter(d => d.currentPrice <= 100);
  const megacaps = data.filter(d => d.marketCap != null && d.marketCap >= 200e9);

  buildTableRows(active,    'tbody-top25',    tableSortState['table-top25']);
  buildTableRows(under10k,  'tbody-under10k', tableSortState['table-under10k']);
  buildTableRows(megacaps,  'tbody-megacaps',  tableSortState['table-megacaps']);
}

function initSortableTable(tableId, getItems) {
  const table = el(tableId);
  if (!table) return;
  table.querySelectorAll('thead th[data-col]').forEach(th => {
    th.classList.add('sortable-th');
    th.addEventListener('click', () => {
      const col = th.dataset.col;
      const prev = tableSortState[tableId];
      const dir  = prev?.col === col && prev.dir === 'desc' ? 'asc' : 'desc';
      tableSortState[tableId] = { col, dir };

      table.querySelectorAll('thead th').forEach(h => h.removeAttribute('data-sort'));
      th.setAttribute('data-sort', dir);

      const tbodyId = table.querySelector('tbody')?.id;
      if (tbodyId) buildTableRows(getItems(), tbodyId, tableSortState[tableId]);
    });
  });
}

function renderAll(data) {
  allData = data;
  allData.forEach(d => applyScore(d));

  const isEmpty = data.length === 0;
  el('empty-state').style.display = isEmpty ? 'flex' : 'none';
  const strip = el('dashboard-income-strip');
  if (strip) strip.style.display = isEmpty ? 'none' : '';

  const total = data.length;
  const above0 = data.filter(d => d._score && d._score.totalScore > 0).length;
  const graded = data.filter(d => d._score && d._score.totalScore > 0 && d._score.grade !== 'F').length;
  const subtitleEl = el('dashboard-stats-subtitle');
  if (subtitleEl) {
    subtitleEl.textContent = `${total} opportunities · ${above0} with score > 0 · ${graded} with passing grades (A-D)`;
  }

  renderTables(data);
  renderDashboardIncomeStrip(data.filter(d => d._score && d._score.totalScore > 0));
  renderScreener();
  if (portfolio && typeof renderPortfolio === 'function') {
    renderPortfolio(portfolio);
  }
}

function setDiscoverProgress({ phase, done, total, symbol, fromCache, toFetch, fetched }) {
  const titleEl  = el('discover-progress-title');
  const countEl  = el('discover-progress-count');
  const fillEl   = el('discover-progress-fill');
  const symbolEl = el('discover-progress-symbol');

  if (phase === 'scanning' && total > 0) {
    const pct = Math.round((done / total) * 100);
    if (titleEl) titleEl.textContent = 'Scanning options chains…';

    if (fromCache != null && toFetch != null) {
      const cachedPart = `<span class="dp-cached">✓ ${fromCache} cached</span>`;
      const fetchPart  = `<span class="dp-fetching">⟳ ${fetched ?? 0} / ${toFetch} fetching</span>`;
      if (countEl) countEl.innerHTML = `${cachedPart}&ensp;·&ensp;${fetchPart}`;
    } else {
      if (countEl) countEl.textContent = `${done} / ${total}`;
    }

    if (fillEl)   fillEl.style.width   = pct + '%';
    if (symbolEl) symbolEl.textContent = symbol || '';
  } else {
    if (titleEl)  titleEl.textContent  = 'Fetching stock universe…';
    if (countEl)  countEl.textContent  = '';
    if (fillEl)   fillEl.style.width   = '0%';
    if (symbolEl) symbolEl.textContent = '';
  }
}

async function triggerPostDiscoverRefresh() {
  const wrap     = el('discover-post-scan');
  const opdataEl = el('post-scan-opdata');
  const pricesEl = el('post-scan-prices');
  const opdataLbl = el('post-scan-opdata-label');
  const pricesLbl = el('post-scan-prices-label');

  if (!wrap) return;
  wrap.classList.remove('hidden');
  opdataEl.className  = 'post-scan-item post-scan-running';
  pricesEl.className  = 'post-scan-item post-scan-pending';
  if (opdataLbl) opdataLbl.textContent = 'Refreshing opportunity data…';
  if (pricesLbl) pricesLbl.textContent = 'Updating prices…';

  try {
    await refreshData();
    opdataEl.className = 'post-scan-item post-scan-done';
    if (opdataLbl) opdataLbl.textContent = '✓ Opportunity data refreshed';
  } catch {
    opdataEl.className = 'post-scan-item post-scan-error';
    if (opdataLbl) opdataLbl.textContent = '✕ Opportunity data failed';
  }

  pricesEl.className = 'post-scan-item post-scan-running';
  try {
    await updatePrices();
    pricesEl.className = 'post-scan-item post-scan-done';
    if (pricesLbl) pricesLbl.textContent = '✓ Prices updated';
  } catch {
    pricesEl.className = 'post-scan-item post-scan-error';
    if (pricesLbl) pricesLbl.textContent = '✕ Price update failed';
  }

  loadScreenerData();
}

function initDiscoverView() {
  async function runScan(options = {}) {
    const runBtn      = el('discover-run-btn');
    const forceBtn    = el('discover-force-btn');
    const runAgainBtn = el('discover-run-again-btn');
    [runBtn, forceBtn, runAgainBtn].forEach(b => { if (b) { b.disabled = true; b.classList.add('spinning'); } });
    el('discover-results').classList.add('hidden');
    el('discover-progress').classList.remove('hidden');
    setDiscoverProgress({ phase: 'fetching', done: 0, total: 0, symbol: '' });

    try {
      const result = await window.electronAPI.runDiscovery(options);
      el('discover-progress').classList.add('hidden');
      if (result.success) {
        renderDiscoverUnified(result.results);
        el('discover-results').classList.remove('hidden');

        if (result.watchlist) {
          watchlist = result.watchlist;
          renderWatchlistChips();
          renderScreener();
        }

        const sumEl = el('discover-summary');
        if (sumEl) {
          const cacheNote = result.fromCache > 0 ? ` (${result.fromCache} from cache, ${result.fetched} fetched fresh)` : '';
          const addNote   = result.totalAdded  > 0 ? ` · ${result.totalAdded} new stocks added to watchlist` : '';
          sumEl.textContent = `Scanned ${result.scanned} stocks · ${result.found} passed filters${cacheNote}${addNote}`;
        }

        triggerPostDiscoverRefresh();
      } else {
        const titleEl = el('discover-progress-title');
        if (titleEl) titleEl.textContent = 'Scan failed: ' + (result.error || 'Unknown error');
        el('discover-progress').classList.remove('hidden');
      }
    } catch (e) {
      const titleEl = el('discover-progress-title');
      if (titleEl) titleEl.textContent = 'Scan failed: ' + e.message;
      el('discover-progress').classList.remove('hidden');
    } finally {
      [el('discover-run-btn'), el('discover-force-btn'), el('discover-run-again-btn')].forEach(b => {
        if (b) { b.disabled = false; b.classList.remove('spinning'); }
      });
    }
  }

  const runBtn      = el('discover-run-btn');
  const forceBtn    = el('discover-force-btn');
  const runAgainBtn = el('discover-run-again-btn');
  if (runBtn)      runBtn.addEventListener('click',      () => runScan());
  if (forceBtn)    forceBtn.addEventListener('click',    () => runScan({ force: true }));
  if (runAgainBtn) runAgainBtn.addEventListener('click', () => runScan());

  window.electronAPI.onDiscoveryProgress(setDiscoverProgress);
}

function initOptionsScannerView() {
  const container = el('view-options-scanner');
  if (!container) return;

  const buttons = container.querySelectorAll('.subview-btn');
  buttons.forEach(btn => {
    btn.addEventListener('click', () => {
      buttons.forEach(b => b.classList.remove('active'));
      container.querySelectorAll('.scanner-subview').forEach(v => v.classList.add('hidden'));

      btn.classList.add('active');
      const subviewId = btn.dataset.subview;
      const target = el('subview-' + subviewId);
      if (target) target.classList.remove('hidden');

      localStorage.setItem('activeScannerSubview', subviewId);
    });
  });

  const lastSubview = localStorage.getItem('activeScannerSubview');
  if (lastSubview) {
    const btn = container.querySelector(`.subview-btn[data-subview="${lastSubview}"]`);
    if (btn) btn.click();
  }
}

// ─── Investment Scanner (Buy Ideas View) ───────────────────────────────────
let investmentScanner = null;
let investmentScanLoading = false;

function invGradeCell(grade, score) {
  return `${renderGradeBadge(grade)} <span style="color:var(--text-muted); font-size:11px;">${score}</span>`;
}
function invSymbolCell(r) {
  return `<div style="display:flex; flex-direction:column;">
    <span style="font-weight:600; color:var(--cyan); font-family:'JetBrains Mono', monospace; font-size:13px;">${r.symbol}</span>
    <span style="font-size:11.5px; color:var(--text-muted); font-family:'Outfit', sans-serif; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:220px;">${r.name || ''}</span>
  </div>`;
}
function invPct(v) { return v == null ? '—' : `${v.toFixed(2)}%`; }

async function renderInvestmentScanner() {
  const root = el('inv-scan-root');
  if (!root) return;
  if (investmentScanLoading) return;
  investmentScanLoading = true;
  if (!investmentScanner) root.innerHTML = '<div style="padding:24px; color:var(--text-muted); font-size:13px;">Loading buy ideas…</div>';

  let data;
  try {
    const watchlistData = (window.allData || allData || [])
      .filter(d => d._score)
      .map(d => ({ symbol: d.symbol, grade: d._lenses?.buyHold?.grade || d._score?.grade, score: d._score?.totalScore ?? 0 }));
    data = await window.electronAPI.scanInvestments(watchlistData);
  } catch (err) {
    root.innerHTML = `<div style="padding:24px; color:var(--red); font-size:13px;">Couldn't load buy ideas: ${err.message}</div>`;
    investmentScanLoading = false;
    return;
  }
  const cats = (data && data.categories) || { etf: [], bond: [], stock: [], dividend: [] };

  const holdCols = [
    { key: 'symbol', label: 'Symbol', sortable: true, render: invSymbolCell },
    { key: 'buyHoldScore', label: 'Quality', align: 'center', sortable: true, render: r => invGradeCell(r.buyHoldGrade, r.buyHoldScore) },
    { key: 'yieldPct', label: 'Yield', align: 'right', sortable: true, render: r => invPct(r.yieldPct) },
    { key: 'taxDragPct', label: 'Tax drag/yr', align: 'right', sortable: true, render: r => `<span style="color:${r.taxDragPct >= 1.5 ? 'var(--red)' : r.taxDragPct >= 0.5 ? '#f59e0b' : 'var(--green)'}">${invPct(r.taxDragPct)}</span>` },
    { key: 'expenseRatioPct', label: 'Expense', align: 'right', sortable: true, render: r => r.expenseRatioPct == null ? '—' : `${r.expenseRatioPct.toFixed(2)}%` },
    { key: 'why', label: 'Why', render: r => `<span style="font-size:11.5px; color:var(--text-secondary);">${(r.reasons || []).join(' · ') || 'Fits your plan'}</span>` },
    { key: 'suggestedUsd', label: 'Suggested', align: 'right', sortable: true, render: r => r.suggestedUsd > 0 ? `<span class="privacy-amount" style="color:var(--green);">${fmt.currency(r.suggestedUsd)}</span>` : '—' },
  ];
  const dividendCols = [
    { key: 'symbol', label: 'Symbol', sortable: true, render: invSymbolCell },
    { key: 'dividendScore', label: 'Income', align: 'center', sortable: true, render: r => invGradeCell(r.dividendGrade, r.dividendScore) },
    { key: 'yieldPct', label: 'Yield', align: 'right', sortable: true, render: r => invPct(r.yieldPct) },
    { key: 'afterTax', label: 'After-tax', align: 'right', sortable: true, sortValue: r => (r.yieldPct - r.taxDragPct), render: r => `<span style="color:var(--green)">${invPct(r.yieldPct - r.taxDragPct)}</span>` },
    { key: 'taxDragPct', label: 'Tax drag/yr', align: 'right', sortable: true, render: r => invPct(r.taxDragPct) },
    { key: 'why', label: 'Why', render: r => `<span style="font-size:11.5px; color:var(--text-secondary);">${(r.reasons || []).join(' · ') || 'Pays income'}</span>` },
  ];

  const intros = {
    etf: 'Broad, low-cost, US-domiciled funds — the core of a long-term portfolio. Ranked by quality; lower tax drag wins ties (Switzerland taxes dividends, so low-yield broad funds are most efficient for you).',
    bond: 'Fixed-income funds for glidepath risk control — held to steady the ride, not for yield (bond interest is fully taxed for you).' + (data.bondsFirst ? ' Your equity exposure is above your age target, so these come first right now.' : ''),
    stock: 'Individual companies, ranked by buy-and-hold quality. Satellite only — keep each small; diversified funds should stay your core. Employer stock and over-concentrated names are excluded.',
    dividend: 'Ranked by after-tax income (the Dividend lens). Remember every 1% of yield is a recurring tax cost at your rate.',
  };

  const config = {
    tabs: [
      { id: 'etf', label: 'ETFs', badge: cats.etf.length, intro: intros.etf },
      { id: 'bond', label: 'Bonds', badge: cats.bond.length, intro: intros.bond },
      { id: 'stock', label: 'Stocks', badge: cats.stock.length, intro: intros.stock },
      { id: 'dividend', label: 'Dividend', badge: cats.dividend.length, intro: intros.dividend },
    ],
    columns: (tabId) => (tabId === 'dividend' ? dividendCols : holdCols),
    getRows: (tabId) => cats[tabId] || [],
    defaultSort: { col: 'buyHoldScore', dir: 'desc' },
    emptyText: 'No candidates in this category right now.',
    onRowClick: (r) => { const d = (window.allData || allData || []).find(x => x.symbol === r.symbol); if (d) openModal(d); },
  };

  if (window.Scanner) {
    investmentScanner = window.Scanner.create(root, config);
    window.investmentScanner = investmentScanner;
  }
  investmentScanLoading = false;
}

el('inv-scan-refresh')?.addEventListener('click', () => {
  investmentScanner = null;
  renderInvestmentScanner();
});
