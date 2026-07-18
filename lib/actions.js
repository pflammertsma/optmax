'use strict';

// Dashboard action plan: merges every advice engine (sell-down plan, tax-smart
// buy ideas, PFIC swaps, per-holding recommendations, compliance guidance)
// into ONE prioritized, deduplicated to-do list — the first thing the user
// sees when the app opens. Pure function, no side effects.
//
// Ordering philosophy (newbie-first): reduce the biggest risk before adding
// anything new. Sells before replacements before buys before FYIs. Each engine
// stays the authority on its own topic; this module only arbitrates overlap
// so the same problem never appears twice in different words.

const MAX_ACTIONS = 7;

// action: { kind: 'sell'|'replace'|'buy'|'review', title, detail, amountUsd?,
//           symbol?, nav, urgent }
function buildActionPlan({ selldown, buyRecs, guidanceItems, holdings } = {}) {
  const actions = [];
  const suppressGuidanceIds = new Set();
  const suppressTrimSymbols = new Set();
  const suppressReplaceSymbols = new Set();
  const items = guidanceItems || [];
  const holds = holdings || [];
  const swaps = buyRecs?.swaps || [];
  const buys = (buyRecs?.recommendations || []).filter(r => r.suggestedUsd > 0);

  // ── 1. Sell-down plan: the scheduled step, or the nudge to start one ──────
  const sd = selldown && selldown.plan && selldown.status ? selldown : null;
  if (sd) {
    // An active plan IS the answer to the concentration alerts — don't repeat them.
    suppressGuidanceIds.add('employer-concentration-hard');
    suppressGuidanceIds.add('employer-concentration-soft');
    suppressTrimSymbols.add(sd.plan.symbol);

    const s = sd.status;
    if (s.sellThisQuarter > 0) {
      actions.push({
        kind: 'sell',
        title: `Sell ~${s.sellThisQuarter.toLocaleString('en-US')} shares of ${sd.plan.symbol}`,
        detail: `${s.status === 'behind' ? 'You’re behind your sell-down schedule — this catches you up. ' : ''}Quarter ${s.currentQuarter} of ${s.quartersToTarget} of your employer-stock sell-down plan · due by ${new Date(s.quarterEndsOn).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}.`,
        amountUsd: Math.round(s.estProceeds),
        symbol: sd.plan.symbol,
        nav: 'guidance',
        urgent: s.status === 'behind',
      });
    }
  } else {
    // No plan, but employer stock is over the 10% line ⇒ the single most
    // valuable next step is starting one, not reading a warning. The candidate
    // (from the selldown IPC) is authoritative — it sees holding-level employer
    // flags, not just settings — with the guidance alert as fallback.
    const candidate = selldown?.candidate;
    const conc = items.find(i => i.id === 'employer-concentration-hard' || i.id === 'employer-concentration-soft');
    const overLimit = (candidate?.weightPct || 0) > 10 || !!conc;
    if (overLimit) {
      suppressGuidanceIds.add('employer-concentration-hard');
      suppressGuidanceIds.add('employer-concentration-soft');
      if (candidate?.symbol) suppressTrimSymbols.add(candidate.symbol.toUpperCase());
      const pctStr = candidate?.weightPct ? `${candidate.weightPct.toFixed(0)}% of your portfolio rides on ${candidate.symbol}` : 'Too much of your portfolio rides on your employer';
      actions.push({
        kind: 'sell',
        title: 'Start an employer-stock sell-down plan',
        detail: `${pctStr} — set a target and a quarterly pace on the Guidance page, and the app tracks the rest.`,
        nav: 'guidance',
        urgent: (candidate?.weightPct || 0) > 15 || conc?.severity === 'error',
      });
    }
  }

  // ── 2. PFIC swaps: one merged row (5 rows of the same problem is noise) ───
  if (swaps.length) {
    suppressGuidanceIds.add('pfic-grouped');
    for (const sw of swaps) suppressReplaceSymbols.add((sw.sell || '').toUpperCase());
    const pairs = swaps.slice(0, 3)
      .map(sw => `${sw.sell} → ${sw.buy || 'US equivalent'}`).join(', ');
    actions.push({
      kind: 'replace',
      title: swaps.length === 1
        ? `Replace ${swaps[0].sell} with ${swaps[0].buy || 'a US-domiciled equivalent'}`
        : `Replace ${swaps.length} foreign funds with US equivalents`,
      detail: `${swaps.length === 1 ? 'It’s' : `${pairs}${swaps.length > 3 ? ` and ${swaps.length - 3} more` : ''} — they’re`} foreign-domiciled (PFIC), which means punitive US tax and painful IRS forms. Swap, don’t add.`,
      nav: 'guidance',
      urgent: true,
    });
  }

  // ── 3. Per-holding Trim / Replace calls (minus what's covered above) ──────
  for (const h of holds) {
    const rec = h.recommendation;
    if (!rec) continue;
    const sym = (h.symbol || '').toUpperCase();
    if (rec.type === 'Trim' && !suppressTrimSymbols.has(sym)) {
      actions.push({
        kind: 'sell',
        title: `Trim your ${sym} position`,
        detail: rec.reason || 'Position is larger than your plan calls for.',
        symbol: sym,
        nav: 'portfolio',
        urgent: false,
      });
    } else if (rec.type === 'Replace' && !suppressReplaceSymbols.has(sym)) {
      actions.push({
        kind: 'replace',
        title: `Replace ${sym}`,
        detail: rec.reason || 'Better swapped for a US-domiciled equivalent.',
        symbol: sym,
        nav: 'guidance',
        urgent: false,
      });
    }
  }

  // ── 4. Buy ideas: top 3 cash-sized suggestions ────────────────────────────
  if (buys.length) {
    // The buys ARE the cash-deployment plan — no separate cash-drag lecture.
    suppressGuidanceIds.add('cash-drag');
    for (const r of buys.slice(0, 3)) {
      actions.push({
        kind: 'buy',
        title: `Buy ~$${r.suggestedUsd.toLocaleString('en-US')} of ${r.symbol}`,
        detail: `${r.name} — ${r.strategyReason}.`,
        amountUsd: r.suggestedUsd,
        symbol: r.symbol,
        nav: 'guidance',
        urgent: false,
      });
    }
    if (buys.length > 3) {
      actions.push({
        kind: 'buy',
        title: `${buys.length - 3} more buy idea${buys.length - 3 > 1 ? 's' : ''} on the Guidance page`,
        detail: 'Ranked by your allocation gaps and tax efficiency.',
        nav: 'guidance',
        urgent: false,
      });
    }
  }

  // ── 5. Remaining error/warning guidance as review rows ────────────────────
  for (const item of items) {
    if (item.severity !== 'error' && item.severity !== 'warning') continue;
    if (suppressGuidanceIds.has(item.id)) continue;
    actions.push({
      kind: 'review',
      title: item.title,
      detail: item.message,
      nav: 'guidance',
      urgent: item.severity === 'error',
    });
  }

  const overflow = Math.max(0, actions.length - MAX_ACTIONS);
  return { actions: actions.slice(0, MAX_ACTIONS), moreCount: overflow };
}

module.exports = { buildActionPlan, MAX_ACTIONS };
