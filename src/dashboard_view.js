'use strict';

// ─── Dashboard & Health View Module ──────────────────────────────────────────

const AP_KIND_STYLE = {
  sell:    { label: 'Sell',    color: '#f59e0b' },
  replace: { label: 'Replace', color: '#f43f5e' },
  buy:     { label: 'Buy',     color: '#10b981' },
  nudge:   { label: 'Review',  color: '#3b82f6' },
};

function renderMetricCards(data) {
  const container = el('metric-cards');
  if (!container) return;

  const watchlistCount = watchlist.length;
  const gradedCount    = data.filter(d => d._score && d._score.totalScore > 0 && d._score.grade !== 'F').length;

  const gradesCount = { A: 0, B: 0, C: 0, D: 0, E: 0 };
  data.forEach(d => {
    if (d._score && d._score.totalScore > 0 && d._score.grade !== 'F') {
      const g = d._score.grade;
      if (gradesCount[g] !== undefined) gradesCount[g]++;
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

function renderDashboardIncomeStrip(active) {
  const wrap = el('dashboard-income-chips');
  if (!wrap) return;
  const items = [...active]
    .sort((a, b) => (b.monthlyYield ?? 0) - (a.monthlyYield ?? 0))
    .slice(0, 8);
  if (!items.length) {
    wrap.innerHTML = '<span style="font-size:12px; color:var(--text-muted); padding:8px 2px;">No income ideas yet — run a scan in the Screener.</span>';
    return;
  }
  wrap.innerHTML = items.map(d => `
    <div class="income-chip" data-idx="${allData.indexOf(d)}"
      style="flex:0 0 auto; min-width:150px; padding:10px 12px; background:rgba(255,255,255,0.02); border:1px solid var(--border); border-radius:8px; cursor:pointer;">
      <div style="display:flex; align-items:center; gap:6px; margin-bottom:4px;">
        <span style="font-size:13px; font-weight:600; color:var(--cyan);">${d.symbol}</span>
        <span class="privacy-amount" style="font-size:12px; color:var(--text-secondary);">$${(d.currentPrice ?? 0).toFixed(2)}</span>
        ${d._score ? `<span title="Options-income grade" style="margin-left:auto;">${renderGradeBadge(d._score.grade)}</span>` : ''}
      </div>
      <div style="display:flex; align-items:baseline; justify-content:space-between;">
        <span style="font-size:10px; color:var(--text-muted); text-transform:uppercase; letter-spacing:0.04em;">Income</span>
        <span class="preview-yield" style="font-size:14px;">${fmt.pct(d.monthlyYield)}/mo</span>
      </div>
    </div>`).join('');
  wrap.querySelectorAll('.income-chip').forEach(chip => {
    chip.addEventListener('click', () => openModal(allData[+chip.dataset.idx]));
  });
}

function renderDashboardVitals(portfolioData) {
  const container = el('dashboard-vitals');
  if (!container) return;
  if (!portfolioData || !portfolioData.holdings || !portfolioData.holdings.length) {
    container.style.display = 'none';
    return;
  }
  container.style.display = '';

  const totalVal = portfolioData.totalValue || 0;
  const cashVal = portfolioData.cash || 0;
  const stockVal = totalVal - cashVal;
  const holdings = portfolioData.holdings.length;
  const empPct = portfolioData.employerPct != null ? `${portfolioData.employerPct.toFixed(1)}%` : '—';

  container.innerHTML = `
    <div class="metric-card">
      <div class="metric-label">Total Portfolio</div>
      <div class="metric-value privacy-amount">${fmt.currency(totalVal)}</div>
    </div>
    <div class="metric-card">
      <div class="metric-label">Stocks Value</div>
      <div class="metric-value privacy-amount">${fmt.currency(stockVal)}</div>
    </div>
    <div class="metric-card">
      <div class="metric-label">Cash Reserve</div>
      <div class="metric-value privacy-amount">${fmt.currency(cashVal)}</div>
    </div>
    <div class="metric-card">
      <div class="metric-label">Employer Stock</div>
      <div class="metric-value">${empPct}</div>
    </div>
    <div class="metric-card">
      <div class="metric-label">Positions</div>
      <div class="metric-value">${holdings}</div>
    </div>`;
}

async function renderDashboardActionPlan(watchlistData, hasHoldings) {
  const wrap = el('dashboard-actionable-steps-wrap');
  const list = el('dashboard-actionable-steps-list');
  if (!wrap || !list) return;

  if (!hasHoldings) {
    wrap.classList.add('hidden');
    return;
  }

  try {
    const res = await window.electronAPI.getActionPlan(watchlistData);
    const actions = res?.actions || [];
    const moreCount = res?.moreCount || 0;
    wrap.classList.remove('hidden');

    if (!actions.length) {
      list.innerHTML = `
        <div style="display:flex; align-items:center; gap:10px; padding:12px; color:var(--text-secondary); font-size:13px;">
          <span style="color:var(--green); font-size:16px;">✓</span>
          Nothing needs your attention right now — your portfolio matches your plan.
          New steps appear here when a sell-down tranche comes due, cash builds up, or an alert fires.
        </div>`;
      return;
    }

    list.innerHTML = actions.map((a, i) => {
      const k = AP_KIND_STYLE[a.kind] || { label: 'Review', color: 'var(--cyan)' };
      return `
        <div class="ap-row" data-nav="${a.nav || 'guidance'}" style="display:flex; gap:12px; align-items:flex-start; padding:10px 12px; background:rgba(255,255,255,0.02); border:1px solid var(--border); border-left:3px solid ${k.color}; border-radius:8px; cursor:pointer;"
             title="Click for the full reasoning">
          <span style="color:var(--text-muted); font-family:'JetBrains Mono',monospace; font-size:12px; padding-top:2px; min-width:16px;">${i + 1}.</span>
          <span style="min-width:58px; text-align:center; color:${k.color}; background:color-mix(in srgb, ${k.color} 12%, transparent); border:1px solid color-mix(in srgb, ${k.color} 30%, transparent); border-radius:4px; padding:1px 7px; font-size:10px; font-weight:700; text-transform:uppercase; margin-top:1px;">${k.label}</span>
          <div style="flex:1; min-width:0;">
            <div style="font-weight:600; font-size:13px; color:var(--text-primary);">${a.title}${a.urgent ? ' <span style="color:var(--red); font-size:10px; font-weight:700; text-transform:uppercase;">· urgent</span>' : ''}</div>
            <div style="font-size:12px; color:var(--text-secondary); margin-top:2px; line-height:1.5;">${a.detail || ''}</div>
          </div>
          ${a.amountUsd ? `<div style="font-family:'JetBrains Mono',monospace; font-size:13px; color:${k.color}; flex-shrink:0;" class="privacy-amount">~$${a.amountUsd.toLocaleString('en-US')}</div>` : ''}
        </div>`;
    }).join('')
      + (moreCount > 0 ? `<div style="font-size:12px; color:var(--text-muted); padding:4px 12px;">+ ${moreCount} more on the Guidance page</div>` : '');

    list.onclick = (e) => {
      const row = e.target.closest('.ap-row');
      if (row?.dataset.nav) navigate(row.dataset.nav);
    };
  } catch (err) {
    console.error('Failed to load action plan:', err);
  }
}

let pfHealthLoading = false;
async function loadPortfolioHealth(hasHoldings) {
  const card = el('pf-health-card');
  const emptyEl = el('pf-health-empty-state');
  const navBadge = el('nav-health-badge');
  if (!card) return;

  if (hasHoldings === undefined) {
    try {
      const p = await window.electronAPI.getPortfolio();
      hasHoldings = !!(p && p.holdings && p.holdings.length > 0);
    } catch {
      hasHoldings = false;
    }
  }

  if (hasHoldings) {
    card.style.display = '';
    if (emptyEl) emptyEl.style.display = 'none';
  } else {
    card.style.display = 'none';
    if (emptyEl) emptyEl.style.display = '';
    if (navBadge) navBadge.style.display = 'none';
    return;
  }

  try {
    const result = await window.electronAPI.getPortfolioHealth();
    if (!result || !result.health) return;
    const { health, dividends } = result;

    const pfGrade = el('pf-health-grade');
    if (pfGrade) pfGrade.innerHTML = `${renderGradeBadge(health.grade)} <span style="font-size:0.6em; color:var(--text-secondary)">${health.totalScore}/100</span>`;
    const pfDivs = el('pf-dividends');
    if (pfDivs) pfDivs.innerHTML = fmt.currency(dividends?.annual || 0);
    if (navBadge) navBadge.innerHTML = renderGradeBadge(health.grade);

    card.style.display = '';
    const badge = el('pf-health-badge');
    if (badge) badge.innerHTML = renderGradeBadge(health.grade);
    const caption = el('pf-health-caption');
    if (caption) caption.textContent = (health.caps && health.caps.length)
      ? health.gradeLabel
      : `${health.totalScore}/100 — ${health.gradeLabel}. Each dimension below explains its score and the one action that would most improve it.`;

    const breakdownEl = el('pf-health-breakdown');
    if (breakdownEl) {
      breakdownEl.innerHTML = (health.breakdown || []).map(b => {
        const ratio = b.max > 0 ? b.score / b.max : 0;
        const color = ratio >= 0.8 ? 'var(--green)' : ratio >= 0.4 ? '#f59e0b' : 'var(--red)';
        return `
          <div style="margin-bottom:14px">
            <div style="display:flex; justify-content:space-between; align-items:baseline; margin-bottom:4px">
              <span style="font-size:13px; font-weight:600; color:var(--text-primary);">${b.label}</span>
              <span style="font-size:12px; color:${color}">${b.score}/${b.max}</span>
            </div>
            <div class="score-bar-track"><div class="score-bar-fill" style="width:${ratio * 100}%; background:${color}"></div></div>
            <div style="font-size:12px; color:var(--text-secondary); margin-top:4px">${b.detail}</div>
            <div style="font-size:12px; color:var(--text-primary); margin-top:2px">→ ${b.action}</div>
          </div>`;
      }).join('');
    }
  } catch (err) {
    console.error('Failed to load portfolio health:', err);
  }
}
