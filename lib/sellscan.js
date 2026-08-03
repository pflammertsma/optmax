'use strict';

// Sell scanner: the mirror image of lib/investments.js. Where the buy scanner
// ranks "what to buy," this ranks "what to sell (or close) to free up cash" —
// the typical need being to fund a better opportunity, e.g. bailing on a weak
// holding to buy an emerging one.
//
// The organising idea is a trade-off between two things:
//
//   • how much you'd WANT to be rid of a holding (weak quality, PFIC exposure,
//     over-concentration, employer stock, tax-inefficient income) — the
//     `shedScore`, and
//   • how much it COSTS to exit — capital-gains tax on the embedded gain plus
//     commission — the `frictionPct`.
//
// A great funding source is a weak holding that is cheap to exit (small gain or
// an outright loss, which for a US person is also a harvestable deduction). A
// high-quality broad fund sitting on a large gain is the opposite: expensive to
// sell and something you'd rather keep.
//
// Tax model (a PLANNING estimate, never advice — the UI must say so):
//   • The user's residence (Switzerland) does not tax private capital gains, so
//     the only gains tax modelled is the US one, and only for a US person.
//   • Normal holdings: gain × the US long-term cap-gains rate. A loss is $0 tax
//     and flagged harvestable.
//   • PFIC holdings: the punitive §1291 exit cost from lib/pfic.js.
//
// Pure — no side effects, no API calls. UMD-free CommonJS like its sibling.

const { analyzeTicker } = require('./guidance');
const { isUSPerson, estimatePficExitCost } = require('./pfic');
const { scoreLenses } = require('./lensscores');
const { dividendYieldPct } = require('./yield');
const { fundBreadth } = require('./verdict');
const { commissionUsd } = require('./tradecost');

function toUpper(s) { return (s || '').toUpperCase().trim(); }
function num(v) { return typeof v === 'number' && isFinite(v) ? v : null; }
function clamp(n, lo = 0, hi = 100) { return Math.max(lo, Math.min(hi, n)); }

const SELL_ACTIONS = {
  exit:    { key: 'exit',    label: 'Exit',        tone: 'bad',  blurb: 'Close the whole position.' },
  trim:    { key: 'trim',    label: 'Trim',        tone: 'warn', blurb: 'Reduce it back toward its target weight.' },
  harvest: { key: 'harvest', label: 'Harvest loss',tone: 'ok',   blurb: 'Sell at a loss to bank a US tax deduction.' },
  keep:    { key: 'keep',    label: 'Keep',        tone: 'good', blurb: 'No reason to sell — hold it.' },
};

// Net cash freed and the tax friction of exiting one holding, fully or in part.
// `fraction` (0–1) lets the caller cost a trim rather than a full close.
function exitEconomics(h, quote, analysis, { usPerson, ltcgRatePct, pficOpts, fraction = 1 }) {
  const marketValue = num(h.marketValue) || 0;
  const costBasis = num(h.costBasis);
  const price = quote ? num(quote.regularMarketPrice) : null;
  const soldValue = marketValue * fraction;

  const embeddedGain = costBasis != null ? marketValue - costBasis : null;
  const soldGain = embeddedGain != null ? embeddedGain * fraction : null;

  let exitTaxUsd = 0;
  let pfic = null;
  const isPfic = !!(analysis && analysis.isPfic);
  if (usPerson && isPfic && costBasis != null) {
    // Punitive §1291 path. Scale the position to the sold fraction.
    pfic = estimatePficExitCost({
      currentValue: soldValue,
      costBasis: costBasis * fraction,
      lots: (pficOpts && pficOpts.lots) || [],
      marginalRatePct: pficOpts && pficOpts.marginalRatePct,
      interestRatePct: pficOpts && pficOpts.interestRatePct,
      assumedYearsHeld: pficOpts && pficOpts.assumedYearsHeld,
    });
    exitTaxUsd = pfic.totalTax;
  } else if (usPerson && soldGain != null && soldGain > 0) {
    exitTaxUsd = soldGain * (ltcgRatePct / 100);
  }

  const commission = commissionUsd(soldValue, price);
  const netCashUsd = Math.max(0, soldValue - exitTaxUsd - commission);
  const frictionUsd = exitTaxUsd + commission;

  return {
    soldValue: Math.round(soldValue),
    embeddedGainUsd: embeddedGain != null ? Math.round(embeddedGain) : null,
    embeddedGainPct: embeddedGain != null && costBasis > 0 ? Math.round((embeddedGain / costBasis) * 1000) / 10 : null,
    soldGainUsd: soldGain != null ? Math.round(soldGain) : null,
    exitTaxUsd: Math.round(exitTaxUsd),
    commissionUsd: Math.round(commission * 100) / 100,
    frictionUsd: Math.round(frictionUsd),
    frictionPct: soldValue > 0 ? Math.round((frictionUsd / soldValue) * 1000) / 10 : 0,
    netCashUsd: Math.round(netCashUsd),
    harvestableLoss: !!(usPerson && !isPfic && embeddedGain != null && embeddedGain < 0),
    pfic,
  };
}

function scanSellCandidates({
  holdings = [], cash = 0, targets = [], settings = {}, quotes = {}, lots = {},
  maxPerCategory = 60,
} = {}) {
  const total = holdings.reduce((s, h) => s + (num(h.marketValue) || 0), 0) + (num(cash) || 0);
  const empty = { categories: { recommendation: [], weak: [], overweight: [], taxsmart: [] },
    totalHoldingsValue: 0, recommendedLiquidityUsd: 0, skippedOptions: 0 };
  if (total <= 0) return empty;

  const usPerson = isUSPerson(settings);
  const dividendTaxRatePct = settings.dividendTaxRatePct ?? 30;
  const ltcgRatePct = settings.usLtcgRatePct ?? 15;   // planning default for a US person
  const concLimitPct = settings.concentrationLimitPct ?? 10;
  const employerSyms = new Set(toUpper(settings.employerSymbols).split(',').map(s => s.trim()).filter(Boolean));
  for (const h of holdings) if (h.isEmployerStock) employerSyms.add(toUpper(h.symbol));

  // Bucket drift, so a trim can be aimed at whichever bucket is over its target.
  const actualBuckets = new Map();
  for (const h of holdings) {
    const b = h.bucket || 'unassigned';
    actualBuckets.set(b, (actualBuckets.get(b) || 0) + (num(h.marketValue) || 0));
  }
  if (cash > 0) actualBuckets.set('cash', (actualBuckets.get('cash') || 0) + cash);
  const overweightByBucket = new Map();
  for (const t of targets) {
    const actualPct = ((actualBuckets.get(t.bucket) || 0) / total) * 100;
    const drift = actualPct - t.targetPct;
    if (drift > 0) overweightByBucket.set(t.bucket, (drift / 100) * total);
  }

  const pficOpts = {
    marginalRatePct: settings.usMarginalRatePct,
    interestRatePct: settings.pficInterestRatePct,
    assumedYearsHeld: settings.pficAssumedYears,
  };

  const rows = [];
  let skippedOptions = 0;
  for (const h of holdings) {
    const sym = toUpper(h.symbol);
    const marketValue = num(h.marketValue) || 0;
    if (!sym || marketValue <= 0) continue;
    // Options ("or otherwise close") are a deliberate follow-up: closing them is
    // about freeing collateral/margin, which needs data we don't model yet.
    if (h.assetCategory === 'OPT' || sym.length > 8) { skippedOptions++; continue; }

    const quote = quotes[sym];
    const analysis = analyzeTicker(sym, holdings, cash, quote);
    const isFund = !!(analysis && (analysis.type === 'etf' || analysis.type === 'bond etf'));
    const kind = analysis && analysis.type === 'bond etf' ? 'bond' : 'equity';
    const breadth = fundBreadth(sym, { isFund, kind });
    const isPfic = !!(analysis && analysis.isPfic);
    const isEmployer = employerSyms.has(sym);
    const weightPct = analysis && analysis.weightPct != null
      ? analysis.weightPct : (marketValue / total) * 100;

    const yieldPct = dividendYieldPct(quote, 0);
    const erPct = isFund && quote
      ? (quote.annualReportExpenseRatio != null ? Math.round(quote.annualReportExpenseRatio * 10000) / 100 : null)
      : null;
    const lenses = scoreLenses({
      symbol: sym, quoteType: quote && quote.quoteType ? quote.quoteType : (isFund ? 'ETF' : 'EQUITY'),
      analysis, expenseRatioPct: erPct, yieldPct, marketCap: quote ? quote.marketCap : null, breadth,
    }, { usPerson, dividendTaxRatePct });
    const buyHoldScore = lenses.buyHold.score;

    const econ = exitEconomics(h, quote, analysis, { usPerson, ltcgRatePct, pficOpts });

    // ── shedScore: how much you'd want to be rid of it (0–100) ────────────────
    let shed = 0;
    const reasons = [];
    const watch = [];

    // Weak quality is the primary driver (a weak name is the natural funding source).
    shed += (100 - buyHoldScore) * 0.4;               // up to 40
    if (buyHoldScore < 45) reasons.push(`Weak long-term quality (grade ${lenses.buyHold.grade})`);

    if (usPerson && isPfic) {
      shed += 30;
      reasons.push('PFIC — foreign fund with punitive US tax; a name to exit over time');
      watch.push('Exiting a PFIC is itself taxed under §1291 — see the exit cost before selling');
    }

    // Over-concentration: single-name weight over the limit, or a bucket over target.
    const bucketOver = overweightByBucket.get(h.bucket) || 0;
    let overweightUsd = 0;
    if (!isFund && weightPct > concLimitPct) {
      const overPct = weightPct - concLimitPct;
      overweightUsd = (overPct / 100) * total;
      shed += clamp(overPct * 2, 0, 25);              // up to 25
      reasons.push(`Over-concentrated at ${weightPct.toFixed(1)}% (limit ${concLimitPct}%)`);
    } else if (bucketOver > 0 && marketValue > 0) {
      overweightUsd = Math.min(bucketOver, marketValue);
      shed += 8;
      reasons.push(`${h.bucket} bucket is over its target — trimming here helps rebalance`);
    }

    if (isEmployer) {
      shed += 15;
      reasons.push('Employer stock — reducing cuts concentration you already carry via salary');
    }

    // Tax-inefficient income in a taxable account (CH taxes dividends fully).
    const taxDragPct = (yieldPct * dividendTaxRatePct) / 100;
    if (!isFund && taxDragPct >= 1.5) {
      shed += 8;
      reasons.push(`High dividend tax drag (~${taxDragPct.toFixed(1)}%/yr at your rate)`);
    }

    // Cheap-to-exit bonus: a loss (harvestable for a US person) or a tiny gain
    // makes this an efficient place to raise cash.
    if (econ.harvestableLoss) {
      shed += 10;
      // Leads the reason list — it's the distinguishing "why this is a good
      // funding source," more informative than the shared bucket-drift note.
      reasons.unshift(`Currently at a loss — a US-harvestable exit with no gains tax`);
      watch.push('US wash-sale rule: don\'t rebuy the same or a substantially identical security within 30 days');
    }

    // Protect genuinely good core holdings from being surfaced as sells.
    const isQualityCore = (breadth === 'broad' || breadth === 'bond') && buyHoldScore >= 82 && !isPfic;
    if (isQualityCore) {
      shed = Math.min(shed, 20);
      watch.push('Still a solid core holding — sell only if you specifically need the cash');
    }

    shed = clamp(Math.round(shed));

    // Friction caveats for the watch list.
    if (econ.embeddedGainUsd != null && econ.embeddedGainUsd > 0) {
      const taxNote = usPerson
        ? ` — about $${econ.exitTaxUsd.toLocaleString('en-US')} US tax at ~${ltcgRatePct}%`
        : '';
      watch.push(`Selling realizes $${econ.embeddedGainUsd.toLocaleString('en-US')} of gains${taxNote}`);
    }
    if (usPerson && isPfic && econ.pfic && econ.pfic.totalTax > 0) {
      watch.push(`Estimated PFIC exit tax ~$${econ.pfic.totalTax.toLocaleString('en-US')} (${econ.pfic.effectiveRatePct}% of the gain)`);
    }

    // ── Action ────────────────────────────────────────────────────────────────
    let action;
    if (usPerson && isPfic) action = SELL_ACTIONS.exit;
    else if (buyHoldScore < 45) action = SELL_ACTIONS.exit;
    else if (econ.harvestableLoss && buyHoldScore < 65) action = SELL_ACTIONS.harvest;
    else if (overweightUsd > 0 && !isQualityCore) action = SELL_ACTIONS.trim;
    else if (isQualityCore || shed < 25) action = SELL_ACTIONS.keep;
    else action = SELL_ACTIONS.trim;

    // Attractiveness as a funding source: want-to-shed, minus what it costs to exit.
    const rankValue = Math.round(shed - econ.frictionPct);

    let headline;
    if (action === SELL_ACTIONS.exit && isPfic) headline = 'Foreign fund with punitive US tax — plan an exit, minding the exit cost.';
    else if (action === SELL_ACTIONS.exit) headline = 'Weak long-term prospects — a natural position to sell to fund something better.';
    else if (action === SELL_ACTIONS.harvest) headline = 'Underwater — selling frees cash and banks a US tax loss.';
    else if (action === SELL_ACTIONS.trim) headline = 'Larger than it should be — trim it back toward target and free some cash.';
    else headline = 'No pressing reason to sell — keep it unless you need the cash.';

    rows.push({
      symbol: sym,
      name: h.description || (quote && (quote.longName || quote.shortName)) || sym,
      bucket: h.bucket || 'unassigned',
      isFund, kind, breadth, isPfic, isEmployer,
      marketValue: Math.round(marketValue),
      weightPct: Math.round(weightPct * 10) / 10,
      buyHoldScore, buyHoldGrade: lenses.buyHold.grade,
      yieldPct: Math.round(yieldPct * 100) / 100,
      taxDragPct: Math.round(taxDragPct * 100) / 100,
      overweightUsd: Math.round(overweightUsd),
      shedScore: shed,
      rankValue,
      action: action.key,
      actionLabel: action.label,
      actionTone: action.tone,
      headline,
      reasons,
      watch,
      ...econ,
    });
  }

  // ── Categorize + rank ───────────────────────────────────────────────────────
  const cap = arr => (maxPerCategory > 0 ? arr.slice(0, maxPerCategory) : arr);

  // Recommendation: genuine funding sources — worth shedding and not "keep" —
  // ranked by attractiveness (want-to-shed minus exit friction).
  const recommendation = cap(rows
    .filter(r => r.action !== 'keep' && r.shedScore >= 30)
    .sort((a, b) => b.rankValue - a.rankValue));

  const weak = cap(rows.slice().sort((a, b) => a.buyHoldScore - b.buyHoldScore));

  const overweight = cap(rows
    .filter(r => r.overweightUsd > 0)
    .sort((a, b) => b.overweightUsd - a.overweightUsd));

  // Tax-smart: cheapest exits first — harvestable losses, then lowest friction.
  const taxsmart = cap(rows
    .filter(r => r.harvestableLoss || r.frictionPct <= 5)
    .sort((a, b) => {
      if (a.harvestableLoss !== b.harvestableLoss) return a.harvestableLoss ? -1 : 1;
      return a.frictionPct - b.frictionPct;
    }));

  const recommendedLiquidityUsd = recommendation.reduce((s, r) => s + (r.netCashUsd || 0), 0);

  return {
    categories: { recommendation, weak, overweight, taxsmart },
    totalHoldingsValue: Math.round(total - (num(cash) || 0)),
    recommendedLiquidityUsd: Math.round(recommendedLiquidityUsd),
    skippedOptions,
    usPerson,
  };
}

module.exports = { scanSellCandidates, exitEconomics, SELL_ACTIONS };
