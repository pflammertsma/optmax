'use strict';

/**
 * lensScores — per-security scores through three different investment lenses.
 *
 * A single "grade" is meaningless without a goal: VTI is an A+ buy-and-hold
 * core holding and an F covered-call underlying at the same time. So instead of
 * one number we score each security through the lens that matches what the user
 * is trying to do:
 *
 *   • buyHold  — is this a good long-term core holding? (diversification,
 *                US-domicile/PFIC safety, cost, stability)
 *   • dividend — is this good, tax-efficient income? (after-tax yield,
 *                sustainability)
 *   • trading  — advanced/speculative: is there a short-term edge? (volatility,
 *                momentum, liquidity). Deliberately flagged as advanced.
 *
 * Pure functions, no side effects, no API calls — safe in the renderer or in
 * node tests. Written UMD-style so the same tested file backs both.
 *
 * Each scorer returns { score: 0–100, grade: 'A'|'B'|'C'|'D'|'F', label,
 * factors: [{ label, detail }] } so the UI can explain the number.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.lensScores = api;
})(typeof window !== 'undefined' ? window : null, function () {

  // ── Shared helpers ─────────────────────────────────────────────────────────
  function gradeFor(score) {
    if (score >= 80) return { grade: 'A', label: 'Excellent' };
    if (score >= 65) return { grade: 'B', label: 'Good' };
    if (score >= 50) return { grade: 'C', label: 'Fair' };
    if (score >= 35) return { grade: 'D', label: 'Weak' };
    return { grade: 'F', label: 'Poor' };
  }

  function isFundLike(d) {
    const qt = (d.quoteType || '').toUpperCase();
    if (qt === 'ETF' || qt === 'MUTUALFUND') return true;
    const t = (d.analysis && d.analysis.type || '').toLowerCase();
    return t === 'etf' || t === 'bond etf' || !!d.overlap;
  }

  function isUSDomiciled(d) {
    const dom = (d.analysis && d.analysis.domicile) || '';
    return /united states|^us$/i.test(dom);
  }

  function marketCapPoints(mc, max) {
    // Bigger = steadier; scaled to the caller's max weight.
    if (mc == null) return max * 0.4;              // unknown → neutral-ish
    if (mc >= 200e9) return max;                   // mega
    if (mc >= 10e9)  return max * 0.8;             // large
    if (mc >= 2e9)   return max * 0.5;             // mid
    if (mc >= 300e6) return max * 0.28;            // small
    return max * 0.1;                              // micro
  }

  function clamp(n) { return Math.max(0, Math.min(100, Math.round(n))); }

  // ── 1. Buy-and-hold quality ────────────────────────────────────────────────
  // Weights: diversification 35, tax fit 30, cost 20, stability 15.
  function buyHoldScore(d, opts = {}) {
    const usPerson = opts.usPerson !== false; // fail-safe: treat unknown as US person
    const factors = [];
    let score = 0;

    // Diversification (35)
    const fund = isFundLike(d);
    const divPts = fund ? 35 : 10;
    score += divPts;
    factors.push({
      label: 'Diversification',
      detail: fund ? 'A diversified fund — one holding, many companies.'
                   : 'A single company — carries concentration risk on its own.',
    });

    // Tax fit / domicile (30) — the PFIC trap only bites US persons.
    const pfic = !!(d.analysis && d.analysis.isPfic) || !!d.isPfic;
    let taxPts, taxDetail;
    if (usPerson && pfic) {
      taxPts = 0;
      taxDetail = 'Foreign-domiciled (PFIC) — punitive US tax and extra IRS forms.';
    } else if (isUSDomiciled(d)) {
      taxPts = 30;
      taxDetail = 'US-domiciled — clean tax treatment for a US person abroad.';
    } else if (!usPerson) {
      taxPts = 24;
      taxDetail = 'Domicile is not a PFIC concern for a non-US person.';
    } else {
      taxPts = 18;
      taxDetail = 'Non-US domicile — check it is not a PFIC before buying.';
    }
    score += taxPts;
    factors.push({ label: 'Tax fit', detail: taxDetail });

    // Cost (20) — fund expense ratio; single stocks carry no fund fee.
    const er = d.expenseRatioPct;
    let costPts, costDetail;
    if (er == null) {
      costPts = fund ? 10 : 14; // fund with unknown ER: mild caution; stock: no fee
      costDetail = fund ? 'Expense ratio unknown.' : 'No fund fee (individual stock).';
    } else if (er <= 0.10) { costPts = 20; costDetail = `Very low cost (${er.toFixed(2)}% expense ratio).`; }
    else if (er <= 0.25)   { costPts = 16; costDetail = `Low cost (${er.toFixed(2)}%).`; }
    else if (er <= 0.50)   { costPts = 11; costDetail = `Moderate cost (${er.toFixed(2)}%).`; }
    else if (er <= 0.75)   { costPts = 6;  costDetail = `High cost (${er.toFixed(2)}%) — drags long-term returns.`; }
    else                   { costPts = 2;  costDetail = `Very high cost (${er.toFixed(2)}%).`; }
    score += costPts;
    factors.push({ label: 'Cost', detail: costDetail });

    // Stability / breadth (15). For a single company this is market cap. For a
    // fund, cap is usually unknown AND the wrong question — what matters is how
    // much of the market it spans. Without this every cheap US ETF scored an
    // identical 91, so a whole-market fund and a one-sector fund looked alike.
    let sizePts, sizeDetail;
    if (fund) {
      const breadth = d.breadth || null;
      if (breadth === 'broad')       { sizePts = 15; sizeDetail = 'Spans the whole market — the broadest, steadiest kind of fund.'; }
      else if (breadth === 'bond')   { sizePts = 15; sizeDetail = 'Broad fixed income — the least volatile sleeve of a portfolio.'; }
      else if (breadth === 'tilt')   { sizePts = 11; sizeDetail = 'A style or factor tilt — diversified, but leans one way.'; }
      else if (breadth === 'sector') { sizePts = 6;  sizeDetail = 'A single sector — concentrated, so it swings harder than the market.'; }
      else                           { sizePts = marketCapPoints(d.marketCap, 15); sizeDetail = 'Fund breadth unknown.'; }
    } else {
      sizePts = marketCapPoints(d.marketCap, 15);
      sizeDetail = d.marketCap == null ? 'Company size unknown.'
        : d.marketCap >= 10e9 ? 'Large, established — lower blow-up risk.'
        : d.marketCap >= 2e9 ? 'Mid-sized — moderate stability.'
        : 'Small — more volatile, higher single-name risk.';
    }
    score += sizePts;
    factors.push({ label: fund ? 'Breadth' : 'Stability', detail: sizeDetail });

    // A PFIC is disqualifying as a core holding for a US person, no matter how
    // cheap or large — cap it so the grade tells the truth.
    if (usPerson && pfic) score = Math.min(score, 30);

    score = clamp(score);
    return { ...gradeFor(score), score, factors };
  }

  // ── 2. Dividend / income ────────────────────────────────────────────────────
  // Weights: after-tax yield 65, sustainability 35.
  function dividendScore(d, opts = {}) {
    const taxRate = (opts.dividendTaxRatePct ?? 0) / 100;
    const factors = [];
    const y = d.yieldPct;

    if (y == null || y <= 0) {
      factors.push({ label: 'Yield', detail: 'Pays little or no dividend — not an income holding.' });
      const score = clamp(y === 0 ? 6 : 4);
      return { ...gradeFor(score), score, factors };
    }

    // After-tax yield (65) — what actually lands in your pocket after the
    // dividend tax (Switzerland taxes dividends fully; there is no sweet-spot
    // reward for yields so high they signal distress).
    const afterTax = y * (1 - taxRate);
    let yPts;
    if      (afterTax >= 3 && afterTax <= 5) yPts = 65;
    else if (afterTax > 5 && afterTax <= 8)  yPts = 55;
    else if (afterTax >= 1.5 && afterTax < 3) yPts = 48;
    else if (afterTax > 8 && afterTax <= 12) yPts = 34; // getting into yield-trap territory
    else if (afterTax >= 0.5 && afterTax < 1.5) yPts = 24;
    else if (afterTax > 12) yPts = 14;                  // very likely unsustainable
    else yPts = 10;
    factors.push({
      label: 'After-tax yield',
      detail: `${y.toFixed(2)}% gross → ~${afterTax.toFixed(2)}% after ${(taxRate * 100).toFixed(0)}% dividend tax.`,
    });

    // Sustainability (35) — large, diversified payers are far more reliable than
    // a small-cap sporting a double-digit yield.
    const fund = isFundLike(d);
    let sPts = marketCapPoints(d.marketCap, 25) + (fund ? 10 : 4);
    if (y > 12 && !fund) sPts = Math.min(sPts, 8); // classic yield trap
    factors.push({
      label: 'Sustainability',
      detail: fund ? 'Diversified fund — income spread across many payers.'
        : d.marketCap >= 10e9 ? 'Large, established payer.'
        : 'Smaller single payer — dividend is less certain.',
    });

    const score = clamp(yPts + sPts);
    return { ...gradeFor(score), score, factors };
  }

  // ── 3. Short-term / trading (advanced, speculative) ─────────────────────────
  // Weights: volatility/opportunity 40, momentum 30, liquidity 30.
  // Deliberately labeled advanced — this is not the newbie default lens.
  function tradingScore(d, opts = {}) {
    const factors = [];
    let score = 0;

    // Volatility / opportunity (40) — IV rank drives option premium and range.
    const ivr = d.ivr;
    let volPts;
    if (ivr == null) { volPts = 14; }
    else if (ivr >= 50) volPts = 40;
    else if (ivr >= 30) volPts = 30;
    else if (ivr >= 15) volPts = 20;
    else volPts = 10;
    score += volPts;
    factors.push({
      label: 'Volatility',
      detail: ivr == null ? 'Implied-volatility rank unknown.'
        : ivr >= 30 ? `Elevated IV rank (${ivr.toFixed(0)}) — richer premium, bigger swings.`
        : `Calm IV rank (${ivr.toFixed(0)}) — little short-term edge.`,
    });

    // Momentum (30)
    const up = d.aboveMA50 === true;
    const support = d.atSupport === true;
    const momPts = up ? 30 : support ? 18 : 8;
    score += momPts;
    factors.push({
      label: 'Momentum',
      detail: up ? 'Trading above its 50-day average — upward trend.'
        : support ? 'Sitting at technical support.'
        : 'Below its 50-day average — weak trend.',
    });

    // Liquidity (30) — size + option open interest = you can get in and out.
    let liqPts = marketCapPoints(d.marketCap, 20);
    const oi = d.openInterest ?? 0;
    liqPts += oi >= 1000 ? 10 : oi >= 200 ? 6 : oi > 0 ? 3 : 0;
    score += liqPts;
    factors.push({
      label: 'Liquidity',
      detail: d.marketCap >= 10e9 ? 'Highly liquid — easy to trade.' : 'Thinner liquidity — mind the spread.',
    });

    score = clamp(score);
    return { ...gradeFor(score), score, factors };
  }

  // Describe the lenses for the UI (labels, one-liners, and who they suit).
  const LENS_META = {
    buyHold:  { key: 'buyHold',  label: 'Buy & Hold', short: 'Hold',   blurb: 'Quality as a long-term core holding.', advanced: false },
    dividend: { key: 'dividend', label: 'Dividend',   short: 'Income', blurb: 'Tax-efficient income.',                 advanced: false },
    trading:  { key: 'trading',  label: 'Short-Term', short: 'Trade',  blurb: 'Advanced: short-term/speculative edge.', advanced: true },
  };

  // Convenience: score all lenses at once.
  function scoreLenses(d, opts = {}) {
    return {
      buyHold:  buyHoldScore(d, opts),
      dividend: dividendScore(d, opts),
      trading:  tradingScore(d, opts),
    };
  }

  return { scoreLenses, buyHoldScore, dividendScore, tradingScore, gradeFor, LENS_META };
});
