'use strict';

// ─── Analysis & Symbol Details Modal ─────────────────────────────────────────
function switchSymbolTab(tabName) {
  const tabs = {
    recommendation: { btn: el('modal-tab-recommendation'), body: el('modal-content-recommendation') },
    compliance:     { btn: el('modal-tab-compliance'),     body: el('modal-content-compliance') },
    options:        { btn: el('modal-tab-options'),         body: el('modal-content-options') },
  };
  if (!tabs[tabName] || !tabs[tabName].btn) tabName = 'recommendation';
  for (const [name, { btn, body }] of Object.entries(tabs)) {
    if (!btn || !body) continue;
    const on = name === tabName;
    btn.classList.toggle('active', on);
    btn.style.color = on ? 'var(--cyan)' : 'var(--text-secondary)';
    btn.style.borderBottom = on ? '2px solid var(--cyan)' : 'none';
    body.style.display = on ? 'block' : 'none';
  }
}

// Recommendation tab: plain-language verdict + goal scores
function renderSymbolRecommendation(d, a, lenses, scannerHit) {
  const rEl = el('si-recommendation');
  const gEl = el('si-goal-scores');
  if (!rEl || !gEl) return;
  const meta = (window.lensScores && window.lensScores.LENS_META) || {};
  const gradeNum = g => ({ A: 5, B: 4, C: 3, D: 2, E: 1, F: 0 }[g] ?? -1);

  const cards = [
    { key: 'buyHold',  label: meta.buyHold?.label  || 'Buy & Hold', grade: lenses?.buyHold?.grade,  blurb: meta.buyHold?.blurb  || 'Quality as a long-term core holding.', factor: lenses?.buyHold?.factors?.[0]?.detail },
    { key: 'dividend', label: meta.dividend?.label || 'Dividend',   grade: lenses?.dividend?.grade, blurb: meta.dividend?.blurb || 'Tax-efficient income.',               factor: lenses?.dividend?.factors?.[0]?.detail },
    { key: 'trading',  label: meta.trading?.label  || 'Short-Term', grade: lenses?.trading?.grade,  blurb: meta.trading?.blurb  || 'Short-term / speculative edge.',      adv: true, factor: lenses?.trading?.factors?.[0]?.detail },
    { key: 'options',  label: 'Options', grade: scannerHit?._score?.grade, blurb: 'Cash-secured put income.', factor: scannerHit?._score ? `Score ${scannerHit._score.totalScore}/100` : 'No options scan for this symbol' },
  ];

  const badgeFor = g => (g ? renderGradeBadge(g) : '<span style="font-size:11px; color:var(--text-muted);">—</span>');
  gEl.innerHTML = `
    <div style="font-size:11px; font-weight:600; color:var(--text-secondary); text-transform:uppercase; letter-spacing:0.5px; margin-bottom:8px;">How it scores for each goal</div>
    <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(190px, 1fr)); gap:8px;">
      ${cards.map(c => `
        <div title="${(c.blurb || '').replace(/"/g, '&quot;')}${c.factor ? ' — ' + c.factor.replace(/"/g, '&quot;') : ''}"
          style="background:rgba(255,255,255,0.02); border:1px solid var(--border); border-radius:8px; padding:10px 12px; ${c.grade ? '' : 'opacity:0.6;'}">
          <div style="display:flex; align-items:center; justify-content:space-between; gap:6px; margin-bottom:5px;">
            <span style="font-size:12px; color:var(--text-secondary); font-weight:600;">${c.label}${c.adv ? ' <span style="color:#a855f7; font-size:9px; text-transform:uppercase;">adv</span>' : ''}</span>
            ${badgeFor(c.grade)}
          </div>
          <div style="font-size:11px; color:var(--text-muted); line-height:1.4;">${c.blurb}</div>
          ${c.factor ? `<div style="font-size:10.5px; color:var(--text-secondary); margin-top:5px;">${c.factor}</div>` : ''}
        </div>`).join('')}
    </div>`;

  const tone = a?.suitability;
  let color = 'var(--cyan)', bg = 'rgba(0,240,255,0.05)', border = 'rgba(0,240,255,0.22)';
  let headline, detail;
  if (a && tone === 'danger') {
    color = '#f43f5e'; bg = 'rgba(244,63,94,0.08)'; border = 'rgba(244,63,94,0.25)';
    headline = a.reason; detail = a.details;
  } else {
    if (tone === 'excellent') { color = 'var(--green)'; bg = 'rgba(16,185,129,0.08)'; border = 'rgba(16,185,129,0.25)'; }
    else if (tone === 'caution') { color = '#f59e0b'; bg = 'rgba(245,158,11,0.08)'; border = 'rgba(245,158,11,0.25)'; }
    const scored = cards.filter(c => c.grade);
    const best = scored.slice().sort((x, y) => gradeNum(y.grade) - gradeNum(x.grade))[0];
    headline = best ? `Best used as ${best.label.toLowerCase()} — grade ${best.grade}` : (a?.reason || 'Analysis');
    const bits = [];
    if (best?.factor) bits.push(best.factor);
    if (a?.reason && a.reason !== headline) bits.push(a.reason);
    detail = bits.join('. ') || (a?.details || 'No scoring data available for this symbol.');
  }
  rEl.innerHTML = `
    <div style="padding:12px 14px; border-radius:8px; background:${bg}; border:1px solid ${border};">
      <div style="font-size:10px; text-transform:uppercase; letter-spacing:0.5px; color:var(--text-muted); margin-bottom:4px;">Recommendation</div>
      <div style="font-weight:700; font-size:15px; color:${color}; margin-bottom:5px;">${headline}</div>
      <div style="font-size:12px; color:var(--text-secondary); line-height:1.5;">${detail}</div>
    </div>
    ${renderVerdictAndCost(d, a, lenses)}`;
}

// "Is it worth owning, and what does owning it cost?" — the two questions the
// score cards don't answer. Rendered directly under the recommendation banner.
function renderVerdictAndCost(d, a, lenses) {
  const V = window.verdict, T = window.tradeCost;
  if (!V || !T) return '';

  const isFund = !!(d.overlap || d.expenseRatioPct != null
    || ['ETF', 'MUTUALFUND'].includes((d.quoteType || '').toUpperCase())
    || ['etf', 'bond etf'].includes((a && a.type || '').toLowerCase()));
  const kind = (a && a.type) === 'bond etf' ? 'bond' : 'equity';
  const taxRate = d.dividendTaxRatePct ?? (typeof lensDividendTaxRate !== 'undefined' ? lensDividendTaxRate : 30);

  const v = V.instrumentVerdict({
    symbol: d.symbol, isFund, kind,
    isPfic: !!(a && a.isPfic) || !!d.isPfic,
    yieldPct: d.yieldPct, expenseRatioPct: d.expenseRatioPct, marketCap: d.marketCap,
    buyHoldScore: lenses?.buyHold?.score, dividendScore: lenses?.dividend?.score,
  }, { usPerson: typeof lensUsPerson !== 'undefined' ? lensUsPerson : true, dividendTaxRatePct: taxRate });

  const c = T.costSummary({
    price: d.price, expenseRatioPct: d.expenseRatioPct, yieldPct: d.yieldPct, dividendTaxRatePct: taxRate,
  });

  const tones = { good: 'var(--green)', ok: 'var(--cyan)', warn: '#f59e0b', bad: 'var(--red)' };
  const vc = tones[v.rating.tone] || 'var(--text-secondary)';
  const q = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');

  const costRow = (label, value, note) => `
    <div style="flex:1 1 130px; min-width:130px;">
      <div style="font-size:10px; color:var(--text-muted); text-transform:uppercase; letter-spacing:0.5px;">${label}</div>
      <div style="font-size:14px; font-weight:700; margin-top:2px; font-family:'JetBrains Mono', monospace;">${value}</div>
      <div style="font-size:10.5px; color:var(--text-muted); margin-top:2px; line-height:1.35;">${note}</div>
    </div>`;

  return `
    <div style="margin-top:12px; padding:12px 14px; border-radius:8px; border:1px solid var(--border); background:rgba(255,255,255,0.02);">
      <div style="display:flex; align-items:center; gap:8px; margin-bottom:6px;">
        <span style="color:${vc}; background:color-mix(in srgb, ${vc} 12%, transparent); border:1px solid color-mix(in srgb, ${vc} 30%, transparent); border-radius:4px; padding:1px 8px; font-size:10.5px; font-weight:700; text-transform:uppercase; letter-spacing:0.04em;">${q(v.role.label)}</span>
        <span style="font-size:12px; font-weight:600; color:${vc};">${q(v.rating.label)}</span>
      </div>
      <div style="font-size:12.5px; color:var(--text-secondary); line-height:1.5;">${q(v.headline)} ${q(v.role.blurb)}</div>
      ${v.hold ? `<div style="margin-top:9px; padding-top:8px; border-top:1px solid var(--border);">
        <span style="font-size:11px; color:var(--text-muted); text-transform:uppercase; letter-spacing:0.5px;">Plan to hold</span>
        <span style="font-size:13px; font-weight:700; color:var(--cyan); margin-left:8px;">${q(v.hold.label)}</span>
        <div style="font-size:11.5px; color:var(--text-secondary); line-height:1.5; margin-top:3px;">${q(v.hold.rationale)}</div>
      </div>` : ''}
      ${(v.strengths || []).length ? `<div style="margin-top:9px; display:flex; flex-wrap:wrap; gap:5px;">${
        v.strengths.map(s => `<span style="font-size:10.5px; color:var(--green); background:rgba(16,185,129,0.10); border:1px solid rgba(16,185,129,0.25); border-radius:4px; padding:2px 7px;">${q(s)}</span>`).join('')
      }</div>` : ''}
      ${v.watch.length ? `<ul style="margin:8px 0 0; padding-left:16px; font-size:11.5px; color:var(--text-secondary); line-height:1.5;">${v.watch.map(w => `<li>${q(w)}</li>`).join('')}</ul>` : ''}
    </div>

    <div style="margin-top:10px; padding:12px 14px; border-radius:8px; border:1px solid var(--border); background:rgba(255,255,255,0.02);">
      <div style="font-size:11px; font-weight:600; color:var(--text-secondary); text-transform:uppercase; letter-spacing:0.5px; margin-bottom:9px;">What it costs to own</div>
      <div style="display:flex; flex-wrap:wrap; gap:14px;">
        ${costRow('Every year', `${c.totalPct.toFixed(2)}%`, `≈$${c.annualCostPer10kUsd} per $10,000 held`)}
        ${costRow('Fund fee', d.expenseRatioPct == null ? 'None' : `${c.expenseRatioPct.toFixed(2)}%`, d.expenseRatioPct == null ? 'Individual stock — no fund fee' : 'Charged whether it rises or falls')}
        ${costRow('Dividend tax', `${c.taxDragPct.toFixed(2)}%`, `${taxRate}% of a ${(d.yieldPct || 0).toFixed(2)}% yield`)}
        ${costRow('To buy &amp; sell', '~$0.70', 'IBKR commission, round trip')}
      </div>
      <div style="margin-top:10px; padding-top:9px; border-top:1px solid var(--border); font-size:11.5px; color:${tones[c.holdLevel] || 'var(--text-secondary)'}; line-height:1.5;">
        ${q(c.holdNote)}
      </div>
      <div style="margin-top:6px; font-size:10.5px; color:var(--text-muted); line-height:1.45;">
        ${c.dominantCost === 'holding'
          ? 'For a long-term holding the annual cost above is what matters — it recurs every year, while the commission is paid once.'
          : 'Commission dominates at this size; the annual cost only overtakes it once the position is meaningful.'}
        Planning estimate, not tax advice.
      </div>
    </div>`;
}

async function openSymbolDetails(symbolOrData, defaultTab = 'recommendation') {
  if (!symbolOrData) return;
  const symbol = typeof symbolOrData === 'string' ? symbolOrData : symbolOrData.symbol;

  const modal = el('modal-overlay');
  if (!modal) return;

  modal.classList.remove('hidden');
  const liveEl = el('modal-live');
  if (liveEl) liveEl.style.display = 'none';

  let loadingEl = el('modal-loading-placeholder');
  if (!loadingEl) {
    loadingEl = document.createElement('div');
    loadingEl.id = 'modal-loading-placeholder';
    loadingEl.style.padding = '40px';
    loadingEl.style.color = 'var(--text-muted)';
    loadingEl.style.textAlign = 'center';
    loadingEl.style.fontSize = '13px';
    loadingEl.textContent = 'Loading symbol details...';
    liveEl.parentNode.insertBefore(loadingEl, liveEl);
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
  if (liveEl) liveEl.style.display = 'flex';

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

  // 2. Compliance box
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

  // Fund breadth feeds the buy-and-hold score (a whole-market fund is steadier
  // than a one-sector fund), so resolve it here rather than letting the lens
  // fall back to "unknown" and grade every ETF identically.
  const lensSubject = window.verdict
    ? { ...d, breadth: window.verdict.fundBreadth(d.symbol, {
        isFund: !!(d.overlap || d.expenseRatioPct != null || ['ETF', 'MUTUALFUND'].includes((d.quoteType || '').toUpperCase())),
        kind: (a && a.type) === 'bond etf' ? 'bond' : 'equity',
      }) }
    : d;
  const lenses = d._lenses || (window.lensScores && window.lensScores.scoreLenses(lensSubject, {
    usPerson: lensUsPerson, dividendTaxRatePct: d.dividendTaxRatePct ?? lensDividendTaxRate,
  })) || null;

  const scannerHit = (typeof symbolOrData === 'object' && symbolOrData._score)
    ? symbolOrData : (window.allData || allData || []).find(x => x.symbol === d.symbol);

  // 3. Always-visible essentials
  const range52 = (d.fiftyTwoWeekLow != null && d.fiftyTwoWeekHigh != null && d.price != null && d.fiftyTwoWeekHigh > d.fiftyTwoWeekLow)
    ? `${(((d.price - d.fiftyTwoWeekLow) / (d.fiftyTwoWeekHigh - d.fiftyTwoWeekLow)) * 100).toFixed(0)}% of 52w range`
    : null;
  const essentials = [];
  essentials.push({ label: d.overlap ? 'Fund Assets' : 'Market Cap', value: d.marketCap != null ? fmt.mktcap(d.marketCap) : '—' });
  essentials.push(d.held
    ? { label: 'You Own', value: `$${Math.round(d.held.marketValue).toLocaleString('en-US')} · ${d.held.weightPct.toFixed(1)}%`, privacy: true }
    : { label: 'You Own', value: 'Not held' });
  if (d.yieldPct != null) essentials.push({ label: 'Dividend Yield', value: `${d.yieldPct.toFixed(2)}%` });
  if (range52) essentials.push({ label: '52-Week Position', value: range52 });
  if (essentials.length < 4 && d.taxDragPct != null) essentials.push({ label: 'Tax Drag/yr', value: `${d.taxDragPct.toFixed(2)}%`, color: d.taxDragPct >= 1.5 ? 'var(--red)' : d.taxDragPct >= 0.5 ? '#f59e0b' : 'var(--green)' });
  if (essentials.length < 4 && d.expenseRatioPct != null) essentials.push({ label: 'Expense Ratio', value: `${d.expenseRatioPct.toFixed(2)}%` });
  el('si-essentials').innerHTML = essentials.slice(0, 4).map(s => `
    <div style="background:rgba(255,255,255,0.02); border:1px solid var(--border); border-radius:8px; padding:8px 10px;">
      <div style="font-size:10px; color:var(--text-muted); text-transform:uppercase; letter-spacing:0.5px;">${s.label}</div>
      <div style="font-size:13px; font-weight:600; margin-top:2px; ${s.color ? `color:${s.color};` : ''}" ${s.privacy ? 'class="privacy-amount"' : ''}>${s.value}</div>
    </div>`).join('');

  renderSymbolRecommendation(d, a, lenses, scannerHit);

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

  const optWrap = el('modal-options-wrap');
  const sidebarNoOpt = el('modal-sidebar-no-options');

  if (scannerHit) {
    if (optWrap) optWrap.style.display = 'block';
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
    currentModal = null;
    if (optWrap) optWrap.style.display = 'none';
    if (sidebarNoOpt) sidebarNoOpt.style.display = 'block';
  }

  const wantTab = (defaultTab === 'options' && !scannerHit) ? 'recommendation' : defaultTab;
  switchSymbolTab(wantTab || 'recommendation');

  renderChart([], d.symbol);
  try {
    const history = await window.electronAPI.fetchHistory(d.symbol);
    renderChart(history, d.symbol);
  } catch (e) {
    console.warn('History fetch failed:', e);
  }
}

async function openSymbolInsight(symbol) {
  await openSymbolDetails(symbol, 'recommendation');
}

function closeSymbolInsight() {
  closeModal();
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

// ─── Help & Guide Modal ──────────────────────────────────────────────────────
function openHelp()  { el('help-overlay')?.classList.remove('hidden'); }
function closeHelp() { el('help-overlay')?.classList.add('hidden'); }

el('help-nav')?.addEventListener('click', openHelp);
el('help-nav')?.addEventListener('keydown', e => {
  if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openHelp(); }
});
el('help-close')?.addEventListener('click', closeHelp);
el('help-overlay')?.addEventListener('click', e => {
  if (e.target === el('help-overlay')) closeHelp();
});

// ─── Status Bar & Connection Details Modal ──────────────────────────────────
el('status-bar-btn')?.addEventListener('click', () => {
  if (typeof openStatusDetail === 'function') openStatusDetail();
});
el('status-detail-close')?.addEventListener('click', () => {
  if (typeof closeStatusDetail === 'function') closeStatusDetail();
});
el('status-detail-overlay')?.addEventListener('click', e => {
  if (e.target === el('status-detail-overlay') && typeof closeStatusDetail === 'function') closeStatusDetail();
});
el('status-detail-retry')?.addEventListener('click', async () => {
  const note = el('status-detail-action-note');
  if (note) note.textContent = ibkrConnectMode === 'flex' ? 'Syncing…' : 'Retrying…';
  try {
    if (ibkrConnectMode === 'flex' && typeof runFlexSync === 'function') {
      await runFlexSync();
    } else if (typeof refreshIbkrStatus === 'function') {
      await refreshIbkrStatus();
    }
  } catch {}
  if (typeof renderStatusDetail === 'function') await renderStatusDetail();
  if (note) note.textContent = 'Rechecked.';
});
el('status-detail-stopgw')?.addEventListener('click', async () => {
  const note = el('status-detail-action-note');
  if (note) note.textContent = 'Stopping gateways…';
  try {
    const r = await window.electronAPI.ibkrGatewayStop();
    if (note) note.textContent = r.stopped > 0 ? `Stopped ${r.stopped}.` : 'None were running.';
  } catch { if (note) note.textContent = 'Stop failed.'; }
  if (typeof renderStatusDetail === 'function') await renderStatusDetail();
});

// ─── Symbol dialog: close + tab switching ────────────────────────────────────
// (Lost in the app.js modularization — without these the dialog can't be closed
// and the Compliance/Options tabs don't respond.)
el('modal-close')?.addEventListener('click', closeModal);
el('modal-overlay')?.addEventListener('click', e => {
  if (e.target === el('modal-overlay')) closeModal();
});
el('modal-tab-recommendation')?.addEventListener('click', () => switchSymbolTab('recommendation'));
el('modal-tab-compliance')?.addEventListener('click', () => switchSymbolTab('compliance'));
el('modal-tab-options')?.addEventListener('click', () => switchSymbolTab('options'));

// ─── Global Keyboard Shortcuts ───────────────────────────────────────────────
document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    closeModal();
    closeHelp();
    if (typeof closeStatusDetail === 'function') closeStatusDetail();
  }
});
