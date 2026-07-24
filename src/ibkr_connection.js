// ─── IBKR Connection & Gateway Manager ───────────────────────────────────────

let ibkrBusy = false;

function paintIbkrButton() {
  const btn = el('pf-ibkr-sync-btn');
  if (!btn || ibkrBusy) return;
  if (ibkrConnectMode === 'flex') {
    btn.innerHTML = `${ICON_SYNC}Sync IBKR`;
    btn.disabled = false;
    return;
  }
  if (ibkrState === 'connected') {
    btn.innerHTML = `${ICON_SYNC}Sync IBKR`;
  } else if (ibkrState === 'needs-login') {
    btn.innerHTML = `${ICON_LOGIN}Login to IBKR`;
  } else {
    btn.innerHTML = `${ICON_START_GATEWAY}Start Gateway`;
  }
  btn.disabled = false;
}

function setIbkrModeUI(mode) {
  ibkrConnectMode = (mode === 'flex') ? 'flex' : 'gateway';
  const gw = el('ibkr-gateway-settings');
  const fx = el('ibkr-flex-settings');
  if (gw) gw.style.display = ibkrConnectMode === 'gateway' ? '' : 'none';
  if (fx) fx.style.display = ibkrConnectMode === 'flex' ? '' : 'none';
  document.querySelectorAll('.ibkr-mode-btn').forEach(b => {
    const active = b.dataset.mode === ibkrConnectMode;
    b.style.background = active ? 'var(--cyan)' : 'transparent';
    b.style.color = active ? '#04121a' : 'var(--text-secondary)';
    b.style.fontWeight = active ? '600' : '400';
  });
  const desc = el('ibkr-mode-desc');
  if (desc) desc.textContent = ibkrConnectMode === 'flex'
    ? 'Read-only, token-based — no gateway, no 2FA popup. Pulls a Flex statement over HTTPS. Best when the live gateway login is being blocked.'
    : 'Live session with interactive 2FA login. Enables real-time connection status; needs the local gateway running.';
  paintIbkrButton();
}

function openStatusDetail() {
  const overlay = el('status-detail-overlay');
  if (!overlay) return;
  overlay.classList.remove('hidden');
  renderStatusDetail();
}

function closeStatusDetail() {
  el('status-detail-overlay')?.classList.add('hidden');
}

async function renderStatusDetail() {
  const body = el('status-detail-body');
  if (!body) return;
  body.innerHTML = '<div style="color:var(--text-muted);">Checking…</div>';

  const subtitle = el('status-detail-subtitle');
  const retryBtn = el('status-detail-retry');
  const stopBtn = el('status-detail-stopgw');

  const row = (label, value) => `
    <div style="display:flex; gap:12px; padding:7px 0; border-bottom:1px solid rgba(255,255,255,0.05);">
      <span style="min-width:130px; color:var(--text-muted); flex-shrink:0;">${label}</span>
      <span style="color:var(--text-primary); word-break:break-word;">${value}</span>
    </div>`;

  if (ibkrConnectMode === 'flex') {
    if (subtitle) subtitle.textContent = '';
    if (stopBtn) stopBtn.style.display = 'none';
    if (retryBtn) retryBtn.textContent = 'Sync now';

    let flexCfg = {};
    try { flexCfg = await window.electronAPI.ibkrHasFlex(); } catch {}
    let flexLog = { entries: [] };
    try { flexLog = await window.electronAPI.ibkrFlexLog(); } catch {}
    const configured = flexCfg.hasToken && flexCfg.queryId;
    const ls = lastFlexSync;

    const logRows = (flexLog.entries || []).slice(-15).reverse().map(e => {
      const t = e.ts ? new Date(e.ts).toLocaleString() : '?';
      const out = e.outcome === 'accepted' ? 'accepted'
        : e.outcome === 'synced' ? `synced ${e.holdings ?? '?'} holdings`
        : e.outcome === 'error' ? `error${e.errorCode ? ' ' + e.errorCode : ''}${e.lockout ? ' (lockout)' : ''}`
        : (e.outcome || '?');
      return `${t}  ·  ${e.kind || '?'}/${e.step || '?'}  ·  ${out}`;
    });

    const stateLabel = ls && ls.ok
      ? '<span style="color:var(--green); font-weight:600;">Connected — last sync OK</span>'
      : ls && !ls.ok
        ? '<span style="color:var(--red); font-weight:600;">Last sync failed</span>'
        : configured
          ? '<span style="color:#f59e0b; font-weight:600;">Ready — not synced yet</span>'
          : '<span style="color:var(--text-muted); font-weight:600;">Not configured</span>';

    const when = ls && ls.at ? new Date(ls.at).toLocaleString() : null;

    body.innerHTML =
      row('Connection method', 'Flex Web Service (read-only — no live gateway)')
      + row('Status', stateLabel)
      + row('Flex Query ID', flexCfg.queryId || '<span style="color:var(--text-muted);">not set</span>')
      + row('Token', flexCfg.hasToken ? 'Stored (encrypted)' : '<span style="color:var(--text-muted);">not stored</span>')
      + (ls && ls.ok
          ? row('Last sync', `${ls.holdings} holdings${ls.statementDate ? ` · statement ${ls.statementDate}` : ''}${ls.accountId ? ` · ${ls.accountId}` : ''}${when ? `<br><span style="color:var(--text-muted); font-size:11px;">${when}</span>` : ''}`)
          : '')
      + (ls && !ls.ok
          ? `<div style="margin-top:12px; padding:10px 12px; background:rgba(239,68,68,0.08); border:1px solid rgba(239,68,68,0.28); border-radius:6px; color:#f8b4b4; line-height:1.5;">
               <div style="font-weight:600; margin-bottom:3px; color:#f87171;">Last sync error</div>${(ls.error || '').replace(/</g, '&lt;')}${when ? `<div style="color:var(--text-muted); font-size:11px; margin-top:4px;">${when}</div>` : ''}</div>`
          : '')
      + (ls && ls.ok && ls.warnings && ls.warnings.length
          ? `<div style="margin-top:10px;"><div style="color:var(--text-muted); margin-bottom:6px;">Import notes</div>`
            + `<pre style="margin:0; padding:10px 12px; background:rgba(0,0,0,0.3); border:1px solid var(--border); border-radius:6px; font-size:11px; line-height:1.5; white-space:pre-wrap; word-break:break-word; color:var(--text-secondary); max-height:150px; overflow-y:auto;">${ls.warnings.join('\n').replace(/</g, '&lt;')}</pre></div>`
          : '')
      + (!configured
          ? `<div style="margin-top:12px; color:var(--text-muted); line-height:1.5;">Add your Flex Query ID and token in <strong>Settings → IBKR</strong> to enable syncing.</div>`
          : '')
      + (logRows.length
          ? `<div style="margin-top:12px;"><div style="color:var(--text-muted); margin-bottom:6px;">Recent Flex requests (newest first)</div>`
            + `<pre style="margin:0; padding:10px 12px; background:rgba(0,0,0,0.3); border:1px solid var(--border); border-radius:6px; font-size:11px; line-height:1.5; white-space:pre-wrap; word-break:break-word; color:var(--text-secondary); max-height:180px; overflow-y:auto;">${logRows.join('\n').replace(/</g, '&lt;')}</pre></div>`
          : '');
    return;
  }

  if (subtitle) subtitle.textContent = 'IBKR gateway & data connection';
  if (stopBtn) stopBtn.style.display = '';
  if (retryBtn) retryBtn.textContent = 'Retry connection';

  let s = {}, gw = {}, logInfo = {}, diag = null;
  try { s = await window.electronAPI.ibkrStatus(); } catch (e) { s = { state: 'unreachable', error: e.message }; }
  try { gw = await window.electronAPI.ibkrGatewayRunning(); } catch {}
  try { logInfo = await window.electronAPI.ibkrGatewayLog(12); } catch {}
  try { diag = await window.electronAPI.ibkrGatewayDiagnostics(); } catch {}

  const stateMeta = {
    connected:     { label: 'Connected', color: 'var(--green)', dot: 'live' },
    'needs-login': { label: 'Not logged in', color: '#f59e0b', dot: 'warning' },
    unreachable:   { label: 'Gateway not reachable', color: 'var(--red)', dot: 'error' },
  }[s.state] || { label: s.state || 'Unknown', color: 'var(--text-muted)', dot: 'offline' };

  const errorLines = (logInfo.tail || []).filter(l => /error|denied|competing|fail|exception|refused/i.test(l));
  const lastExit = gw.lastExit || logInfo.lastExit;

  body.innerHTML =
    row('IBKR session', `<span style="color:${stateMeta.color}; font-weight:600;">${stateMeta.label}</span>`)
    + (s.competing ? row('Session conflict', '<span style="color:var(--red);">Another IBKR session is competing.</span>') : '')
    + (s.reason ? row('Details', s.reason) : '')
    + row('Gateway process', gw.running ? (gw.external ? 'Running (started outside PortMax)' : 'Running') : 'Not running')
    + row('Gateway URL', s.gatewayUrl || '—')
    + (lastExit ? row('Last gateway exit', `code ${lastExit.code ?? '?'}${lastExit.error ? ' — ' + lastExit.error : ''}`) : '')
    + (s.error ? row('Error', `<span style="color:var(--red);">${s.error}</span>`) : '')
    + (diag && diag.verdict
        ? `<div style="margin-top:12px; padding:10px 12px; background:rgba(245,158,11,0.08); border:1px solid rgba(245,158,11,0.28); border-radius:6px; color:#f8d7a0; line-height:1.5;">
             <div style="font-weight:600; margin-bottom:3px; color:#fbbf24;">What the gateway log says</div>${diag.verdict}</div>`
        : '')
    + (diag && diag.recent && diag.recent.length
        ? `<div style="margin-top:10px;"><div style="color:var(--text-muted); margin-bottom:6px;">Recent gateway login events</div>`
          + `<pre style="margin:0; padding:10px 12px; background:rgba(0,0,0,0.3); border:1px solid var(--border); border-radius:6px; font-size:11px; line-height:1.5; white-space:pre-wrap; word-break:break-word; color:var(--text-secondary); max-height:160px; overflow-y:auto;">${diag.recent.join('\n').replace(/</g, '&lt;')}</pre></div>`
        : '')
    + (errorLines.length
        ? `<div style="margin-top:12px;"><div style="color:var(--text-muted); margin-bottom:6px;">Recent gateway log</div>`
          + `<pre style="margin:0; padding:10px 12px; background:rgba(0,0,0,0.3); border:1px solid var(--border); border-radius:6px; font-size:11px; line-height:1.5; white-space:pre-wrap; word-break:break-word; color:#f8b4b4; max-height:150px; overflow-y:auto;">${errorLines.join('\n')}</pre></div>`
        : '');
}

function setStatus(state, text) {
  const dot   = el('status-dot');
  const label = el('status-text');
  if (!dot || !label) return;

  if (state === 'live' && text === 'Live') {
    if (ibkrState === 'connected') {
      dot.className = 'status-dot live';
      label.textContent = ibkrCompeting ? 'IBKR (competing session)' : 'Live';
      label.title = ibkrCompeting ? (ibkrReason || '') : '';
    } else if (ibkrState === 'needs-login') {
      dot.className = 'status-dot warning';
      label.textContent = ibkrCompeting ? 'IBKR: session conflict'
        : ibkrSawConnected ? 'IBKR dropped — session conflict?'
        : 'IBKR disconnected';
      label.title = ibkrReason || '';
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

async function flexPreflightOK() {
  try {
    const g = await window.electronAPI.ibkrFlexGuard();
    if (g && g.warn) {
      return confirm(`${g.message}\n\nRequest anyway? This may reset IBKR's rate-limit timer.`);
    }
  } catch {}
  return true;
}

function shortFlexError(result) {
  if (result && result.lockout) return 'IBKR Flex: rate-limited';
  const code = result && result.errorCode ? ` (code ${result.errorCode})` : '';
  return `IBKR Flex: sync failed${code}`;
}

async function runFlexSync(statusEl) {
  const setMsg = (kind, full, short) => {
    if (statusEl) {
      statusEl.textContent = full;
      statusEl.style.color = kind === 'error' ? 'var(--red)' : (kind === 'ok' ? 'var(--green)' : 'var(--text-muted)');
    }
    setStatus(kind === 'error' ? 'error' : (kind === 'ok' ? 'live' : 'loading'), short || full);
  };
  setMsg('loading', 'Fetching IBKR Flex statement…');
  try {
    const result = await window.electronAPI.ibkrFlexSync();
    if (result.success) {
      if (typeof renderPortfolio === 'function') renderPortfolio(result.portfolio);
      const dateNote = result.statementDate ? ` (as of ${result.statementDate})` : '';
      setMsg('ok', `Synced ${result.portfolio.holdings.length} holdings from IBKR Flex${dateNote}`);
      if (result.warnings?.length) console.warn('Flex sync warnings:', result.warnings);
      lastFlexSync = {
        at: Date.now(), ok: true,
        holdings: result.portfolio.holdings.length,
        statementDate: result.statementDate || null,
        accountId: result.accountId || null,
        warnings: result.warnings || [],
      };
      return true;
    }
    setMsg('error', result.error || 'Flex sync failed', shortFlexError(result));
    lastFlexSync = { at: Date.now(), ok: false, error: result.error || 'Flex sync failed' };
    return false;
  } catch (e) {
    setMsg('error', 'Flex sync failed: ' + e.message, 'IBKR Flex: sync failed');
    lastFlexSync = { at: Date.now(), ok: false, error: e.message };
    return false;
  }
}

// ─── IBKR Gateway Status & Login Modal ───────────────────────────────────────
refreshIbkrStatus = async function (opts = {}) {
  try {
    const s = await window.electronAPI.ibkrStatus();
    ibkrState = s.state;
    ibkrReason = s.reason || null;
    ibkrCompeting = !!s.competing;
    if (s.state === 'connected') ibkrSawConnected = true;

    paintIbkrButton();
    if (!opts.quiet) {
      setStatus('live', 'Live');
    }
    return s;
  } catch (err) {
    ibkrState = 'unreachable';
    paintIbkrButton();
    return { state: 'unreachable', error: err.message };
  }
};

async function pollIbkrUntil(states, timeoutMs = 30000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 2000));
    const s = await refreshIbkrStatus({ quiet: true });
    if (states.includes(s.state)) return s.state;
  }
  return ibkrState;
}

let ibkrLoginPoll = null;

async function openIbkrLogin() {
  const overlay = el('ibkr-login-overlay');
  const host = el('ibkr-webview-host');
  const loading = el('ibkr-login-loading');
  if (!overlay || !host) return;

  const s = await window.electronAPI.ibkrStatus();
  host.innerHTML = '';
  if (loading) loading.style.display = '';
  const wv = document.createElement('webview');
  wv.setAttribute('src', s.gatewayUrl || 'https://localhost:5000');
  wv.setAttribute('partition', 'persist:ibkr');
  wv.setAttribute('useragent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36');
  wv.style.width = '100%';
  wv.style.height = '100%';
  wv.addEventListener('did-stop-loading', () => { if (loading) loading.style.display = 'none'; });

  const urlBar = el('ibkr-url-bar');
  const urlLock = el('ibkr-url-lock');
  const showUrl = (u) => {
    if (!urlBar || !u) return;
    urlBar.textContent = u;
    const secure = /^https:/i.test(u);
    urlBar.style.color = secure ? 'var(--text-muted)' : 'var(--red)';
    if (urlLock) urlLock.style.stroke = secure ? 'var(--text-muted)' : 'var(--red)';
  };
  showUrl(s.gatewayUrl || 'https://localhost:5000');
  wv.addEventListener('did-navigate', (e) => showUrl(e.url));
  wv.addEventListener('did-navigate-in-page', (e) => showUrl(e.url));

  const checkForSuccess = () => {
    wv.executeJavaScript(`(document.body?.innerText || '').slice(0, 300)`)
      .then(text => {
        if (/client login succeeds/i.test(text || '')) { onIbkrLoginSuccess(); return; }
        if (/access denied|don't have permission|edgesuite\.net/i.test(text || '')) {
          showIbkrFallback();
        }
      })
      .catch(() => {});
  };

  wv.addEventListener('did-finish-load', checkForSuccess);
  wv.addEventListener('did-navigate', checkForSuccess);

  host.appendChild(wv);
  const fb = el('ibkr-login-fallback');
  if (fb) fb.style.display = 'none';
  const fbWaiting = el('ibkr-fallback-waiting');
  if (fbWaiting) fbWaiting.style.display = 'none';
  overlay.classList.remove('hidden');

  clearInterval(ibkrLoginPoll);
  ibkrLoginPoll = setInterval(async () => {
    checkForSuccess();
    const s = await refreshIbkrStatus({ quiet: true });
    if (s.state === 'connected') {
      onIbkrLoginSuccess();
    }
  }, 3000);
}

function onIbkrLoginSuccess() {
  closeIbkrLogin();
  setStatus('live', 'IBKR connected — syncing…');
  ibkrState = 'connected';
  paintIbkrButton();
  const syncBtn = el('pf-ibkr-sync-btn');
  if (syncBtn && !syncBtn.disabled) syncBtn.click();
  settleIbkrStatusAfterLogin();
}

async function settleIbkrStatusAfterLogin(attempts = 8, delayMs = 2000) {
  for (let i = 0; i < attempts; i++) {
    await new Promise(r => setTimeout(r, 2000));
    let s;
    try { s = await window.electronAPI.ibkrStatus(); } catch { continue; }
    if (s.state === 'connected') {
      ibkrState = 'connected';
      paintIbkrButton();
      return;
    }
  }
  refreshIbkrStatus({ quiet: true });
}

function closeIbkrLogin() {
  const overlay = el('ibkr-login-overlay');
  const host = el('ibkr-webview-host');
  clearInterval(ibkrLoginPoll);
  ibkrLoginPoll = null;
  if (overlay) overlay.classList.add('hidden');
  if (host) host.innerHTML = '';
}

function showIbkrFallback() {
  const fb = el('ibkr-login-fallback');
  const loading = el('ibkr-login-loading');
  if (loading) loading.style.display = 'none';
  if (fb) fb.style.display = 'flex';
}

el('ibkr-login-close')?.addEventListener('click', closeIbkrLogin);
el('ibkr-open-browser-btn')?.addEventListener('click', async () => {
  try { await window.electronAPI.ibkrOpenLogin(); } catch {}
  const waiting = el('ibkr-fallback-waiting');
  if (waiting) waiting.style.display = 'inline-flex';
});
el('ibkr-retry-embedded-btn')?.addEventListener('click', () => {
  closeIbkrLogin();
  openIbkrLogin();
});

// ─── Sync Button Handler ─────────────────────────────────────────────────────
el('pf-ibkr-sync-btn')?.addEventListener('click', async () => {
  const btn = el('pf-ibkr-sync-btn');
  if (!btn || ibkrBusy) return;

  if (ibkrConnectMode === 'flex') {
    ibkrBusy = true;
    btn.disabled = true;
    btn.textContent = 'Syncing…';
    try {
      await runFlexSync();
    } finally {
      ibkrBusy = false;
      btn.disabled = false;
      paintIbkrButton();
    }
    return;
  }

  if (ibkrState === 'connected') {
    ibkrBusy = true;
    btn.disabled = true;
    btn.textContent = 'Syncing…';
    try {
      const result = await window.electronAPI.ibkrSync();
      if (result.success) {
        if (typeof renderPortfolio === 'function') renderPortfolio(result.portfolio);
        setStatus('live', `Synced ${result.portfolio.holdings.length} holdings`);
      } else {
        setStatus('error', result.error || 'IBKR sync failed');
      }
    } catch (e) {
      setStatus('error', 'IBKR sync failed: ' + e.message);
    } finally {
      ibkrBusy = false;
      btn.disabled = false;
      refreshIbkrStatus({ quiet: true });
    }
    return;
  }

  if (ibkrState === 'needs-login') {
    openIbkrLogin();
    return;
  }

  if (ibkrState === 'unreachable') {
    ibkrBusy = true;
    btn.disabled = true;
    btn.textContent = 'Starting…';
    try {
      const running = await window.electronAPI.ibkrGatewayRunning();
      if (!running.running) {
        const start = await window.electronAPI.ibkrGatewayStart();
        if (!start.success) {
          setStatus('error', start.error || 'Could not start gateway');
          ibkrBusy = false;
          paintIbkrButton();
          return;
        }
        setStatus('loading', 'Starting IBKR gateway… (Java takes ~15–30s)');
        await pollIbkrUntil(['needs-login', 'connected'], 40000);
      } else {
        await refreshIbkrStatus();
      }
    } catch (err) {
      setStatus('error', 'Failed to launch gateway: ' + err.message);
    } finally {
      ibkrBusy = false;
      btn.disabled = false;
      refreshIbkrStatus({ quiet: true });
    }
  }
});
