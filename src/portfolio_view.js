'use strict';

// ─── Portfolio Helpers ────────────────────────────────────────────────────────
function pfBucketOptions(selected) {
  return PF_BUCKETS
    .filter(b => b !== 'cash')
    .map(b => `<option value="${b}" ${b === (selected || 'unassigned') ? 'selected' : ''}>${b}</option>`)
    .join('');
}

// ─── Tax-Smart Buy Ideas ──────────────────────────────────────────────────────
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
        if (swaps.length) renderPficCosts();
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

      card.onclick = (e) => {
        const link = e.target.closest('.si-symbol-link');
        if (link?.dataset.symbol) openSymbolInsight(link.dataset.symbol);
      };
    })
    .catch(err => console.error('Failed to load buy recommendations:', err));
}

// ─── PFIC Exit Cost Table ────────────────────────────────────────────────────
async function renderPficCosts() {
  const box = el('pf-pfic-costs');
  if (!box) return;
  try {
    const res = await window.electronAPI.getPficEstimates();
    if (!res?.relevant || !res.estimates?.length) { box.style.display = 'none'; return; }
    const withGain = res.estimates.filter(e => e.gainUsd > 0 || e.lossUsd < 0);
    if (!withGain.length) { box.style.display = 'none'; return; }
    box.style.display = '';

    const totalTax = withGain.reduce((s, e) => s + e.totalTax, 0);
    const totalWait = withGain.reduce((s, e) => s + e.waitOneYearExtra, 0);
    const anyAssumed = withGain.some(e => e.usedAssumedAge);

    const rows = withGain.map(e => {
      if (e.gainUsd <= 0) {
        return `<tr>
          <td style="font-family:'JetBrains Mono',monospace; font-weight:700;">${e.symbol}</td>
          <td class="privacy-amount" style="color:var(--text-secondary);">${e.lossUsd < 0 ? `−$${Math.abs(e.lossUsd).toLocaleString('en-US')}` : '$0'}</td>
          <td colspan="3" style="color:var(--text-secondary);">No gain — exiting now is tax-free (and PFIC losses aren't deductible, so there's nothing to wait for)</td>
        </tr>`;
      }
      return `<tr>
        <td style="font-family:'JetBrains Mono',monospace; font-weight:700;">${e.symbol}</td>
        <td class="privacy-amount">$${e.gainUsd.toLocaleString('en-US')}</td>
        <td class="privacy-amount" style="color:#f43f5e;">~$${e.totalTax.toLocaleString('en-US')} <span style="color:var(--text-muted);">(${e.effectiveRatePct.toFixed(0)}% of gain)</span></td>
        <td class="privacy-amount" style="color:var(--green);">~$${e.ltcgComparisonTax.toLocaleString('en-US')}</td>
        <td class="privacy-amount" style="color:#f59e0b;">+$${e.waitOneYearExtra.toLocaleString('en-US')}/yr${e.usedAssumedAge ? ' <span style="color:var(--text-muted);" title="No purchase dates in your import for this fund — using the assumed holding period from Settings.">*</span>' : ''}</td>
      </tr>`;
    }).join('');

    box.innerHTML = `
      <div style="font-size:11px; font-weight:600; color:var(--text-secondary); text-transform:uppercase; letter-spacing:0.5px; margin-bottom:6px;">
        What exiting is estimated to cost (US §1291 tax)
      </div>
      <div class="table-wrapper" style="overflow-x:auto;">
        <table class="data-table" style="font-size:12px;">
          <thead><tr>
            <th>Fund</th><th>Unrealized gain</th><th>Est. tax if sold today</th><th>If it were a US fund</th><th>Cost of waiting</th>
          </tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
      <div style="font-size:11px; color:var(--text-muted); margin-top:8px; line-height:1.6;">
        Selling all ${withGain.length} today ≈ <strong class="privacy-amount" style="color:#f43f5e;">$${totalTax.toLocaleString('en-US')}</strong> in US tax;
        every year you wait adds ≈ <strong class="privacy-amount" style="color:#f59e0b;">$${totalWait.toLocaleString('en-US')}</strong> in interest and top-rate throwback — the bill arrives whenever you sell, so waiting only grows it.
        Assumes the default §1291 regime (no QEF/mark-to-market election), ${res.assumptions.marginalRatePct}% marginal rate, ${res.assumptions.interestRatePct}%/yr IRS interest${anyAssumed ? `, * = assumed ${res.assumptions.assumedYears}-year holding where lot dates are missing` : ''}; ignores NIIT and state tax.
        <strong>A planning estimate, not tax advice — confirm with a US expat tax professional before selling.</strong> Adjust assumptions in Settings → Tax Profile.
      </div>`;
  } catch (err) {
    console.error('Failed to load PFIC estimates:', err);
    box.style.display = 'none';
  }
}

// ─── Employer-Stock Sell-Down Plan ───────────────────────────────────────────
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

async function enrichEmployerExposure(directPct) {
  try {
    const exp = await window.electronAPI.getEmployerExposure();
    if (!exp || exp.impliedUsd <= 0) return;
    const elPct = el('pf-employer-pct');
    if (!elPct) return;
    elPct.innerHTML = `${exp.totalPct.toFixed(2)}%<span style="display:block; font-size:11px; font-weight:400; color:var(--text-muted); margin-top:2px;">${exp.directPct.toFixed(1)}% direct + ${exp.impliedPct.toFixed(1)}% via funds</span>`;
    elPct.style.color = exp.totalPct > concentrationLimit * 1.5 ? 'var(--red)' : exp.totalPct > concentrationLimit ? '#f59e0b' : '';
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
  el('pf-employer-pct').style.color = conc.pct > concentrationLimit * 1.5 ? 'var(--red)' : conc.pct > concentrationLimit ? '#f59e0b' : '';
  if (has) enrichEmployerExposure(conc.pct);
  const top = d.topPositions[0];
  el('pf-largest').textContent = top ? `${top.symbol} · ${top.weightPct.toFixed(1)}%` : '—';

  if (typeof renderDashboardVitals === 'function') {
    renderDashboardVitals(has ? { totalValue: d.totalValue, cash: p.cash || 0, employerPct: conc.pct } : null);
  }
  if (typeof loadPortfolioHealth === 'function') {
    loadPortfolioHealth(has);
  }

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
        })
        .catch(err => console.error('Failed to load portfolio guidance:', err));

      renderBuyIdeas(watchlistData);
      renderSellDownCard();
      if (typeof renderDashboardActionPlan === 'function') {
        renderDashboardActionPlan(watchlistData, true);
      }
    }
  }
  if (!has) {
    const ideasCard = el('pf-buy-ideas-card');
    if (ideasCard) ideasCard.style.display = 'none';
    const sdCard = el('pf-selldown-card');
    if (sdCard) sdCard.style.display = 'none';
  }

  if (!has) return;

  const rows = p.holdings.map((h, i) => {
    const pnl = (h.costBasis != null && h.marketValue != null) ? h.marketValue - h.costBasis : null;
    const name = h.description || h.name || (allData.find(x => x.symbol === h.symbol)?.name) || '';
    return {
      idx: i,
      symbol:      h.symbol,
      name,
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
    if (av == null) return 1;
    if (bv == null) return -1;
    if (typeof av === 'string') return mul * av.localeCompare(bv);
    return mul * (av - bv);
  });

  el('pf-holdings-table').querySelectorAll('thead th[data-col]').forEach(th => {
    if (th.dataset.col === col) th.setAttribute('data-sort', dir);
    else th.removeAttribute('data-sort');
  });

  el('pf-holdings-tbody').innerHTML = rows.map(r => `
    <tr class="pf-row" data-symbol="${r.symbol}">
      <td>
        <div style="display:flex; flex-direction:column;">
          <span style="font-weight:600; color:var(--cyan); font-family:'JetBrains Mono', monospace; font-size:13px;">${r.symbol}</span>
          <span style="font-size:11.5px; color:var(--text-muted); font-family:'Outfit', sans-serif; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:200px;">${r.name || ''}</span>
        </div>
      </td>
      <td style="font-family:'JetBrains Mono', monospace;">${fmt.currency(r.marketValue)}</td>
      <td style="font-family:'JetBrains Mono', monospace;">${pfPct(r.weightPct)}</td>
      <td style="font-family:'JetBrains Mono', monospace;">${r.costBasis != null ? fmt.currency(r.costBasis) : '—'}</td>
      <td style="font-family:'JetBrains Mono', monospace;">${pfSignedCurrency(r.pnl)}</td>
      <td style="font-family:'JetBrains Mono', monospace;">${pfSignedPct(r.pnlPct)}</td>
      <td style="font-family:'JetBrains Mono', monospace;">${r.currency || '—'}</td>
      <td style="text-align: center; vertical-align: middle; padding: 6px 4px;">
        ${renderRecommendationBadge(r.recommendation.type)}
        ${r.recommendation.reason ? `<div style="font-size: 10px; color: var(--text-secondary); margin-top: 4px; max-width: 140px; white-space: normal; line-height: 1.2; text-align: center; display: block; margin-left: auto; margin-right: auto;">${r.recommendation.reason}</div>` : ''}
      </td>
      <td><select class="schedule-select pf-bucket-select" data-idx="${r.idx}">${pfBucketOptions(r.bucket)}</select></td>
    </tr>`).join('');

  el('pf-holdings-tbody').querySelectorAll('tr.pf-row').forEach(row => {
    row.style.cursor = 'pointer';
    row.addEventListener('click', (e) => {
      if (e.target.closest('.pf-bucket-select')) return;
      openSymbolInsight(row.dataset.symbol);
    });
  });

  el('pf-holdings-tbody').querySelectorAll('.pf-bucket-select').forEach(sel => {
    sel.addEventListener('change', async () => {
      const holdings = [...portfolio.holdings];
      holdings[+sel.dataset.idx] = { ...holdings[+sel.dataset.idx], bucket: sel.value === 'unassigned' ? null : sel.value };
      renderPortfolio(await window.electronAPI.savePortfolio({ holdings }));
    });
  });

  const driftRows = (d.drift || []).map(r => {
    const isOk = Math.abs(r.driftPct) <= (p.tolerancePct || 5);
    const color = isOk ? 'var(--green)' : 'var(--red)';
    const actionText = r.action === 'hold' ? 'On target' : r.action === 'buy' ? `Buy ${fmt.currency(Math.abs(r.deltaUsd))}` : `Sell ${fmt.currency(Math.abs(r.deltaUsd))}`;
    return `
      <tr>
        <td style="font-weight:600; text-transform:capitalize;">${r.bucket}</td>
        <td>${r.targetPct.toFixed(0)}%</td>
        <td>${r.actualPct.toFixed(1)}%</td>
        <td style="color:${color}; font-weight:600;">${r.driftPct > 0 ? '+' : ''}${r.driftPct.toFixed(1)}%</td>
        <td style="color:${isOk ? 'var(--text-secondary)' : color};">${actionText}</td>
      </tr>`;
  }).join('');

  const driftTbody = el('pf-drift-tbody');
  if (driftTbody) driftTbody.innerHTML = driftRows || '<tr><td colspan="5" style="color:var(--text-muted); text-align:center;">Set bucket targets to calculate drift.</td></tr>';

  const offTargetCount = (d.drift || []).filter(r => Math.abs(r.driftPct) > (p.tolerancePct || 5)).length;
  const driftCountEl = el('pf-drift-count');
  if (driftCountEl) driftCountEl.textContent = has ? `${offTargetCount}` : '—';

  const targetFor = b => ((p.targets || []).find(t => t.bucket === b) || {}).targetPct ?? '';
  const fieldsEl = el('pf-targets-fields');
  if (fieldsEl) {
    fieldsEl.innerHTML = PF_BUCKETS.filter(b => b !== 'unassigned').map(b => `
      <div class="settings-field">
        <label class="settings-field-label" for="pf-target-${b}">${b} target %</label>
        <input type="number" class="schedule-select pf-target-input" id="pf-target-${b}" data-bucket="${b}" min="0" max="100" step="1" value="${targetFor(b)}">
      </div>`).join('');

    fieldsEl.querySelectorAll('.pf-target-input').forEach(inp => {
      inp.addEventListener('change', async () => {
        const targets = [...(p.targets || [])];
        const bucket = inp.dataset.bucket;
        const val = parseFloat(inp.value) || 0;
        const idx = targets.findIndex(t => t.bucket === bucket);
        if (idx >= 0) targets[idx] = { ...targets[idx], targetPct: val };
        else targets.push({ bucket, targetPct: val });
        renderPortfolio(await window.electronAPI.savePortfolio({ targets }));
      });
    });
  }

  // Age-indexed recommendation rendering
  (async () => {
    try {
      const rec = ageIndexedTargets(await window.electronAPI.getSettings());
      const recBox = el('pf-recommendation-box');
      if (!recBox) return;
      if (rec) {
        recBox.style.display = 'flex';
        recBox.style.flexDirection = 'column';
        const labelEl = el('pf-rec-age-label');
        if (labelEl) labelEl.textContent = `(Age ${rec.age}, glidepath ${rec.base})`;
        const coreEl = el('pf-rec-core');
        if (coreEl) coreEl.textContent = `${rec.coreRec}%`;
        const satEl = el('pf-rec-sat');
        if (satEl) satEl.textContent = `${rec.satRec}%`;
        const cashEl = el('pf-rec-cash');
        if (cashEl) cashEl.textContent = `${rec.cashRec}%`;
      } else {
        recBox.style.display = 'none';
      }
    } catch {}
  })();

  if (window.glossaryController && typeof window.glossaryController.wrapTerms === 'function') {
    setTimeout(() => window.glossaryController.wrapTerms(el('view-portfolio')), 100);
  }
}

// The age-indexed target mix, from settings. One implementation so the display
// and the Apply button can't disagree. Fixes two bugs: birthYear lives at the
// top level of settings (not under taxProfile, which is undefined), and the
// core % must follow the configured glidepath base — it was hardcoded to 110,
// so changing the glidepath in Settings never reached this box.
function ageIndexedTargets(settings) {
  const raw = settings?.birthYear ?? settings?.taxProfile?.birthYear;
  const birthYear = raw ? parseInt(raw, 10) : null;
  if (!birthYear || birthYear <= 1900 || birthYear > new Date().getFullYear()) return null;
  const age = new Date().getFullYear() - birthYear;
  const base = Number(settings?.glidepathBase) || 110;
  const coreRec = Math.min(95, Math.max(20, base - age));
  const satRec = Math.max(0, 95 - coreRec);
  return { age, base, coreRec, satRec, cashRec: 5 };
}

// ─── Portfolio View Initialization ──────────────────────────────────────────
async function initPortfolioView() {
  el('pf-apply-rec-btn')?.addEventListener('click', async () => {
    try {
      const rec = ageIndexedTargets(await window.electronAPI.getSettings());
      if (!rec) return;
      const newTargets = [
        { bucket: 'core', targetPct: rec.coreRec },
        { bucket: 'satellite', targetPct: rec.satRec },
        { bucket: 'cash', targetPct: rec.cashRec },
      ];
      renderPortfolio(await window.electronAPI.savePortfolio({ targets: newTargets }));
    } catch {}
  });
  el('pf-holdings-table')?.querySelectorAll('thead th[data-col]').forEach(th => {
    th.classList.add('sortable-th');
    th.addEventListener('click', () => {
      const col = th.dataset.col;
      const dir = pfSort.col === col && pfSort.dir === 'desc' ? 'asc' : 'desc';
      pfSort = { col, dir };
      if (portfolio) renderPortfolio(portfolio);
    });
  });

  el('pf-autobucket-btn')?.addEventListener('click', async () => {
    if (!portfolio) return;
    const holdings = portfolio.holdings.map(h =>
      h.bucket ? h : { ...h, bucket: PF_CORE_ETFS.has(h.symbol) ? 'core' : 'satellite' }
    );
    renderPortfolio(await window.electronAPI.savePortfolio({ holdings }));
  });

  el('pf-import-btn')?.addEventListener('click', async () => {
    const result = await window.electronAPI.importPortfolioCsv();
    if (result.canceled) return;
    if (!result.success) { setStatus('error', result.error || 'Import failed'); return; }
    renderPortfolio(result.portfolio);
    if (result.warnings?.length) console.warn('CSV import warnings:', result.warnings);
  });

  el('pf-prices-btn')?.addEventListener('click', async () => {
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

  el('pf-tolerance-input')?.addEventListener('change', async () => {
    const v = parseFloat(el('pf-tolerance-input').value);
    if (!Number.isFinite(v) || v <= 0) return;
    renderPortfolio(await window.electronAPI.savePortfolio({ tolerancePct: v }));
  });

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

  el('pf-lookup-btn')?.addEventListener('click', runTickerLookup);
  el('pf-lookup-input')?.addEventListener('keydown', e => { if (e.key === 'Enter') runTickerLookup(); });

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

  document.querySelectorAll('.guidance-tabs .tab-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.guidance-tabs .tab-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentGuidanceFilter = btn.dataset.filter;
      renderFilteredGuidance();
    });
  });

  const p = await window.electronAPI.getPortfolio();
  if (p) renderPortfolio(p);
}

// ─── Trajectory / Progress View ─────────────────────────────────────────────
async function renderProgressView() {
  const emptyEl = el('progress-empty-state');
  const contentEl = el('progress-content');
  const container = el('progress-kpis');
  if (!emptyEl || !contentEl || !container) return;

  let history = [];
  try { history = (await window.electronAPI.getProfileHistory())?.history || []; } catch {}
  if (!history.length) {
    emptyEl.style.display = '';
    contentEl.style.display = 'none';
    return;
  }
  emptyEl.style.display = 'none';
  contentEl.style.display = '';

  const last = history[history.length - 1];
  const empPts = history.filter(h => h.employerPctDirect != null);
  const empLast = empPts.length ? empPts[empPts.length - 1].employerPctDirect : null;
  const empFirst = empPts.length ? empPts[0].employerPctDirect : null;
  const empDelta = (empLast != null && empFirst != null) ? empLast - empFirst : null;

  const healthPts = history.filter(h => h.healthScore != null);
  const hLast = healthPts.length ? healthPts[healthPts.length - 1].healthScore : null;
  const hFirst = healthPts.length ? healthPts[0].healthScore : null;

  const pficPts = history.filter(h => h.pficValue != null);
  const pficLast = pficPts.length ? pficPts[pficPts.length - 1].pficValue : null;

  const pgDate = (iso) => iso ? new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '';
  const labels = history.map(h => pgDate(h.date));
  const delta = (a, b) => (a == null || b == null) ? null : Math.round((a - b) * 100) / 100;
  const trend = (dv, goodIsDown) => {
    if (dv == null || Math.abs(dv) < 0.01) return 'no change';
    const good = goodIsDown ? dv < 0 : dv > 0;
    const arrow = dv < 0 ? '▼' : '▲';
    return `${arrow} ${Math.abs(dv).toFixed(1)}`;
  };

  const kpis = [];
  if (empLast != null) kpis.push({ label: 'Employer concentration', value: `${empLast.toFixed(1)}%`, sub: `${trend(empDelta, true)} since ${pgDate(empPts[0].date)}` });
  if (hLast != null) kpis.push({ label: 'Health score', value: `${hLast}/100`, sub: `${trend(delta(hLast, hFirst), false)} since ${pgDate(healthPts[0].date)}` });
  kpis.push({ label: 'Total value', value: `<span class="privacy-amount">$${Math.round(last.totalValue).toLocaleString('en-US')}</span>`, sub: `<span style="color:var(--text-muted); font-size:12px;">${history.length} data point${history.length > 1 ? 's' : ''}</span>` });
  if (pficLast != null && pficLast > 0) kpis.push({ label: 'PFIC exposure', value: `<span class="privacy-amount">$${Math.round(pficLast).toLocaleString('en-US')}</span>`, sub: `<span style="color:var(--text-muted); font-size:12px;">${pficPts[pficPts.length - 1].pficCount} foreign fund(s)</span>` });

  el('progress-kpis').innerHTML = kpis.map(k => `
    <div class="metric-card" style="background:var(--surface-1, rgba(255,255,255,0.02)); border:1px solid var(--border); border-radius:var(--radius); padding:14px 16px;">
      <div class="metric-label">${k.label}</div>
      <div class="metric-value" style="font-size:22px;">${k.value}</div>
      <div style="margin-top:2px;">${k.sub}</div>
    </div>`).join('');

  if (!window.Chart) { el('progress-footnote').textContent = 'Charts need Chart.js, which failed to load.'; return; }

  const ink = getComputedStyle(document.body).getPropertyValue('--text-secondary')?.trim() || '#888';
  const gridColor = 'rgba(255,255,255,0.06)';
  const mkLine = (canvasId, datasets, yOpts = {}) => {
    if (progressCharts[canvasId]) progressCharts[canvasId].destroy();
    const ctx = el(canvasId);
    if (!ctx) return;
    progressCharts[canvasId] = new window.Chart(ctx, {
      type: 'line',
      data: { labels, datasets },
      options: {
        responsive: true, maintainAspectRatio: false,
        interaction: { intersect: false, mode: 'index' },
        plugins: { legend: { display: datasets.length > 1, labels: { color: ink, boxWidth: 12, font: { size: 11 } } } },
        scales: {
          x: { grid: { display: false }, ticks: { color: ink, font: { size: 11 }, maxRotation: 0, autoSkip: true, maxTicksLimit: 8 } },
          y: { grid: { color: gridColor }, ticks: { color: ink, font: { size: 11 }, ...yOpts.ticks }, ...yOpts.scale },
        },
      },
    });
  };

  let targetPct = concentrationLimit;
  try {
    const sd = await window.electronAPI.getSellDownStatus();
    if (sd?.plan?.targetWeightPct != null) targetPct = sd.plan.targetWeightPct;
  } catch {}
  mkLine('progress-conc-chart', [
    { label: 'Employer %', data: history.map(h => h.employerPctDirect), borderColor: '#d95926', backgroundColor: 'rgba(217,89,38,0.10)', fill: true, borderWidth: 2, tension: 0.25, spanGaps: true, pointRadius: history.length > 30 ? 0 : 3, pointHoverRadius: 5 },
    { label: `Target ${targetPct}%`, data: history.map(() => targetPct), borderColor: '#898781', borderDash: [5, 4], borderWidth: 1.5, pointRadius: 0, fill: false },
  ], { scale: { beginAtZero: true, suggestedMax: Math.max(50, Math.ceil((empLast || 40) / 10) * 10) }, ticks: { callback: v => v + '%' } });

  mkLine('progress-health-chart', [
    { label: 'Score', data: history.map(h => h.healthScore), borderColor: '#199e70', backgroundColor: 'rgba(25,158,112,0.10)', fill: true, borderWidth: 2, tension: 0.25, spanGaps: true, pointRadius: history.length > 30 ? 0 : 3, pointHoverRadius: 5 },
  ], { scale: { beginAtZero: true, max: 100 } });

  mkLine('progress-value-chart', [
    { label: 'Total value', data: history.map(h => h.totalValue), borderColor: '#2a78d6', backgroundColor: 'rgba(42,120,214,0.10)', fill: true, borderWidth: 2, tension: 0.25, spanGaps: true, pointRadius: history.length > 30 ? 0 : 3, pointHoverRadius: 5 },
  ], { ticks: { callback: v => isPrivacyMode ? '•••' : '$' + (v / 1000).toFixed(0) + 'k' } });

  const sources = [...new Set(history.map(h => h.source))];
  const footnoteEl = el('progress-footnote');
  if (footnoteEl) {
    footnoteEl.innerHTML =
      `History records a point whenever your portfolio changes; import dated Activity Statements to backfill the past. `
      + `Backfilled statements are scored the same way as live data (the health grade doesn't need live prices). `
      + `A gap in a line just means that metric wasn't captured at that point. `
      + `Sources so far: ${sources.join(', ')}.`;
  }
}

function initProgressView() {
  const btn = el('progress-import-btn');
  if (!btn) return;
  btn.addEventListener('click', async () => {
    const orig = btn.innerHTML;
    btn.disabled = true;
    btn.textContent = 'Importing…';
    try {
      const res = await window.electronAPI.importHistoryCsv();
      if (res.canceled) return;
      if (!res.success) { alert(`Import failed: ${res.error}`); return; }
      await renderProgressView();
      const note = el('progress-footnote');
      const pgDate = (iso) => iso ? new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '';
      if (note) note.innerHTML = `<span style="color:var(--green);">Added a history point for ${pgDate(res.statementDate)}.</span> ` + note.innerHTML;
    } catch (err) {
      alert(`Import failed: ${err.message}`);
    } finally {
      btn.disabled = false;
      btn.innerHTML = orig;
    }
  });
}
