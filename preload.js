const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  loadInitialData:      ()               => ipcRenderer.invoke('load-initial-data'),
  fetchData:            ()               => ipcRenderer.invoke('fetch-data'),
  fetchPrices:          ()               => ipcRenderer.invoke('fetch-prices'),
  fetchHistory:         (symbol)         => ipcRenderer.invoke('fetch-history', symbol),
  getSettings:          ()               => ipcRenderer.invoke('get-settings'),
  saveSettings:         (settings)       => ipcRenderer.invoke('save-settings', settings),
  resetAllData:         ()               => ipcRenderer.invoke('reset-all-data'),

  // Watchlist management
  getWatchlists:        ()               => ipcRenderer.invoke('get-watchlists'),
  addToWatchlist:       (payload)        => ipcRenderer.invoke('add-to-watchlist', payload),
  removeFromWatchlist:  (payload)        => ipcRenderer.invoke('remove-from-watchlist', payload),
  scanSingleSymbol:     (symbol)         => ipcRenderer.invoke('scan-single-symbol', symbol),

  // Starred management
  getStarred:           ()               => ipcRenderer.invoke('get-starred'),
  toggleStarred:        (payload)        => ipcRenderer.invoke('toggle-starred', payload),

  // Discovery
  getDiscoveryOpps:       ()        => ipcRenderer.invoke('get-discovery-opps'),
  runDiscovery:           (options) => ipcRenderer.invoke('run-discovery', options),
  onDiscoveryProgress:    (cb) => ipcRenderer.on('discovery-progress', (_e, d) => cb(d)),
  offDiscoveryProgress:   ()   => ipcRenderer.removeAllListeners('discovery-progress'),

  // Manual refresh / price-update progress
  onFetchProgress:        (cb) => ipcRenderer.on('fetch-progress', (_e, d) => cb(d)),
  offFetchProgress:       ()   => ipcRenderer.removeAllListeners('fetch-progress'),
  onPriceProgress:        (cb) => ipcRenderer.on('price-progress', (_e, d) => cb(d)),
  offPriceProgress:       ()   => ipcRenderer.removeAllListeners('price-progress'),

  // Portfolio (long-term module)
  getPortfolio:         ()               => ipcRenderer.invoke('get-portfolio'),
  savePortfolio:        (updates)        => ipcRenderer.invoke('save-portfolio', updates),
  importPortfolioCsv:   ()               => ipcRenderer.invoke('import-portfolio-csv'),

  // IBKR Client Portal Gateway (Phase 2)
  ibkrStatus:             ()             => ipcRenderer.invoke('ibkr-status'),
  ibkrSync:               ()             => ipcRenderer.invoke('ibkr-sync'),
  ibkrOpenLogin:          ()             => ipcRenderer.invoke('ibkr-open-login'),
  ibkrGatewayStart:       ()             => ipcRenderer.invoke('ibkr-gateway-start'),
  ibkrGatewayStop:        ()             => ipcRenderer.invoke('ibkr-gateway-stop'),
  ibkrGatewayRunning:     ()             => ipcRenderer.invoke('ibkr-gateway-running'),
  ibkrPickGatewayDir:     ()             => ipcRenderer.invoke('ibkr-pick-gateway-dir'),
  ibkrGatewayLog:         (lines)        => ipcRenderer.invoke('ibkr-gateway-log', lines),
  ibkrSaveCredentials:    (creds)        => ipcRenderer.invoke('ibkr-save-credentials', creds),
  ibkrClearCredentials:   ()             => ipcRenderer.invoke('ibkr-clear-credentials'),
  ibkrHasCredentials:     ()             => ipcRenderer.invoke('ibkr-has-credentials'),
  ibkrGetCredentials:     ()             => ipcRenderer.invoke('ibkr-get-credentials'),

  // Portfolio health + live prices
  refreshPortfolioPrices: ()             => ipcRenderer.invoke('refresh-portfolio-prices'),
  getPortfolioHealth:     ()             => ipcRenderer.invoke('get-portfolio-health'),

  // Guidance (compliance engine)
  analyzeTicker:        (symbol, holdings, cash) => ipcRenderer.invoke('analyze-ticker', symbol, holdings, cash),
  getPortfolioGuidance: (holdings, cash, targets, watchlistData) => ipcRenderer.invoke('get-portfolio-guidance', holdings, cash, targets, watchlistData),
  getBuyRecommendations: (watchlistData) => ipcRenderer.invoke('get-buy-recommendations', watchlistData),
  scanInvestments:       (watchlistData) => ipcRenderer.invoke('scan-investments', watchlistData),
  getSymbolInsights:     (symbol)        => ipcRenderer.invoke('get-symbol-insights', symbol),
  getEmployerExposure:   ()              => ipcRenderer.invoke('get-employer-exposure'),

  // Employer-stock sell-down plan (Phase 4)
  getSellDownStatus:     ()              => ipcRenderer.invoke('selldown-status'),
  saveSellDownPlan:      (plan)          => ipcRenderer.invoke('selldown-save-plan', plan),
  clearSellDownPlan:     ()              => ipcRenderer.invoke('selldown-clear-plan'),

  // Dashboard action plan (aggregated advice)
  getActionPlan:         (watchlistData) => ipcRenderer.invoke('get-action-plan', watchlistData),

  // PFIC exit-cost estimates (planning only)
  getPficEstimates:      ()              => ipcRenderer.invoke('get-pfic-estimates'),

  // Profile history (trajectory over time)
  getProfileHistory:     ()              => ipcRenderer.invoke('get-profile-history'),
  importHistoryCsv:      ()              => ipcRenderer.invoke('import-history-csv'),

  // Window controls
  minimizeWindow: () => ipcRenderer.send('window-minimize'),
  maximizeWindow: () => ipcRenderer.send('window-maximize'),
  closeWindow:    () => ipcRenderer.send('window-close'),

  // Full list refresh events (pushed from main)
  onAutoFetchStart: (cb) => ipcRenderer.on('auto-fetch-start', cb),
  onAutoFetchDone:  (cb) => ipcRenderer.on('auto-fetch-done',  (_e, p) => cb(p)),
  onAutoFetchError: (cb) => ipcRenderer.on('auto-fetch-error', (_e, m) => cb(m)),

  // Price update events (pushed from main)
  onAutoPriceStart: (cb) => ipcRenderer.on('auto-price-start', cb),
  onAutoPriceDone:  (cb) => ipcRenderer.on('auto-price-done',  (_e, p) => cb(p)),
  onAutoPriceError: (cb) => ipcRenderer.on('auto-price-error', (_e, m) => cb(m)),
});
