# Architecture Plan — Bolting a Portfolio Module onto PortMax

Goal: add long-term portfolio tracking, IBKR sync, and background signal
notifications **without disturbing** the existing CSP scanner code paths,
so upstream changes remain easy to merge.

## Current architecture (for reference)

- `main.js` — single Electron main process file: window creation, IPC
  handlers, in-memory schedulers (`setInterval`/`setTimeout`) for CSP data
  refresh and price updates, local JSON file cache in `app.getPath('userData')`.
- `lib/strategies.js` — pure functions (HV, IVR, mean reversion) used by
  `main.js`. `src/scoring.js` — pure 100-point scorer used by the renderer.
- `preload.js` — context-bridge API surface exposed to the renderer.
- `src/` — renderer: `index.html`, `app.js` (vanilla JS, view-based
  navigation), `style.css`. No framework, no bundler.
- Background behavior today: schedulers only run **while the app window
  process is alive** — closing the window quits the app entirely
  (`app.on('window-all-closed')` calls `app.quit()` on non-macOS). There is
  no system tray, no OS notifications, no headless mode today.

## Proposed additions

### 1. System tray + keep-alive-on-close

- In `main.js`, add a `Tray` instance with a context menu (Open, Sync Now,
  Quit). On `window-all-closed`, **don't quit** — hide to tray instead
  (guard this behind a setting so it's opt-in, since it changes existing
  behavior the original scanner didn't design for).
- Only actually quit via the tray's "Quit" item or `before-quit`.
- This is additive to existing lifecycle code, not a rewrite — a few new
  event handlers plus a settings flag (e.g. `settings.minimizeToTray`).

### 2. Native notifications

- Use Electron's built-in `Notification` API (no extra dependency) fired
  from the main process when a signal check produces a new, un-dismissed
  signal. Clicking the notification focuses/restores the window to the
  Portfolio view.
- Keep a small "signal log" (e.g. `signals.json`) so notifications aren't
  re-fired for the same condition every check cycle — only fire on
  state transitions (e.g. "just crossed threshold") or a daily digest,
  not every poll.

### 3. New data modules (parallel to existing ones)

| New file | Role | Parallels |
|---|---|---|
| `lib/ibkr.js` | IBKR Client Portal Web API client + gateway process management | `lib/strategies.js` (pure helpers) but with network/process side effects, more like the fetch logic in `main.js` |
| `lib/portfolio.js` | Portfolio math: drift vs. target allocation, concentration %, glidepath target calc | `src/scoring.js` (pure scoring functions), but for portfolio-level rather than per-opportunity scoring |
| `lib/signals.js` | Signal rule evaluation (see [`signals.md`](signals.md)) — takes portfolio snapshot + settings, returns a list of triggered signals | New concept, no direct existing parallel |

New cache files in `userData`, separate from `data.json`:
- `portfolio.json` — last synced IBKR snapshot (positions, balances, timestamp).
- `signals.json` — signal state/history (to dedupe notifications).
- Settings additions to the existing `settings.json` / `DEFAULT_SETTINGS` in
  `main.js`: target allocation config, concentration thresholds, IBKR gateway
  path/port, notification preferences, RSU vest tracking entries.

### 4. New IPC surface (additive to `preload.js`)

New channels, same pattern as existing ones (`ipcMain.handle` / `contextBridge`):
`get-ibkr-status`, `sync-ibkr-portfolio`, `get-portfolio-snapshot`,
`get-signals`, `dismiss-signal`, `get-glidepath-config`,
`save-glidepath-config`, `log-rsu-vest`. None of these touch the existing
CSP-scanner channels.

### 5. New renderer view

- A new nav item ("Portfolio" or "Long-Term") in `src/index.html` +
  a new section in `src/app.js`, following the existing `navigate(viewId)`
  pattern already used for Dashboard/Screener/Discover/Settings. Reuses the
  existing glassmorphism design system (`style.css` variables) so it looks
  native to the app rather than bolted on.
- Views needed: portfolio overview (holdings, drift vs target, concentration
  %), signals/alerts list, glidepath & target-allocation settings, RSU vest
  log.

### 6. Background scheduling for signal checks

- A new `setInterval` in `main.js` (or, cleaner, inside `lib/signals.js`
  with a small `initSignalScheduler()` export called from `main.js`,
  mirroring `initScheduler()`/`initPriceScheduler()`), e.g. every 30–60
  minutes: sync IBKR snapshot (respecting gateway session state) → run
  signal rules → notify on new triggers.
- Frequency should be low — this is a long-term investing tool, not a
  day-trading one. Hourly-to-daily checks are more than sufficient; avoid
  over-polling IBKR's API.

## Suggested build order (once you're ready to implement)

1. `lib/portfolio.js` + manual/CSV-imported holdings first (no IBKR
   dependency yet) — lets the allocation/concentration/glidepath math and
   the new UI be built and tested independently of the IBKR gateway.
2. `lib/ibkr.js` gateway integration, replacing manual entry with live sync.
3. `lib/signals.js` rule engine + notification wiring + tray/background
   lifecycle changes last, once the data underneath is trustworthy.

This order means most of the value (a rebalancing dashboard) exists well
before the hardest integration (IBKR auth/session lifecycle) is done.

## Open questions

- Comfortable with a vanilla-JS renderer addition matching the existing
  style, or would you rather introduce a small framework/build step for the
  new section only? (Recommendation: stay vanilla, for consistency and to
  avoid a mixed build system.)
- Any preference on notification frequency (e.g. immediate vs. a daily
  digest at a fixed time)?
