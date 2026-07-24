'use strict';

// ─── DOM Shortcut ─────────────────────────────────────────────────────────────
function el(id) { return document.getElementById(id); }

// ─── General Format Helpers ───────────────────────────────────────────────────
const fmt = {
  currency: v => v == null ? '—' : `<span class="privacy-amount">$${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>`,
  pct:      v => v == null ? '—' : v.toFixed(2) + '%',
  num:      v => v == null ? '—' : v.toLocaleString('en-US'),
  mktcap:   v => {
    if (v == null || v <= 0) return '—';
    let val;
    if (v >= 1e12) val = '$' + (v / 1e12).toFixed(2) + 'T';
    else if (v >= 1e9)  val = '$' + (v / 1e9).toFixed(2) + 'B';
    else if (v >= 1e6)  val = '$' + (v / 1e6).toFixed(2) + 'M';
    else val = '$' + v.toLocaleString('en-US');
    return `<span class="privacy-amount">${val}</span>`;
  }
};

// Avoids "-0.00%" from float dust
function pfPct(v) {
  if (v == null) return '—';
  return fmt.pct(Math.abs(v) < 0.005 ? 0 : v);
}

function pfSignedCurrency(v) {
  if (v == null) return '—';
  const val = '$' + Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const raw = v < 0 ? `-${val}` : val;
  const color = v < 0 ? 'var(--red)' : 'var(--green)';
  return `<span class="privacy-amount" style="color:${color}">${raw}</span>`;
}

function pfSignedPct(v) {
  if (v == null) return '—';
  const color = v < 0 ? 'var(--red)' : 'var(--green)';
  return `<span style="color:${color}">${v >= 0 ? '+' : ''}${v.toFixed(2)}%</span>`;
}

const fmtDate = iso => iso ? new Date(iso).toLocaleDateString('en-US', DATE_FMT) : '—';
const fmtTime = iso => iso ? new Date(iso).toLocaleString('en-US', TIME_FMT) : '—';

// ─── Grade & Badge Helpers ────────────────────────────────────────────────────
function gradeColor(grade) {
  return { A: 'var(--green)', B: '#14b8a6', C: '#f59e0b', D: '#f97316', E: 'var(--red)', F: 'var(--text-muted)' }[grade] || 'var(--text-muted)';
}

function renderGradeBadge(grade) {
  return `<span class="grade-badge grade-badge-${grade}">${grade}</span>`;
}

function renderRecommendationBadge(rec) {
  if (rec === 'Buy') {
    return `<span style="color: var(--green); background: rgba(16, 185, 129, 0.12); border: 1px solid rgba(16, 185, 129, 0.25); border-radius: 4px; padding: 2px 6px; font-size: 11px; font-weight: 600; text-transform: uppercase;">Buy</span>`;
  }
  if (rec === 'Trim') {
    return `<span style="color: #f59e0b; background: rgba(245, 158, 11, 0.12); border: 1px solid rgba(245, 158, 11, 0.25); border-radius: 4px; padding: 2px 6px; font-size: 11px; font-weight: 600; text-transform: uppercase;">Trim</span>`;
  }
  if (rec === 'Hold') {
    return `<span style="color: var(--text-secondary); background: rgba(255, 255, 255, 0.04); border: 1px solid rgba(255, 255, 255, 0.08); border-radius: 4px; padding: 2px 6px; font-size: 11px; font-weight: 600; text-transform: uppercase;">Hold</span>`;
  }
  if (rec === 'Write Call') {
    return `<span style="color: var(--cyan); background: rgba(6, 182, 212, 0.12); border: 1px solid rgba(6, 182, 212, 0.25); border-radius: 4px; padding: 2px 6px; font-size: 11px; font-weight: 600; text-transform: uppercase; white-space: nowrap;">Write Call</span>`;
  }
  if (rec === 'Replace') {
    return `<span style="color: #f43f5e; background: rgba(244, 63, 94, 0.12); border: 1px solid rgba(244, 63, 94, 0.25); border-radius: 4px; padding: 2px 6px; font-size: 11px; font-weight: 600; text-transform: uppercase;">Replace</span>`;
  }
  return `<span style="color: var(--text-muted); font-size: 11px;">—</span>`;
}

function renderScoreBar(score, grade) {
  const color = gradeColor(grade);
  return `<div class="score-bar-track"><div class="score-bar-fill" style="width:${score}%;background:${color}"></div></div>`;
}
