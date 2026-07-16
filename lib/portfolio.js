'use strict';

// Pure portfolio math for the long-term Portfolio module.
// No side effects, no API calls — mirrors lib/strategies.js in spirit.
// See docs/planning/ for the design rationale.

// A holding: { symbol, quantity, marketValue, costBasis?, bucket?, isEmployerStock? }
// marketValue is quantity × current price in account base currency.

// ── Allocation ────────────────────────────────────────────────────────────────

// Total market value across holdings, plus optional cash balance.
function totalValue(holdings, cash = 0) {
  const sum = (holdings || []).reduce((s, h) => s + (h.marketValue || 0), 0);
  return sum + (cash || 0);
}

// Per-holding weight as % of total (including cash). Returns [] on empty/zero.
function allocationByHolding(holdings, cash = 0) {
  const total = totalValue(holdings, cash);
  if (total <= 0) return [];
  return (holdings || []).map(h => ({
    symbol: h.symbol,
    marketValue: h.marketValue || 0,
    weightPct: ((h.marketValue || 0) / total) * 100,
  }));
}

// Aggregate weights by bucket label (e.g. 'core', 'satellite'); holdings with
// no bucket fall into 'unassigned'. Cash > 0 appears as bucket 'cash'.
function allocationByBucket(holdings, cash = 0) {
  const total = totalValue(holdings, cash);
  if (total <= 0) return [];
  const buckets = new Map();
  for (const h of holdings || []) {
    const key = h.bucket || 'unassigned';
    buckets.set(key, (buckets.get(key) || 0) + (h.marketValue || 0));
  }
  if (cash > 0) buckets.set('cash', (buckets.get('cash') || 0) + cash);
  return [...buckets.entries()].map(([bucket, value]) => ({
    bucket,
    marketValue: value,
    weightPct: (value / total) * 100,
  }));
}

// ── Drift vs. target ─────────────────────────────────────────────────────────

// targets: [{ bucket, targetPct }]. tolerancePct is absolute percentage points.
// Returns per-bucket drift with a `rebalance` flag and the trade value needed
// to return to target (positive = buy, negative = sell).
function computeDrift(holdings, targets, cash = 0, tolerancePct = 5) {
  const total = totalValue(holdings, cash);
  const actual = new Map(allocationByBucket(holdings, cash).map(b => [b.bucket, b]));
  const seen = new Set();
  const rows = [];

  for (const t of targets || []) {
    seen.add(t.bucket);
    const a = actual.get(t.bucket);
    const actualPct = a ? a.weightPct : 0;
    const driftPct = actualPct - t.targetPct;
    rows.push({
      bucket: t.bucket,
      targetPct: t.targetPct,
      actualPct,
      driftPct,
      rebalance: Math.abs(driftPct) > tolerancePct,
      tradeValue: total > 0 ? -(driftPct / 100) * total : 0,
    });
  }

  // Buckets that exist in the portfolio but have no target: implicit 0% target.
  for (const [bucket, a] of actual.entries()) {
    if (seen.has(bucket)) continue;
    rows.push({
      bucket,
      targetPct: 0,
      actualPct: a.weightPct,
      driftPct: a.weightPct,
      rebalance: a.weightPct > tolerancePct,
      tradeValue: -(a.weightPct / 100) * total,
    });
  }

  return rows;
}

// ── Concentration ────────────────────────────────────────────────────────────

// % of total portfolio in directly-held employer stock (isEmployerStock flag,
// or symbols listed in employerSymbols). Index-implied exposure is a later
// refinement — see docs/planning/signals.md.
function employerConcentration(holdings, cash = 0, employerSymbols = []) {
  const total = totalValue(holdings, cash);
  if (total <= 0) return { value: 0, pct: 0 };
  const syms = new Set((employerSymbols || []).map(s => s.toUpperCase()));
  const value = (holdings || [])
    .filter(h => h.isEmployerStock || syms.has((h.symbol || '').toUpperCase()))
    .reduce((s, h) => s + (h.marketValue || 0), 0);
  return { value, pct: (value / total) * 100 };
}

// Largest single positions as % of total — the generic concentration check.
function topConcentrations(holdings, cash = 0, count = 5) {
  return allocationByHolding(holdings, cash)
    .sort((a, b) => b.weightPct - a.weightPct)
    .slice(0, count);
}

// ── Glidepath ────────────────────────────────────────────────────────────────

// Simple adjustable age-indexed equity target: min(maxPct, base - age).
function glidepathEquityTarget(age, base = 110, maxPct = 100) {
  if (age == null || age < 0) return null;
  return Math.max(0, Math.min(maxPct, base - age));
}

// ── IBKR CSV import ──────────────────────────────────────────────────────────

// Parses an IBKR Client Portal / Flex positions CSV export.
// Column names vary across IBKR export flavors; we match common aliases
// case-insensitively. Returns { holdings, cash, errors }.
const CSV_ALIASES = {
  symbol:      ['symbol', 'ticker', 'financial instrument description', 'underlying'],
  quantity:    ['quantity', 'position', 'qty'],
  marketValue: ['market value', 'value', 'position value', 'marketvalue', 'mkt val'],
  costBasis:   ['cost basis', 'costbasis', 'cost bas.', 'average cost'],
  assetClass:  ['asset class', 'asset category', 'sec type', 'assetclass'],
  currency:    ['currency', 'ccy'],
};

function splitCsvLine(line) {
  const out = [];
  let cur = '', inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') { cur += '"'; i++; }
      else inQuotes = !inQuotes;
    } else if (ch === ',' && !inQuotes) {
      out.push(cur); cur = '';
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out.map(c => c.trim());
}

function parseNumber(v) {
  if (v == null) return null;
  const n = parseFloat(String(v).replace(/[",\s]/g, ''));
  return Number.isFinite(n) ? n : null;
}

// Symbols are ticker-shaped: start with a letter, then letters/digits/space/./-
const TICKER_RE = /^[A-Z][A-Z0-9 .\-]{0,11}$/;

// ── IBKR Activity Statement parser ───────────────────────────────────────────
// Format: every line is prefixed with "<Section>,<Header|Data|Total>,...".
// We use: Open Positions (positions), Cash Report (ending cash),
// Base Currency Exchange Rate (FX→base), Account Information (base currency).

function isActivityStatement(text) {
  return /^Open Positions,(Header|Data),/m.test(text);
}

function parseActivityStatementCsv(text) {
  const errors = [];
  const holdings = [];
  const holdingsBySymbol = new Map();
  let cash = 0;
  let baseCurrency = null;
  const fxRates = {};   // currency → rate to base
  let posCols = null;   // Open Positions column map

  const lines = text.replace(/^﻿/, '').split(/\r?\n/).filter(l => l.trim() !== '');

  // First pass: FX rates and base currency (needed before converting positions)
  for (const line of lines) {
    const cells = splitCsvLine(line);
    if (cells[0] === 'Base Currency Exchange Rate' && cells[1] === 'Data') {
      const rate = parseNumber(cells[3]);
      if (cells[2] && rate) fxRates[cells[2].toUpperCase()] = rate;
    } else if (cells[0] === 'Account Information' && cells[1] === 'Data' && cells[2] === 'Base Currency') {
      baseCurrency = (cells[3] || '').toUpperCase() || null;
    }
  }

  for (let i = 0; i < lines.length; i++) {
    const cells = splitCsvLine(lines[i]);
    const [section, kind] = cells;

    if (section === 'Open Positions') {
      if (kind === 'Header') {
        posCols = {};
        cells.forEach((c, idx) => { posCols[c.toLowerCase().trim()] = idx; });
        continue;
      }
      if (kind !== 'Data' || !posCols) continue;

      const getColIdx = (aliases) => {
        for (const a of aliases) {
          if (posCols[a] != null) return posCols[a];
        }
        return -1;
      };

      const datadiscriminatorIdx = getColIdx(['datadiscriminator', 'discriminator']);
      const datadiscriminator = datadiscriminatorIdx >= 0 ? cells[datadiscriminatorIdx] : '';

      const symbolIdx = getColIdx(['symbol', 'ticker']);
      const symbol = symbolIdx >= 0 ? cells[symbolIdx].toUpperCase().trim() : '';
      if (!symbol || !TICKER_RE.test(symbol)) continue;

      const currencyIdx = getColIdx(['currency', 'ccy']);
      const currency = currencyIdx >= 0 ? cells[currencyIdx].toUpperCase() || null : null;
      const rate = (!currency || currency === baseCurrency) ? 1 : fxRates[currency];
      if (rate == null && currency) {
        errors.push(`No FX rate for ${currency} (${symbol}) — imported unconverted`);
      }
      const fx = rate ?? 1;

      if (datadiscriminator === 'Summary') {
        const valIdx = getColIdx(['value', 'market value', 'position value']);
        const cbIdx = getColIdx(['cost basis', 'costbasis']);
        const qtyIdx = getColIdx(['quantity', 'position', 'qty']);
        const acIdx = getColIdx(['asset category', 'asset class', 'sec type']);

        const value = valIdx >= 0 ? parseNumber(cells[valIdx]) : null;
        const costBasis = cbIdx >= 0 ? parseNumber(cells[cbIdx]) : null;

        const holding = {
          symbol,
          quantity:      qtyIdx >= 0 ? parseNumber(cells[qtyIdx]) : null,
          marketValue:   value != null ? value * fx : 0,
          costBasis:     costBasis != null ? costBasis * fx : null,
          currency,
          assetCategory: acIdx >= 0 ? cells[acIdx] || null : null,
          lots:          [],
        };
        holdingsBySymbol.set(symbol, holding);
        holdings.push(holding);
      } else if (datadiscriminator === 'Lot') {
        const valIdx = getColIdx(['value', 'market value', 'position value']);
        const cbIdx = getColIdx(['cost basis', 'costbasis']);
        const qtyIdx = getColIdx(['quantity', 'position', 'qty']);
        const cpIdx = getColIdx(['cost price', 'costprice', 'average cost', 'avg price']);
        const pnlIdx = getColIdx(['unrealized p/l', 'unrealized p&l', 'unrealized pnl', 'unrealized gain/loss']);
        const pnlPctIdx = getColIdx(['unrealized p/l %', 'unrealized p&l %', 'unrealized pnl %']);
        const dateIdx = getColIdx(['acquisition date', 'date', 'acquired date', 'purchase date']);

        const qty = qtyIdx >= 0 ? parseNumber(cells[qtyIdx]) : null;
        const val = valIdx >= 0 ? parseNumber(cells[valIdx]) : null;
        const cb = cbIdx >= 0 ? parseNumber(cells[cbIdx]) : null;
        const cp = cpIdx >= 0 ? parseNumber(cells[cpIdx]) : null;
        const pnl = pnlIdx >= 0 ? parseNumber(cells[pnlIdx]) : null;
        const pnlPct = pnlPctIdx >= 0 ? parseNumber(cells[pnlPctIdx]) : null;
        const acquisitionDate = dateIdx >= 0 ? cells[dateIdx] || null : null;

        const lot = {
          quantity: qty,
          costPrice: cp != null ? cp * fx : (qty > 0 && cb != null ? (cb / qty) * fx : null),
          costBasis: cb != null ? cb * fx : null,
          marketValue: val != null ? val * fx : 0,
          unrealizedPnl: pnl != null ? pnl * fx : null,
          unrealizedPnlPct: pnlPct,
          acquisitionDate,
        };

        const holding = holdingsBySymbol.get(symbol);
        if (holding) {
          holding.lots.push(lot);
        }
      }
    } else if (section === 'Cash Report' && kind === 'Data'
               && cells[2] === 'Ending Cash' && cells[3] === 'Base Currency Summary') {
      const v = parseNumber(cells[4]);
      if (v != null) cash = v;
    }
  }

  if (!holdings.length) errors.push('No positions found in Open Positions section');
  return { holdings, cash, errors, baseCurrency };
}

function headerFlags(cellsLower) {
  const hasSym = CSV_ALIASES.symbol.some(a => cellsLower.includes(a));
  const hasVal = CSV_ALIASES.marketValue.some(a => cellsLower.includes(a)) ||
                 CSV_ALIASES.quantity.some(a => cellsLower.includes(a));
  return { hasSym, hasVal };
}

function mapColumns(cellsLower) {
  const colIndex = {};
  for (const [field, aliases] of Object.entries(CSV_ALIASES)) {
    colIndex[field] = cellsLower.findIndex(c => aliases.includes(c));
  }
  return colIndex;
}

function parsePositionsCsv(text) {
  const errors = [];
  const holdings = [];
  const bySymbol = new Map();
  let cash = 0;

  if (!text || !text.trim()) return { holdings, cash, errors: ['Empty file'] };

  // IBKR Activity Statements get their own, exact parser
  if (isActivityStatement(text)) return parseActivityStatementCsv(text);

  const lines = text.split(/\r?\n/).filter(l => l.trim() !== '');

  // IBKR exports can contain multiple sections, each with its own header row
  // and column order. Re-map columns at every header row; sections whose
  // header lacks a value/quantity column are skipped entirely.
  let colIndex = null;
  let sectionValid = false;

  for (let i = 0; i < lines.length; i++) {
    const cells = splitCsvLine(lines[i]);
    const lower = cells.map(c => c.toLowerCase());

    const { hasSym, hasVal } = headerFlags(lower);
    if (hasSym) {
      if (hasVal) {
        colIndex = mapColumns(lower);
        sectionValid = true;
      } else {
        sectionValid = false;
      }
      continue;
    }
    if (!sectionValid || !colIndex) continue;
    if (cells.length < 2) continue;

    const symbol = (cells[colIndex.symbol] || '').toUpperCase().trim();
    if (!symbol) continue;

    const assetClass = colIndex.assetClass >= 0 ? (cells[colIndex.assetClass] || '').toLowerCase() : '';
    const marketValue = colIndex.marketValue >= 0 ? parseNumber(cells[colIndex.marketValue]) : null;

    if (assetClass.includes('cash') || symbol === 'CASH' || symbol.startsWith('TOTAL')) {
      if (marketValue != null) cash += marketValue;
      continue;
    }

    // Rows whose "symbol" isn't ticker-shaped are section subtotals or
    // misaligned artifacts — skip rather than import garbage.
    if (!TICKER_RE.test(symbol)) continue;

    const quantity = colIndex.quantity >= 0 ? parseNumber(cells[colIndex.quantity]) : null;
    if (marketValue == null && quantity == null) {
      errors.push(`Row ${i + 1}: no parsable value or quantity for ${symbol}`);
      continue;
    }

    const holding = {
      symbol,
      quantity:    quantity ?? null,
      marketValue: marketValue ?? 0,
      costBasis:   colIndex.costBasis >= 0 ? parseNumber(cells[colIndex.costBasis]) : null,
      currency:    colIndex.currency >= 0 ? (cells[colIndex.currency] || null) : null,
    };

    // Same symbol appearing again (another section) — keep the row that has a
    // real market value rather than importing duplicates.
    const existing = bySymbol.get(symbol);
    if (existing) {
      if (!existing.marketValue && holding.marketValue) {
        Object.assign(existing, holding);
      } else {
        errors.push(`Row ${i + 1}: duplicate row for ${symbol} ignored`);
      }
      continue;
    }
    bySymbol.set(symbol, holding);
    holdings.push(holding);
  }

  if (!holdings.length && !errors.length) {
    return { holdings, cash, errors: ['Could not find a header row with symbol and value/quantity columns'] };
  }
  return { holdings, cash, errors };
}

module.exports = {
  totalValue,
  allocationByHolding,
  allocationByBucket,
  computeDrift,
  employerConcentration,
  topConcentrations,
  glidepathEquityTarget,
  parsePositionsCsv,
  parseActivityStatementCsv,
  isActivityStatement,
};
