'use strict';

/**
 * chartaxis — the pure decisions behind a price chart.
 *
 * Two of them were wrong for a long time and both are invisible in code review
 * but glaring on screen:
 *
 *   • Axis precision was hardcoded to whole dollars, so a fund trading in a
 *     $49.50–$50.30 band drew five identical "$50" labels. Precision has to come
 *     from the SPAN of the data, not the size of the numbers.
 *
 *   • The series used the raw close. On any dividend payer the ex-dividend date
 *     draws as a cliff — VTIP's 2026-07-01 distribution of $0.68 rendered as a
 *     1.4% overnight crash. For an app built around dividend-paying holdings
 *     that disfigures precisely the instruments it cares most about, so the
 *     adjusted close (total return) is the right series.
 *
 * Pure. UMD so the renderer and node tests share one implementation.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root) root.chartAxis = api;
})(typeof window !== 'undefined' ? window : null, function () {

  function num(v) { return typeof v === 'number' && isFinite(v) ? v : null; }

  /**
   * Decimal places for an axis tick, chosen so adjacent ticks can never render
   * identically. Driven by the span the chart actually covers.
   */
  function axisDecimals(min, max) {
    const lo = num(min), hi = num(max);
    if (lo == null || hi == null) return 2;
    const span = Math.abs(hi - lo);
    if (span === 0) return 2;
    if (span < 2) return 2;      // e.g. 49.50 → 50.30: needs cents
    if (span < 25) return 1;     // e.g. 180 → 197: one decimal separates ticks
    return 0;                    // e.g. 400 → 900: whole units are plenty
  }

  /**
   * Normalize a history array into the series the chart should draw.
   * Prefers the adjusted close so distributions don't read as price collapses,
   * and reports whether any adjustment was actually applied so the UI can say so.
   */
  function priceSeries(history) {
    const rows = Array.isArray(history) ? history : [];
    const points = [];
    let adjusted = false;
    for (const h of rows) {
      if (!h) continue;
      const close = num(h.close);
      const adj = num(h.adjClose);
      const value = adj != null ? adj : close;
      if (value == null) continue;
      if (adj != null && close != null && Math.abs(adj - close) > 0.005) adjusted = true;
      points.push({ date: h.date, value });
    }
    const values = points.map(p => p.value);
    const min = values.length ? Math.min(...values) : null;
    const max = values.length ? Math.max(...values) : null;
    return {
      points, values,
      labels: points.map(p => p.date),
      min, max,
      decimals: axisDecimals(min, max),
      adjusted,
      changePct: values.length > 1 && values[0] !== 0
        ? ((values[values.length - 1] - values[0]) / values[0]) * 100
        : null,
    };
  }

  /** "24 Jun 2026" from an ISO date, left alone if it isn't one. */
  function formatDateLabel(iso) {
    const s = String(iso || '');
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
    if (!m) return s;
    const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}`;
  }

  return { axisDecimals, priceSeries, formatDateLabel };
});
