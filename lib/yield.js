'use strict';

// Single source of truth for "what is this security's dividend yield, in
// percent?" — because Yahoo's three dividend fields disagree with each other,
// and for some symbols are outright wrong.
//
// Observed (2026-07-24, live quotes):
//   O    price 64.72  rate 3.234  trailingAnnualDividendYield 0.0497   dividendYield 5
//   JNJ  price 259.27 rate 5.24   trailingAnnualDividendYield 0.0205   dividendYield 2.07
//   VTI  price 364.69 rate 2.802  trailingAnnualDividendYield 0.0076   dividendYield 1.05
//   MFG  price 10.57  rate 145    trailingAnnualDividendYield 13.8095  dividendYield 1.75
//
// MFG (Mizuho, a Japanese ADR) is the trap: `rate` is 145 **JPY** — the local
// dividend — divided by a **USD** ADR price, so Yahoo's own ratio (13.81) is
// currency-mismatched garbage. Treating it as a fraction and ×100 produced the
// nonsense 1380.95% yield. `dividendYield` (1.75) is the sane figure.
//
// Strategy: prefer the field that is already a percent and most consistently
// populated (`dividendYield`), then the fraction field normalized by magnitude,
// then rate/price — taking the FIRST candidate that is physically plausible.

// A yield above this is treated as a data error, not a real distribution.
// Generous enough for covered-call ETFs / CEFs (JEPQ ~9-12%).
const MAX_PLAUSIBLE_YIELD_PCT = 60;

function num(v) {
  const n = typeof v === 'number' ? v : parseFloat(v);
  return Number.isFinite(n) ? n : null;
}

// `fallback` is returned verbatim when nothing usable is found — pass null to
// distinguish "unknown" from a genuine 0% (non-payer); defaults to 0.
function dividendYieldPct(quote, fallback = 0) {
  if (quote) {
    const candidates = [];

    // 1. dividendYield — Yahoo reports this already in percent (5 = 5%) and
    //    populates it most consistently, including for ADRs where the other
    //    fields are computed from mismatched currencies.
    const dy = num(quote.dividendYield);
    if (dy > 0) candidates.push(dy);

    // 2. trailingAnnualDividendYield — a FRACTION on normal US listings
    //    (0.0497 = 4.97%). When it arrives >= 1 it is not a fraction at all but
    //    a raw (often currency-mismatched) ratio, so never scale those up.
    const tay = num(quote.trailingAnnualDividendYield);
    if (tay > 0) candidates.push(tay < 1 ? tay * 100 : tay);

    // 3. rate / price — only meaningful when both are the same currency, which
    //    we cannot verify; last resort, and still plausibility-checked.
    const rate = num(quote.trailingAnnualDividendRate);
    const price = num(quote.regularMarketPrice);
    if (rate > 0 && price > 0) candidates.push((rate / price) * 100);

    const usable = candidates.find(v => v > 0 && v <= MAX_PLAUSIBLE_YIELD_PCT);
    if (usable != null) return usable;
  }
  return fallback;
}

module.exports = { dividendYieldPct, MAX_PLAUSIBLE_YIELD_PCT };
