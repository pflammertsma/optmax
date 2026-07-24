'use strict';

// ─── Broad-market core ETFs & Buckets ────────────────────────────────────────
const PF_BUCKETS = ['core', 'satellite', 'cash', 'unassigned'];

const PF_CORE_ETFS = new Set([
  'VTI', 'VOO', 'SPY', 'IVV', 'ITOT', 'SCHB',            // US total market / S&P 500
  'VT', 'ACWI',                                          // global
  'VXUS', 'VEA', 'VWO', 'IEFA', 'IEMG', 'EFA', 'EEM',    // ex-US / intl / EM
  'IWDA', 'IWDC', 'VUSA', 'VWRL', 'VWCE', 'IUSC',        // UCITS equivalents
]);

// ─── Settings Descriptions ────────────────────────────────────────────────────
const INTERVAL_DESCS = {
  '1':  'Full options scan once a day.',
  '2':  'Full options scan every 2 days.',
  '7':  'Full options scan every week.',
  '14': 'Full options scan every 2 weeks.',
  '30': 'Full options scan once a month.'
};

const MARGIN_DESCS = {
  '0':    'Picks the strike closest to the current price. Max premium, minimal cushion.',
  '5':    'Strike ≥5% below price. Balanced premium and downside protection.',
  '7.5':  'Strike ≥7.5% below price. Moderate cushion with decent yield.',
  '10':   'Strike ≥10% below price. Conservative — stock needs a 10% drop to be at risk.',
  '12.5': 'Strike ≥12.5% below price. Wide buffer, noticeably lower yield.',
  '15':   'Strike ≥15% below price. Maximum protection, lowest yield.'
};

const PRICE_INTERVAL_DESCS = {
  '1':  'Current stock prices refresh every hour.',
  '2':  'Current stock prices refresh every 2 hours.',
  '4':  'Current stock prices refresh every 2 hours.',
  '6':  'Current stock prices refresh every 6 hours.',
  '12': 'Current stock prices refresh every 12 hours.',
  '24': 'Current stock prices refresh once a day.',
  '0':  'Prices only update when you click Update Prices.'
};

// ─── Date Formats & Icons ─────────────────────────────────────────────────────
const DATE_FMT = { month: 'short', day: 'numeric', year: 'numeric' };
const TIME_FMT = { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' };

let EYE_OPEN = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>';
let EYE_CLOSED = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>';
let ICON_SYNC = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 12a9 9 0 1 1-3-6.7"/><polyline points="21 3 21 9 15 9"/></svg>';
let ICON_LOGIN = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4"/><polyline points="10 17 15 12 10 7"/><line x1="15" y1="12" x2="3" y2="12"/></svg>';
let ICON_START_GATEWAY = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polygon points="5 3 19 12 5 21 5 3"/></svg>';

async function initIcons() {
  try {
    const [open, closed, sync, login, play] = await Promise.all([
      fetch('../assets/icons/eye-open.svg').then(r => r.text()),
      fetch('../assets/icons/eye-closed.svg').then(r => r.text()),
      fetch('../assets/icons/sync.svg').then(r => r.text()),
      fetch('../assets/icons/login.svg').then(r => r.text()),
      fetch('../assets/icons/start-gateway.svg').then(r => r.text()),
    ]);
    if (open) EYE_OPEN = open;
    if (closed) EYE_CLOSED = closed;
    if (sync) ICON_SYNC = sync;
    if (login) ICON_LOGIN = login;
    if (play) ICON_START_GATEWAY = play;
    if (typeof updatePrivacyMode === 'function') updatePrivacyMode();
    if (typeof paintIbkrButton === 'function') paintIbkrButton();
  } catch (err) {
    console.error('Failed to load SVG icons:', err);
  }
}
initIcons();

const SELLDOWN_TAX_NOTE =
  `As a US citizen you owe US <span class="help-tooltip" data-glossary="capital-gains" style="border-bottom:1px dotted var(--text-secondary); cursor:pointer;" title="Tax on the profit when you sell shares. Shares held over one year qualify for the lower long-term rate (0/15/20%). Switzerland doesn't tax private capital gains at all. Click for glossary.">capital-gains tax</span> on sales — prefer lots held over a year, and among those the ones you paid the most for (smallest taxable gain). Reinvest the proceeds using the Tax-Smart Buy Ideas below.`;
