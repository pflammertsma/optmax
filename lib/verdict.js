'use strict';

/**
 * verdict — the one-line answer to "is this worth buying, and what is it FOR?"
 *
 * The scanner already produces plenty of numbers (quality score, yield, tax
 * drag, expense ratio). The problem is that a wall of near-identical numbers
 * doesn't tell a newbie anything: a dozen broad US ETFs all score A/91 and all
 * say "core underweight by $396,616", which is not a decision.
 *
 * So this module collapses the numbers into two things a person can act on:
 *
 *   • role   — what job this instrument does in a portfolio (Core, Diversifier,
 *              Satellite, Income). This is the "what is it FOR".
 *   • rating — how strongly it suits THIS user (strong / solid / careful /
 *              avoid), given their PFIC exposure and dividend tax rate.
 *
 * plus a short `watch` list of the caveats that are actually distinguishing —
 * never the ones every row shares.
 *
 * Pure. UMD so the renderer and node tests share one implementation.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.verdict = api;
})(typeof window !== 'undefined' ? window : null, function () {

  // Fund breadth taxonomy. This is the axis the buy-and-hold score was blind
  // to: VTI (whole market) and VGT (one sector) are not the same animal even
  // though both are cheap, US-domiciled and diversified-vs-a-single-stock.
  const BROAD_FUNDS = new Set([
    'VTI', 'VOO', 'VT', 'VXUS', 'VEA', 'IEMG', 'SPY', 'IVV', 'ITOT', 'SCHB',
    'SCHF', 'SCHE', 'SCHA', 'VO', 'VB', 'VTWO', 'IWM', 'DIA', 'VTV', 'VEU',
  ]);
  const TILT_FUNDS = new Set([
    'VUG', 'SCHG', 'QQQM', 'QQQ', 'VIG', 'DGRO', 'VYM', 'SCHD', 'DGRW',
    'MOAT', 'COWZ', 'AVUV', 'USMV', 'QUAL', 'MTUM',
  ]);
  const SECTOR_FUNDS = new Set([
    'VGT', 'SMH', 'VHT', 'VDE', 'VNQ', 'NLR', 'XLF', 'XLE', 'XLK', 'XLV',
    'XLI', 'XLP', 'XLU', 'XLC', 'XLB', 'XLY', 'ARKK', 'SOXX', 'IBB', 'URNM',
    'JEPQ', 'JEPI', 'QYLD', 'XYLD',
  ]);

  /** 'broad' | 'tilt' | 'sector' | 'bond' | 'single' */
  function fundBreadth(symbol, { isFund = false, kind = null } = {}) {
    if (!isFund) return 'single';
    if (kind === 'bond') return 'bond';
    const s = (symbol || '').toUpperCase();
    if (BROAD_FUNDS.has(s)) return 'broad';
    if (SECTOR_FUNDS.has(s)) return 'sector';
    if (TILT_FUNDS.has(s)) return 'tilt';
    return 'tilt';                       // unknown fund: neutral, not bedrock
  }

  const ROLES = {
    core:        { key: 'core',        label: 'Core',        blurb: 'Portfolio bedrock — own it for years and keep adding.' },
    diversifier: { key: 'diversifier', label: 'Diversifier', blurb: 'Held to steady the ride, not to grow the pot.' },
    satellite:   { key: 'satellite',   label: 'Satellite',   blurb: 'A side bet around the core — keep the position small.' },
    income:      { key: 'income',      label: 'Income',      blurb: 'Bought for the dividend cheque it pays.' },
    avoid:       { key: 'avoid',       label: 'Avoid',       blurb: 'Not suitable for your situation.' },
  };

  const RATINGS = {
    strong:  { key: 'strong',  label: 'Strong buy-and-hold', tone: 'good' },
    solid:   { key: 'solid',   label: 'Solid',               tone: 'ok'   },
    careful: { key: 'careful', label: 'Only with care',      tone: 'warn' },
    avoid:   { key: 'avoid',   label: 'Avoid',               tone: 'bad'  },
  };

  function n(v) { return typeof v === 'number' && isFinite(v) ? v : null; }

  /**
   * @param row  { symbol, isFund, kind, isPfic, yieldPct, expenseRatioPct,
   *               marketCap, buyHoldScore, dividendScore, breadth? }
   * @param opts { usPerson, dividendTaxRatePct }
   */
  function instrumentVerdict(row = {}, opts = {}) {
    const usPerson = opts.usPerson !== false;      // fail-safe: assume US person
    const taxRate = opts.dividendTaxRatePct ?? 0;

    const isFund = !!row.isFund;
    const kind = row.kind || (isFund ? 'equity' : 'equity');
    const breadth = row.breadth || fundBreadth(row.symbol, { isFund, kind });
    const er = n(row.expenseRatioPct);
    const y = n(row.yieldPct) ?? 0;
    const cap = n(row.marketCap);
    const quality = n(row.buyHoldScore) ?? 0;
    const income = n(row.dividendScore) ?? 0;
    const taxDrag = (y * taxRate) / 100;

    const watch = [];

    // ── Hard stop: a PFIC is disqualifying for a US person, full stop. ────────
    if (usPerson && row.isPfic) {
      return {
        breadth,
        role: ROLES.avoid,
        rating: RATINGS.avoid,
        headline: 'Foreign-domiciled fund (PFIC) — punitive US tax and extra IRS paperwork. Don\'t buy this.',
        watch: ['PFIC: taxed under §1291 with an interest charge, plus Form 8621 every year'],
      };
    }

    // ── Role: what job does this do? ─────────────────────────────────────────
    let role;
    if (kind === 'bond') role = ROLES.diversifier;
    else if (breadth === 'broad') role = ROLES.core;
    else if (breadth === 'sector') role = ROLES.satellite;
    else if (breadth === 'single') role = (y >= 3 && income >= 65) ? ROLES.income : ROLES.satellite;
    else role = (y >= 3 && income >= 65) ? ROLES.income : ROLES.core;   // 'tilt'

    // ── Distinguishing caveats only — never something every row shares. ──────
    if (er != null && er > 0.30) {
      watch.push(`${er.toFixed(2)}%/yr fund fee — about $${Math.round(er * 100)} a year on every $10,000`);
    }
    // 0.75%/yr is roughly where the dividend tax starts costing more than a
    // typical broad fund's entire expense ratio — worth saying out loud.
    if (taxDrag >= 0.75) {
      watch.push(`${y.toFixed(1)}% yield is taxable income — roughly ${taxDrag.toFixed(1)}%/yr lost to dividend tax`);
    }
    if (breadth === 'sector') {
      watch.push('One sector only — it will swing much harder than the whole market');
    }
    if (breadth === 'single') {
      watch.push('A single company — one bad quarter hits the whole position');
    }
    if (cap != null && cap > 0 && cap < 2e9) {
      watch.push('Small company — thinner trading and wider spreads');
    }
    if (!isFund && y > 12) {
      watch.push('A double-digit yield on one company usually signals distress, not a bargain');
    }

    // ── Rating: how strongly does it suit THIS user? ──────────────────────────
    let rating;
    if (!isFund && y > 12) {
      rating = RATINGS.careful;
    } else if ((er != null && er > 0.50) || quality < 50 || (!isFund && cap != null && cap < 2e9)) {
      rating = RATINGS.careful;
    } else if (quality >= 85 && (er == null || er <= 0.15) && (role === ROLES.core || role === ROLES.diversifier)) {
      rating = RATINGS.strong;
    } else {
      rating = RATINGS.solid;
    }

    // ── Headline: role + the single most important reason. ────────────────────
    let headline;
    if (rating === RATINGS.strong && kind === 'bond') {
      headline = 'Cheap, broad fixed income — exactly what a glidepath wants.';
    } else if (rating === RATINGS.strong) {
      headline = 'Broad, cheap and tax-clean for you — the kind of fund to buy and forget.';
    } else if (rating === RATINGS.careful && er != null && er > 0.50) {
      headline = `Usable, but the ${er.toFixed(2)}% fee is a permanent drag — only if you specifically want this exposure.`;
    } else if (rating === RATINGS.careful && !isFund) {
      headline = 'A single-company bet — fine in a small size, never as a core holding.';
    } else if (rating === RATINGS.careful) {
      headline = 'Workable, but check the caveats before you commit money.';
    } else if (role === ROLES.income) {
      headline = `Pays real income (${y.toFixed(1)}%), but you're taxed on every franc of it.`;
    } else if (role === ROLES.satellite) {
      headline = 'A reasonable satellite position — keep it a small slice of the portfolio.';
    } else if (role === ROLES.diversifier) {
      headline = 'Ballast for the portfolio — dampens the swings rather than driving returns.';
    } else {
      headline = 'A sound long-term holding, just not the cheapest or broadest option here.';
    }

    return { breadth, role, rating, headline, watch };
  }

  return { instrumentVerdict, fundBreadth, ROLES, RATINGS, BROAD_FUNDS, TILT_FUNDS, SECTOR_FUNDS };
});
