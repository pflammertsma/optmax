# PortMax: Portfolio & Options Maximizer
## Application Design & Architecture Document

This document serves as a comprehensive blueprint for **PortMax**, a native desktop application designed to track, analyze, and optimize your investments. It contains the technical stack, architectural decisions, UI/UX guidelines, and data processing logic.

---

### 1. Technology Stack
- **Framework**: Electron (Desktop App)
- **Frontend**: Vanilla HTML5, CSS3, Vanilla JavaScript (ES6+)
- **Backend/Main Process**: Node.js
- **Data Fetching**: `yahoo-finance2` (NPM package for live stock quotes, historical data, and options chains)
- **Data Visualization**: Chart.js (Loaded via CDN)
- **Packaging**: `electron-builder` (Targeting macOS ARM64/x64, frameless window setup)

---

### 2. Application Architecture
PortMax follows standard Electron IPC (Inter-Process Communication) architecture to ensure security and separation of concerns.

#### A. Main Process (`main.js`)
- **Window Management**: Spawns a frameless BrowserWindow (`titleBarStyle: 'hiddenInset'`) with a default size of 1280x800.
- **IPC Handlers**: Listens for data requests from the frontend.
  - `ipcMain.handle('fetch-data')`: Triggers the heavy lifting logic to fetch live options data for a hardcoded list of ~45 high-volatility/popular tickers.
  - `ipcMain.handle('load-initial-data')`: Reads cached `data.json` from the system's `userData` directory for immediate startup loading.
- **Data Persistence**: Caches the latest successful fetch to local disk to prevent rate-limiting and allow offline viewing.

#### B. Preload Script (`preload.js`)
- Uses `contextBridge.exposeInMainWorld` to expose a secure `window.electronAPI` object.
- Maps the `fetchData` and `loadInitialData` IPC calls so the renderer process can invoke them securely without enabling `nodeIntegration`.

#### C. Renderer Process (`app.js`, `index.html`)
- Handles DOM manipulation, routing between views (Dashboard, Overall List, Under $10k List, Portfolio), and formatting numbers/currency.
- Renders dynamic data tables and interactive UI components.
- Manages the Analysis Modal state and instantiates Chart.js instances.

---

### 3. UI/UX Design System
The application utilizes a premium, dark-mode, glassmorphism aesthetic inspired by modern fintech and cyberpunk design trends.

#### A. Global Styling & Theming (`style.css`)
- **Typography**: 
  - Primary UI: `Outfit` (Google Fonts) for sleek, modern headers and labels.
  - Numbers/Data: `JetBrains Mono` for tabular alignment and technical feel.
- **Color Palette**:
  - **Background**: Deep Navy/Black (`#070911` to `#111524`).
  - **Accents**: Neon Cyan (`#00f0ff`) to Purple (`#7000ff`) gradients.
  - **Status Indicators**: Emerald Green (`#10b981`) and Rose Red (`#f43f5e`).
- **Glassmorphism**: Extensive use of `backdrop-filter: blur(12px)` with semi-transparent backgrounds (`rgba(17, 21, 36, 0.6)`) and subtle white borders (`rgba(255, 255, 255, 0.05)`) to create depth.

#### B. Layout & Navigation
- **Sidebar**: Fixed left sidebar for navigation, containing a gradient logo, navigation links, and a live data status indicator.
- **Main Content**: Dynamic main viewing area that swaps between distinct sections.
- **Window Dragging**: A dedicated `<div class="window-drag-region">` fixed to the absolute top of the viewport (`top: 0`, `height: 32px`, `z-index: 9999`) with `-webkit-app-region: drag;` applied. This enables native-like window dragging while avoiding interactive element conflicts.

---

### 4. Core Features & Views

#### A. Opportunity Dashboard
- **Metric Cards**: Four glassmorphic cards showing aggregate data: Avg. Monthly Yield, Avg. Annualized Yield, Top Premium Available, and Active Opportunities count.
- **Preview Sections**: Cards showcasing the absolute Top 3 opportunities across both tracking lists for quick glances.

#### B. Data Tables (Top 25 Overall & Top 25 Under $10k)
- Clean, sortable tables displaying: Symbol, Stock Price, Strike, DTE (Days to Expiration), Premium, Capital Required, Monthly Yield, Annualized Yield, Monthly Income, and an "Analyze" action button.
- The **Under $10k** view automatically filters out any ticker where the current stock price exceeds $100.

#### C. Deep-Dive Analysis Modal
- Triggered by clicking "Analyze" on any table row.
- **Header**: Displays the full company name (e.g., Apple Inc.) and Exchange (e.g., NasdaqGS), fetched via `yahooFinance.quote`.
- **Price Chart**: A 30-day historical line chart of the underlying stock's closing prices, utilizing Chart.js with a neon-cyan gradient fill.
- **Mechanics Breakdown**: Plain-English explanation of the trade (e.g., *"If assigned, you will be obligated to buy 100 shares at $150..."*).
- **Advanced Stats**: Displays Implied Volatility, Volume/Open Interest ratio, Break-Even price, and Margin of Safety.

#### D. Portfolio Management & Signals
- **IBKR Sync/Import**: Parses Client Portal CSV exports and Activity Statement CSV reports.
- **Drift Analysis**: Compares actual asset allocation weights against configured targets and highlights drift.
- **Rebalancing Guidance**: Computes specific trades needed to rebalance back to target weights.
- **Concentration Tracking**: Pushes alerts if individual positions (especially employer stock) exceed safe net-worth thresholds.

---

### 5. Options Data Processing Logic
The engine driving PortMax calculates the viability of cash-secured puts using the following pipeline:

1. **Ticker Iteration**: Loop through a predefined array of high-liquidity symbols (e.g., TSLA, AMD, PLTR).
2. **Date Targeting**: Calculate a target expiration date ~30 days in the future.
3. **Chain Fetching**: Use `yahooFinance.options(symbol)` to fetch the options chain closest to the target date.
4. **OTM Filtering**: Filter the `puts` array for options where `strike < currentPrice`.
5. **Selection**: Select the highest strike price that is still Out-of-The-Money (to maximize premium).
6. **Metric Calculation**:
   - `Premium` = `lastPrice` of the put option.
   - `Capital Required` = `Strike * 100`.
   - `Margin of Safety` = `((Current Price - Strike) / Current Price) * 100`.
   - `Break Even` = `Strike - Premium`.
   - `Monthly Yield` = `(Premium / Strike) * (30 / DTE) * 100`.
   - `Annualized Yield` = `Monthly Yield * 12`.
   - `Monthly Income` = `(Premium * 100) * (30 / DTE)`.
7. **Sorting**: Sort all valid opportunities by `Annualized Yield` in descending order and slice the top 25.

---

### 6. Prompt Engineering Notes for Recreation
If providing this document to an AI agent to recreate the app, use the following directives:
- *"Create a Node.js project using `npm init -y` and install `electron`, `electron-builder`, and `yahoo-finance2`."*
- *"Implement the Main Process (`main.js`) with a frameless window configuration (`titleBarStyle: 'hiddenInset'`) and secure IPC routing."*
- *"Implement the exact mathematical logic for Options Data Processing as described in section 5, handling errors gracefully if a ticker has no options chain available."*
- *"Strictly follow the Glassmorphism UI/UX design system outlined in Section 3 using vanilla CSS variables."*
- *"Ensure the `-webkit-app-region: drag` trick is implemented perfectly to allow macOS users to move the window."*
- *"Integrate the portfolio calculations in `lib/portfolio.js` for allocations, target drift, and RSU concentration tracking."*
