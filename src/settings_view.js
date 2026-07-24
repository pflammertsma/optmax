'use strict';

// ─── Settings View Module ────────────────────────────────────────────────────

function updateIntervalDesc(val) {
  const elDesc = el('interval-desc');
  if (elDesc) elDesc.textContent = INTERVAL_DESCS[val] || '';
}

function updateMarginDesc(val) {
  const elDesc = el('margin-desc');
  if (elDesc) elDesc.textContent = MARGIN_DESCS[val] || '';
}

function updatePriceIntervalDesc(val) {
  const elDesc = el('price-interval-desc');
  if (elDesc) elDesc.textContent = PRICE_INTERVAL_DESCS[val] || '';
}

function setListLabels(fetchedAt, minMarginPct, nextRefresh) {
  const m = minMarginPct != null ? minMarginPct : 20;
  const subtitleEl = el('dashboard-stats-subtitle');
  if (subtitleEl && (!allData || allData.length === 0)) {
    subtitleEl.textContent = `0 opportunities · 0 with score > 0 · 0 with passing grades`;
  }
}

function setPriceLabels(pricedAt, nextPriceUpdate) {
  // Price label updates
}

function setListBtnsState(disabled) {
  const b1 = el('refresh-btn');
  const b2 = el('sidebar-refresh-btn');
  if (b1) { b1.disabled = disabled; b1.classList.toggle('spinning', disabled); }
  if (b2) { b2.disabled = disabled; b2.classList.toggle('spinning', disabled); }
}

function setPriceBtnState(disabled) {
  const btn = el('price-refresh-btn');
  if (btn) { btn.disabled = disabled; btn.classList.toggle('spinning', disabled); }
}

async function refreshCredentialsStatus() {
  const label = el('pf-credentials-status');
  if (!label) return;
  try {
    const has = await window.electronAPI.ibkrHasCredentials();
    label.textContent = has ? 'Username & password stored (encrypted).' : 'No credentials stored yet.';
  } catch {
    label.textContent = '';
  }
}

async function refreshFlexStatus() {
  const label = el('pf-flex-status');
  if (!label) return;
  try {
    const s = await window.electronAPI.ibkrHasFlex();
    if (s.hasToken && s.queryId) {
      label.textContent = `Configured: Query ID ${s.queryId}, Token stored.`;
      label.style.color = 'var(--text-secondary)';
    } else if (s.queryId) {
      label.textContent = `Query ID ${s.queryId} set, but Token missing.`;
      label.style.color = '#f59e0b';
    } else {
      label.textContent = 'No Flex query ID or token configured yet.';
      label.style.color = 'var(--text-muted)';
    }
    const qInp = el('settings-flex-query-id');
    if (qInp && s.queryId && !qInp.value) qInp.value = s.queryId;
  } catch {
    label.textContent = '';
  }
}

async function initSettingsUI() {
  let settings = {};
  try {
    settings = await window.electronAPI.getSettings();
  } catch (e) {
    console.error('Failed to load settings:', e);
  }

  const intervalVal = String(settings.refreshIntervalDays ?? 7);
  const marginVal   = String(settings.minMarginPct ?? 20);
  const priceVal    = String(settings.priceRefreshHours ?? 1);

  const selInterval = el('interval-select');
  const selMargin   = el('margin-select');
  const selPrice    = el('price-interval-select');

  if (selInterval) selInterval.value = intervalVal;
  if (selMargin)   selMargin.value   = marginVal;
  if (selPrice)    selPrice.value    = priceVal;

  updateIntervalDesc(intervalVal);
  updateMarginDesc(marginVal);
  updatePriceIntervalDesc(priceVal);

  const birthInp = el('settings-birth-year');
  if (birthInp) {
    birthInp.value = settings.birthYear ?? '';
    birthInp.addEventListener('change', async () => {
      const val = parseInt(birthInp.value, 10);
      if (Number.isFinite(val) && val > 1900 && val <= new Date().getFullYear()) {
        await window.electronAPI.saveSettings({ birthYear: val });
        if (portfolio && typeof renderPortfolio === 'function') renderPortfolio(portfolio);
      }
    });
  }

  const glidebaseInp = el('settings-glidepath-base');
  if (glidebaseInp) {
    glidebaseInp.value = settings.glidepathBase ?? 110;
    glidebaseInp.addEventListener('change', async () => {
      const val = parseInt(glidebaseInp.value, 10);
      if (Number.isFinite(val) && val >= 90 && val <= 130) {
        await window.electronAPI.saveSettings({ glidepathBase: val });
        if (portfolio && typeof renderPortfolio === 'function') renderPortfolio(portfolio);
      }
    });
  }

  const employerInp = el('settings-employer-symbols');
  if (employerInp) {
    const employerVal = Array.isArray(settings.employerSymbols)
      ? settings.employerSymbols.join(', ')
      : (settings.employerSymbols || '');
    employerInp.value = employerVal;
    employerInp.addEventListener('change', async () => {
      const symbols = employerInp.value.split(/[\s,]+/).map(s => s.trim().toUpperCase()).filter(Boolean);
      await window.electronAPI.saveSettings({ employerSymbols: symbols });
      if (portfolio && typeof renderPortfolio === 'function') renderPortfolio(portfolio);
    });
  }

  const concLimitInp = el('settings-conc-limit');
  if (concLimitInp) {
    const val = Number.isFinite(Number(settings.concentrationLimitPct)) ? Number(settings.concentrationLimitPct) : 10;
    concLimitInp.value = val;
    concentrationLimit = val;
    concLimitInp.addEventListener('change', async () => {
      const n = parseFloat(concLimitInp.value);
      if (Number.isFinite(n) && n >= 1 && n <= 50) {
        concentrationLimit = n;
        await window.electronAPI.saveSettings({ concentrationLimitPct: n });
        if (portfolio && typeof renderPortfolio === 'function') renderPortfolio(portfolio);
      }
    });
  }

  const pficAgeInp = el('settings-pfic-age');
  if (pficAgeInp) {
    pficAgeInp.value = settings.pficAssumedYears ?? 3;
    pficAgeInp.addEventListener('change', async () => {
      const v = parseInt(pficAgeInp.value, 10);
      if (Number.isFinite(v) && v >= 1 && v <= 20) {
        await window.electronAPI.saveSettings({ pficAssumedYears: v });
        if (typeof renderPficCosts === 'function') renderPficCosts();
      }
    });
  }

  const pficRateInp = el('settings-pfic-rate');
  if (pficRateInp) {
    pficRateInp.value = settings.pficMarginalRatePct ?? 37;
    pficRateInp.addEventListener('change', async () => {
      const v = parseFloat(pficRateInp.value);
      if (Number.isFinite(v) && v >= 0 && v <= 60) {
        await window.electronAPI.saveSettings({ pficMarginalRatePct: v });
        if (typeof renderPficCosts === 'function') renderPficCosts();
      }
    });
  }

  const pficInterestInp = el('settings-pfic-interest');
  if (pficInterestInp) {
    pficInterestInp.value = settings.pficInterestRatePct ?? 8;
    pficInterestInp.addEventListener('change', async () => {
      const v = parseFloat(pficInterestInp.value);
      if (Number.isFinite(v) && v >= 0 && v <= 20) {
        await window.electronAPI.saveSettings({ pficInterestRatePct: v });
        if (typeof renderPficCosts === 'function') renderPficCosts();
      }
    });
  }

  const usPersonChk = el('settings-tax-us-person');
  if (usPersonChk) {
    usPersonChk.checked = settings.usPerson ?? true;
    lensUsPerson = usPersonChk.checked;
    usPersonChk.addEventListener('change', async () => {
      lensUsPerson = usPersonChk.checked;
      await window.electronAPI.saveSettings({ usPerson: usPersonChk.checked });
      renderAll(allData);
    });
  }

  const divTaxRateInp = el('settings-tax-div-rate');
  if (divTaxRateInp) {
    const val = Number.isFinite(Number(settings.dividendTaxRatePct)) ? Number(settings.dividendTaxRatePct) : 30;
    divTaxRateInp.value = val;
    lensDividendTaxRate = val;
    divTaxRateInp.addEventListener('change', async () => {
      const n = parseFloat(divTaxRateInp.value);
      if (Number.isFinite(n) && n >= 0 && n <= 60) {
        lensDividendTaxRate = n;
        await window.electronAPI.saveSettings({ dividendTaxRatePct: n });
        renderAll(allData);
      }
    });
  }

  setIbkrModeUI(settings.ibkrConnectMode || 'gateway');
  refreshCredentialsStatus();
  refreshFlexStatus();

  const saveCredsBtn = el('pf-save-credentials');
  if (saveCredsBtn) {
    saveCredsBtn.addEventListener('click', async () => {
      const username = el('settings-ibkr-username')?.value.trim() || '';
      const passwordInput = el('settings-ibkr-password');
      const password = passwordInput?.value || '';
      const r = await window.electronAPI.ibkrSaveCredentials({ username, password });
      if (r.success) {
        if (passwordInput) passwordInput.value = '';
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

  document.querySelectorAll('.ibkr-mode-btn').forEach(b => {
    b.addEventListener('click', () => {
      const mode = b.dataset.mode === 'flex' ? 'flex' : 'gateway';
      setIbkrModeUI(mode);
      window.electronAPI.saveSettings({ ibkrConnectMode: mode });
    });
  });

  const saveFlexBtn = el('pf-save-flex');
  if (saveFlexBtn) {
    saveFlexBtn.addEventListener('click', async () => {
      const queryId = el('settings-flex-query-id')?.value.trim() || '';
      const tokenInput = el('settings-flex-token');
      const token = tokenInput?.value.trim() || '';
      const r = await window.electronAPI.ibkrSaveFlex({ queryId, token });
      if (r.success) {
        if (tokenInput) tokenInput.value = '';
        setStatus('live', 'Flex settings saved');
      } else {
        setStatus('error', r.error || 'Could not save Flex settings');
      }
      refreshFlexStatus();
    });
  }

  const clearFlexBtn = el('pf-clear-flex');
  if (clearFlexBtn) {
    clearFlexBtn.addEventListener('click', async () => {
      await window.electronAPI.ibkrClearFlex();
      const q = el('settings-flex-query-id'); if (q) q.value = '';
      const t = el('settings-flex-token'); if (t) t.value = '';
      setStatus('live', 'Flex settings cleared');
      refreshFlexStatus();
    });
  }

  async function persistTypedFlex() {
    const queryId = el('settings-flex-query-id')?.value.trim() || '';
    const tokenInput = el('settings-flex-token');
    const token = tokenInput?.value.trim() || '';
    if (queryId || token) {
      await window.electronAPI.ibkrSaveFlex({ queryId, token });
      if (tokenInput) tokenInput.value = '';
      refreshFlexStatus();
    }
  }

  const testFlexBtn = el('pf-flex-test');
  if (testFlexBtn) {
    testFlexBtn.addEventListener('click', async () => {
      await persistTypedFlex();
      const statusEl = el('pf-flex-status');
      if (!(await flexPreflightOK())) {
        if (statusEl) { statusEl.textContent = 'Skipped — waiting to avoid resetting IBKR\'s cool-down.'; statusEl.style.color = 'var(--text-muted)'; }
        return;
      }
      testFlexBtn.disabled = true;
      const orig = testFlexBtn.textContent;
      testFlexBtn.textContent = 'Testing…';
      if (statusEl) { statusEl.textContent = 'Testing connection…'; statusEl.style.color = 'var(--text-muted)'; }
      try {
        const r = await window.electronAPI.ibkrFlexTest();
        if (statusEl) {
          statusEl.textContent = r.success ? (r.message || 'Connection OK — no data synced.') : r.error;
          statusEl.style.color = r.success ? 'var(--green)' : 'var(--red)';
        }
        setStatus(r.success ? 'live' : 'error',
          r.success ? 'IBKR Flex: connection OK' : 'IBKR Flex: test failed');
      } catch (e) {
        if (statusEl) { statusEl.textContent = 'Test failed: ' + e.message; statusEl.style.color = 'var(--red)'; }
      } finally { testFlexBtn.disabled = false; testFlexBtn.textContent = orig; }
    });
  }

  const syncFlexBtn = el('pf-flex-sync');
  if (syncFlexBtn) {
    syncFlexBtn.addEventListener('click', async () => {
      await persistTypedFlex();
      const statusEl = el('pf-flex-status');
      if (!(await flexPreflightOK())) {
        if (statusEl) { statusEl.textContent = 'Skipped — waiting to avoid resetting IBKR\'s cool-down.'; statusEl.style.color = 'var(--text-muted)'; }
        return;
      }
      syncFlexBtn.disabled = true;
      const orig = syncFlexBtn.textContent;
      syncFlexBtn.textContent = 'Syncing…';
      // Pre-flight already ran above — don't prompt the user a second time.
      try { await runFlexSync(statusEl, { skipPreflight: true }); }
      finally { syncFlexBtn.disabled = false; syncFlexBtn.textContent = orig; }
    });
  }

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

  const stopGwBtn = el('pf-stop-gateways');
  if (stopGwBtn) {
    stopGwBtn.addEventListener('click', async () => {
      const statusEl = el('pf-stop-gateways-status');
      stopGwBtn.disabled = true;
      if (statusEl) statusEl.textContent = 'Stopping…';
      try {
        const r = await window.electronAPI.ibkrGatewayStop();
        ibkrSawConnected = false;
        if (statusEl) statusEl.textContent = r.stopped > 0
          ? `Stopped ${r.stopped} gateway${r.stopped === 1 ? '' : 's'}.`
          : 'No gateways were running.';
        await refreshIbkrStatus({ quiet: true });
      } catch {
        if (statusEl) statusEl.textContent = 'Could not stop gateways.';
      } finally {
        stopGwBtn.disabled = false;
      }
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
