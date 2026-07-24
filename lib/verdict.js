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

  // Terminology note: risks are named plainly — "PFIC risk", "PFIC exposure",
  // "unsustainable yield". Never "trap".
  //
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

  // Bond funds recognised by symbol as well as by `kind`. The scanner knows
  // VTIP is a bond fund because its seed says so; the symbol dialog only has
  // whatever analyzeTicker inferred, and got 'equity' — so the same fund was
  // being called a Diversifier in the table and an Income/style-tilt holding in
  // the dialog, with a "broad equity" holding period. One list, one answer.
  const BOND_FUNDS = new Set([
    'BND', 'AGG', 'BNDX', 'BNDW', 'TLT', 'IEF', 'TIP', 'VTIP', 'SGOV', 'BIL',
    'SHV', 'SHY', 'VGSH', 'VGIT', 'VGLT', 'VCIT', 'VCSH', 'LQD', 'HYG', 'JNK',
    'MUB', 'VTEB', 'ICSH', 'NEAR', 'SCHZ', 'SPTI', 'GOVT', 'SCHO', 'SCHR',
  ]);

  /** 'broad' | 'tilt' | 'sector' | 'bond' | 'single' */
  function fundBreadth(symbol, { isFund = false, kind = null } = {}) {
    if (!isFund) return 'single';
    if (kind === 'bond') return 'bond';
    const s = (symbol || '').toUpperCase();
    if (BOND_FUNDS.has(s)) return 'bond';
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

  // Short-duration bond funds behave nothing like long ones: SGOV is a parking
  // space, TLT swings like an equity. The recommended holding period has to
  // distinguish them.
  const SHORT_DURATION_BONDS = new Set(['SGOV', 'VTIP', 'BIL', 'SHV', 'SHY', 'VGSH', 'ICSH', 'NEAR']);

  // Broad, but only across one slice of the market. VB holds hundreds of names
  // and is a perfectly good core holding — it is still not "the whole market",
  // and saying so would be wrong.
  const CAP_SEGMENT_FUNDS = new Set(['VB', 'VO', 'SCHA', 'IWM', 'VTWO', 'DIA', 'VTV']);

  const RATINGS = {
    strong:  { key: 'strong',  label: 'Strong buy-and-hold', tone: 'good' },
    solid:   { key: 'solid',   label: 'Solid',               tone: 'ok'   },
    careful: { key: 'careful', label: 'Only with care',      tone: 'warn' },
    avoid:   { key: 'avoid',   label: 'Avoid',               tone: 'bad'  },
  };

  function n(v) { return typeof v === 'number' && isFinite(v) ? v : null; }

  /**
   * Recommended minimum holding period. Nothing to do with commission (that's
   * lib/tradecost) — this is about how long the asset needs to ride out its own
   * volatility before the expected return is likely to have shown up. A
   * whole-market fund wants a full business cycle; a T-bill fund is a parking
   * space you can use next month.
   */
  function holdingPeriod({ breadth, kind, symbol } = {}) {
    const s = (symbol || '').toUpperCase();
    if (kind === 'bond' || breadth === 'bond') {
      if (SHORT_DURATION_BONDS.has(s)) {
        return { minYears: 0, label: 'Any time', rationale: 'Very short-duration bonds barely move — fine for money you need within a year.' };
      }
      return { minYears: 3, label: '3+ yrs', rationale: 'Hold at least as long as the fund\'s duration, or a rate move can leave you underwater when you sell.' };
    }
    if (breadth === 'single') {
      return { minYears: 10, label: '10+ yrs', rationale: 'A single company can stay down for years for reasons that have nothing to do with the market — never money you need on a date.' };
    }
    if (breadth === 'sector') {
      return { minYears: 5, label: '5+ yrs', rationale: 'One sector can lag the market for years at a stretch; you need time for its cycle to turn.' };
    }
    // broad + tilt
    return { minYears: 7, label: '7+ yrs', rationale: 'Broad equity has historically needed a full business cycle to reliably recover from a bad entry point.' };
  }

  /**
   * A two-or-three word descriptor of what the thing actually IS. This is the
   * one phrase that genuinely differs row to row, so it's what the table shows;
   * the fuller prose belongs in the tooltip and the dialog.
   */
  function breadthLabel(breadth, symbol) {
    const s = (symbol || '').toUpperCase();
    switch (breadth) {
      case 'broad':  return CAP_SEGMENT_FUNDS.has(s) ? 'One size band' : 'Whole market';
      case 'tilt':   return 'Style tilt';
      case 'sector': return 'One sector';
      case 'bond':   return SHORT_DURATION_BONDS.has(s) ? 'Cash-like bonds' : 'Fixed income';
      case 'single': return 'Single company';
      default:       return '';
    }
  }

  /**
   * Why the quality score is what it is, as short chips. The mirror image of
   * `watch` — without this a column of identical "A 91" badges tells the user
   * nothing about what earned the grade.
   */
  function qualityStrengths(row = {}, opts = {}) {
    const usPerson = opts.usPerson !== false;
    const isFund = !!row.isFund;
    const breadth = row.breadth || fundBreadth(row.symbol, { isFund, kind: row.kind });
    const er = n(row.expenseRatioPct);
    const cap = n(row.marketCap);
    const out = [];

    if (breadth === 'broad') {
      out.push(CAP_SEGMENT_FUNDS.has((row.symbol || '').toUpperCase())
        ? 'Hundreds of companies, one size band'
        : 'Whole market in one fund');
    }
    else if (breadth === 'tilt') out.push('Diversified, with a style tilt');
    else if (breadth === 'bond') out.push('Broad fixed income');
    else if (breadth === 'sector') out.push('One sector');
    else if (cap != null && cap >= 200e9) out.push('Mega-cap company');
    else if (cap != null && cap >= 10e9) out.push('Large, established company');

    if (usPerson && !row.isPfic && isFund) out.push('US-domiciled — no PFIC exposure');
    if (er != null && er <= 0.10) out.push(`Very low fee (${er.toFixed(2)}%)`);
    else if (er != null && er <= 0.25) out.push(`Low fee (${er.toFixed(2)}%)`);

    const y = n(row.yieldPct) ?? 0;
    const taxRate = opts.dividendTaxRatePct ?? 0;
    if (y > 0 && y < 1.5 && taxRate > 0) out.push('Low yield — little taxable income');

    return out;
  }

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
        breadthLabel: breadthLabel(breadth, row.symbol),
        strengths: [],
        hold: { minYears: 0, label: 'Don\'t buy', rationale: 'There is no holding period that makes a PFIC work for a US person.' },
        watch: ['PFIC: taxed under §1291 with an interest charge, plus Form 8621 every year'],
      };
    }

    // ── Role: what job does this do? ─────────────────────────────────────────
    // Keyed off breadth, not the caller-supplied `kind` — the dialog often has
    // no reliable kind, and a bond fund must not read as an equity holding
    // there while reading as a Diversifier in the table.
    let role;
    if (kind === 'bond' || breadth === 'bond') role = ROLES.diversifier;
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
    // Total annual cost of ownership. A fund can pass every individual check —
    // cheap-ish fee, decent quality score — and still hand back 3%+ a year once
    // its yield meets this user's dividend tax rate. That is not "solid".
    const annualCostPct = (er || 0) + taxDrag;

    let rating;
    if (!isFund && y > 12) {
      rating = RATINGS.careful;
    } else if (annualCostPct > 2) {
      rating = RATINGS.careful;
      watch.unshift(`Costs about ${annualCostPct.toFixed(1)}%/yr to own once fee and dividend tax are counted — that is a high bar for the returns to clear`);
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
    } else if (rating === RATINGS.careful && annualCostPct > 2) {
      headline = `Costs roughly ${annualCostPct.toFixed(1)}%/yr to hold at your tax rate — the yield has to be worth that before it's worth buying.`;
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

    return {
      breadth,
      breadthLabel: breadthLabel(breadth, row.symbol),
      role, rating, headline, watch,
      strengths: qualityStrengths({ ...row, breadth }, { usPerson, dividendTaxRatePct: taxRate }),
      hold: holdingPeriod({ breadth, kind, symbol: row.symbol }),
    };
  }

  return {
    instrumentVerdict, fundBreadth, breadthLabel, holdingPeriod, qualityStrengths,
    ROLES, RATINGS, BROAD_FUNDS, TILT_FUNDS, SECTOR_FUNDS,
  };
});
