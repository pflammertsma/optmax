'use strict';

// ─── State ───────────────────────────────────────────────────────────────────
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
};

let screenerSort = { col: 'score', dir: 'desc' };

// ─── Format helpers ───────────────────────────────────────────────────────────
const fmt = {
  currency: v => v == null ? '—' : `<span class="privacy-amount">$${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>`,
  pct:      v => v == null ? '—' : v.toFixed(2) + '%',
  num:      v => v == null ? '—' : v.toLocaleString('en-US'),
  mktcap:   v => {
    if (v == null || v <= 0) return '—';
    let val;
    if (v >= 1e12) val = '$' + (v / 1e12).toFixed(2) + 'T';
    else if (v >= 1e9)  val = '$' + (v / 1e9).toFixed(2) + 'B';
    else if (v >= 1e6)  val = '$' + (v / 1e6).toFixed(2) + 'M';
    else val = '$' + v.toLocaleString('en-US');
    return `<span class="privacy-amount">${val}</span>`;
  }
};

function el(id) { return document.getElementById(id); }

// ─── Grade helpers ────────────────────────────────────────────────────────────
function gradeColor(grade) {
  return { A: 'var(--green)', B: '#14b8a6', C: '#f59e0b', D: '#f97316', E: 'var(--red)', F: 'var(--text-muted)' }[grade] || 'var(--text-muted)';
}

function renderGradeBadge(grade) {
  return `<span class="grade-badge grade-badge-${grade}">${grade}</span>`;
}

function renderRecommendationBadge(rec) {
  if (rec === 'Buy') {
    return `<span style="color: var(--green); background: rgba(16, 185, 129, 0.12); border: 1px solid rgba(16, 185, 129, 0.25); border-radius: 4px; padding: 2px 6px; font-size: 11px; font-weight: 600; text-transform: uppercase;">Buy</span>`;
  }
  if (rec === 'Trim') {
    return `<span style="color: #f59e0b; background: rgba(245, 158, 11, 0.12); border: 1px solid rgba(245, 158, 11, 0.25); border-radius: 4px; padding: 2px 6px; font-size: 11px; font-weight: 600; text-transform: uppercase;">Trim</span>`;
  }
  if (rec === 'Hold') {
    return `<span style="color: var(--text-secondary); background: rgba(255, 255, 255, 0.04); border: 1px solid rgba(255, 255, 255, 0.08); border-radius: 4px; padding: 2px 6px; font-size: 11px; font-weight: 600; text-transform: uppercase;">Hold</span>`;
  }
  if (rec === 'Write Call') {
    return `<span style="color: var(--cyan); background: rgba(6, 182, 212, 0.12); border: 1px solid rgba(6, 182, 212, 0.25); border-radius: 4px; padding: 2px 6px; font-size: 11px; font-weight: 600; text-transform: uppercase; white-space: nowrap;">Write Call</span>`;
  }
  if (rec === 'Replace') {
    return `<span style="color: #f43f5e; background: rgba(244, 63, 94, 0.12); border: 1px solid rgba(244, 63, 94, 0.25); border-radius: 4px; padding: 2px 6px; font-size: 11px; font-weight: 600; text-transform: uppercase;">Replace</span>`;
  }
  return `<span style="color: var(--text-muted); font-size: 11px;">—</span>`;
}

function renderScoreBar(score, grade) {
  const color = gradeColor(grade);
  return `<div class="score-bar-track"><div class="score-bar-fill" style="width:${score}%;background:${color}"></div></div>`;
}

// ─── Scoring ──────────────────────────────────────────────────────────────────
function applyScore(d) {
  if (!window.scoreStock) return;
  d._score = window.scoreStock(d, scoringConfig);
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
}

document.querySelectorAll('.nav-link').forEach(link => {
  link.addEventListener('click', () => {
    navigate(link.dataset.view);
    // Re-probe the gateway each time the Portfolio view is opened, so a gateway
    // started (or logged into) after boot is reflected without a manual click.
    if (link.dataset.view === 'portfolio') refreshIbkrStatus();
    // Health self-sufficiency: if the boot-time load failed (or hasn't landed
    // yet), landing on Health cold retries it instead of showing an empty page.
    if (link.dataset.view === 'health' && !el('pf-health-breakdown').innerHTML) {
      window.electronAPI.getPortfolio()
        .then(p => loadPortfolioHealth(p.holdings.length > 0))
        .catch(err => console.error('Health cold-load failed:', err));
    }
  });
});

function setStatus(state, text) {
  const dot   = el('status-dot');
  const label = el('status-text');
  if (!dot || !label) return;

  if (state === 'live' && text === 'Live') {
    if (ibkrState === 'connected') {
      dot.className = 'status-dot live';
      label.textContent = 'Live';
    } else if (ibkrState === 'needs-login') {
      dot.className = 'status-dot warning';
      label.textContent = 'IBKR disconnected';
    } else {
      dot.className = 'status-dot offline';
      label.textContent = 'IBKR Offline';
    }
  } else {
    let dotClass = state;
    if (state === 'live') {
      if (ibkrState === 'connected') {
        dotClass = 'live';
      } else if (ibkrState === 'needs-login') {
        dotClass = 'warning';
      } else {
        dotClass = 'offline';
      }
    }
    dot.className = 'status-dot ' + dotClass;
    label.textContent = text;
  }
}

// ─── Metric cards ─────────────────────────────────────────────────────────────
function renderMetricCards(data) {
  const container = el('metric-cards');
  if (!container) return;

  const watchlistCount = watchlist.length;
  // Graded opportunities now include any unblocked passing grade (A, B, C, D, E)
  const gradedCount    = data.filter(d => d._score && d._score.totalScore > 0 && d._score.grade !== 'F').length;

  const gradesCount = { A: 0, B: 0, C: 0, D: 0, E: 0 };
  data.forEach(d => {
    if (d._score && d._score.totalScore > 0 && d._score.grade !== 'F') {
      const g = d._score.grade;
      if (gradesCount[g] !== undefined) {
        gradesCount[g]++;
      }
    }
  });

  const gradeParts = [];
  ['A', 'B', 'C', 'D', 'E'].forEach(g => {
    if (gradesCount[g] > 0) {
      gradeParts.push(`
        <span class="grade-badge grade-badge-${g}" style="font-size: 11px; padding: 2px 8px; border-radius: 4px; font-weight: 700;">
          ${g}: ${gradesCount[g]}
        </span>
      `);
    }
  });
  const gradeSubtext = gradeParts.length > 0 
    ? `<div style="display: flex; gap: 6px; flex-wrap: wrap; align-items: center;">${gradeParts.join('')}</div>` 
    : '<div style="font-size: 11px; color: var(--text-muted);">No graded opportunities</div>';

  container.innerHTML = `
    <div class="metric-card">
      <div class="metric-label">Watchlist Stocks</div>
      <div class="metric-value">${watchlistCount}</div>
    </div>
    <div class="metric-card">
      <div class="metric-label">Graded Opportunities</div>
      <div style="display: flex; align-items: center; gap: 12px; margin-top: 2px;">
        <div class="metric-value">${gradedCount}</div>
        ${gradeSubtext}
      </div>
    </div>
  `;
}

// ─── Preview lists ────────────────────────────────────────────────────────────
function renderDashboardStarred() {
  const container = el('preview-starred');
  if (!container) return;

  const starredOpps = allData.filter(d => starredList.includes(d.symbol));

  if (!starredOpps.length) {
    container.innerHTML = '<div class="preview-empty" style="color: var(--text-muted); font-size: 11.5px; padding: 12px 4px;">No starred stocks yet. Star your favorite tickers in the Screener.</div>';
    return;
  }

  container.innerHTML = starredOpps.slice(0, 10).map((d, i) => `
    <div class="preview-item" data-idx="${allData.indexOf(d)}">
      <div class="preview-item-left" style="align-items: flex-start;">
        <span class="preview-rank" style="color: #fbbf24; font-size: 13px; width: 16px; margin-top: 4px;">★</span>
        <div style="display: flex; flex-direction: column; gap: 4px;">
          <div style="display: flex; align-items: center; gap: 6px;">
            <span class="preview-symbol" style="font-size: 14px; font-weight: 600; color: var(--cyan);">${d.symbol}</span>
            <span class="preview-info privacy-amount" style="font-weight: 600; color: var(--text-primary); margin: 0;">$${d.currentPrice.toFixed(2)}</span>
            ${d._score ? renderGradeBadge(d._score.grade) : ''}
          </div>
          <span class="preview-info" style="font-size: 11px; color: var(--text-secondary);">${fmt.currency(d.strike)} strike · ${d.dte}d</span>
        </div>
      </div>
      <div style="display: flex; flex-direction: column; align-items: flex-end; line-height: 1.25;">
        <span style="font-family: 'JetBrains Mono', monospace; font-size: 11px; color: var(--text-secondary); font-weight: 500;">${fmt.pct(d.annualizedYield)}/yr</span>
        <span class="preview-yield" style="font-size: 14px;">${fmt.pct(d.monthlyYield)}/mo</span>
      </div>
    </div>
  `).join('');

  container.querySelectorAll('.preview-item').forEach(item => {
    item.addEventListener('click', () => openModal(allData[+item.dataset.idx]));
  });
}

function renderPreviewList(containerId, items) {
  const container = el(containerId);
  if (!items.length) {
    container.innerHTML = '<p class="preview-empty">No data available.</p>';
    return;
  }
  container.innerHTML = items.slice(0, 10).map((d, i) => `
    <div class="preview-item" data-idx="${allData.indexOf(d)}">
      <div class="preview-item-left" style="align-items: flex-start;">
        <span class="preview-rank" style="margin-top: 4px;">${i + 1}</span>
        <div style="display: flex; flex-direction: column; gap: 4px;">
          <div style="display: flex; align-items: center; gap: 6px;">
            <span class="preview-symbol" style="font-size: 14px; font-weight: 600; color: var(--cyan);">${d.symbol}</span>
            <span class="preview-info privacy-amount" style="font-weight: 600; color: var(--text-primary); margin: 0;">$${d.currentPrice.toFixed(2)}</span>
            ${d._score ? renderGradeBadge(d._score.grade) : ''}
          </div>
          <span class="preview-info" style="font-size: 11px; color: var(--text-secondary);">${fmt.currency(d.strike)} strike · ${d.dte}d</span>
        </div>
      </div>
      <div style="display: flex; flex-direction: column; align-items: flex-end; line-height: 1.25;">
        <span style="font-family: 'JetBrains Mono', monospace; font-size: 11px; color: var(--text-secondary); font-weight: 500;">${fmt.pct(d.annualizedYield)}/yr</span>
        <span class="preview-yield" style="font-size: 14px;">${fmt.pct(d.monthlyYield)}/mo</span>
      </div>
    </div>
  `).join('');

  container.querySelectorAll('.preview-item').forEach(item => {
    item.addEventListener('click', () => openModal(allData[+item.dataset.idx]));
  });
}

// ─── Standard tables (Top 25 / Under $10k) ───────────────────────────────────
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
    if (tbodyId === 'tbody-favorites') {
      return `
        <tr>
          <td class="td-rank">${i + 1}</td>
          <td class="td-symbol">${d.symbol}</td>
          <td class="td-price">${fmt.currency(d.currentPrice)}</td>
          <td class="td-mktcap" style="font-family:'JetBrains Mono',monospace;font-size:11.5px">${fmt.mktcap(d.marketCap)}</td>
          <td>${sc ? renderGradeBadge(sc.grade) : '—'}</td>
          <td class="td-score">${sc ? sc.totalScore : '—'}</td>
          <td class="td-strike options-metric">${fmt.currency(d.strike)}</td>
          <td class="td-dte options-metric">${d.dte}d</td>
          <td class="td-premium options-metric">${fmt.currency(d.premium)}</td>
          <td class="td-capital options-metric">${fmt.currency(d.capitalRequired)}</td>
          <td class="td-yield-mo options-metric">${fmt.pct(d.monthlyYield)}</td>
          <td class="td-yield-ann options-metric">${fmt.pct(d.annualizedYield)}</td>
          <td class="td-income options-metric">${fmt.currency(d.monthlyIncome)}</td>
          <td><button class="analyze-btn" data-idx="${allData.indexOf(d)}">Analyze</button></td>
        </tr>
      `;
    }
    return `
      <tr>
        <td class="td-rank">${i + 1}</td>
        <td class="td-symbol">${d.symbol}</td>
        <td class="td-score">${scoreTd}</td>
        <td class="td-price">${fmt.currency(d.currentPrice)}</td>
        <td class="td-strike options-metric">${fmt.currency(d.strike)}</td>
        <td class="td-dte options-metric">${d.dte}d</td>
        <td class="td-premium options-metric">${fmt.currency(d.premium)}</td>
        <td class="td-capital options-metric">${fmt.currency(d.capitalRequired)}</td>
        <td class="td-yield-mo options-metric">${fmt.pct(d.monthlyYield)}</td>
        <td class="td-yield-ann options-metric">${fmt.pct(d.annualizedYield)}</td>
        <td class="td-income options-metric">${fmt.currency(d.monthlyIncome)}</td>
        <td><button class="analyze-btn" data-idx="${allData.indexOf(d)}">Analyze</button></td>
      </tr>
    `;
  }).join('');

  tbody.querySelectorAll('.analyze-btn').forEach(btn => {
    btn.addEventListener('click', () => openModal(allData[+btn.dataset.idx]));
  });
}

function renderTables(data) {
  const active = data.filter(d => d._score && d._score.totalScore > 0);
  const under10k = active.filter(d => d.currentPrice <= 100);
  const megacaps = data.filter(d => d.marketCap != null && d.marketCap >= 200e9);
  const favorites = data.filter(d => starredList.includes(d.symbol));

  buildTableRows(active,    'tbody-top25',    tableSortState['table-top25']);
  buildTableRows(under10k,  'tbody-under10k', tableSortState['table-under10k']);
  buildTableRows(megacaps,  'tbody-megacaps',  tableSortState['table-megacaps']);
  buildTableRows(favorites, 'tbody-favorites', tableSortState['table-favorites']);
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

// ─── Full render ──────────────────────────────────────────────────────────────
function renderAll(data) {
  allData = data;
  allData.forEach(d => applyScore(d));

  const isEmpty = data.length === 0;
  el('empty-state').style.display  = isEmpty ? 'flex' : 'none';
  el('preview-grid').style.display = isEmpty ? 'none' : 'flex';

  const total = data.length;
  const above0 = data.filter(d => d._score && d._score.totalScore > 0).length;
  const graded = data.filter(d => d._score && d._score.totalScore > 0 && d._score.grade !== 'F').length;

  const subtitleEl = el('dashboard-stats-subtitle');
  if (subtitleEl) {
    subtitleEl.textContent = `${total} opportunities · ${above0} with score > 0 · ${graded} with passing grades (A-D)`;
  }

  renderMetricCards(data);
  renderTables(data);
  
  const active = data.filter(d => d._score && d._score.totalScore > 0);
  renderPreviewList('preview-overall', active);
  renderPreviewList('preview-under10k', active.filter(d => d.currentPrice <= 100));
  
  // Render Top 5 Mega Caps (including those with 0 score)
  const megaCaps = data.filter(d => d.marketCap != null && d.marketCap >= 200e9);
  renderPreviewList('preview-megacaps', megaCaps);

  renderDashboardStarred();
  renderScreener();
  if (portfolio) {
    renderPortfolio(portfolio);
  }
}

// ─── Unified watchlist ────────────────────────────────────────────────────────
function renderWatchlistChips() {
  // The watchlist here is the scanner's full stock universe (hundreds of
  // symbols), so rendering every one as a chip is unusable. The count +
  // the screener table below are the feedback instead; individual removal
  // happens from a stock's detail modal.
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

      // Show the ticker right away as a placeholder row, before the (slow,
      // full-watchlist) scan runs — so the add feels instant.
      pendingSymbols.add(symbol);
      renderScreener();
      flashScreenerRow(symbol, okEl);

      // Then fetch its data in the background; the placeholder is replaced by
      // the real row once the scan results land.
      setStatus('loading', `Fetching ${symbol} data…`);
      try {
        await window.electronAPI.fetchHistory(symbol);
        await refreshData();
        await updatePrices();
      } finally {
        pendingSymbols.delete(symbol);
        renderScreener();
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

// Point the user at where the added stock landed: scroll its row into view and
// flash it, or explain if the current filters are hiding it.
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
      // Drop it from the in-memory scan too so the screener/dashboard reflect
      // the removal now, without waiting for the next options fetch.
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

// ─── Screener ─────────────────────────────────────────────────────────────────
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
  // The screener shows your watchlist-scanned opportunities (allData) — the
  // same source as the Dashboard. Discover-scan results live in their own
  // Option Scanner → Discover table, not here.
  let items = allData.filter(d => d._score);
  if (screenerFilters.cleanOnly) items = items.filter(d => d._score.killSwitches.length === 0);
  if (screenerFilters.grade !== 'all') items = items.filter(d => d._score.grade === screenerFilters.grade);
  items = items.filter(d => d._score.totalScore >= screenerFilters.minScore);
  
  if (screenerFilters.minYield > 0) {
    items = items.filter(d => d.monthlyYield >= screenerFilters.minYield);
  }
  if (screenerFilters.minPrice > 0) {
    items = items.filter(d => d.currentPrice >= screenerFilters.minPrice);
  }
  if (screenerFilters.maxPrice < Infinity) {
    items = items.filter(d => d.currentPrice <= screenerFilters.maxPrice);
  }
  if (screenerFilters.minMarketCap > 0) {
    items = items.filter(d => d.marketCap != null && d.marketCap >= screenerFilters.minMarketCap);
  }

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
        // Reverse alphabetical comparison for grade (so A is best, F is worst)
        return valA.localeCompare(valB) * -dir;
      } else {
        valA = a[col];
        valB = b[col];
      }
      
      if (valA == null) return 1;
      if (valB == null) return -1;
      
      if (typeof valA === 'string') {
        return valA.localeCompare(valB) * dir;
      }
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

  // Placeholder rows for just-added symbols not yet in the scan results.
  const renderedSyms = new Set(items.map(d => d.symbol));
  const pendingHtml = [...pendingSymbols]
    .filter(s => !renderedSyms.has(s))
    .map(s => `
      <tr class="pending-row">
        <td class="td-rank"><span class="mini-spinner"></span></td>
        <td></td>
        <td class="td-symbol">${s}</td>
        <td colspan="9" style="color:var(--text-muted); font-size:12px;">Fetching data…</td>
      </tr>`).join('');

  if (!items.length && !pendingHtml) {
    tbody.innerHTML = `<tr><td colspan="12" class="empty-row">${
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
    return `
      <tr class="screener-row" data-idx="${allData.indexOf(d)}" style="cursor:pointer">
        <td class="td-rank">${i + 1}</td>
        <td><button class="${starClass}" data-symbol="${d.symbol}">${starIcon}</button></td>
        <td class="td-symbol">${d.symbol}</td>
        <td class="td-price">${fmt.currency(d.currentPrice)}</td>
        <td class="td-mktcap" style="font-family:'JetBrains Mono',monospace;font-size:11.5px">${fmt.mktcap(d.marketCap)}</td>
        <td class="td-score" style="font-family:'JetBrains Mono',monospace;font-weight:600">${sc.totalScore}</td>
        <td>${renderGradeBadge(sc.grade)}</td>
        <td class="td-ivr options-metric">${ivrStr}</td>
        <td class="td-ivhv options-metric">${ivhvStr}</td>
        <td class="td-yield-mo options-metric">${fmt.pct(d.monthlyYield)}</td>
        <td class="options-metric">${renderScoreBar(sc.totalScore, sc.grade)}</td>
        <td><button class="analyze-btn" data-idx="${allData.indexOf(d)}">Detail</button></td>
      </tr>`;
  }).join('');

  tbody.querySelectorAll('.screener-row').forEach(row => {
    row.addEventListener('click', e => {
      if (e.target.classList.contains('analyze-btn') || e.target.classList.contains('star-btn')) return;
      openModal(allData[+row.dataset.idx]);
    });
  });
  tbody.querySelectorAll('.analyze-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      openModal(allData[+btn.dataset.idx]);
    });
  });
  tbody.querySelectorAll('.star-btn').forEach(btn => {
    btn.addEventListener('click', async e => {
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
}

function initScreenerFilters() {
  const slider = el('filter-min-score');
  const valEl  = el('filter-min-score-val');
  if (slider) {
    slider.addEventListener('input', () => {
      screenerFilters.minScore = +slider.value;
      if (valEl) valEl.textContent = slider.value;
      renderScreener();
    });
  }

  const yieldSlider = el('filter-min-yield');
  const yieldValEl  = el('filter-min-yield-val');
  if (yieldSlider) {
    yieldSlider.addEventListener('input', () => {
      screenerFilters.minYield = +yieldSlider.value;
      if (yieldValEl) yieldValEl.textContent = (+yieldSlider.value).toFixed(1) + '%';
      renderScreener();
    });
  }

  const minPriceSlider = el('filter-min-price');
  const maxPriceSlider = el('filter-max-price');
  const priceRangeValEl  = el('filter-price-range-val');

  if (minPriceSlider && maxPriceSlider) {
    const updatePriceRange = () => {
      let minVal = +minPriceSlider.value;
      let maxVal = +maxPriceSlider.value;

      // Prevent sliders from crossing each other
      if (minVal >= maxVal) {
        minVal = maxVal - 10;
        if (minVal < 0) {
          minVal = 0;
          minPriceSlider.value = 0;
          maxPriceSlider.value = 10;
          maxVal = 10;
        } else {
          minPriceSlider.value = minVal;
        }
      }

      screenerFilters.minPrice = minVal;
      screenerFilters.maxPrice = maxVal >= 500 ? Infinity : maxVal;

      if (priceRangeValEl) {
        const minStr = '$' + minVal;
        const maxStr = maxVal >= 500 ? 'No Limit' : '$' + maxVal;
        priceRangeValEl.textContent = `${minStr} - ${maxStr}`;
      }
      renderScreener();
    };

    minPriceSlider.addEventListener('input', updatePriceRange);
    maxPriceSlider.addEventListener('input', updatePriceRange);
  }

  const capSelect = el('filter-market-cap');
  if (capSelect) {
    capSelect.addEventListener('change', () => {
      screenerFilters.minMarketCap = +capSelect.value;
      renderScreener();
    });
  }

  document.querySelectorAll('.grade-filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.grade-filter-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      screenerFilters.grade = btn.dataset.grade;
      renderScreener();
    });
  });

  const cleanToggle = el('filter-clean-only');
  if (cleanToggle) {
    cleanToggle.addEventListener('change', () => {
      screenerFilters.cleanOnly = cleanToggle.checked;
      renderScreener();
    });
  }

  const screenerShowOptions = el('screener-show-options');
  if (screenerShowOptions) {
    screenerShowOptions.addEventListener('change', () => {
      const table = el('table-screener');
      if (table) {
        if (screenerShowOptions.checked) {
          table.classList.remove('hide-options-metrics');
        } else {
          table.classList.add('hide-options-metrics');
        }
      }
    });
  }

  const favoritesShowOptions = el('favorites-show-options');
  if (favoritesShowOptions) {
    favoritesShowOptions.addEventListener('change', () => {
      const table = el('table-favorites');
      if (table) {
        if (favoritesShowOptions.checked) {
          table.classList.remove('hide-options-metrics');
        } else {
          table.classList.add('hide-options-metrics');
        }
      }
    });
  }
}

function initScreenerSorting() {
  const table = el('table-screener');
  if (!table) return;

  const headers = table.querySelectorAll('thead th[data-col]');
  headers.forEach(th => {
    th.classList.add('sortable-th');
    th.addEventListener('click', () => {
      const col = th.dataset.col;
      const isAsc = th.getAttribute('data-sort') === 'asc';
      const dir   = isAsc ? 'desc' : 'asc';

      screenerSort = { col, dir };

      headers.forEach(h => h.removeAttribute('data-sort'));
      th.setAttribute('data-sort', dir);

      renderScreener();
    });
  });
}

// ─── Discover View ────────────────────────────────────────────────────────────
function renderDiscoverUnified(results) {
  const tbody = el('discover-tbody-unified');
  if (!tbody) return;

  const seen = new Set();
  const allOpps = [];
  for (const group of [results.ivr, results.iv_hv, results.mean_reversion]) {
    for (const d of (group || [])) {
      if (!seen.has(d.symbol)) {
        seen.add(d.symbol);
        applyScore(d);
        allOpps.push(d);
      }
    }
  }
  allOpps.sort((a, b) => (b._score?.totalScore ?? 0) - (a._score?.totalScore ?? 0));
  const top25 = allOpps.slice(0, 25);

  if (!top25.length) {
    tbody.innerHTML = '<tr><td colspan="9" class="empty-row">No qualifying candidates found.</td></tr>';
    return;
  }

  tbody.innerHTML = top25.map((d, i) => {
    const sc      = d._score;
    const ivPct   = d.impliedVolatility > 0 ? (d.impliedVolatility * 100).toFixed(1) + '%' : '—';
    const ivrStr  = d.ivr != null ? d.ivr.toFixed(0) : '—';
    const ivhvStr = d.ivHvRatio > 0 ? d.ivHvRatio.toFixed(2) + 'x' : '—';
    return `
      <tr>
        <td class="td-rank">${i + 1}</td>
        <td class="td-symbol">${d.symbol}<div class="discover-company">${d.companyName || ''}</div></td>
        <td class="td-score" style="font-family:'JetBrains Mono',monospace;font-weight:600">${sc ? sc.totalScore : '—'}</td>
        <td>${sc ? renderGradeBadge(sc.grade) : '—'}</td>
        <td class="td-iv">${ivPct}</td>
        <td class="td-ivr">${ivrStr}</td>
        <td class="td-ivhv">${ivhvStr}</td>
        <td class="td-yield-mo">${fmt.pct(d.monthlyYield)}</td>
        <td class="td-yield-ann">${fmt.pct(d.annualizedYield)}</td>
      </tr>`;
  }).join('');
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

// ─── Post-discover auto-refresh ───────────────────────────────────────────────
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

  // Reload screener from updated discovery cache
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

        // Auto-trigger opportunity data refresh then price update
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

// ─── Analysis Modal ───────────────────────────────────────────────────────────
function switchSymbolTab(tabName) {
  const compTab = el('modal-tab-compliance');
  const optTab = el('modal-tab-options');
  const compContent = el('modal-content-compliance');
  const optContent = el('modal-content-options');

  if (!compTab || !optTab || !compContent || !optContent) return;

  if (tabName === 'compliance') {
    compTab.classList.add('active');
    compTab.style.color = 'var(--cyan)';
    compTab.style.borderBottom = '2px solid var(--cyan)';
    
    optTab.classList.remove('active');
    optTab.style.color = 'var(--text-secondary)';
    optTab.style.borderBottom = 'none';

    compContent.style.display = 'block';
    optContent.style.display = 'none';
  } else {
    optTab.classList.add('active');
    optTab.style.color = 'var(--cyan)';
    optTab.style.borderBottom = '2px solid var(--cyan)';
    
    compTab.classList.remove('active');
    compTab.style.color = 'var(--text-secondary)';
    compTab.style.borderBottom = 'none';

    compContent.style.display = 'none';
    optContent.style.display = 'grid';
  }
}

async function openSymbolDetails(symbolOrData, defaultTab = 'compliance') {
  if (!symbolOrData) return;
  const symbol = typeof symbolOrData === 'string' ? symbolOrData : symbolOrData.symbol;
  
  const modal = el('modal-overlay');
  if (!modal) return;

  modal.classList.remove('hidden');
  el('modal-details-body').style.display = 'none';

  let loadingEl = el('modal-loading-placeholder');
  if (!loadingEl) {
    loadingEl = document.createElement('div');
    loadingEl.id = 'modal-loading-placeholder';
    loadingEl.style.padding = '40px';
    loadingEl.style.color = 'var(--text-muted)';
    loadingEl.style.textAlign = 'center';
    loadingEl.style.fontSize = '13px';
    loadingEl.textContent = 'Loading symbol details...';
    el('modal-details-body').parentNode.insertBefore(loadingEl, el('modal-details-body'));
  }
  loadingEl.style.display = 'block';

  let d;
  try {
    d = await window.electronAPI.getSymbolInsights(symbol);
  } catch (e) {
    loadingEl.textContent = 'Failed to load details.';
    console.error('getSymbolInsights failed:', e);
    return;
  }
  if (!d || d.error) {
    loadingEl.textContent = 'No data available for this symbol.';
    return;
  }

  loadingEl.style.display = 'none';
  el('modal-details-body').style.display = 'grid';

  // 1. Header Population
  el('modal-company').textContent = d.name || d.symbol;
  el('modal-symbol-badge').textContent = d.symbol;
  const sublineBits = [d.exchange, d.analysis?.type ? d.analysis.type.toUpperCase() : null, d.analysis?.domicile ? `domiciled: ${d.analysis.domicile}` : null].filter(Boolean);
  el('modal-exchange').textContent = sublineBits.join(' · ');
  el('modal-price').textContent = d.price != null ? `$${d.price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : '—';
  
  const chEl = el('modal-change');
  if (d.changePct != null) {
    chEl.textContent = `${d.changePct >= 0 ? '+' : ''}${d.changePct.toFixed(2)}% today`;
    chEl.style.color = d.changePct >= 0 ? 'var(--green)' : 'var(--red)';
  } else {
    chEl.textContent = '';
  }

  // Watchlist Header Action Button
  const watchlistBtn = el('modal-watchlist-action-btn');
  if (watchlistBtn) {
    const isWatchlisted = watchlist.some(s => s.toUpperCase() === d.symbol.toUpperCase());
    if (isWatchlisted) {
      watchlistBtn.textContent = '✓ Watchlisted';
      watchlistBtn.style.border = '1px solid var(--border)';
      watchlistBtn.style.background = 'transparent';
      watchlistBtn.style.color = 'var(--text-secondary)';
    } else {
      watchlistBtn.textContent = '+ Watchlist';
      watchlistBtn.style.border = '1px solid rgba(0, 240, 255, 0.3)';
      watchlistBtn.style.background = 'rgba(0, 240, 255, 0.05)';
      watchlistBtn.style.color = 'var(--cyan)';
    }
    watchlistBtn.disabled = false;

    watchlistBtn.onclick = async () => {
      watchlistBtn.disabled = true;
      watchlistBtn.textContent = '…';
      if (isWatchlisted) {
        await removeFromWatchlist(d.symbol);
      } else {
        await addToWatchlist(d.symbol);
      }
      openSymbolDetails(symbolOrData, defaultTab);
    };
  }

  // Star Toggle Button
  const starBtn = el('modal-star-btn');
  if (starBtn) {
    const updateStarUI = () => {
      const isStarred = starredList.includes(d.symbol);
      starBtn.textContent = isStarred ? '★' : '☆';
      starBtn.className = isStarred ? 'star-btn starred' : 'star-btn';
    };
    updateStarUI();
    starBtn.onclick = async () => {
      const result = await window.electronAPI.toggleStarred({ symbol: d.symbol });
      if (result.success) {
        starredList = result.starred;
        updateStarUI();
        renderScreener();
        renderDashboardStarred();
        renderTables(allData);
      }
    };
  }

  // 2. Compliance Content
  const a = d.analysis;
  const compEl = el('si-compliance');
  if (a) {
    const palette = {
      danger:    { color: '#f43f5e', bg: 'rgba(244,63,94,0.08)',  border: 'rgba(244,63,94,0.25)' },
      caution:   { color: '#f59e0b', bg: 'rgba(245,158,11,0.08)', border: 'rgba(245,158,11,0.25)' },
      excellent: { color: 'var(--green)', bg: 'rgba(16,185,129,0.08)', border: 'rgba(16,185,129,0.25)' },
    }[a.suitability] || { color: 'var(--text-secondary)', bg: 'transparent', border: 'var(--border)' };
    compEl.innerHTML = `
      <div style="padding:10px 12px; border-radius:8px; background:${palette.bg}; border:1px solid ${palette.border}; font-size:12px;">
        <div style="font-weight:600; color:${palette.color}; margin-bottom:3px;">${a.reason}</div>
        <div style="color:var(--text-secondary); line-height:1.5;">${a.details}</div>
      </div>`;
  } else compEl.innerHTML = '';

  const range52 = (d.fiftyTwoWeekLow != null && d.fiftyTwoWeekHigh != null && d.price != null && d.fiftyTwoWeekHigh > d.fiftyTwoWeekLow)
    ? `${(((d.price - d.fiftyTwoWeekLow) / (d.fiftyTwoWeekHigh - d.fiftyTwoWeekLow)) * 100).toFixed(0)}% of 52w range`
    : null;
  const stats = [
    d.yieldPct != null ? { label: 'Dividend Yield', value: `${d.yieldPct.toFixed(2)}%` } : null,
    d.taxDragPct != null ? { label: `Tax Drag (@${d.dividendTaxRatePct}%)`, value: `${d.taxDragPct.toFixed(2)}%/yr`, color: d.taxDragPct >= 1.5 ? 'var(--red)' : d.taxDragPct >= 0.5 ? '#f59e0b' : 'var(--green)' } : null,
    d.expenseRatioPct != null ? { label: 'Expense Ratio', value: `${d.expenseRatioPct.toFixed(2)}%` } : null,
    range52 ? { label: '52-Week Position', value: range52 } : null,
    d.marketCap != null ? { label: d.overlap ? 'Fund Assets' : 'Market Cap', value: fmt.mktcap(d.marketCap), html: true } : null,
    d.held ? { label: 'Your Position', value: `$${Math.round(d.held.marketValue).toLocaleString('en-US')} · ${d.held.weightPct.toFixed(1)}% (${d.held.bucket})`, html: false, privacy: true } : null,
  ].filter(Boolean);
  el('si-stats').innerHTML = stats.map(s => `
    <div style="background:rgba(255,255,255,0.02); border:1px solid var(--border); border-radius:8px; padding:8px 10px;">
      <div style="font-size:10px; color:var(--text-muted); text-transform:uppercase; letter-spacing:0.5px;">${s.label}</div>
      <div style="font-size:13px; font-weight:600; margin-top:2px; ${s.color ? `color:${s.color};` : ''}" ${s.privacy ? 'class="privacy-amount"' : ''}>${s.value}</div>
    </div>`).join('');

  const calloutEl = el('si-overlap-callout');
  const holdingsSection = el('si-holdings-section');
  if (d.overlap && d.overlap.rows.length) {
    const o = d.overlap;
    const parts = [];
    if (o.employerFundPct > 0) {
      parts.push(`<strong style="color:#f43f5e;">${o.employerFundPct.toFixed(1)}% of this fund is your employer's stock</strong> — every $10k you invest adds ~$${o.employerUsdPer10k.toLocaleString('en-US')} of hidden exposure on top of your direct position.`);
    }
    if (o.overlapCount > 0) {
      parts.push(`${o.overlapCount} of its top holdings (${o.overlapFundPct.toFixed(1)}% of the fund) are names you already own directly — buying it partly duplicates what you have rather than diversifying.`);
    }
    calloutEl.innerHTML = parts.length ? `
      <div style="padding:10px 12px; border-radius:8px; background:rgba(245,158,11,0.06); border:1px solid rgba(245,158,11,0.2); font-size:12px; color:var(--text-secondary); line-height:1.6;">
        ${parts.join('<br>')}
      </div>` : '';

    holdingsSection.style.display = '';
    const maxPct = Math.max(...o.rows.map(r => r.fundPct), 1);
    el('si-holdings-list').innerHTML = o.rows.slice(0, 10).map(r => `
      <div style="display:flex; align-items:center; gap:8px; font-size:12px;">
        <span style="font-family:'JetBrains Mono',monospace; font-weight:600; width:56px; ${r.isEmployer ? 'color:#f43f5e;' : r.alreadyHeld ? 'color:#f59e0b;' : ''}">${r.symbol}</span>
        <div style="flex:1; height:8px; background:rgba(255,255,255,0.04); border-radius:4px; overflow:hidden;">
          <div style="height:100%; width:${(r.fundPct / maxPct) * 100}%; background:${r.isEmployer ? '#f43f5e' : r.alreadyHeld ? '#f59e0b' : 'var(--cyan)'}; opacity:0.75;"></div>
        </div>
        <span style="width:44px; text-align:right; font-family:'JetBrains Mono',monospace;">${r.fundPct.toFixed(1)}%</span>
        <span style="width:150px; font-size:11px; color:var(--text-muted); text-align:right;">${r.isEmployer ? 'EMPLOYER STOCK' : r.alreadyHeld ? `you hold ${r.directWeightPct.toFixed(1)}% directly` : ''}</span>
      </div>`).join('');
  } else {
    calloutEl.innerHTML = '';
    holdingsSection.style.display = 'none';
  }

  const sectorsSection = el('si-sectors-section');
  if (d.sectorWeights && d.sectorWeights.length) {
    sectorsSection.style.display = '';
    el('si-sectors-list').innerHTML = d.sectorWeights.slice(0, 8).map(s => `
      <span style="font-size:11px; padding:3px 8px; border-radius:5px; background:rgba(255,255,255,0.04); border:1px solid var(--border); color:var(--text-secondary);">
        ${s.sector.replace(/_/g, ' ')} <strong style="color:var(--text-primary);">${s.pct.toFixed(1)}%</strong>
      </span>`).join('');
  } else {
    sectorsSection.style.display = 'none';
  }

  // 3. Options Content
  const scannerHit = typeof symbolOrData === 'object' && symbolOrData._score ? symbolOrData : (window.allData || allData || []).find(x => x.symbol === d.symbol);
  const optTabBtn = el('modal-tab-options');
  const sidebarOptSec = el('modal-sidebar-options-section');
  const sidebarNoOpt = el('modal-sidebar-no-options');

  if (scannerHit) {
    if (optTabBtn) {
      optTabBtn.disabled = false;
      optTabBtn.style.opacity = '1';
      optTabBtn.style.cursor = 'pointer';
      optTabBtn.title = '';
    }
    if (sidebarOptSec) sidebarOptSec.style.display = 'block';
    if (sidebarNoOpt) sidebarNoOpt.style.display = 'none';

    currentModal = scannerHit;
    const sc = scannerHit._score;

    el('modal-score-number').textContent   = sc.totalScore;
    el('modal-grade-badge').textContent    = sc.grade;
    el('modal-grade-badge').className      = `grade-badge grade-badge-lg grade-badge-${sc.grade}`;
    el('modal-grade-label').textContent    = sc.gradeLabel;
    el('modal-ann-yield').textContent      = `Ann. yield: ${fmt.pct(scannerHit.annualizedYield)}`;
    el('modal-score-bar').style.width      = sc.totalScore + '%';
    el('modal-score-bar').style.background = gradeColor(sc.grade);

    const ksEl = el('modal-kill-switches');
    if (sc.killSwitches.length) {
      ksEl.innerHTML = sc.killSwitches.map(k => `<div class="kill-switch-alert">⚠ ${k}</div>`).join('');
    } else {
      ksEl.innerHTML = '';
    }

    const BREAKDOWN_META = [
      { key: 'ivRank',        label: 'IV Rank',        max: 20 },
      { key: 'ivHvRatio',     label: 'IV/HV Ratio',    max: 15 },
      { key: 'monthlyYield',  label: 'Monthly Yield',  max: 15 },
      { key: 'absoluteIV',    label: 'Absolute IV',    max: 10 },
      { key: 'delta',         label: 'Delta',          max: 10 },
      { key: 'atSupport',     label: 'At Support',     max: 10 },
      { key: 'openInterest',  label: 'Open Interest',  max: 6  },
      { key: 'bidAskSpread',  label: 'Bid-Ask Spread', max: 6  },
      { key: 'aboveMA50',     label: 'Above MA50',     max: 4  },
      { key: 'earningsClear', label: 'Earnings Clear', max: 4  },
    ];

    el('modal-breakdown-rows').innerHTML = BREAKDOWN_META.map(m => {
      const pts = sc.breakdown[m.key] ?? 0;
      const pct = Math.round((pts / m.max) * 100);
      return `
        <div class="breakdown-row">
          <span class="breakdown-label">${m.label}</span>
          <span class="breakdown-pts">${pts}/${m.max}</span>
          <div class="breakdown-bar-track">
            <div class="breakdown-bar-fill" style="width:${pct}%;background:${gradeColor(sc.grade)}"></div>
          </div>
        </div>`;
    }).join('');

    el('mechanics-text').innerHTML =
      `Sell 1 put contract with a <span class="privacy-amount">$${scannerHit.strike.toFixed(2)}</span> strike expiring in ${scannerHit.dte} days ` +
      `for a premium of <span class="privacy-amount">$${(scannerHit.premium * 100).toFixed(2)}</span> (${fmt.pct(scannerHit.marginOfSafety)} below current price). ` +
      `If assigned, you will be obligated to buy 100 shares at <span class="privacy-amount">$${scannerHit.strike.toFixed(2)}</span>, ` +
      `requiring <span class="privacy-amount">$${scannerHit.capitalRequired.toLocaleString()}</span> in capital. ` +
      `Your break-even price is <span class="privacy-amount">$${scannerHit.breakEven.toFixed(2)}</span>.`;

    const expBox  = el('modal-block-explanation-box');
    const expText = el('modal-block-explanation');
    if (expBox && expText) {
      if (sc && sc.killSwitches && sc.killSwitches.length > 0) {
        expBox.style.display = 'block';
        const explanations = sc.killSwitches.map(k => {
          if (k.toLowerCase().includes('earnings')) {
            return `<strong>Earnings Block:</strong> Earnings reports typically introduce extreme, unpredictable price swings and overnight gaps. Selling cash-secured puts right before earnings exposes you to high tail risk, where the stock can gap down far below your strike price. The system blocks this trade because the company's earnings date falls within your option's expiration window.`;
          }
          if (k.toLowerCase().includes('bid-ask') || k.toLowerCase().includes('spread')) {
            return `<strong>Liquidity Block:</strong> Wide bid-ask spreads indicate low liquidity, high slippage, and poor execution quality. This makes it difficult and expensive to enter the trade, and even harder to roll or close the position early if needed. The system blocks this trade because the bid-ask spread exceeds the $0.50 risk threshold.`;
          }
          if (k.toLowerCase().includes('iv') || k.toLowerCase().includes('volatility')) {
            return `<strong>Volatility Block:</strong> Extremely high implied volatility (above 80%) is a major warning signal of company distress, an impending binary event, or extreme speculative fever. While premiums are high, the risk of a severe price crash is heavily elevated, overriding the safety margin of put-selling.`;
          }
          return `<strong>System Block:</strong> This trade has been blocked by the active safety filter: ${k}.`;
        });
        expText.innerHTML = explanations.join('<br><br>');
      } else {
        expBox.style.display = 'none';
        expText.innerHTML = '';
      }
    }

    const volStr    = scannerHit.impliedVolatility > 0 ? fmt.pct(scannerHit.impliedVolatility * 100) : 'N/A';
    const hvStr     = scannerHit.hv > 0 ? fmt.pct(scannerHit.hv * 100) : 'N/A';
    const ivhvStr   = scannerHit.ivHvRatio > 0 ? scannerHit.ivHvRatio.toFixed(2) + 'x' : 'N/A';
    const ivrStr    = scannerHit.ivr != null ? scannerHit.ivr.toFixed(0) : 'Insufficient history';
    const deltaStr  = scannerHit.delta != null ? Math.abs(scannerHit.delta).toFixed(2) : 'N/A';
    const spreadStr = scannerHit.bidAskSpread != null ? fmt.currency(scannerHit.bidAskSpread) : 'N/A';

    el('stats-grid-options').innerHTML = [
      { label: 'Strike',               value: fmt.currency(scannerHit.strike)            },
      { label: 'Expiration',           value: scannerHit.expirationDate                  },
      { label: 'DTE',                  value: scannerHit.dte + ' days'                   },
      { label: 'Premium (mid)',        value: fmt.currency(scannerHit.premium)           },
      { label: 'Delta',                value: deltaStr                          },
      { label: 'Implied Volatility',   value: volStr,         cls: 'cyan'       },
      { label: 'Historical Vol (30d)', value: hvStr                             },
      { label: 'IV / HV Ratio',        value: ivhvStr                           },
      { label: 'IV Rank',              value: ivrStr                            },
      { label: 'Open Interest',        value: fmt.num(scannerHit.openInterest)           },
      { label: 'Bid-Ask Spread',       value: spreadStr                         },
      { label: 'Break-Even',           value: fmt.currency(scannerHit.breakEven)         },
      { label: 'Margin of Safety',     value: fmt.pct(scannerHit.marginOfSafety), cls: 'green' },
      { label: 'Above MA50',           value: scannerHit.aboveMA50 ? 'Yes' : 'No'       },
    ].map(s => `
      <div class="stat-item">
        <div class="stat-label">${s.label}</div>
        <div class="stat-value ${s.cls || ''}">${s.value}</div>
      </div>
    `).join('');
  } else {
    if (optTabBtn) {
      optTabBtn.disabled = true;
      optTabBtn.style.opacity = '0.4';
      optTabBtn.style.cursor = 'not-allowed';
      optTabBtn.title = 'No options scanner data found for this symbol';
    }
    if (sidebarOptSec) sidebarOptSec.style.display = 'none';
    if (sidebarNoOpt) sidebarNoOpt.style.display = 'block';

    el('modal-content-options').innerHTML = `
      <div style="padding: 40px; text-align: center; color: var(--text-secondary);">
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="var(--text-muted)" stroke-width="1.5" style="margin-bottom:12px;"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
        <div style="font-weight:600; font-size:14px; margin-bottom:4px;">No active option writing opportunities found</div>
        <p style="font-size:12px; max-width:400px; margin: 0 auto; line-height: 1.5;">Options are only scanned for watchlisted stocks. Check back later or search another ticker.</p>
      </div>`;
  }

  // 5. Default tab activation
  if (defaultTab === 'options' && scannerHit) {
    switchSymbolTab('options');
  } else {
    switchSymbolTab('compliance');
  }

  // 6. Draw Chart
  renderChart([], d.symbol);
  try {
    const history = await window.electronAPI.fetchHistory(d.symbol);
    renderChart(history, d.symbol);
  } catch (e) {
    console.warn('History fetch failed:', e);
  }
}

async function openModal(d) {
  await openSymbolDetails(d, 'options');
}

function closeModal() {
  el('modal-overlay').classList.add('hidden');
  if (priceChart) { priceChart.destroy(); priceChart = null; }
  currentModal = null;
}

function renderChart(history, symbol) {
  const canvas = el('price-chart');
  if (priceChart) { priceChart.destroy(); priceChart = null; }

  if (!history.length) {
    canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);
    return;
  }

  const ctx      = canvas.getContext('2d');
  const gradient = ctx.createLinearGradient(0, 0, 0, 140);
  gradient.addColorStop(0, 'rgba(0, 240, 255, 0.3)');
  gradient.addColorStop(1, 'rgba(0, 240, 255, 0.0)');

  priceChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: history.map(h => h.date),
      datasets: [{
        label: symbol + ' Close',
        data: history.map(h => h.close),
        borderColor: '#00f0ff',
        borderWidth: 2,
        backgroundColor: gradient,
        pointRadius: 0,
        pointHoverRadius: 4,
        fill: true,
        tension: 0.35
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: 'rgba(13, 17, 23, 0.95)',
          borderColor: 'rgba(0, 240, 255, 0.3)',
          borderWidth: 1,
          titleColor: '#9ca3af',
          bodyColor: '#e8eaf0',
          callbacks: { label: ctx => ' $' + ctx.parsed.y.toFixed(2) }
        }
      },
      scales: {
        x: {
          grid: { color: 'rgba(255,255,255,0.04)', drawTicks: false },
          ticks: { color: '#9ca3af', font: { family: 'JetBrains Mono', size: 10 }, maxTicksLimit: 6 }
        },
        y: {
          grid: { color: 'rgba(255,255,255,0.04)', drawTicks: false },
          ticks: { color: '#9ca3af', font: { family: 'JetBrains Mono', size: 10 }, callback: v => '$' + v.toFixed(0) }
        }
      }
    }
  });
}

el('modal-close').addEventListener('click', closeModal);
el('modal-overlay').addEventListener('click', e => {
  if (e.target === el('modal-overlay')) closeModal();
});
el('modal-tab-compliance').addEventListener('click', () => switchSymbolTab('compliance'));
el('modal-tab-options').addEventListener('click', () => switchSymbolTab('options'));
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    if (!el('modal-overlay').classList.contains('hidden')) { closeModal(); return; }
    if (!el('help-overlay').classList.contains('hidden'))  { closeHelp(); }
  }
});

// ─── Help modal ───────────────────────────────────────────────────────────────
function openHelp()  { el('help-overlay').classList.remove('hidden'); }
function closeHelp() { el('help-overlay').classList.add('hidden'); }

el('help-btn').addEventListener('click', openHelp);
el('help-close').addEventListener('click', closeHelp);
el('help-overlay').addEventListener('click', e => {
  if (e.target === el('help-overlay')) closeHelp();
});

// ─── Settings UI ─────────────────────────────────────────────────────────────
const DATE_FMT = { month: 'short', day: 'numeric', year: 'numeric' };
const TIME_FMT = { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' };

const INTERVAL_DESCS = {
  '1':  'Full options scan once a day.',
  '2':  'Full options scan every 2 days.',
  '7':  'Full options scan every week.',
  '14': 'Full options scan every 2 weeks.',
  '30': 'Full options scan once a month.'
};

const MARGIN_DESCS = {
  '0':    'Picks the strike closest to the current price. Max premium, minimal cushion.',
  '5':    'Strike ≥5% below price. Balanced premium and downside protection.',
  '7.5':  'Strike ≥7.5% below price. Moderate cushion with decent yield.',
  '10':   'Strike ≥10% below price. Conservative — stock needs a 10% drop to be at risk.',
  '12.5': 'Strike ≥12.5% below price. Wide buffer, noticeably lower yield.',
  '15':   'Strike ≥15% below price. Maximum protection, lowest yield.'
};

const PRICE_INTERVAL_DESCS = {
  '1':  'Current stock prices refresh every hour.',
  '2':  'Current stock prices refresh every 2 hours.',
  '4':  'Current stock prices refresh every 4 hours.',
  '6':  'Current stock prices refresh every 6 hours.',
  '12': 'Current stock prices refresh every 12 hours.',
  '24': 'Current stock prices refresh once a day.',
  '0':  'Prices only update when you click Update Prices.'
};

const fmtDate = iso => iso ? new Date(iso).toLocaleDateString('en-US', DATE_FMT) : '—';
const fmtTime = iso => iso ? new Date(iso).toLocaleString('en-US', TIME_FMT) : '—';

function updateIntervalDesc(val)      { const e = el('interval-desc');       if (e) e.textContent = INTERVAL_DESCS[val] || ''; }
function updateMarginDesc(val)        { const e = el('margin-desc');         if (e) e.textContent = MARGIN_DESCS[String(val)] || ''; }
function updatePriceIntervalDesc(val) { const e = el('price-interval-desc'); if (e) e.textContent = PRICE_INTERVAL_DESCS[String(val)] || ''; }

function setListLabels(fetchedAt, minMarginPct, nextRefresh) {
  const dateEl    = el('last-updated-date');
  const marginEl  = el('last-margin-used');
  const marginRow = el('last-margin-row');
  const nextEl    = el('next-refresh-date');
  if (dateEl)  dateEl.textContent  = fmtDate(fetchedAt);
  if (nextEl)  nextEl.textContent  = fmtDate(nextRefresh);
  if (minMarginPct != null && marginEl && marginRow) {
    marginEl.textContent    = minMarginPct + '% OTM margin';
    marginRow.style.display = '';
  }
}

function setPriceLabels(pricedAt, nextPriceUpdate) {
  const lastEl = el('last-priced-date');
  const nextEl = el('next-price-date');
  if (lastEl) lastEl.textContent = fmtTime(pricedAt);
  if (nextEl) nextEl.textContent = nextPriceUpdate ? fmtTime(nextPriceUpdate) : 'Manual';
}

function setListBtnsState(loading) {
  ['refresh-btn', 'sidebar-refresh-btn'].forEach(id => {
    const b = el(id); if (!b) return;
    b.disabled = loading;
    loading ? b.classList.add('spinning') : b.classList.remove('spinning');
  });
}

function setPriceBtnState(loading) {
  const b = el('price-refresh-btn'); if (!b) return;
  b.disabled = loading;
  loading ? b.classList.add('spinning') : b.classList.remove('spinning');
}

function saveScoringConfig(updates) {
  Object.assign(scoringConfig, updates);
  window.electronAPI.saveSettings(updates);
  allData.forEach(d => applyScore(d));
  screenerData.forEach(d => applyScore(d));
  renderScreener();
  renderTables(allData);
}

async function initSettingsUI() {
  try {
    const settings    = await window.electronAPI.getSettings();
    const intervalSel = el('interval-select');
    const marginSel   = el('margin-select');
    const priceSel    = el('price-interval-select');

    if (intervalSel && settings.refreshIntervalDays) {
      intervalSel.value = String(settings.refreshIntervalDays);
      updateIntervalDesc(String(settings.refreshIntervalDays));
    }
    if (marginSel && settings.minMarginPct != null) {
      marginSel.value = String(settings.minMarginPct);
      updateMarginDesc(settings.minMarginPct);
    }
    if (priceSel && settings.priceRefreshHours != null) {
      priceSel.value = String(settings.priceRefreshHours);
      updatePriceIntervalDesc(String(settings.priceRefreshHours));
    }

    // Load scoring config
    scoringConfig = {
      gradeA:           settings.gradeA           ?? 50,
      gradeB:           settings.gradeB           ?? 40,
      gradeC:           settings.gradeC           ?? 30,
      gradeD:           settings.gradeD           ?? 20,
      gradeE:           settings.gradeE           ?? 1,
      blockEarnings:    settings.blockEarnings    !== false,
      blockBidAsk:      settings.blockBidAsk      !== false,
      blockHighIV:      settings.blockHighIV      !== false,
      deltaMin:         settings.deltaMin         ?? 0.25,
      deltaMax:         settings.deltaMax         ?? 0.35,
    };

    const setIfEl = (id, val) => { const e = el(id); if (e) e.value = val; };
    setIfEl('threshold-a',         scoringConfig.gradeA);
    setIfEl('threshold-b',         scoringConfig.gradeB);
    setIfEl('threshold-c',         scoringConfig.gradeC);
    setIfEl('threshold-d',         scoringConfig.gradeD);
    setIfEl('threshold-e',         scoringConfig.gradeE);
    const ksEarnings = el('ks-earnings'); if (ksEarnings) ksEarnings.checked = scoringConfig.blockEarnings;
    const ksBidAsk   = el('ks-bid-ask');  if (ksBidAsk)   ksBidAsk.checked   = scoringConfig.blockBidAsk;
    const ksHighIV   = el('ks-high-iv');  if (ksHighIV)   ksHighIV.checked   = scoringConfig.blockHighIV;
    setIfEl('delta-min', scoringConfig.deltaMin);
    setIfEl('delta-max', scoringConfig.deltaMax);
    const monthly = settings.monthlyYieldTarget ?? 1.0;
    setIfEl('yield-target-monthly', monthly);
    setIfEl('yield-target-annual',  (monthly * 12).toFixed(1));

    // Portfolio long-term settings
    setIfEl('settings-birth-year', settings.birthYear ?? 1984);
    setIfEl('settings-glidepath-base', settings.glidepathBase ?? 110);
    setIfEl('settings-cash-drag-threshold', settings.cashDragThreshold ?? 5000);
    setIfEl('settings-dividend-tax-rate', settings.dividendTaxRatePct ?? 30);
    setIfEl('settings-employer-symbols', settings.employerSymbols ?? '');
    setIfEl('settings-ibkr-gateway-url', settings.ibkrGatewayUrl ?? 'https://localhost:5000');
    setIfEl('settings-ibkr-username', settings.ibkrUsername ?? '');
    const dirLabel = el('pf-gateway-dir-label');
    if (dirLabel) dirLabel.textContent = settings.ibkrGatewayDir || 'not set';
    const autoStart = el('settings-ibkr-autostart');
    if (autoStart) autoStart.checked = !!settings.ibkrAutoStart;
    refreshCredentialsStatus();

    // Leave screener filter slider to 0 by default as requested
    screenerFilters.minScore = 0;
    const slider = el('filter-min-score');
    const valEl  = el('filter-min-score-val');
    if (slider) slider.value = 0;
    if (valEl)  valEl.textContent = 0;

  } catch {}

  // Scoring threshold inputs
  ['threshold-a', 'threshold-b', 'threshold-c', 'threshold-d', 'threshold-e'].forEach(id => {
    const e = el(id); if (!e) return;
    e.addEventListener('change', () => {
      const key = {
        'threshold-a':        'gradeA',
        'threshold-b':        'gradeB',
        'threshold-c':        'gradeC',
        'threshold-d':        'gradeD',
        'threshold-e':        'gradeE',
      }[id];
      saveScoringConfig({ [key]: +e.value });
    });
  });

  [
    ['ks-earnings', 'blockEarnings'],
    ['ks-bid-ask',  'blockBidAsk'],
    ['ks-high-iv',  'blockHighIV'],
  ].forEach(([id, key]) => {
    const e = el(id); if (!e) return;
    e.addEventListener('change', () => saveScoringConfig({ [key]: e.checked }));
  });

  ['delta-min', 'delta-max'].forEach(id => {
    const e = el(id); if (!e) return;
    e.addEventListener('change', () => {
      saveScoringConfig({ [id === 'delta-min' ? 'deltaMin' : 'deltaMax']: +e.value });
    });
  });

  const monthlyTarget = el('yield-target-monthly');
  if (monthlyTarget) {
    monthlyTarget.addEventListener('change', () => {
      const v = +monthlyTarget.value;
      window.electronAPI.saveSettings({ monthlyYieldTarget: v });
      const ann = el('yield-target-annual');
      if (ann) ann.value = (v * 12).toFixed(1);
    });
  }

  // Portfolio settings change listeners
  // (IBKR username + password are saved together via the dedicated Save
  // button below, not here — the password must never pass through the
  // generic plaintext saveSettings path.)
  ['settings-birth-year', 'settings-glidepath-base', 'settings-cash-drag-threshold', 'settings-dividend-tax-rate', 'settings-employer-symbols', 'settings-ibkr-gateway-url'].forEach(id => {
    const e = el(id); if (!e) return;
    e.addEventListener('change', async () => {
      const key = {
        'settings-birth-year': 'birthYear',
        'settings-glidepath-base': 'glidepathBase',
        'settings-cash-drag-threshold': 'cashDragThreshold',
        'settings-dividend-tax-rate': 'dividendTaxRatePct',
        'settings-employer-symbols': 'employerSymbols',
        'settings-ibkr-gateway-url': 'ibkrGatewayUrl',
      }[id];
      const textFields = ['settings-employer-symbols', 'settings-ibkr-gateway-url'];
      let val = e.value;
      if (!textFields.includes(id)) {
        val = parseInt(e.value, 10);
      }
      await window.electronAPI.saveSettings({ [key]: val });

      // Trigger portfolio render to update alerts immediately on settings changes
      const p = await window.electronAPI.getPortfolio();
      if (p) renderPortfolio(p);
    });
  });

  // IBKR credentials: save (encrypted) / clear
  async function refreshCredentialsStatus() {
    const status = el('pf-credentials-status');
    if (!status) return;
    const s = await window.electronAPI.ibkrHasCredentials();
    if (!s.encryptionAvailable) {
      status.textContent = 'OS credential encryption unavailable on this machine';
      status.style.color = 'var(--red)';
    } else if (s.hasPassword) {
      status.textContent = 'Password stored (encrypted)';
      status.style.color = 'var(--green)';
    } else {
      status.textContent = 'No password stored';
      status.style.color = 'var(--text-muted)';
    }
  }

  const saveCredsBtn = el('pf-save-credentials');
  if (saveCredsBtn) {
    saveCredsBtn.addEventListener('click', async () => {
      const username = el('settings-ibkr-username')?.value.trim() || '';
      const passwordInput = el('settings-ibkr-password');
      const password = passwordInput?.value || '';
      const r = await window.electronAPI.ibkrSaveCredentials({ username, password });
      if (r.success) {
        if (passwordInput) passwordInput.value = ''; // never leave it sitting in the DOM
        setStatus('live', 'IBKR credentials saved (encrypted)');
      } else {
        setStatus('error', r.error || 'Could not save credentials');
      }
      refreshCredentialsStatus();
    });
  }

  const clearCredsBtn = el('pf-clear-credentials');
  if (clearCredsBtn) {
    clearCredsBtn.addEventListener('click', async () => {
      await window.electronAPI.ibkrClearCredentials();
      const u = el('settings-ibkr-username'); if (u) u.value = '';
      const p = el('settings-ibkr-password'); if (p) p.value = '';
      setStatus('live', 'IBKR credentials cleared');
      refreshCredentialsStatus();
    });
  }

  // IBKR gateway folder picker + auto-start toggle
  const pickDirBtn = el('pf-pick-gateway-dir');
  if (pickDirBtn) {
    pickDirBtn.addEventListener('click', async () => {
      const r = await window.electronAPI.ibkrPickGatewayDir();
      if (r.canceled) return;
      const label = el('pf-gateway-dir-label');
      if (label) label.textContent = r.dir;
      if (!r.valid) {
        setStatus('error', `That folder has no ${r.expected} — pick the unzipped clientportal.gw folder`);
      } else {
        setStatus('live', 'Gateway folder set');
      }
    });
  }
  const autoStartChk = el('settings-ibkr-autostart');
  if (autoStartChk) {
    autoStartChk.addEventListener('change', () => {
      window.electronAPI.saveSettings({ ibkrAutoStart: autoStartChk.checked });
    });
  }

  const resetBtn = el('reset-all-data-btn');
  if (resetBtn) {
    resetBtn.addEventListener('click', async () => {
      const confirmReset = confirm("Are you absolutely sure you want to reset all data? This will permanently erase your watchlist, starred items, and all cached scans, and restart the application fresh.");
      if (!confirmReset) return;

      resetBtn.disabled = true;
      resetBtn.textContent = 'Resetting…';

      try {
        const result = await window.electronAPI.resetAllData();
        if (result.success) {
          alert("All data has been successfully reset. The application will now reload to start completely fresh.");
          window.location.reload();
        } else {
          alert("Failed to reset data: " + (result.error || "Unknown error"));
          resetBtn.disabled = false;
          resetBtn.textContent = 'Reset All Data';
        }
      } catch (err) {
        alert("Failed to reset data: " + err.message);
        resetBtn.disabled = false;
        resetBtn.textContent = 'Reset All Data';
      }
    });
  }
}

el('interval-select').addEventListener('change', async e => {
  await window.electronAPI.saveSettings({ refreshIntervalDays: parseInt(e.target.value, 10) });
  updateIntervalDesc(e.target.value);
});

el('margin-select').addEventListener('change', async e => {
  await window.electronAPI.saveSettings({ minMarginPct: parseFloat(e.target.value) });
  updateMarginDesc(e.target.value);
});

el('price-interval-select').addEventListener('change', async e => {
  await window.electronAPI.saveSettings({ priceRefreshHours: parseFloat(e.target.value) });
  updatePriceIntervalDesc(e.target.value);
});

// ─── List refresh ─────────────────────────────────────────────────────────────
async function loadInitialData() {
  setStatus('loading', 'Loading cache…');
  try {
    // Force-load watchlist and starred stocks before rendering to prevent race conditions on boot
    try {
      watchlist = await window.electronAPI.getWatchlists();
      starredList = await window.electronAPI.getStarred();
    } catch (e) {
      console.error('Boot configuration load failed:', e);
    }

    const result = await window.electronAPI.loadInitialData();
    if (result?.data?.length) {
      renderAll(result.data);
      await refreshIbkrStatus();
      setListLabels(result.fetchedAt, result.minMarginPct, result.nextRefresh);
      setPriceLabels(result.pricedAt, result.nextPriceUpdate);
    } else {
      renderAll([]);
      await refreshIbkrStatus();
    }
  } catch {
    setStatus('error', 'Cache error');
  }
}

function showSettingsProgress(wrapId, fillId, countId, symbolId) {
  el(wrapId).classList.remove('hidden');
  el(fillId).style.width = '0%';
  el(countId).textContent = '';
  el(symbolId).textContent = '';
}
function updateSettingsProgress(fillId, countId, symbolId, done, total, symbol) {
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  el(fillId).style.width = pct + '%';
  el(countId).textContent = total > 0 ? `${done} / ${total}` : '';
  el(symbolId).textContent = symbol || '';
}
function hideSettingsProgress(wrapId) {
  el(wrapId).classList.add('hidden');
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

// ─── Price update ─────────────────────────────────────────────────────────────
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

// ─── Push events from main ────────────────────────────────────────────────────
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

// ─── Button wiring ────────────────────────────────────────────────────────────
const dashboardRefreshBtn = el('refresh-btn');
if (dashboardRefreshBtn) dashboardRefreshBtn.addEventListener('click', refreshData);
el('sidebar-refresh-btn').addEventListener('click', refreshData);
el('price-refresh-btn').addEventListener('click', updatePrices);

// ─── Window controls ─────────────────────────────────────────────────────────
el('wc-minimize').addEventListener('click', () => window.electronAPI.minimizeWindow());
el('wc-maximize').addEventListener('click', () => window.electronAPI.maximizeWindow());
el('wc-close').addEventListener('click',    () => window.electronAPI.closeWindow());

// ─── Privacy Mode ─────────────────────────────────────────────────────────────
let isPrivacyMode = localStorage.getItem('privacyMode') === 'true';

const EYE_OPEN = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>`;
const EYE_CLOSED = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path><line x1="1" y1="1" x2="23" y2="23"></line></svg>`;

function updatePrivacyMode() {
  const btn = el('wc-privacy');
  if (btn) btn.innerHTML = isPrivacyMode ? EYE_CLOSED : EYE_OPEN;
  if (isPrivacyMode) {
    document.body.classList.add('privacy-active');
  } else {
    document.body.classList.remove('privacy-active');
  }
}

function togglePrivacyMode() {
  isPrivacyMode = !isPrivacyMode;
  localStorage.setItem('privacyMode', isPrivacyMode);
  updatePrivacyMode();
}

const privacyBtn = el('wc-privacy');
if (privacyBtn) {
  privacyBtn.addEventListener('click', togglePrivacyMode);
}
updatePrivacyMode();

// ─── Portfolio view (long-term module) ───────────────────────────────────────
const PF_BUCKETS = ['core', 'satellite', 'cash', 'unassigned'];
let portfolio = null;
let pfSort = { col: 'marketValue', dir: 'desc' };
let ibkrState = 'unreachable';
// Assigned in initPortfolioView; re-run when navigating to the Portfolio view
// so the gateway pill reflects a gateway that came online after boot.
let refreshIbkrStatus = () => {};

// Avoids "-0.00%" from float dust
function pfPct(v) {
  if (v == null) return '—';
  return fmt.pct(Math.abs(v) < 0.005 ? 0 : v);
}

function pfSignedCurrency(v) {
  if (v == null) return '—';
  const val = '$' + Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const raw = v < 0 ? `-${val}` : val;
  const color = v < 0 ? 'var(--red)' : 'var(--green)';
  return `<span class="privacy-amount" style="color:${color}">${raw}</span>`;
}

function pfSignedPct(v) {
  if (v == null) return '—';
  const color = v < 0 ? 'var(--red)' : 'var(--green)';
  return `<span style="color:${color}">${v >= 0 ? '+' : ''}${v.toFixed(2)}%</span>`;
}

// Broad-market, buy-and-hold index ETFs → 'core'; anything else → 'satellite'.
// Conservative list: only unambiguous total-market / regional index funds.
const PF_CORE_ETFS = new Set([
  'VTI', 'VOO', 'SPY', 'IVV', 'ITOT', 'SCHB',            // US total market / S&P 500
  'VT', 'ACWI',                                          // global
  'VXUS', 'VEA', 'VWO', 'IEFA', 'IEMG', 'EFA', 'EEM',    // ex-US / intl / EM
  'IWDA', 'IWDC', 'VUSA', 'VWRL', 'VWCE', 'IUSC',        // UCITS equivalents
]);

function pfBucketOptions(selected) {
  return PF_BUCKETS
    .filter(b => b !== 'cash')
    .map(b => `<option value="${b}" ${b === (selected || 'unassigned') ? 'selected' : ''}>${b}</option>`)
    .join('');
}

// ── Symbol Insights dialog ──────────────────────────────────────────────────
// Portfolio/guidance context for any symbol: fund look-through with overlap
// against current holdings (incl. hidden employer exposure), tax notes, and
// compliance status. Distinct from the CSP opportunity modal, which is about
// a specific options trade — but deep-links to it when scanner data exists.
async function openSymbolInsight(symbol) {
  await openSymbolDetails(symbol, 'compliance');
}

function closeSymbolInsight() {
  closeModal();
}

// Tax-Smart Buy Ideas: renders the output of the rules-based engine that maps
// the user's own targets + tax profile onto specific tickers. The heavy
// lifting (PFIC exclusion, dividend tax drag, glidepath) lives in
// lib/recommendations.js; this only draws what comes back.
function renderBuyIdeas(watchlistData) {
  const card = el('pf-buy-ideas-card');
  if (!card) return;
  window.electronAPI.getBuyRecommendations(watchlistData)
    .then(result => {
      const { recommendations, swaps, glidepathNote, deployableCash } = result;
      if (!recommendations.length && !swaps.length) { card.style.display = 'none'; return; }
      card.style.display = '';

      const glideEl = el('pf-buy-ideas-glidepath');
      if (glideEl) {
        glideEl.style.display = glidepathNote ? '' : 'none';
        glideEl.innerHTML = glidepathNote || '';
      }

      const kindBadge = k => k === 'bond'
        ? `<span style="color:#a78bfa; background:rgba(167,139,250,0.12); border:1px solid rgba(167,139,250,0.25); border-radius:4px; padding:1px 6px; font-size:10px; font-weight:600; text-transform:uppercase;">Bond</span>`
        : `<span style="color:var(--cyan); background:rgba(6,182,212,0.1); border:1px solid rgba(6,182,212,0.2); border-radius:4px; padding:1px 6px; font-size:10px; font-weight:600; text-transform:uppercase;">Equity</span>`;

      const dragColor = d => d >= 1.5 ? 'var(--red)' : d >= 0.5 ? '#f59e0b' : 'var(--green)';

      el('pf-buy-ideas-list').innerHTML = recommendations.map(r => `
        <div style="display:flex; gap:12px; align-items:flex-start; padding:10px 12px; background:rgba(255,255,255,0.02); border:1px solid var(--border); border-radius:8px;">
          <div style="min-width:64px;">
            <div class="si-symbol-link" data-symbol="${r.symbol}" style="font-family:'JetBrains Mono',monospace; font-weight:700; font-size:14px; cursor:pointer; color:var(--cyan);" title="View insights for ${r.symbol}">${r.symbol}</div>
            <div style="margin-top:3px;">${kindBadge(r.kind)}</div>
          </div>
          <div style="flex:1; min-width:0;">
            <div style="font-size:12px; color:var(--text-primary);">${r.name}</div>
            <div style="font-size:12px; color:var(--text-secondary); margin-top:2px;">${r.strategyReason}</div>
            <div style="font-size:11px; color:var(--text-muted); margin-top:4px; line-height:1.5;">${r.taxNotes.join(' ')}</div>
          </div>
          <div style="text-align:right; flex-shrink:0;">
            ${r.suggestedUsd > 0 ? `<div style="font-family:'JetBrains Mono',monospace; font-size:13px; color:var(--green);" class="privacy-amount">~$${r.suggestedUsd.toLocaleString('en-US')}</div>` : ''}
            <div style="font-size:11px; color:${dragColor(r.taxDragPct)}; margin-top:2px; display:inline-block; border-bottom: 1px dotted var(--text-secondary); cursor: help;" title="Tax drag is the loss in returns from paying dividend taxes. Since Switzerland doesn't tax capital gains but taxes dividends, low-yield funds are more tax-efficient. This is the estimated annual tax cost of this fund's dividends at your rate.">tax drag ${r.taxDragPct.toFixed(2)}%/yr</div>
          </div>
        </div>`).join('');

      const swapsWrap = el('pf-buy-ideas-swaps');
      if (swapsWrap) {
        swapsWrap.style.display = swaps.length ? '' : 'none';
        if (swaps.length) {
          el('pf-buy-ideas-swaps-list').innerHTML = swaps.map(s => `
            <div style="display:flex; gap:10px; align-items:center; padding:8px 12px; background:rgba(244,63,94,0.05); border:1px solid rgba(244,63,94,0.15); border-radius:8px; font-size:12px;">
              <span class="si-symbol-link" data-symbol="${s.sell}" style="font-family:'JetBrains Mono',monospace; font-weight:700; cursor:pointer;" title="View insights for ${s.sell}">${s.sell}</span>
              <span style="color:var(--text-muted);">→</span>
              ${s.buy
                ? `<span class="si-symbol-link" data-symbol="${s.buy}" style="font-family:'JetBrains Mono',monospace; font-weight:700; color:var(--green); cursor:pointer;" title="View insights for ${s.buy}">${s.buy}</span>`
                : `<span style="font-family:'JetBrains Mono',monospace; font-weight:700; color:var(--green);">US equivalent</span>`}
              <span style="color:var(--text-secondary); flex:1;">${s.reason}</span>
            </div>`).join('');
        }
      }

      // One delegated handler covers every symbol link in the card
      card.onclick = (e) => {
        const link = e.target.closest('.si-symbol-link');
        if (link?.dataset.symbol) openSymbolInsight(link.dataset.symbol);
      };
    })
    .catch(err => console.error('Failed to load buy recommendations:', err));
}

// ─── Employer-stock sell-down plan (Phase 4) ─────────────────────────────────
const SELLDOWN_TAX_NOTE =
  `As a US citizen you owe US <span class="help-tooltip" style="border-bottom:1px dotted var(--text-secondary); cursor:help;" title="Tax on the profit when you sell shares. Shares held over one year qualify for the lower long-term rate (0/15/20%). Switzerland doesn't tax private capital gains at all.">capital-gains tax</span> on sales — prefer lots held over a year, and among those the ones you paid the most for (smallest taxable gain). Reinvest the proceeds using the Tax-Smart Buy Ideas below.`;

const selldownDate = iso => new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });

async function renderSellDownCard() {
  const card = el('pf-selldown-card');
  const body = el('pf-selldown-body');
  if (!card || !body) return;
  try {
    const res = await window.electronAPI.getSellDownStatus();
    if (!res || (!res.plan && !res.candidate)) { card.style.display = 'none'; return; }
    card.style.display = '';
    if (!res.plan) renderSellDownSetup(body, res.candidate);
    else if (res.positionGone) renderSellDownComplete(body, res.plan, null);
    else if (res.status.status === 'complete') renderSellDownComplete(body, res.plan, res.status);
    else renderSellDownActive(body, res.plan, res.status);
  } catch (err) {
    console.error('Failed to load sell-down status:', err);
    card.style.display = 'none';
  }
}

function renderSellDownSetup(body, candidate, existingPlan = null) {
  const pct = candidate.weightPct;
  const sym = candidate.symbol;
  body.innerHTML = `
    <div style="font-size:13px; color:var(--text-primary); line-height:1.6;">
      <strong style="color:#f59e0b;">${pct.toFixed(1)}% of your money is riding on one company — ${sym}, your employer.</strong>
      A common rule of thumb is to keep any single stock under 10% of your portfolio, and employer stock is
      doubly risky: if the company hits a rough patch, your paycheck and your savings take the hit together.
    </div>
    <div style="font-size:12px; color:var(--text-secondary); margin-top:8px; line-height:1.6;">
      A sell-down plan breaks the fix into small, scheduled quarterly sales — no market timing, no big
      one-day decision. The app tracks your progress every time you sync IBKR and tells you each quarter
      exactly how many shares are due.
    </div>
    <div style="display:flex; gap:16px; align-items:flex-end; flex-wrap:wrap; margin-top:14px;">
      <div class="settings-field" style="margin:0;">
        <label class="settings-field-label" for="sd-target-input">Reduce to (% of portfolio)</label>
        <input type="number" class="schedule-select" id="sd-target-input" min="0" max="${Math.max(0, Math.floor(pct - 1))}" step="1" value="${existingPlan ? existingPlan.targetWeightPct : 10}" style="width:110px;">
      </div>
      <div class="settings-field" style="margin:0;">
        <label class="settings-field-label" for="sd-quarters-input">Spread over</label>
        <select class="schedule-select" id="sd-quarters-input" style="width:150px;">
          <option value="4">4 quarters (1 yr)</option>
          <option value="6">6 quarters</option>
          <option value="8" selected>8 quarters (2 yrs)</option>
          <option value="12">12 quarters (3 yrs)</option>
        </select>
      </div>
      <button class="settings-action-btn" id="sd-start-btn" style="width:auto; padding:8px 16px; margin:0;">
        ${existingPlan ? 'Save new plan' : 'Start my plan'}
      </button>
      ${existingPlan ? '<button class="settings-action-btn" id="sd-cancel-btn" style="width:auto; padding:8px 16px; margin:0; opacity:0.7;">Cancel</button>' : ''}
    </div>
    <div id="sd-setup-preview" style="font-size:12px; color:var(--text-secondary); margin-top:10px;"></div>
    <div style="font-size:11px; color:var(--text-muted); margin-top:10px; line-height:1.6;">${SELLDOWN_TAX_NOTE}</div>`;

  if (existingPlan) {
    const q = body.querySelector('#sd-quarters-input');
    if ([...q.options].some(o => +o.value === existingPlan.quartersToTarget)) q.value = String(existingPlan.quartersToTarget);
  }

  // Live preview: "that's about N shares (~$X) per quarter"
  const preview = () => {
    const target = parseFloat(body.querySelector('#sd-target-input').value);
    const quarters = parseInt(body.querySelector('#sd-quarters-input').value, 10);
    const box = body.querySelector('#sd-setup-preview');
    if (!Number.isFinite(target) || target >= pct) { box.textContent = ''; return; }
    const targetShares = candidate.shares * (target / pct);
    const perQ = Math.round((candidate.shares - targetShares) / quarters);
    box.innerHTML = `That works out to selling about <strong>${perQ.toLocaleString('en-US')} shares</strong> (≈ ${fmt.currency(perQ * candidate.price)}) per quarter.`;
  };
  body.querySelector('#sd-target-input').addEventListener('input', preview);
  body.querySelector('#sd-quarters-input').addEventListener('change', preview);
  preview();

  body.querySelector('#sd-start-btn').addEventListener('click', async () => {
    const target = parseFloat(body.querySelector('#sd-target-input').value);
    const quarters = parseInt(body.querySelector('#sd-quarters-input').value, 10);
    if (!Number.isFinite(target) || target < 0 || target >= pct) {
      alert(`The goal needs to be below your current ${pct.toFixed(1)}% weight.`);
      return;
    }
    const res = await window.electronAPI.saveSellDownPlan({ symbol: sym, targetWeightPct: target, quartersToTarget: quarters });
    if (!res.success) { alert(`Couldn't start the plan: ${res.error}`); return; }
    renderSellDownCard();
  });
  body.querySelector('#sd-cancel-btn')?.addEventListener('click', () => renderSellDownCard());
}

function renderSellDownActive(body, plan, s) {
  const chips = {
    'on-track': ['On track', 'var(--green)', 'rgba(34,197,94,0.12)'],
    'ahead':    ['Ahead of schedule', 'var(--cyan)', 'rgba(6,182,212,0.12)'],
    'behind':   ['Behind schedule', '#f59e0b', 'rgba(245,158,11,0.12)'],
  };
  const [chipLabel, chipColor, chipBg] = chips[s.status] || chips['on-track'];

  // Next-step sentence — the one thing a newbie needs from this card.
  let nextStep;
  if (s.sellThisQuarter > 0) {
    const verb = s.status === 'behind' ? 'To catch up, sell' : 'Sell';
    nextStep = `${verb} <strong>~${s.sellThisQuarter.toLocaleString('en-US')} shares of ${plan.symbol}</strong>
      (≈ ${fmt.currency(s.estProceeds)}) before <strong>${selldownDate(s.quarterEndsOn)}</strong>.`;
  } else {
    nextStep = `Nothing to sell right now — your next tranche is due in the quarter starting <strong>${selldownDate(s.quarterEndsOn)}</strong>.`;
  }

  body.innerHTML = `
    <div style="display:flex; align-items:center; gap:10px; flex-wrap:wrap;">
      <span style="color:${chipColor}; background:${chipBg}; border:1px solid ${chipColor}; border-radius:12px; padding:2px 10px; font-size:11px; font-weight:600;">${chipLabel}</span>
      <span style="font-size:12px; color:var(--text-secondary);">Quarter ${s.currentQuarter} of ${plan.quartersToTarget}${s.pastEnd ? ' (plan period has ended)' : ''} · plan ends ${selldownDate(s.planEndsOn)}</span>
    </div>

    <div style="margin-top:12px; font-size:14px; line-height:1.6; color:var(--text-primary); padding:10px 14px; background:rgba(255,255,255,0.03); border:1px solid var(--border); border-radius:8px;">
      <span style="font-size:11px; font-weight:600; text-transform:uppercase; letter-spacing:0.5px; color:${chipColor}; display:block; margin-bottom:4px;">This quarter's step</span>
      ${nextStep}
      <div style="font-size:11px; color:var(--text-muted); margin-top:6px;">Place the order yourself at IBKR — when you next sync, progress updates automatically.</div>
    </div>

    ${s.positionGrew ? `
    <div style="margin-top:10px; font-size:12px; color:#f59e0b; padding:8px 12px; background:rgba(245,158,11,0.08); border:1px solid rgba(245,158,11,0.2); border-radius:8px;">
      Your ${plan.symbol} position has <strong>grown</strong> since the plan started (new RSU vests?). The new shares are folded into what's left to sell.
    </div>` : ''}

    <div style="margin-top:14px;">
      <div style="display:flex; justify-content:space-between; font-size:11px; color:var(--text-secondary); margin-bottom:4px;">
        <span>Started at ${plan.startWeightPct.toFixed(1)}%</span>
        <span style="color:var(--text-primary); font-weight:600;">Now ${s.currentWeightPct.toFixed(1)}%</span>
        <span>Goal ${plan.targetWeightPct.toFixed(0)}%</span>
      </div>
      <div class="score-bar-track"><div class="score-bar-fill" style="width:${s.progressPct}%; background:${chipColor}"></div></div>
      <div style="display:flex; gap:18px; flex-wrap:wrap; font-size:12px; color:var(--text-secondary); margin-top:8px;">
        <span>Sold so far: <strong style="color:var(--text-primary);">${Math.max(0, Math.round(s.actualSold)).toLocaleString('en-US')} shares</strong></span>
        <span>Still to sell: <strong style="color:var(--text-primary);">~${Math.round(s.sharesRemainingToTarget).toLocaleString('en-US')} shares</strong> (${fmt.currency(s.sharesRemainingToTarget * (s.currentValue / s.currentShares))})</span>
        <span>Position today: ${fmt.currency(s.currentValue)}</span>
      </div>
    </div>

    <div style="font-size:11px; color:var(--text-muted); margin-top:12px; line-height:1.6;">${SELLDOWN_TAX_NOTE}</div>

    <div style="display:flex; gap:10px; margin-top:12px;">
      <button class="settings-action-btn" id="sd-adjust-btn" style="width:auto; padding:6px 12px; font-size:11px; margin:0;">Adjust plan</button>
      <button class="settings-action-btn" id="sd-delete-btn" style="width:auto; padding:6px 12px; font-size:11px; margin:0; color:var(--red);">Delete plan</button>
    </div>`;

  body.querySelector('#sd-adjust-btn').addEventListener('click', () => {
    // Re-open setup prefilled; saving re-snapshots today's position as the new baseline.
    renderSellDownSetup(body, {
      symbol: plan.symbol,
      shares: s.currentShares,
      price: s.currentValue / s.currentShares,
      weightPct: s.currentWeightPct,
    }, plan);
  });
  body.querySelector('#sd-delete-btn').addEventListener('click', async () => {
    if (!confirm('Delete this sell-down plan? Your progress tracking will be lost (holdings are untouched).')) return;
    await window.electronAPI.clearSellDownPlan();
    renderSellDownCard();
  });
}

function renderSellDownComplete(body, plan, s) {
  body.innerHTML = `
    <div style="font-size:13px; color:var(--green); line-height:1.6;">
      <strong>🎉 Goal reached.</strong> ${plan.symbol} is ${s ? `down to ${s.currentWeightPct.toFixed(1)}%` : 'no longer'} of your portfolio
      (goal: ${plan.targetWeightPct.toFixed(0)}%, started at ${plan.startWeightPct.toFixed(1)}%).
      Keep an eye on new RSU vests — if the weight creeps back up, start a new plan.
    </div>
    <div style="display:flex; gap:10px; margin-top:12px;">
      <button class="settings-action-btn" id="sd-delete-btn" style="width:auto; padding:6px 12px; font-size:11px; margin:0;">Dismiss</button>
    </div>`;
  body.querySelector('#sd-delete-btn').addEventListener('click', async () => {
    await window.electronAPI.clearSellDownPlan();
    renderSellDownCard();
  });
}

// Upgrade the Employer Stock metric asynchronously with the look-through
// figure: direct position + employer stock hiding inside held index funds.
// Fund compositions come from a 7-day cache, so this is cheap after first run.
async function enrichEmployerExposure(directPct) {
  try {
    const exp = await window.electronAPI.getEmployerExposure();
    if (!exp || exp.impliedUsd <= 0) return;
    const elPct = el('pf-employer-pct');
    if (!elPct) return;
    elPct.innerHTML = `${exp.totalPct.toFixed(2)}%<span style="display:block; font-size:11px; font-weight:400; color:var(--text-muted); margin-top:2px;">${exp.directPct.toFixed(1)}% direct + ${exp.impliedPct.toFixed(1)}% via funds</span>`;
    elPct.style.color = exp.totalPct > 15 ? 'var(--red)' : exp.totalPct > 10 ? '#f59e0b' : '';
    const card = elPct.closest('.metric-card');
    if (card) {
      const perFund = exp.perFund.map(f => `${f.symbol}: ${f.employerFundPct.toFixed(1)}% of fund ≈ $${f.impliedUsd.toLocaleString('en-US')}`).join('\n');
      card.title = `True employer exposure (floor — only each fund's top holdings are visible):\n$${exp.impliedUsd.toLocaleString('en-US')} held indirectly via ${exp.perFund.length} fund(s)\n\n${perFund}`;
    }
  } catch {}
}

function renderFilteredGuidance() {
  const listEl = el('pf-guidance-list');
  if (!listEl) return;

  if (currentGuidanceItems.length === 0) {
    listEl.innerHTML = `
      <div class="guidance-item severity-info" style="border: 1px dashed rgba(6, 182, 212, 0.35); background: transparent;">
        <span class="guidance-icon">✓</span>
        <div class="guidance-content">
          <span class="guidance-title">Portfolio is compliant</span>
          <span class="guidance-message">No PFIC assets, elevated employer concentrations, or cash drag detected. Your current holdings are structured appropriately.</span>
        </div>
      </div>`;
    const bAll = el('badge-count-all');
    const bTax = el('badge-count-tax');
    const bRebalance = el('badge-count-rebalance');
    const bOptions = el('badge-count-options');
    if (bAll) bAll.textContent = '0';
    if (bTax) bTax.textContent = '0';
    if (bRebalance) bRebalance.textContent = '0';
    if (bOptions) bOptions.textContent = '0';
    return;
  }

  let allCount = currentGuidanceItems.length;
  let taxCount = 0;
  let rebalanceCount = 0;
  let optionsCount = 0;

  for (const item of currentGuidanceItems) {
    if (item.type === 'tax-pfic' || item.type === 'concentration' || item.type === 'swiss-tax') {
      taxCount++;
    } else if (item.type === 'glidepath' || item.type === 'tax-loss-harvesting' || item.type === 'tax-rebalance' || item.type === 'rebalance-watchlist') {
      rebalanceCount++;
    } else if (item.type === 'options-covered-call') {
      optionsCount++;
    }
  }

  const badgeAll = el('badge-count-all');
  const badgeTax = el('badge-count-tax');
  const badgeRebalance = el('badge-count-rebalance');
  const badgeOptions = el('badge-count-options');
  if (badgeAll) badgeAll.textContent = String(allCount);
  if (badgeTax) badgeTax.textContent = String(taxCount);
  if (badgeRebalance) badgeRebalance.textContent = String(rebalanceCount);
  if (badgeOptions) badgeOptions.textContent = String(optionsCount);

  const filtered = currentGuidanceItems.filter(item => {
    if (currentGuidanceFilter === 'all') return true;
    if (currentGuidanceFilter === 'tax') {
      return item.type === 'tax-pfic' || item.type === 'concentration' || item.type === 'swiss-tax';
    }
    if (currentGuidanceFilter === 'rebalance') {
      return item.type === 'glidepath' || item.type === 'tax-loss-harvesting' || item.type === 'tax-rebalance' || item.type === 'rebalance-watchlist';
    }
    if (currentGuidanceFilter === 'options') {
      return item.type === 'options-covered-call';
    }
    return false;
  });

  if (filtered.length === 0) {
    listEl.innerHTML = `
      <div style="padding: 32px; text-align: center; color: var(--text-muted); font-size: 13px;">
        No alerts in this category.
      </div>`;
    return;
  }

  listEl.innerHTML = filtered.map(item => {
    const icon = item.severity === 'error' ? '✕' : item.severity === 'warning' ? '⚠' : 'ℹ';
    return `
      <div class="guidance-item severity-${item.severity}">
        <span class="guidance-icon">${icon}</span>
        <div class="guidance-content">
          <span class="guidance-title">${item.title}</span>
          <span class="guidance-message">${item.message}</span>
        </div>
      </div>`;
  }).join('');
}

function renderPortfolio(p) {
  portfolio = p;
  const has = p.holdings.length > 0;
  el('pf-empty-state').style.display = has ? 'none' : '';
  el('pf-content').style.display = has ? '' : 'none';

  el('pf-source-badge').textContent = p.updatedAt
    ? `${p.source || 'manual'} · ${new Date(p.updatedAt).toLocaleDateString()}`
    : 'no data';

  const d = p.derived;
  const totalValStr = has ? fmt.currency(d.totalValue) : '—';
  const cashValStr = has ? fmt.currency(p.cash || 0) : '—';

  const totalEl = el('pf-total-value');
  const cashEl = el('pf-cash');
  
  if (totalEl) {
    totalEl.innerHTML = totalValStr;
    if (totalValStr.length > 10) totalEl.classList.add('long-value');
    else totalEl.classList.remove('long-value');
  }

  if (cashEl) {
    cashEl.innerHTML = cashValStr;
    if (cashValStr.length > 10) cashEl.classList.add('long-value');
    else cashEl.classList.remove('long-value');
  }

  el('pf-cash-label').textContent = p.baseCurrency ? `Cash (${p.baseCurrency})` : 'Cash';
  const conc = d.concentration;
  el('pf-employer-pct').textContent = has ? fmt.pct(conc.pct) : '—';
  el('pf-employer-pct').style.color = conc.pct > 15 ? 'var(--red)' : conc.pct > 10 ? '#f59e0b' : '';
  if (has) enrichEmployerExposure(conc.pct);
  const top = d.topPositions[0];
  el('pf-largest').textContent = top ? `${top.symbol} · ${top.weightPct.toFixed(1)}%` : '—';

  // Fetch and render compliance guidance alerts
  const listEl = el('pf-guidance-list');
  if (listEl) {
    if (!has) {
      listEl.innerHTML = `
        <div class="guidance-item severity-info" style="border: 1px dashed rgba(6, 182, 212, 0.35); background: transparent;">
          <span class="guidance-icon">◔</span>
          <div class="guidance-content">
            <span class="guidance-title">No portfolio imported</span>
            <span class="guidance-message">Import your IBKR Activity Statement in the Portfolio screen to generate compliance alerts.</span>
          </div>
        </div>`;
      const wrap = el('dashboard-actionable-steps-wrap');
      if (wrap) wrap.classList.add('hidden');
    } else {
      const watchlistData = (window.allData || allData || [])
        .filter(d => (window.starredList || starredList || []).includes(d.symbol) || (window.watchlist || watchlist || []).includes(d.symbol))
        .map(d => ({
          symbol: d.symbol,
          score: d._score?.totalScore ?? 0,
          grade: d._score?.grade ?? 'F',
          ivr: d.ivr ?? null,
          impliedVolatility: d.impliedVolatility ?? null,
          regularMarketPrice: d.regularMarketPrice ?? d.currentPrice ?? null
        }));
      window.electronAPI.getPortfolioGuidance(p.holdings, p.cash, p.targets, watchlistData)
        .then(guidanceItems => {
          currentGuidanceItems = guidanceItems || [];
          renderFilteredGuidance();
          updateDashboardActionableSteps(currentGuidanceItems, p.holdings);
        })
        .catch(err => console.error('Failed to load portfolio guidance:', err));

      renderBuyIdeas(watchlistData);
      renderSellDownCard();
    }
  }
  if (!has) {
    const ideasCard = el('pf-buy-ideas-card');
    if (ideasCard) ideasCard.style.display = 'none';
    const sdCard = el('pf-selldown-card');
    if (sdCard) sdCard.style.display = 'none';
  }

  if (!has) return;

  // Holdings table — rows carry their original index so edits survive sorting
  const rows = p.holdings.map((h, i) => {
    const pnl = (h.costBasis != null && h.marketValue != null) ? h.marketValue - h.costBasis : null;
    return {
      idx: i,
      symbol:      h.symbol,
      marketValue: h.marketValue ?? 0,
      weightPct:   d.totalValue > 0 ? ((h.marketValue || 0) / d.totalValue) * 100 : 0,
      costBasis:   h.costBasis ?? null,
      pnl,
      pnlPct:      (pnl != null && h.costBasis > 0) ? (pnl / h.costBasis) * 100 : null,
      currency:    h.currency || null,
      recommendation: h.recommendation || { type: '—', reason: '' },
      bucket:      h.bucket || 'unassigned',
      isEmployerStock: !!h.isEmployerStock,
    };
  });

  const { col, dir } = pfSort;
  const mul = dir === 'desc' ? -1 : 1;
  rows.sort((a, b) => {
    const av = a[col], bv = b[col];
    if (av == null && bv == null) return 0;
    if (av == null) return 1;             // nulls always last
    if (bv == null) return -1;
    if (typeof av === 'string') return mul * av.localeCompare(bv);
    return mul * (av - bv);
  });

  el('pf-holdings-table').querySelectorAll('thead th[data-col]').forEach(th => {
    if (th.dataset.col === col) th.setAttribute('data-sort', dir);
    else th.removeAttribute('data-sort');
  });

  el('pf-holdings-tbody').innerHTML = rows.map(r => `
    <tr>
      <td class="symbol-cell click-insight" data-symbol="${r.symbol}" style="cursor: pointer; color: var(--cyan); text-decoration: underline dotted;" title="Click for details &amp; compliance insights">${r.symbol}</td>
      <td>${fmt.currency(r.marketValue)}</td>
      <td>${pfPct(r.weightPct)}</td>
      <td>${r.costBasis != null ? fmt.currency(r.costBasis) : '—'}</td>
      <td>${pfSignedCurrency(r.pnl)}</td>
      <td>${pfSignedPct(r.pnlPct)}</td>
      <td>${r.currency || '—'}</td>
      <td style="text-align: center; vertical-align: middle; padding: 6px 4px;">
        ${renderRecommendationBadge(r.recommendation.type)}
        ${r.recommendation.reason ? `<div style="font-size: 10px; color: var(--text-secondary); margin-top: 4px; max-width: 140px; white-space: normal; line-height: 1.2; text-align: center; display: block; margin-left: auto; margin-right: auto;">${r.recommendation.reason}</div>` : ''}
      </td>
      <td><select class="schedule-select pf-bucket-select" data-idx="${r.idx}">${pfBucketOptions(r.bucket)}</select></td>
    </tr>`).join('');

  el('pf-holdings-tbody').querySelectorAll('.click-insight').forEach(cell => {
    cell.addEventListener('click', () => {
      openSymbolInsight(cell.dataset.symbol);
    });
  });

  el('pf-holdings-tbody').querySelectorAll('.pf-bucket-select').forEach(sel => {
    sel.addEventListener('change', async () => {
      const holdings = [...portfolio.holdings];
      holdings[+sel.dataset.idx] = { ...holdings[+sel.dataset.idx], bucket: sel.value === 'unassigned' ? null : sel.value };
      renderPortfolio(await window.electronAPI.savePortfolio({ holdings }));
    });
  });

  // Target fields
  const targetFor = b => (p.targets.find(t => t.bucket === b) || {}).targetPct ?? '';
  el('pf-targets-fields').innerHTML = PF_BUCKETS.filter(b => b !== 'unassigned').map(b => `
    <div class="settings-field">
      <label class="settings-field-label" for="pf-target-${b}">${b} target %</label>
      <input type="number" class="schedule-select pf-target-input" id="pf-target-${b}" data-bucket="${b}" min="0" max="100" step="1" value="${targetFor(b)}">
    </div>`).join('');

  // Fetch settings for recommended allocation calculations
  window.electronAPI.getSettings().then(settings => {
    const currentYear = new Date().getFullYear();
    const age = settings.birthYear ? currentYear - settings.birthYear : null;
    const base = settings.glidepathBase ?? 110;
    
    const ageLabelEl = el('pf-rec-age-label');
    const boxEl = el('pf-recommendation-box');
    if (!ageLabelEl || !boxEl) return;

    if (!age || age <= 0) {
      ageLabelEl.textContent = 'Setup Birth Year in Settings';
      el('pf-rec-core').textContent = '—';
      el('pf-rec-sat').textContent = '—';
      el('pf-rec-cash').textContent = '—';
      const applyBtn = el('pf-apply-rec-btn');
      if (applyBtn) applyBtn.style.display = 'none';
      return;
    }

    const applyBtn = el('pf-apply-rec-btn');
    if (applyBtn) applyBtn.style.display = '';
    const equityTarget = Math.max(0, Math.min(100, base - age));
    ageLabelEl.textContent = `Age ${age} (Equity Target: ${equityTarget}%)`;
    
    const cashRec = 5;
    const satRec = 10;
    const coreRec = 85;

    el('pf-rec-core').textContent = `${coreRec}%`;
    el('pf-rec-sat').textContent = `${satRec}%`;
    el('pf-rec-cash').textContent = `${cashRec}%`;

    if (applyBtn) {
      const newApplyBtn = applyBtn.cloneNode(true);
      applyBtn.parentNode.replaceChild(newApplyBtn, applyBtn);
      newApplyBtn.addEventListener('click', async () => {
        const targets = [
          { bucket: 'core', targetPct: coreRec },
          { bucket: 'satellite', targetPct: satRec },
          { bucket: 'cash', targetPct: cashRec }
        ];
        renderPortfolio(await window.electronAPI.savePortfolio({ targets }));
      });
    }
  }).catch(err => console.error('Failed to load settings for recommended allocation:', err));

  el('pf-targets-fields').querySelectorAll('.pf-target-input').forEach(inp => {
    inp.addEventListener('change', async () => {
      const targets = PF_BUCKETS.filter(b => b !== 'unassigned')
        .map(b => {
          const v = parseFloat(el(`pf-target-${b}`).value);
          return Number.isFinite(v) && v > 0 ? { bucket: b, targetPct: v } : null;
        })
        .filter(Boolean);
      renderPortfolio(await window.electronAPI.savePortfolio({ targets }));
    });
  });
  el('pf-tolerance-input').value = p.tolerancePct;

  // Drift table
  el('pf-drift-tbody').innerHTML = d.drift.map(r => {
    const driftColor = r.rebalance ? (r.driftPct > 0 ? '#f59e0b' : 'var(--red)') : 'var(--green)';
    const action = r.rebalance
      ? `${r.tradeValue > 0 ? 'Buy' : 'Sell'} ${fmt.currency(Math.abs(r.tradeValue))}`
      : 'On target';
    return `<tr>
      <td>${r.bucket}</td>
      <td>${r.targetPct.toFixed(0)}%</td>
      <td>${fmt.pct(r.actualPct)}</td>
      <td style="color:${driftColor}">${r.driftPct >= 0 ? '+' : ''}${r.driftPct.toFixed(1)}pp</td>
      <td>${action}</td>
    </tr>`;
  }).join('');

  loadPortfolioHealth(has);
}

function updateDashboardActionableSteps(guidanceItems, holdings) {
  const wrap = el('dashboard-actionable-steps-wrap');
  const list = el('dashboard-actionable-steps-list');
  if (!wrap || !list) return;

  if (!holdings || holdings.length === 0) {
    wrap.classList.add('hidden');
    return;
  }

  const steps = [];

  // 1. Position recommendations
  holdings.forEach(h => {
    const rec = h.recommendation;
    if (rec && rec.type && rec.type !== 'Hold' && rec.type !== '—') {
      const actionStyle = rec.type === 'Buy' ? 'color: var(--green)' : 'color: var(--orange)';
      steps.push(`
        <li style="margin-bottom: 4px;">
          <strong style="${actionStyle}">${rec.type} ${h.symbol}</strong>: 
          ${rec.reason || 'Asset needs adjustment.'}
        </li>
      `);
    }
  });

  // 2. Compliance and health alerts
  if (guidanceItems) {
    guidanceItems.forEach(item => {
      if (item.severity === 'error' || item.severity === 'warning') {
        const itemStyle = item.severity === 'error' ? 'color: var(--red)' : 'color: var(--orange)';
        steps.push(`
          <li style="margin-bottom: 4px;">
            <strong style="${itemStyle}">${item.title}</strong>: ${item.message}
          </li>
        `);
      }
    });
  }

  if (steps.length > 0) {
    list.innerHTML = steps.join('');
    wrap.classList.remove('hidden');
  } else {
    list.innerHTML = `<li style="list-style: none; margin-left: -20px; color: var(--text-muted);">✓ Your portfolio is perfectly balanced. No immediate action required!</li>`;
    wrap.classList.remove('hidden');
  }
}

// ─── Portfolio health + dividends (async, quote-backed) ─────────────────────
let pfHealthLoading = false;

async function loadPortfolioHealth(hasHoldings) {
  const card = el('pf-health-card');
  const navBadge = el('nav-health-badge');
  const emptyState = el('pf-health-empty-state');
  if (emptyState) emptyState.style.display = hasHoldings ? 'none' : '';
  if (!hasHoldings) {
    el('pf-health-grade').textContent = '—';
    el('pf-dividends').textContent = '—';
    if (card) card.style.display = 'none';
    if (navBadge) navBadge.innerHTML = '';
    return;
  }
  if (pfHealthLoading) return;
  pfHealthLoading = true;
  try {
    const result = await window.electronAPI.getPortfolioHealth();
    if (!result || !result.health) return;
    const { health, dividends } = result;

    // Metric cards + sidebar badge
    el('pf-health-grade').innerHTML =
      `${renderGradeBadge(health.grade)} <span style="font-size:0.6em; color:var(--text-secondary)">${health.totalScore}/100</span>`;
    el('pf-dividends').innerHTML = fmt.currency(dividends.annual);
    if (navBadge) navBadge.innerHTML = renderGradeBadge(health.grade);

    // Breakdown card
    if (card) {
      card.style.display = '';
      el('pf-health-badge').innerHTML = renderGradeBadge(health.grade);
      el('pf-health-caption').textContent = health.caps.length
        ? health.gradeLabel
        : `${health.totalScore}/100 — ${health.gradeLabel}. Each dimension below explains its score and the one action that would most improve it.`;

      el('pf-health-breakdown').innerHTML = health.breakdown.map(b => {
        const ratio = b.max > 0 ? b.score / b.max : 0;
        const color = ratio >= 0.8 ? 'var(--green)' : ratio >= 0.4 ? '#f59e0b' : 'var(--red)';
        return `
          <div style="margin-bottom:14px">
            <div style="display:flex; justify-content:space-between; align-items:baseline; margin-bottom:4px">
              <span style="font-size:13px; font-weight:600">${b.label}</span>
              <span style="font-size:12px; color:${color}">${b.score}/${b.max}</span>
            </div>
            <div class="score-bar-track"><div class="score-bar-fill" style="width:${ratio * 100}%; background:${color}"></div></div>
            <div style="font-size:12px; color:var(--text-secondary); margin-top:4px">${b.detail}</div>
            <div style="font-size:12px; color:var(--text-main); margin-top:2px">→ ${b.action}</div>
          </div>`;
      }).join('');
    }
  } catch (err) {
    console.error('Failed to load portfolio health:', err);
  } finally {
    pfHealthLoading = false;
  }
}

async function initPortfolioView() {  // Sortable holdings headers — same toggle behavior as the CSP tables
  el('pf-holdings-table').querySelectorAll('thead th[data-col]').forEach(th => {
    th.classList.add('sortable-th');
    th.addEventListener('click', () => {
      const col = th.dataset.col;
      const dir = pfSort.col === col && pfSort.dir === 'desc' ? 'asc' : 'desc';
      pfSort = { col, dir };
      if (portfolio) renderPortfolio(portfolio);
    });
  });

  el('pf-autobucket-btn').addEventListener('click', async () => {
    if (!portfolio) return;
    const holdings = portfolio.holdings.map(h =>
      h.bucket ? h : { ...h, bucket: PF_CORE_ETFS.has(h.symbol) ? 'core' : 'satellite' }
    );
    renderPortfolio(await window.electronAPI.savePortfolio({ holdings }));
  });

  el('pf-import-btn').addEventListener('click', async () => {
    const result = await window.electronAPI.importPortfolioCsv();
    if (result.canceled) return;
    if (!result.success) { setStatus('error', result.error || 'Import failed'); return; }
    renderPortfolio(result.portfolio);
    if (result.warnings?.length) console.warn('CSV import warnings:', result.warnings);
  });

  // ── IBKR gateway status + live sync ─────────────────────────────────────
  refreshIbkrStatus = async function () {
    const btn = el('pf-ibkr-sync-btn');
    if (!btn) return;
    const s = await window.electronAPI.ibkrStatus();
    ibkrState = s.state;

    // Update consolidated sidebar status and dot
    setStatus('live', 'Live');

    if (s.state === 'connected') {
      btn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="margin-right:6px"><path d="M21 12a9 9 0 1 1-3-6.7"/><polyline points="21 3 21 9 15 9"/></svg>Sync IBKR`;
    } else if (s.state === 'needs-login') {
      btn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="margin-right:6px"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><polyline points="10 17 15 12 10 7"/><line x1="15" y1="12" x2="3" y2="12"/></svg>Login to IBKR`;
    } else if (s.state === 'unreachable') {
      btn.innerHTML = `<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="margin-right:6px"><polygon points="5 3 19 12 5 21 5 3"/></svg>Start Gateway`;
    }
  };

  // After launching the gateway, poll until it answers (slow Java startup) —
  // and bail out immediately if the process dies instead of booting.
  async function superviseGatewayStartup(timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      await new Promise(r => setTimeout(r, 2000));
      const running = await window.electronAPI.ibkrGatewayRunning();
      if (!running.running) return 'died';
      await refreshIbkrStatus();
      if (ibkrState === 'needs-login' || ibkrState === 'connected') return ibkrState;
    }
    return 'timeout';
  }

  // ── Embedded IBKR login (webview) ───────────────────────────────────────
  let ibkrLoginPoll = null;
  let ibkrLoginDomPoll = null;

  async function openIbkrLogin() {
    const overlay = el('ibkr-login-overlay');
    const host = el('ibkr-webview-host');
    const loading = el('ibkr-login-loading');
    if (!overlay || !host) return;

    const s = await window.electronAPI.ibkrStatus();
    ibkrLoginHandled = false; // new login attempt → success may fire again
    // Build a fresh webview each open so it always targets the current URL
    host.innerHTML = '';
    if (loading) loading.style.display = '';
    const wv = document.createElement('webview');
    wv.setAttribute('src', s.gatewayUrl || 'https://localhost:5000');
    wv.setAttribute('partition', 'persist:ibkr');
    wv.style.width = '100%';
    wv.style.height = '100%';
    wv.addEventListener('did-stop-loading', () => { if (loading) loading.style.display = 'none'; });

    // The gateway's terminal page after auth is a bare "Client login succeeds"
    // body. Capture it the moment it renders: close the modal and sync
    // immediately instead of leaving raw text on screen. IBKR's 2FA screen
    // updates itself in place after you approve the phone push (no full page
    // navigation), so `did-stop-loading` alone never fires again — poll the
    // body text on a short interval too, for as long as the modal is open.
    const checkForSuccess = () => {
      wv.executeJavaScript(`(document.body?.innerText || '').slice(0, 200)`)
        .then(text => {
          if (/client login succeeds/i.test(text || '')) onIbkrLoginSuccess();
        })
        .catch(() => {});
    };
    wv.addEventListener('did-stop-loading', checkForSuccess);
    clearInterval(ibkrLoginDomPoll);
    ibkrLoginDomPoll = setInterval(checkForSuccess, 1500);

    // Diagnostics: surface webview-side load/console failures in devtools so a
    // stuck login screen can be root-caused (e.g. a poll request inside the
    // IBKR page itself failing) instead of just looking idle.
    wv.addEventListener('did-fail-load', (e) => {
      if (e.errorCode === -3) return; // ERR_ABORTED — normal on redirects, not a real failure
      console.warn('[ibkr-login] webview did-fail-load', e.errorCode, e.errorDescription, e.validatedURL);
    });
    wv.addEventListener('console-message', (e) => {
      if (e.level >= 2) console.warn('[ibkr-login:page]', e.message);
    });

    // Prefill username + (if stored) password and auto-submit, landing the
    // user straight at the 2FA prompt. Password is fetched fresh from the
    // OS-encrypted store each time and never persisted in renderer state.
    const creds = await window.electronAPI.ibkrGetCredentials();
    const username = (creds.username || '').trim();
    const password = creds.password || null;
    if (username || password) {
      wv.addEventListener('dom-ready', () => {
        wv.executeJavaScript(`
          (function fill(tries) {
            const userInput = document.querySelector('#user_name')
              || document.querySelector('#username')
              || document.querySelector('input[name="username"]')
              || document.querySelector('input[name="user_name"]')
              || document.querySelector('input[type="text"][autocomplete*="user"]');
            const passInput = document.querySelector('input[type="password"]');

            if (userInput || passInput) {
              const setVal = (el, val) => {
                if (!el || !val || el.value) return;
                el.value = val;
                el.dispatchEvent(new Event('input', { bubbles: true }));
                el.dispatchEvent(new Event('change', { bubbles: true }));
              };
              setVal(userInput, ${JSON.stringify(username)});
              setVal(passInput, ${JSON.stringify(password)});

              if (${JSON.stringify(!!password)} && userInput?.value && passInput?.value) {
                // Auto-submit only when BOTH fields are filled — never submit
                // with just a username. Small delay lets IBKR's own JS validators run.
                setTimeout(() => {
                  const btn = document.querySelector('#submitForm')
                    || document.querySelector('button[type="submit"]')
                    || document.querySelector('input[type="submit"]')
                    || [...document.querySelectorAll('button')].find(b => /log\\s*in/i.test(b.textContent || ''));
                  if (btn) btn.click();
                  else passInput.form?.requestSubmit?.();
                }, 300);
              } else if (passInput) {
                passInput.focus();
              }
            } else if (tries > 0) {
              setTimeout(() => fill(tries - 1), 500); // page may render the form late
            }
          })(10);
        `).catch(() => {});
      });
    }
    host.appendChild(wv);
    overlay.classList.remove('hidden');

    // While the modal is open, poll for successful auth as a fallback to the
    // success-page capture above.
    clearInterval(ibkrLoginPoll);
    ibkrLoginPoll = setInterval(async () => {
      await refreshIbkrStatus();
      if (ibkrState === 'connected') onIbkrLoginSuccess();
    }, 3000);
  }

  // Idempotent: reachable from both the success-page capture and the status
  // poll — whichever fires first closes the modal and kicks off a sync.
  let ibkrLoginHandled = false;
  async function onIbkrLoginSuccess() {
    if (ibkrLoginHandled) return;
    ibkrLoginHandled = true;
    closeIbkrLogin();
    setStatus('live', 'IBKR login successful — syncing your portfolio…');
    // We already know we're authenticated (this fires off the "Client login
    // succeeds" page or a connected status poll) — set state directly instead
    // of re-checking via refreshIbkrStatus() first. Right after 2FA the real
    // gateway's /iserver/auth/status can briefly still answer needs-login
    // before the session propagates, and the sync button's click handler
    // reads ibkrState synchronously, so a stale refresh here would reopen
    // this same login modal instead of syncing.
    ibkrState = 'connected';
    const syncBtn = el('pf-ibkr-sync-btn');
    if (syncBtn && !syncBtn.disabled) syncBtn.click();
    refreshIbkrStatus(); // update the pill/button styling to match, in the background
  }

  function closeIbkrLogin() {
    const overlay = el('ibkr-login-overlay');
    const host = el('ibkr-webview-host');
    clearInterval(ibkrLoginPoll);
    ibkrLoginPoll = null;
    clearInterval(ibkrLoginDomPoll);
    ibkrLoginDomPoll = null;
    if (overlay) overlay.classList.add('hidden');
    if (host) host.innerHTML = ''; // tear down the webview
  }

  el('ibkr-login-close')?.addEventListener('click', closeIbkrLogin);

  el('pf-ibkr-sync-btn').addEventListener('click', async () => {
    const btn = el('pf-ibkr-sync-btn');
    
    if (ibkrState === 'connected') {
      btn.disabled = true;
      const prevLabel = btn.innerHTML;
      btn.textContent = 'Syncing…';
      try {
        const result = await window.electronAPI.ibkrSync();
        if (result.success) {
          renderPortfolio(result.portfolio);
          setStatus('live', `Synced ${result.portfolio.holdings.length} holdings from IBKR (${result.accountId})`);
          if (result.warnings?.length) console.warn('IBKR sync warnings:', result.warnings);
        } else {
          setStatus('error', result.error || 'IBKR sync failed');
        }
      } catch {
        setStatus('error', 'IBKR sync failed');
      } finally {
        btn.innerHTML = prevLabel;
        refreshIbkrStatus();
      }
      return;
    }
    
    if (ibkrState === 'needs-login') {
      openIbkrLogin();
      return;
    }
    
    if (ibkrState === 'unreachable') {
      btn.disabled = true;
      const prevLabel = btn.innerHTML;
      btn.textContent = 'Starting…';
      try {
        const running = await window.electronAPI.ibkrGatewayRunning();
        if (!running.running) {
          const start = await window.electronAPI.ibkrGatewayStart();
          if (!start.success) {
            setStatus('error', start.error || 'Could not start gateway');
            btn.innerHTML = prevLabel;
            btn.disabled = false;
            return;
          }
          setStatus('loading', 'Starting IBKR gateway… (Java takes ~15–30s)');
          const outcome = await superviseGatewayStartup(60000);
          if (outcome === 'needs-login') {
            setStatus('', 'Gateway ready — log in to IBKR');
            openIbkrLogin();
          } else if (outcome === 'connected') {
            setStatus('live', 'IBKR connected — you can now Sync.');
          } else if (outcome === 'died') {
            const log = await window.electronAPI.ibkrGatewayLog(8);
            const tail = log.tail.length ? ` Last log: "${log.tail[log.tail.length - 1]}"` : '';
            setStatus('error', `Gateway exited during startup (code ${log.lastExit?.code ?? '?'}).${tail}`);
          } else {
            setStatus('error', 'Gateway is running but not answering after 60s');
          }
        }
      } catch (err) {
        setStatus('error', 'Failed to launch gateway: ' + err.message);
      } finally {
        btn.innerHTML = prevLabel;
        btn.disabled = false;
        refreshIbkrStatus();
      }
    }
  });

  refreshIbkrStatus();

  el('pf-prices-btn').addEventListener('click', async () => {
    const btn = el('pf-prices-btn');
    btn.disabled = true;
    const prevLabel = btn.innerHTML;
    btn.textContent = 'Refreshing…';
    try {
      const result = await window.electronAPI.refreshPortfolioPrices();
      if (result.success) {
        renderPortfolio(result.portfolio);
        setStatus('live', `Prices updated (${result.updated} holdings${result.skipped.length ? `, ${result.skipped.length} kept imported values` : ''})`);
      } else {
        setStatus('error', 'Price refresh failed');
      }
    } catch {
      setStatus('error', 'Price refresh failed');
    } finally {
      btn.disabled = false;
      btn.innerHTML = prevLabel;
    }
  });

  el('pf-tolerance-input').addEventListener('change', async () => {
    const v = parseFloat(el('pf-tolerance-input').value);
    if (!Number.isFinite(v) || v <= 0) return;
    renderPortfolio(await window.electronAPI.savePortfolio({ tolerancePct: v }));
  });

  // Ticker Compliance Lookup Search Wire-up
  async function runTickerLookup() {
    const input = el('pf-lookup-input');
    const resultBox = el('pf-lookup-result');
    if (!input || !resultBox) return;

    const symbol = input.value.trim().toUpperCase();
    if (!symbol) return;

    resultBox.classList.remove('hidden');
    resultBox.innerHTML = '<div style="color: var(--text-muted); font-size:12px;">Analyzing ticker context...</div>';

    try {
      const res = await window.electronAPI.analyzeTicker(symbol, portfolio?.holdings || [], portfolio?.cash || 0);
      if (!res) {
        resultBox.innerHTML = '<div style="color: var(--red); font-size:12px;">Failed to analyze ticker.</div>';
        return;
      }

      const badgeClass = `suitability-${res.suitability}`;
      const badgeText = res.suitability === 'danger' ? 'High Risk' : res.suitability === 'caution' ? 'Caution' : 'Suitable';
      
      let holdingNote = 'Not currently held.';
      if (res.weightPct > 0) {
        holdingNote = `Holds <strong>${res.weightPct.toFixed(1)}%</strong> of your portfolio.`;
      }

      resultBox.innerHTML = `
        <div class="lookup-result-header">
          <span class="lookup-ticker">${res.symbol}</span>
          <span class="lookup-badge ${badgeClass}">${badgeText}</span>
        </div>
        <div class="lookup-row">
          <span class="lookup-label">Asset Type</span>
          <span class="lookup-value" style="text-transform: capitalize;">${res.type}</span>
        </div>
        <div class="lookup-row">
          <span class="lookup-label">Domicile</span>
          <span class="lookup-value">${res.domicile}</span>
        </div>
        <div class="lookup-row">
          <span class="lookup-label">Tax Class</span>
          <span class="lookup-value">${res.isPfic ? 'PFIC (Foreign pooled fund)' : 'Standard (Non-PFIC)'}</span>
        </div>
        <div class="lookup-row">
          <span class="lookup-label">Portfolio Impact</span>
          <span class="lookup-value">${holdingNote}</span>
        </div>
        <div class="lookup-details">
          <strong>Guidance:</strong> ${res.reason}<br><br>
          ${res.details}
        </div>
      `;
    } catch (e) {
      resultBox.innerHTML = `<div style="color: var(--red); font-size:12px;">Error: ${e.message}</div>`;
    }
  }

  // Sidebar Ticker Search Wire-up
  const sidebarSearch = el('sidebar-search-input');
  if (sidebarSearch) {
    sidebarSearch.addEventListener('keydown', e => {
      if (e.key === 'Enter') {
        const val = sidebarSearch.value.trim().toUpperCase();
        if (val) {
          openSymbolInsight(val);
          sidebarSearch.value = '';
        }
      }
    });
  }

  // Guidance Tabs Category Filters Wire-up
  document.querySelectorAll('.guidance-tabs .tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.guidance-tabs .tab-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentGuidanceFilter = btn.dataset.filter;
      renderFilteredGuidance();
    });
  });

  renderPortfolio(await window.electronAPI.getPortfolio());
}

// ─── Boot ─────────────────────────────────────────────────────────────────────
initSettingsUI();
initScreenerWatchlist();
initScreenerFilters();
initScreenerSorting();
initDiscoverView();
initPortfolioView();
initOptionsScannerView();
initSortableTable('table-top25',    () => allData.filter(d => d._score && d._score.totalScore > 0));
initSortableTable('table-under10k', () => allData.filter(d => d._score && d._score.totalScore > 0 && d.currentPrice <= 100));
initSortableTable('table-megacaps', () => allData.filter(d => d.marketCap != null && d.marketCap >= 200e9));
initSortableTable('table-favorites', () => allData.filter(d => starredList.includes(d.symbol)));
loadInitialData();
loadScreenerData();

// Restore active page view on reload
const savedView = localStorage.getItem('activeView');
if (savedView) {
  navigate(savedView);
}
