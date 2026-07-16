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
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));
  const view = el('view-' + viewId);
  if (view) view.classList.add('active');
  const link = document.querySelector(`.nav-link[data-view="${viewId}"]`);
  if (link) link.classList.add('active');
}

document.querySelectorAll('.nav-link').forEach(link => {
  link.addEventListener('click', () => navigate(link.dataset.view));
});

// ─── Status indicator ─────────────────────────────────────────────────────────
function setStatus(state, text) {
  const dot   = el('status-dot');
  const label = el('status-text');
  dot.className     = 'status-dot ' + state;
  label.textContent = text;
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
    return `
      <tr>
        <td class="td-rank">${i + 1}</td>
        <td class="td-symbol">${d.symbol}</td>
        <td class="td-score">${scoreTd}</td>
        <td class="td-price">${fmt.currency(d.currentPrice)}</td>
        <td class="td-strike">${fmt.currency(d.strike)}</td>
        <td class="td-dte">${d.dte}d</td>
        <td class="td-premium">${fmt.currency(d.premium)}</td>
        <td class="td-capital">${fmt.currency(d.capitalRequired)}</td>
        <td class="td-yield-mo">${fmt.pct(d.monthlyYield)}</td>
        <td class="td-yield-ann">${fmt.pct(d.annualizedYield)}</td>
        <td class="td-income">${fmt.currency(d.monthlyIncome)}</td>
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
  el('preview-grid').style.display = isEmpty ? 'none' : 'grid';

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
}

// ─── Unified watchlist ────────────────────────────────────────────────────────
function renderWatchlistChips() {
  const container = el('chips-screener');
  if (!container) return;

  if (!watchlist.length) {
    container.innerHTML = '<span class="chips-empty">No stocks added yet.</span>';
    return;
  }

  container.innerHTML = watchlist.map(sym => `
    <span class="watchlist-chip">
      ${sym}
      <button class="chip-remove" data-symbol="${sym}" title="Remove">×</button>
    </span>
  `).join('');

  container.querySelectorAll('.chip-remove').forEach(btn => {
    btn.addEventListener('click', () => removeFromWatchlist(btn.dataset.symbol));
  });
}

async function addToWatchlist(symbol) {
  const errEl = el('add-error-screener');
  const btn   = el('add-btn-screener');
  const input = el('add-input-screener');
  if (!symbol || !symbol.trim()) return;

  btn.disabled = true; btn.textContent = '…';
  if (errEl) errEl.textContent = '';

  try {
    const result = await window.electronAPI.addToWatchlist({ symbol });
    if (result.success) {
      watchlist = result.watchlist;
      if (input) input.value = '';
      renderWatchlistChips();

      // Run the 3 sync tasks to make sure the added stock gets fully updated
      setStatus('loading', `Fetching ${symbol} historical prices…`);
      await window.electronAPI.fetchHistory(symbol);

      await refreshData();
      await updatePrices();

      renderScreener();
    } else {
      if (errEl) errEl.textContent = result.error || 'Invalid symbol';
    }
  } catch (e) {
    if (errEl) errEl.textContent = 'Failed to add';
    console.error('Add failed:', e);
  } finally {
    btn.disabled = false; btn.textContent = '+ Add';
  }
}

async function removeFromWatchlist(symbol) {
  try {
    const result = await window.electronAPI.removeFromWatchlist({ symbol });
    if (result.success) {
      watchlist = result.watchlist;
      renderWatchlistChips();
      renderScreener();
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
  let items = screenerData.filter(d => d._score);
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

  if (!items.length) {
    tbody.innerHTML = `<tr><td colspan="12" class="empty-row">${
      screenerData.length > 0 ? 'No stocks match the current filters.' : 'Run a Discover scan to populate the screener.'
    }</td></tr>`;
    return;
  }

  tbody.innerHTML = items.map((d, i) => {
    const sc      = d._score;
    const ivrStr  = d.ivr != null ? d.ivr.toFixed(0) : '—';
    const ivhvStr = d.ivHvRatio > 0 ? d.ivHvRatio.toFixed(2) + 'x' : '—';
    const isStarred = starredList.includes(d.symbol);
    const starIcon = isStarred ? '★' : '☆';
    const starClass = isStarred ? 'star-btn starred' : 'star-btn';
    return `
      <tr class="screener-row" data-idx="${screenerData.indexOf(d)}" style="cursor:pointer">
        <td class="td-rank">${i + 1}</td>
        <td><button class="${starClass}" data-symbol="${d.symbol}">${starIcon}</button></td>
        <td class="td-symbol">${d.symbol}</td>
        <td class="td-price">${fmt.currency(d.currentPrice)}</td>
        <td class="td-mktcap" style="font-family:'JetBrains Mono',monospace;font-size:11.5px">${fmt.mktcap(d.marketCap)}</td>
        <td class="td-score" style="font-family:'JetBrains Mono',monospace;font-weight:600">${sc.totalScore}</td>
        <td>${renderGradeBadge(sc.grade)}</td>
        <td class="td-ivr">${ivrStr}</td>
        <td class="td-ivhv">${ivhvStr}</td>
        <td class="td-yield-mo">${fmt.pct(d.monthlyYield)}</td>
        <td>${renderScoreBar(sc.totalScore, sc.grade)}</td>
        <td><button class="analyze-btn" data-idx="${screenerData.indexOf(d)}">Detail</button></td>
      </tr>`;
  }).join('');

  tbody.querySelectorAll('.screener-row').forEach(row => {
    row.addEventListener('click', e => {
      if (e.target.classList.contains('analyze-btn') || e.target.classList.contains('star-btn')) return;
      openModal(screenerData[+row.dataset.idx]);
    });
  });
  tbody.querySelectorAll('.analyze-btn').forEach(btn => {
    btn.addEventListener('click', e => {
      e.stopPropagation();
      openModal(screenerData[+btn.dataset.idx]);
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

// ─── Analysis Modal ───────────────────────────────────────────────────────────
async function openModal(d) {
  if (!d) return;
  currentModal = d;
  const sc = d._score;

  el('modal-company').textContent       = d.companyName || d.symbol;
  el('modal-exchange').textContent      = d.exchange || '';
  el('modal-symbol-badge').textContent  = d.symbol;
  el('modal-strategy-badges').innerHTML = '';

  // Score summary
  if (sc) {
    el('modal-score-number').textContent   = sc.totalScore;
    el('modal-grade-badge').textContent    = sc.grade;
    el('modal-grade-badge').className      = `grade-badge grade-badge-lg grade-badge-${sc.grade}`;
    el('modal-grade-label').textContent    = sc.gradeLabel;
    el('modal-ann-yield').textContent      = `Ann. yield: ${fmt.pct(d.annualizedYield)}`;
    el('modal-score-bar').style.width      = sc.totalScore + '%';
    el('modal-score-bar').style.background = gradeColor(sc.grade);

    const ksEl = el('modal-kill-switches');
    if (sc.killSwitches.length) {
      ksEl.innerHTML = sc.killSwitches.map(k =>
        `<div class="kill-switch-alert">⚠ ${k}</div>`
      ).join('');
    } else {
      ksEl.innerHTML = '';
    }

    // Score breakdown
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
  }

  // Trade mechanics
  el('mechanics-text').innerHTML =
    `Sell 1 put contract with a <span class="privacy-amount">$${d.strike.toFixed(2)}</span> strike expiring in ${d.dte} days ` +
    `for a premium of <span class="privacy-amount">$${(d.premium * 100).toFixed(2)}</span> (${fmt.pct(d.marginOfSafety)} below current price). ` +
    `If assigned, you will be obligated to buy 100 shares at <span class="privacy-amount">$${d.strike.toFixed(2)}</span>, ` +
    `requiring <span class="privacy-amount">$${d.capitalRequired.toLocaleString()}</span> in capital. ` +
    `Your break-even price is <span class="privacy-amount">$${d.breakEven.toFixed(2)}</span>.`;

  // Block explanation
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

  // Options data
  const volStr    = d.impliedVolatility > 0 ? fmt.pct(d.impliedVolatility * 100) : 'N/A';
  const hvStr     = d.hv > 0 ? fmt.pct(d.hv * 100) : 'N/A';
  const ivhvStr   = d.ivHvRatio > 0 ? d.ivHvRatio.toFixed(2) + 'x' : 'N/A';
  const ivrStr    = d.ivr != null ? d.ivr.toFixed(0) : 'Insufficient history';
  const deltaStr  = d.delta != null ? Math.abs(d.delta).toFixed(2) : 'N/A';
  const spreadStr = d.bidAskSpread != null ? fmt.currency(d.bidAskSpread) : 'N/A';

  el('stats-grid-options').innerHTML = [
    { label: 'Strike',               value: fmt.currency(d.strike)            },
    { label: 'Expiration',           value: d.expirationDate                  },
    { label: 'DTE',                  value: d.dte + ' days'                   },
    { label: 'Premium (mid)',        value: fmt.currency(d.premium)           },
    { label: 'Delta',                value: deltaStr                          },
    { label: 'Implied Volatility',   value: volStr,         cls: 'cyan'       },
    { label: 'Historical Vol (30d)', value: hvStr                             },
    { label: 'IV / HV Ratio',        value: ivhvStr                           },
    { label: 'IV Rank',              value: ivrStr                            },
    { label: 'Open Interest',        value: fmt.num(d.openInterest)           },
    { label: 'Bid-Ask Spread',       value: spreadStr                         },
    { label: 'Break-Even',           value: fmt.currency(d.breakEven)         },
    { label: 'Margin of Safety',     value: fmt.pct(d.marginOfSafety), cls: 'green' },
    { label: 'Above MA50',           value: d.aboveMA50 ? 'Yes' : 'No'       },
  ].map(s => `
    <div class="stat-item">
      <div class="stat-label">${s.label}</div>
      <div class="stat-value ${s.cls || ''}">${s.value}</div>
    </div>
  `).join('');

  // Add-to-watchlist button
  const addBtn = el('modal-add-watchlist');
  if (addBtn) {
    const already = watchlist.includes(d.symbol);
    addBtn.textContent = already ? '✓ In Watchlist' : '+ Add to Watchlist';
    addBtn.disabled = already;
    addBtn.onclick = async () => {
      addBtn.disabled = true; addBtn.textContent = '…';
      const result = await window.electronAPI.addToWatchlist({ symbol: d.symbol });
      if (result.success) {
        watchlist = result.watchlist;
        renderWatchlistChips();
        addBtn.textContent = '✓ In Watchlist';
      } else {
        addBtn.disabled = false; addBtn.textContent = '+ Add to Watchlist';
      }
    };
  }

  // Modal star toggle button
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

  el('modal-overlay').classList.remove('hidden');
  renderChart([], d.symbol);
  try {
    const history = await window.electronAPI.fetchHistory(d.symbol);
    renderChart(history, d.symbol);
  } catch (e) {
    console.warn('History fetch failed:', e);
  }
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
      setStatus('live', 'Live');
      setListLabels(result.fetchedAt, result.minMarginPct, result.nextRefresh);
      setPriceLabels(result.pricedAt, result.nextPriceUpdate);
    } else {
      renderAll([]);
      setStatus('', 'No data — add stocks and refresh');
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

function renderPortfolio(p) {
  portfolio = p;
  const has = p.holdings.length > 0;
  el('pf-empty-state').style.display = has ? 'none' : '';
  el('pf-content').style.display = has ? '' : 'none';

  el('pf-source-badge').textContent = p.updatedAt
    ? `${p.source || 'manual'} · ${new Date(p.updatedAt).toLocaleDateString()}`
    : 'no data';

  const d = p.derived;
  el('pf-total-value').innerHTML = has ? fmt.currency(d.totalValue) : '—';
  el('pf-cash').innerHTML = has ? fmt.currency(p.cash || 0) : '—';
  el('pf-cash-label').textContent = p.baseCurrency ? `Cash (${p.baseCurrency})` : 'Cash';
  const conc = d.concentration;
  el('pf-employer-pct').textContent = has ? fmt.pct(conc.pct) : '—';
  el('pf-employer-pct').style.color = conc.pct > 15 ? 'var(--red)' : conc.pct > 10 ? '#f59e0b' : '';
  const top = d.topPositions[0];
  el('pf-largest').textContent = top ? `${top.symbol} · ${top.weightPct.toFixed(1)}%` : '—';
  const offCount = d.drift.filter(r => r.rebalance).length;
  el('pf-drift-count').textContent = has ? String(offCount) : '—';
  el('pf-drift-count').style.color = offCount > 0 ? '#f59e0b' : 'var(--green)';

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
      <td class="symbol-cell">${r.symbol}</td>
      <td>${fmt.currency(r.marketValue)}</td>
      <td>${pfPct(r.weightPct)}</td>
      <td>${r.costBasis != null ? fmt.currency(r.costBasis) : '—'}</td>
      <td>${pfSignedCurrency(r.pnl)}</td>
      <td>${pfSignedPct(r.pnlPct)}</td>
      <td>${r.currency || '—'}</td>
      <td><select class="schedule-select pf-bucket-select" data-idx="${r.idx}">${pfBucketOptions(r.bucket)}</select></td>
      <td><input type="checkbox" class="pf-employer-check" data-idx="${r.idx}" ${r.isEmployerStock ? 'checked' : ''}></td>
    </tr>`).join('');

  el('pf-holdings-tbody').querySelectorAll('.pf-bucket-select').forEach(sel => {
    sel.addEventListener('change', async () => {
      const holdings = [...portfolio.holdings];
      holdings[+sel.dataset.idx] = { ...holdings[+sel.dataset.idx], bucket: sel.value === 'unassigned' ? null : sel.value };
      renderPortfolio(await window.electronAPI.savePortfolio({ holdings }));
    });
  });
  el('pf-holdings-tbody').querySelectorAll('.pf-employer-check').forEach(chk => {
    chk.addEventListener('change', async () => {
      const holdings = [...portfolio.holdings];
      holdings[+chk.dataset.idx] = { ...holdings[+chk.dataset.idx], isEmployerStock: chk.checked };
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

  // Fetch and render compliance guidance alerts
  window.electronAPI.getPortfolioGuidance(p.holdings, p.cash, p.targets)
    .then(guidanceItems => {
      const listEl = el('pf-guidance-list');
      if (!listEl) return;
      if (guidanceItems.length === 0) {
        listEl.innerHTML = `
          <div class="guidance-item severity-info" style="border: 1px dashed rgba(6, 182, 212, 0.35); background: transparent;">
            <span class="guidance-icon">✓</span>
            <div class="guidance-content">
              <span class="guidance-title">Portfolio is compliant</span>
              <span class="guidance-message">No PFIC assets, elevated employer concentrations, or cash drag detected. Your current holdings are structured appropriately.</span>
            </div>
          </div>`;
        return;
      }
      
      listEl.innerHTML = guidanceItems.map(item => {
        const icon = item.severity === 'error' ? '✕' : '⚠';
        return `
          <div class="guidance-item severity-${item.severity}">
            <span class="guidance-icon">${icon}</span>
            <div class="guidance-content">
              <span class="guidance-title">${item.title}</span>
              <span class="guidance-message">${item.message}</span>
            </div>
          </div>`;
      }).join('');
    })
    .catch(err => console.error('Failed to load portfolio guidance:', err));
}

async function initPortfolioView() {
  // Sortable holdings headers — same toggle behavior as the CSP tables
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
        holdingNote = `Holds **${res.weightPct.toFixed(1)}%** of your portfolio.`;
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

  const lookupBtn = el('pf-lookup-btn');
  const lookupInput = el('pf-lookup-input');
  if (lookupBtn) lookupBtn.addEventListener('click', runTickerLookup);
  if (lookupInput) {
    lookupInput.addEventListener('keydown', e => {
      if (e.key === 'Enter') runTickerLookup();
    });
  }

  renderPortfolio(await window.electronAPI.getPortfolio());
}

// ─── Boot ─────────────────────────────────────────────────────────────────────
initSettingsUI();
initScreenerWatchlist();
initScreenerFilters();
initScreenerSorting();
initDiscoverView();
initPortfolioView();
initSortableTable('table-top25',    () => allData.filter(d => d._score && d._score.totalScore > 0));
initSortableTable('table-under10k', () => allData.filter(d => d._score && d._score.totalScore > 0 && d.currentPrice <= 100));
initSortableTable('table-megacaps', () => allData.filter(d => d.marketCap != null && d.marketCap >= 200e9));
initSortableTable('table-favorites', () => allData.filter(d => starredList.includes(d.symbol)));
loadInitialData();
loadScreenerData();
