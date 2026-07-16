// Playwright driver for PortMax (Windows). Usage: node scripts/drive.mjs
import { _electron as electron } from 'playwright-core';
import * as readline from 'node:readline';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT     = path.resolve(fileURLToPath(import.meta.url), '../..');
const SHOT_DIR = process.env.SCREENSHOT_DIR || path.join(ROOT, 'scripts', 'shots');
const ELECTRON = path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe');

fs.mkdirSync(SHOT_DIR, { recursive: true });

let app  = null;
let page = null;

const COMMANDS = {
  async launch() {
    if (app) return console.log('already launched');
    app = await electron.launch({
      executablePath: ELECTRON,
      args: [ROOT],
      timeout: 30_000,
    });
    await new Promise(r => setTimeout(r, 4_000));
    page = app.windows().find(w => !w.url().startsWith('devtools://'))
        ?? await app.firstWindow();
    await page.waitForLoadState('domcontentloaded');
    console.log(`launched. ${app.windows().length} window(s):`);
    for (const w of app.windows()) console.log(' ', w.url());
  },

  async ss(name) {
    if (!page) return console.log('ERROR: launch first');
    const f = path.join(SHOT_DIR, (name || `ss-${Date.now()}`) + '.png');
    await page.screenshot({ path: f });
    console.log('screenshot:', f);
  },

  async click(sel) {
    if (!page) return console.log('ERROR: launch first');
    const r = await page.evaluate(s => {
      const el = document.querySelector(s);
      if (!el) return 'NOT_FOUND';
      el.click(); return 'OK';
    }, sel);
    console.log('click', sel, '→', r);
  },

  async 'click-text'(text) {
    if (!page) return console.log('ERROR: launch first');
    const r = await page.evaluate(t => {
      const els = [...document.querySelectorAll('button, a, [role="button"], .nav-link')];
      const el  = els.find(e => e.textContent?.trim() === t)
               ?? els.find(e => e.textContent?.includes(t));
      if (!el) return 'NOT_FOUND';
      el.click(); return 'OK: ' + el.tagName;
    }, text);
    console.log('click-text', JSON.stringify(text), '→', r);
  },

  async type(text)  { if (page) await page.keyboard.type(text, { delay: 40 }); },
  async press(key)  { if (page) await page.keyboard.press(key); },

  async wait(ms) {
    await new Promise(r => setTimeout(r, Number(ms) || 1000));
    console.log('waited', ms || 1000, 'ms');
  },

  async eval(expr) {
    if (!page) return console.log('ERROR: launch first');
    try   { console.log(JSON.stringify(await page.evaluate(expr))); }
    catch (e) { console.log('ERROR:', e.message); }
  },

  async text(sel) {
    if (!page) return console.log('ERROR: launch first');
    console.log(await page.evaluate(
      s => (s ? document.querySelector(s) : document.body)?.innerText ?? '(null)',
      sel || null));
  },

  async status() {
    if (!page) return console.log('ERROR: launch first');
    const r = await page.evaluate(() => ({
      statusText: document.getElementById('status-text')?.textContent,
      activeView: document.querySelector('.view.active')?.id,
      dataRows:   document.querySelectorAll('#tbody-top25 tr').length,
    }));
    console.log(JSON.stringify(r, null, 2));
  },

  async windows() {
    if (!app) return console.log('ERROR: launch first');
    for (const w of app.windows()) console.log(' ', w.url());
  },

  async quit() { if (app) await app.close().catch(() => {}); app = null; page = null; },
  help() { console.log('commands:', Object.keys(COMMANDS).join(', ')); },
};

const rl = readline.createInterface({ input: process.stdin, output: process.stdout, prompt: 'driver> ' });

rl.on('line', async line => {
  const [cmd, ...rest] = line.trim().split(/\s+/);
  if (!cmd) return rl.prompt();
  const fn = COMMANDS[cmd];
  if (!fn) { console.log('unknown:', cmd, '— try: help'); return rl.prompt(); }
  try { await fn(rest.join(' ')); } catch (e) { console.log('ERROR:', e.message); }
  if (cmd === 'quit') { rl.close(); process.exit(0); }
  rl.prompt();
});
rl.on('close', async () => { try { await COMMANDS.quit(); } catch {} process.exit(0); });

console.log('PortMax driver — "help" for commands, "launch" to start');
rl.prompt();
