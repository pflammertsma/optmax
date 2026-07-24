'use strict';

// IBKR Flex Web Service — read-only statement retrieval, no Client Portal
// Gateway. The user configures an "Activity Flex Query" once in Client Portal
// (Performance & Reports → Flex Queries) and a Flex Web Service token; the app
// then pulls positions + cash + dividends over two plain HTTPS GETs, entirely
// avoiding the interactive gateway/2FA/Akamai path that IP-blocks so easily.
//
// This module is PURE: URL builders + XML parsers only, no network. The caller
// (main.js) performs the two HTTPS requests and hands the response bodies here.
//
// Flow (v3):
//   1. SendRequest?t=TOKEN&q=QUERYID&v=3  → a <FlexStatementResponse> with a
//      ReferenceCode (Success) or an ErrorCode/ErrorMessage (Fail).
//   2. GetStatement?t=TOKEN&q=REFERENCECODE&v=3 → the <FlexQueryResponse> with
//      the data, OR another <FlexStatementResponse> error (e.g. 1019 "statement
//      generation in progress" → retry with backoff).

// The canonical Flex Web Service endpoint (what ib_insync / ibflex use). IBKR
// also exposes an ndcdyn/AccountManagement path, but it 302-redirects here — so
// we target this directly and the SendRequest response's own <Url> is used for
// the GetStatement step. Note the "." before the action (a servlet method), not
// a "/".
const FLEX_BASE = 'https://gdcdyn.interactivebrokers.com/Universal/servlet/FlexStatementService';

function sendRequestUrl(token, queryId) {
  return `${FLEX_BASE}.SendRequest?t=${encodeURIComponent(token)}&q=${encodeURIComponent(queryId)}&v=3`;
}

// The SendRequest step returns the GetStatement URL to use; fall back to the
// known endpoint if it's absent.
function getStatementUrl(baseUrl, token, referenceCode) {
  const base = baseUrl || `${FLEX_BASE}.GetStatement`;
  const join = base.includes('?') ? '&' : '?';
  return `${base}${join}t=${encodeURIComponent(token)}&q=${encodeURIComponent(referenceCode)}&v=3`;
}

// ── Minimal XML helpers (Flex XML is flat attributes on elements) ────────────
function parseAttrs(tagText) {
  const attrs = {};
  const re = /([\w:.]+)\s*=\s*("([^"]*)"|'([^']*)')/g;
  let m;
  while ((m = re.exec(tagText))) attrs[m[1]] = m[3] != null ? m[3] : m[4];
  return attrs;
}

// All occurrences of <Name ...>  (self-closing or open) → array of attr maps.
// The \b after the name keeps <OpenPosition> from matching <OpenPositions>.
function elements(xml, name) {
  const out = [];
  const re = new RegExp(`<${name}\\b([^>]*?)/?>`, 'g');
  let m;
  while ((m = re.exec(String(xml || '')))) out.push(parseAttrs(m[1]));
  return out;
}

function firstElement(xml, name) {
  return elements(xml, name)[0] || null;
}

// <Tag>text</Tag> → trimmed text (used for the control response's Status etc.).
function tagText(xml, name) {
  const m = new RegExp(`<${name}>([\\s\\S]*?)</${name}>`).exec(String(xml || ''));
  return m ? m[1].trim() : null;
}

function num(v) {
  if (v == null || v === '') return null;
  const n = parseFloat(String(v).replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}

// YYYYMMDD (Flex's default) or YYYY-MM-DD → YYYY-MM-DD.
function flexDate(v) {
  const s = String(v || '').trim();
  let m = /^(\d{4})-?(\d{2})-?(\d{2})$/.exec(s);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  return null;
}

// ── Control response (SendRequest, and error form of GetStatement) ───────────
// Returns { ok, status, referenceCode, url, errorCode, errorMessage } or null
// when the body isn't a FlexStatementResponse (i.e. it's the data payload).
function parseControlResponse(xml) {
  if (!/<FlexStatementResponse\b/.test(String(xml || ''))) return null;
  const status = tagText(xml, 'Status');
  return {
    ok: /^success$/i.test(status || ''),
    status: status || null,
    referenceCode: tagText(xml, 'ReferenceCode'),
    url: tagText(xml, 'Url'),
    errorCode: tagText(xml, 'ErrorCode'),
    errorMessage: tagText(xml, 'ErrorMessage'),
  };
}

// Flex error codes that are transient — the request is valid, IBKR is just
// busy or the statement isn't ready yet, so the caller should back off + retry.
//   1001 could not be generated (busy) · 1003 not available · 1004 incomplete ·
//   1005-1008 P&L not ready · 1009 heavy load · 1019 generation in progress ·
//   1021 could not be retrieved
// Deliberately EXCLUDES rate-limit codes (1018 too many requests, 1025 too many
// failed attempts): retrying those deepens the lockout — the caller must wait.
const TRANSIENT_CODES = new Set(['1001', '1003', '1004', '1005', '1006', '1007', '1008', '1009', '1019', '1021']);

// Rate-limit / lockout codes — do NOT retry; back off for several minutes.
const LOCKOUT_CODES = new Set(['1018', '1025']);

function isLockoutError(control) {
  const c = control && control.errorCode;
  if (c && LOCKOUT_CODES.has(c)) return true;
  return /too many (requests|failed attempts)|request limit|threshold/i.test((control && control.errorMessage) || '');
}

function isGeneratingError(control) {
  if (!control) return false;
  if (control.errorCode && TRANSIENT_CODES.has(control.errorCode)) return true;
  return /in progress|try again|not ready|could not be (generated|retrieved)|heavy load|not available|incomplete/i
    .test(control.errorMessage || '');
}

// ── Position + asset-class mapping (mirrors lib/ibkr.mapIbkrPositions) ────────
function mapAssetCategory(cat) {
  const c = String(cat || '').toUpperCase();
  if (c === 'BOND' || c === 'BILL') return 'Bond';
  if (c === 'OPT' || c === 'FOP') return 'OPT';
  return 'Stocks';
}

// ── Data payload (GetStatement success) ──────────────────────────────────────
// Parse a <FlexQueryResponse> into the app's portfolio shape. Monetary fields
// are converted to base currency via each row's fxRateToBase (Flex reports
// per-instrument-currency amounts), so no external FX lookup is needed.
function parseFlexStatement(xml) {
  const control = parseControlResponse(xml);
  if (control) {
    return {
      error: control.errorMessage || `Flex error ${control.errorCode || ''}`.trim(),
      errorCode: control.errorCode || null,
      generating: isGeneratingError(control),
    };
  }
  if (!/<FlexQueryResponse\b/.test(String(xml || ''))) {
    return { error: 'Unrecognized Flex response (no FlexQueryResponse).', errorCode: null };
  }

  const errors = [];
  const stmt = firstElement(xml, 'FlexStatement') || {};
  const accountId = stmt.accountId || null;
  const statementDate = flexDate(stmt.toDate) || flexDate(stmt.reportDate) || null;

  const acctInfo = firstElement(xml, 'AccountInformation') || {};
  let baseCurrency = (acctInfo.currency || stmt.currency || '').toUpperCase() || null;

  // Positions
  const holdings = [];
  for (const p of elements(xml, 'OpenPosition')) {
    const qty = num(p.position);
    if (qty == null || qty === 0) continue;
    const cat = (p.assetCategory || '').toUpperCase();
    if (cat === 'CASH') continue;
    const symbol = (p.symbol || '').toUpperCase().trim();
    if (!symbol) { errors.push(`Position conid ${p.conid || '?'}: no symbol`); continue; }

    const fx = num(p.fxRateToBase);
    const rate = fx != null && fx > 0 ? fx : 1;
    const currency = (p.currency || baseCurrency || 'USD').toUpperCase();
    if (fx == null && currency !== (baseCurrency || currency)) {
      errors.push(`No fxRateToBase for ${symbol} (${currency}) — imported unconverted`);
    }
    const mktValue = num(p.positionValue);
    const costMoney = num(p.costBasisMoney);
    const costPrice = num(p.costBasisPrice);

    holdings.push({
      symbol,
      quantity: qty,
      marketValue: mktValue != null ? mktValue * rate : 0,
      costBasis: costMoney != null ? costMoney * rate
        : (costPrice != null ? costPrice * qty * rate : null),
      currency,
      assetCategory: mapAssetCategory(cat),
      conid: p.conid != null ? Number(p.conid) : null,
    });
  }

  // Cash + dividends from the Cash Report. The BASE_SUMMARY row carries the
  // base-currency totals; 3-letter rows give the per-currency breakdown.
  let cash = 0, cashFound = false;
  const div = { grossMtd: null, grossYtd: null, whMtd: null, whYtd: null, byCurrency: {} };
  for (const c of elements(xml, 'CashReportCurrency')) {
    const ccy = (c.currency || '').toUpperCase();
    const ending = num(c.endingCash);
    const dividends = num(c.dividends);
    const withholding = num(c.withholdingTax);
    if (ccy === 'BASE_SUMMARY') {
      if (ending != null) { cash = ending; cashFound = true; }
      if (dividends != null) div.grossYtd = dividends;
      if (withholding != null) div.whYtd = withholding;
      if (!baseCurrency && c.fromDate == null) { /* base ccy unknown here */ }
    } else if (/^[A-Z]{3}$/.test(ccy)) {
      if (dividends != null || withholding != null) {
        div.byCurrency[ccy] = {
          grossYtd: dividends ?? null,
          whYtd: withholding ?? null,
        };
      }
    }
  }
  if (!cashFound) errors.push('No base-currency cash summary found in the Flex statement.');

  const hasDiv = div.grossYtd != null || Object.keys(div.byCurrency).length > 0;

  // Optional NAV block for the history snapshot.
  let nav = null;
  const eq = firstElement(xml, 'EquitySummaryByReportDateInBase') || firstElement(xml, 'EquitySummaryInBase');
  if (eq) {
    nav = {
      total: num(eq.total),
      cash: num(eq.cash),
      stock: num(eq.stock),
      dividendAccruals: num(eq.dividendAccruals),
      twrPct: null,
    };
    if (Object.values(nav).every(v => v == null)) nav = null;
  }

  return {
    holdings, cash, baseCurrency, accountId, statementDate,
    dividendsPaid: hasDiv ? div : null,
    nav,
    errors,
  };
}

// Human-readable, actionable description of a Flex control error, with a hint
// keyed off the error code. `step` is 'request' or 'retrieve'; `extra` is an
// optional trailing clause (e.g. how long we retried).
function describeFlexError(step, control, extra) {
  const c = control && control.errorCode;
  const code = c ? ` (code ${c})` : '';
  const msg = (control && control.errorMessage) || 'Unknown Flex error';
  const stepLabel = step === 'request' ? 'requesting' : 'retrieving';
  let hint = '';
  if (c === '1018' || c === '1025') hint = ' You\'ve hit IBKR\'s request limit — a temporary lockout, not a config problem. Observed to clear after roughly 75 minutes, and every attempt inside that window restarts the clock, so wait it out rather than retrying.';
  else if (c === '1009') hint = ' IBKR\'s statement service is under load — this is IBKR-side, not your config. Wait a few minutes and try once more.';
  // 1001 is NOT simply "busy". Waiting hours does not clear it, so pointing the
  // user at "try again shortly" sends them into a retry loop that only risks a
  // 1025 lockout. It means IBKR declined to generate THIS query — most often
  // because the query's reporting period has no data it can produce right now.
  else if (c === '1001') hint = ' IBKR declined to generate this particular statement. If a short wait does not fix it, the cause is usually the Flex query itself rather than a rate limit: open the query in IBKR (Performance & Reports → Flex Queries) and check its period — a period covering only today, or one with no activity, cannot be generated. Retrying repeatedly will trip the rate limiter (1025) without fixing it.';
  else if (c === '1019' || c === '1021') hint = ' The statement was still being generated — try again in a moment.';
  else if (c === '1011') hint = ' The Flex Web Service isn\'t active — enable it in IBKR (Flex Web Service Configuration).';
  else if (c === '1012' || c === '1015' || c === '1016') hint = ' Your Flex token is invalid or expired — regenerate it in IBKR and re-save.';
  else if (c === '1013') hint = ' The token has an IP restriction that doesn\'t match this machine — clear it in IBKR.';
  else if (c === '1014' || c === '1020') hint = ' The Query ID looks invalid — re-check it against your Activity Flex Query in IBKR.';
  else if (c === '1003' || c === '1004') hint = ' The statement isn\'t available for this period yet — try a different period or wait.';
  return `IBKR error while ${stepLabel} the Flex statement${code}: ${msg}.${hint}${extra ? ' ' + extra + '.' : ''}`;
}

// Pre-flight advisory: given the request log, should we warn before firing
// another SendRequest? Pure (log + now + tunables in, decision out) so it can be
// unit-tested; main.js wraps it with the persisted log and the real constants.
//
// Three warn levels, most urgent first:
//   • 'lockout' — IBKR signalled 1018/1025; the cool-down clock is running and
//     every attempt inside it re-arms the clock.
//   • 'query-error' — the last attempt failed with 1001. Retrying does NOT fix a
//     1001 (proven: one returned after 6h idle) and a hasty retry converts it to
//     a 1025. So warn until something other than a 1001 is logged.
//   • 'soon' — under the minimum gap between requests.
const GUARD_COOLOFF_MS = 75 * 60 * 1000;
const GUARD_MIN_GAP_MS = 30 * 1000;

function flexGuardDecision(log = [], now = Date.now(), opts = {}) {
  const cooloffMs = opts.cooloffMs ?? GUARD_COOLOFF_MS;
  const minGapMs = opts.minGapMs ?? GUARD_MIN_GAP_MS;
  const entries = Array.isArray(log) ? log : [];
  const requests = entries.filter(e => e.step === 'SendRequest');
  const lastReq = requests.length ? requests[requests.length - 1] : null;
  const last = lastReq ? Date.parse(lastReq.ts) : null;
  const sinceLast = last != null ? now - last : null;

  let lockoutAt = null;
  for (let i = entries.length - 1; i >= 0; i--) {
    if (entries[i].lockout) { lockoutAt = Date.parse(entries[i].ts); break; }
  }
  const lockoutRemaining = (lockoutAt != null && now - lockoutAt < cooloffMs)
    ? cooloffMs - (now - lockoutAt) : 0;

  // The most recent request being a 1001 (and not a lockout, which is handled
  // above) means the query itself couldn't be generated.
  const lastWas1001 = !!lastReq && !lastReq.lockout && String(lastReq.errorCode) === '1001';

  const fmtTime = (ms) => new Date(ms).toLocaleTimeString();
  let warn = false, level = 'ok', message = '';
  if (lockoutRemaining > 0) {
    warn = true; level = 'lockout';
    const m = Math.ceil(lockoutRemaining / 60000);
    message = `IBKR signalled a rate-limit lockout at ${fmtTime(lockoutAt)}. Best guess is the cool-down has about ${m} minute${m === 1 ? '' : 's'} left. Sending another request now may reset IBKR's timer and extend the lockout.`;
  } else if (lastWas1001) {
    warn = true; level = 'query-error';
    message = `Your last IBKR Flex request failed with error 1001 ("statement could not be generated"). This isn't a rate limit — a longer wait won't fix it, and retrying too soon can trigger a lockout instead. Run the query directly in IBKR (Performance & Reports → Flex Queries) to see why, and check its reporting period, before trying again here.`;
  } else if (sinceLast != null && sinceLast < minGapMs) {
    warn = true; level = 'soon';
    message = `Your last IBKR Flex request was ${Math.round(sinceLast / 1000)}s ago. Requesting again this soon can trip IBKR's rate limiter.`;
  }
  return {
    warn, level, message,
    sinceLastMs: sinceLast,
    lockoutRemainingMs: lockoutRemaining,
    lastRequestAt: last,
    guessedCooloffMs: cooloffMs,
  };
}

module.exports = {
  FLEX_BASE,
  TRANSIENT_CODES,
  LOCKOUT_CODES,
  GUARD_COOLOFF_MS,
  GUARD_MIN_GAP_MS,
  sendRequestUrl,
  getStatementUrl,
  parseControlResponse,
  isGeneratingError,
  isLockoutError,
  describeFlexError,
  flexGuardDecision,
  parseFlexStatement,
  mapAssetCategory,
};
