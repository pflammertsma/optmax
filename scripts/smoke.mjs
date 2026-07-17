// One-shot smoke test: launch → wait for load → screenshot every view → check UI state → quit
import { _electron as electron } from 'playwright-core';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT     = path.resolve(fileURLToPath(import.meta.url), '../..');
const SHOT_DIR = path.join(ROOT, 'scripts', 'shots');
const ELECTRON = path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe');

fs.mkdirSync(SHOT_DIR, { recursive: true });

console.log('Launching PortMax…');
const app = await electron.launch({
  executablePath: ELECTRON,
  args: [ROOT, '--smoke-test'],
  timeout: 30_000,
});

const proc = app.process();
proc.stdout.on('data', data => console.log('MAIN OUT:', data.toString()));
proc.stderr.on('data', data => console.log('MAIN ERR:', data.toString()));

const page = app.windows().find(w => !w.url().startsWith('devtools://'))
          ?? await app.firstWindow();

await page.waitForLoadState('domcontentloaded');
page.on('console', msg => console.log('PAGE LOG:', msg.text()));
page.on('pageerror', err => console.log('PAGE ERROR:', err.message));
console.log('Window loaded:', page.url());

// Wait for boot sequence (initSettingsUI + initWatchlists + loadInitialData)
await page.waitForSelector('#status-text', { timeout: 10_000 });
await new Promise(r => setTimeout(r, 3_000));

// Helper: navigate to a view by data-view attribute
async function nav(viewId) {
  await page.evaluate(id => {
    document.querySelector(`.nav-link[data-view="${id}"]`)?.click();
  }, viewId);
  await new Promise(r => setTimeout(r, 400));
}

// Helper: take a numbered screenshot
async function shot(name) {
  const f = path.join(SHOT_DIR, name + '.png');
  await page.screenshot({ path: f });
  console.log('Screenshot:', f);
  return f;
}

// ── 01 Dashboard ─────────────────────────────────────────────────────────────
await nav('dashboard');
await shot('01-dashboard');

// ── 01b Portfolio ────────────────────────────────────────────────────────────
await nav('portfolio');
await shot('01b-portfolio');

// ── 01d Targets ──────────────────────────────────────────────────────────────
await nav('targets');
await shot('01d-targets');

// ── 01c Guidance ─────────────────────────────────────────────────────────────
await nav('guidance');
await shot('01c-guidance');

// ── Read UI state ─────────────────────────────────────────────────────────────
const state = await page.evaluate(() => ({
  statusText: document.getElementById('status-text')?.textContent,
  activeView: document.querySelector('.view.active')?.id,
  navLinks:   [...document.querySelectorAll('.nav-link')].map(l => l.textContent.trim()),
  views: ['view-dashboard','view-portfolio','view-targets','view-guidance','view-screener','view-options-scanner',
          'view-favorites','view-settings']
    .map(id => ({ id, exists: !!document.getElementById(id) })),
  helpBtn: !!document.getElementById('help-btn'),
}));

console.log('\nUI state:');
console.log(JSON.stringify(state, null, 2));

// ── 02 Screener ───────────────────────────────────────────────────────────────
await nav('screener');
await shot('02-screener');

// ── 03 Top 25 Overall ────────────────────────────────────────────────────────
await nav('top25');
await shot('03-top25');

// ── 04 Top 25 Under $10k ─────────────────────────────────────────────────────
await nav('under10k');
await shot('04-under10k');

// ── 05 Mega Caps ─────────────────────────────────────────────────────────────
await nav('megacaps');
await shot('05-megacaps');

// ── 06 Starred Stocks ────────────────────────────────────────────────────────
await nav('favorites');
await shot('06-favorites');

// ── 07 Discover ──────────────────────────────────────────────────────────────
await nav('discover');
await shot('07-discover');

// ── 08 Settings ──────────────────────────────────────────────────────────────
await nav('settings');
await shot('08-settings');

// ── 09 Help modal ─────────────────────────────────────────────────────────────
await page.evaluate(() => document.getElementById('help-btn')?.click());
await new Promise(r => setTimeout(r, 400));
await shot('09-help-modal');

await app.close();
console.log('\nDone. Check scripts/shots/ for screenshots.');
