'use strict';

// Profile history: dated snapshots of the portfolio's shape over time, so the
// app can show a *trajectory* (employer concentration falling toward target,
// health rising, PFIC exposure trending to zero) instead of only the current
// state. Pure math + parsing, no side effects.
//
// Design intent (per user): retain a GENEROUS amount per point — not just the
// headline metrics but a compact per-holding breakdown — so metrics we haven't
// invented yet can be recomputed over old history later. One point per day;
// a backfilled statement lands at its own (older) date, sorted in.

const {
  totalValue, allocationByBucket, employerConcentration, topConcentrations,
} = require('./portfolio');

// ── CSV helpers (minimal, quote-aware) ──────────────────────────────────────
function splitLine(line) {
  const out = [];
  let cur = '', q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') { q = !q; continue; }
    if (c === ',' && !q) { out.push(cur); cur = ''; continue; }
    cur += c;
  }
  out.push(cur);
  return out.map(s => s.trim());
}

function num(v) {
  const n = parseFloat(String(v).replace(/[^0-9.\-]/g, ''));
  return Number.isFinite(n) ? n : null;
}

// Local-time YYYY-MM-DD (avoids the UTC day-shift toISOString would cause).
function isoDate(d) {
  if (!(d instanceof Date) || isNaN(d.getTime())) return null;
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// Pull the statement date (from the "Statement … Period" row) and the Net Asset
// Value block from an IBKR Activity Statement. Returns nulls if not present.
function parseStatementMeta(text) {
  const lines = String(text || '').split(/\r?\n/);
  let statementDate = null;
  const nav = { total: null, cash: null, stock: null, dividendAccruals: null, twrPct: null };
  let navTwrNext = false;

  for (const line of lines) {
    if (!line) continue;
    const cells = splitLine(line);
    const section = cells[0];

    if (section === 'Statement' && cells[1] === 'Data' && cells[2] === 'Period') {
      // Period can be "July 14, 2026" or a "date - date" range → take the last date.
      const raw = (cells[3] || '').split(' - ').pop().trim();
      const d = new Date(raw);
      if (!isNaN(d.getTime())) statementDate = isoDate(d);
    }

    if (section === 'Net Asset Value' && cells[1] === 'Data') {
      const label = (cells[2] || '').trim();
      const currentTotal = num(cells[6]); // Asset Class,Prior,Long,Short,CurrentTotal,Change
      if (label === 'Total') nav.total = currentTotal;
      else if (label === 'Cash') nav.cash = currentTotal;
      else if (label === 'Stock') nav.stock = currentTotal;
      else if (label === 'Dividend Accruals') nav.dividendAccruals = currentTotal;
      // The TWR value sits on the Data row right after its header row.
      if (navTwrNext && nav.twrPct == null) { nav.twrPct = num(cells[2]); navTwrNext = false; }
    }
    if (section === 'Net Asset Value' && cells[1] === 'Header'
        && /time weighted rate of return/i.test(cells[2] || '')) {
      navTwrNext = true;
    }
  }

  const hasNav = Object.values(nav).some(v => v != null);
  return { statementDate, nav: hasNav ? nav : null };
}

// Build one dated snapshot. Structural metrics (value, allocation, employer
// direct %, concentration) are computed here from portfolio math — no quotes
// needed, so this works for a backfilled statement. Quote-dependent
// enrichments (health, dividends, employer-via-funds, PFIC classification,
// equity/bond split) are OPTIONAL inputs the live path supplies; absent, the
// corresponding fields are null (honest gaps rather than fabricated points).
function buildProfileSnapshot(opts) {
  const {
    date, source = 'live', capturedAt = new Date().toISOString(),
    holdings = [], cash = 0, targets = [], settings = {},
    age = null, glidepathBase = 110,
    health = null, dividends = null,
    employerViaFundsPct = null, equityValue = null,
    pfic = null, nav = null,
  } = opts;

  const total = totalValue(holdings, cash);
  const employerSyms = new Set([
    ...String(settings.employerSymbols || '').toUpperCase().split(',').map(s => s.trim()).filter(Boolean),
    ...holdings.filter(h => h.isEmployerStock).map(h => (h.symbol || '').toUpperCase()),
  ]);
  const emp = employerConcentration(holdings, cash, [...employerSyms]);
  const top = topConcentrations(holdings, cash, 1)[0] || null;
  const buckets = allocationByBucket(holdings, cash).map(b => ({
    bucket: b.bucket, value: round2(b.marketValue), pct: round2(b.weightPct),
  }));

  const round = v => (v == null ? null : Math.round(v));
  const targetEquityPct = (age != null && age > 0)
    ? Math.max(0, Math.min(100, (glidepathBase ?? 110) - age)) : null;
  // Equity %: prefer the caller's quote-classified value; else invested (non-cash).
  const equityPct = total > 0
    ? round2(((equityValue != null ? equityValue : total - cash) / total) * 100) : 0;

  return {
    date, source, capturedAt,
    totalValue: round2(total),
    cash: round2(cash),
    cashPct: total > 0 ? round2((cash / total) * 100) : 0,
    // From the statement's NAV block when backfilling (else null).
    stockValue: nav ? round2(nav.stock) : null,
    dividendAccruals: nav ? round2(nav.dividendAccruals) : null,
    twrPct: nav ? nav.twrPct : null,
    buckets,
    employerPctDirect: round2(emp.pct),
    employerPctTotal: employerViaFundsPct != null ? round2(emp.pct + employerViaFundsPct) : null,
    employerSymbols: [...employerSyms],
    topSymbol: top ? top.symbol : null,
    topPct: top ? round2(top.weightPct) : null,
    equityPct,
    targetEquityPct,
    pficValue: pfic ? round2(pfic.value) : null,
    pficCount: pfic ? pfic.count : null,
    pficSymbols: pfic ? pfic.symbols : null,
    healthScore: health ? health.totalScore : null,
    healthGrade: health ? health.grade : null,
    dividendAnnual: dividends ? round2(dividends.annual) : null,
    // Compact per-holding breakdown — retained so future metrics can be
    // recomputed over historical points without re-importing.
    holdings: holdings.map(h => ({
      symbol: h.symbol,
      quantity: h.quantity ?? null,
      marketValue: round2(h.marketValue),
      costBasis: h.costBasis != null ? round2(h.costBasis) : null,
      currency: h.currency || null,
      bucket: h.bucket || null,
      isEmployerStock: !!h.isEmployerStock,
    })),
  };
}

function round2(v) {
  return v == null ? null : Math.round(v * 100) / 100;
}

// Insert a snapshot: one point per date (newer replaces same-date), kept sorted
// ascending so a backfilled older date slots into place. Caps length, keeping
// the most recent maxPoints.
function appendSnapshot(history, snap, { maxPoints = 1000 } = {}) {
  if (!snap || !snap.date) return history || [];
  const list = (history || []).filter(h => h.date !== snap.date);
  list.push(snap);
  list.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return list.length > maxPoints ? list.slice(list.length - maxPoints) : list;
}

module.exports = { parseStatementMeta, buildProfileSnapshot, appendSnapshot };
