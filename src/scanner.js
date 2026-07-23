'use strict';

// Shared, config-driven scanner renderer. One place that builds the tab bar +
// sortable table chrome for EVERY scanner page (Option Scanner, Investment
// Scanner, …). Change the markup or styling here and it carries over to all of
// them — that is the whole point.
//
// A scanner is just a config object:
//   createScanner(rootEl, {
//     tabs: [{ id, label, badge?, badgeStyle?, custom?(contentEl) }],
//     columns: [{ key, label, align?, sortable?, sortValue?(row), render(row) }],
//     getRows: (tabId) => row[],        // data provider, called on each render
//     onRowClick?: (row) => void,
//     emptyText?: string,
//     defaultSort?: { col, dir },       // col = column key, dir 'asc'|'desc'
//   })
// Returns { render, showTab, activeTab }.
//
// Renderer-only (no Node deps) so it loads as a plain <script> global.

(function (root) {
  function el(tag, cls, html) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    return e;
  }

  function createScanner(rootEl, config) {
    if (!rootEl) return null;
    const tabs = config.tabs || [];
    // Columns may be a single array (shared by all tabs) or a function of the
    // active tab id — so e.g. a Dividend tab can show a different grade column.
    const colsFor = (tabId) => (typeof config.columns === 'function' ? (config.columns(tabId) || []) : (config.columns || []));
    const state = {
      activeTab: (tabs[0] && tabs[0].id) || null,
      sort: config.defaultSort ? { ...config.defaultSort } : null,
    };

    rootEl.innerHTML = '';
    rootEl.classList.add('scanner-root');

    // ── Tab bar ────────────────────────────────────────────────────────────
    const tabBar = el('div', 'scanner-tabs');
    const tabButtons = {};
    tabs.forEach(t => {
      const btn = el('button', 'scanner-tab-btn', t.label + (t.badge
        ? ` <span class="scanner-tab-badge"${t.badgeStyle ? ` style="${t.badgeStyle}"` : ''}>${t.badge}</span>` : ''));
      btn.addEventListener('click', () => showTab(t.id));
      tabButtons[t.id] = btn;
      tabBar.appendChild(btn);
    });
    if (tabs.length > 1) rootEl.appendChild(tabBar);

    const content = el('div', 'scanner-content');
    rootEl.appendChild(content);

    // ── Sorting ──────────────────────────────────────────────────────────────
    function sortRows(rows) {
      if (!state.sort || !state.sort.col) return rows;
      const col = colsFor(state.activeTab).find(c => c.key === state.sort.col);
      if (!col) return rows;
      const val = row => (col.sortValue ? col.sortValue(row) : row[col.key]);
      const dir = state.sort.dir === 'asc' ? 1 : -1;
      return [...rows].sort((a, b) => {
        let av = val(a), bv = val(b);
        if (av == null) av = -Infinity;
        if (bv == null) bv = -Infinity;
        if (typeof av === 'string' || typeof bv === 'string') {
          av = String(av).toLowerCase(); bv = String(bv).toLowerCase();
        }
        if (av < bv) return -1 * dir;
        if (av > bv) return 1 * dir;
        return 0;
      });
    }

    function onHeaderClick(colKey) {
      if (state.sort && state.sort.col === colKey) {
        state.sort.dir = state.sort.dir === 'asc' ? 'desc' : 'asc';
      } else {
        state.sort = { col: colKey, dir: 'desc' }; // numbers usually read best desc-first
      }
      render();
    }

    // ── Table ─────────────────────────────────────────────────────────────────
    function buildTable(rows) {
      const columns = colsFor(state.activeTab);
      const wrap = el('div', 'table-wrapper scanner-table-wrapper');
      const table = el('table', 'data-table scanner-table');
      const thead = el('thead');
      const htr = el('tr');
      columns.forEach(c => {
        const th = el('th', null, c.label);
        if (c.align) th.style.textAlign = c.align;
        if (c.sortable) {
          th.classList.add('scanner-sortable');
          th.style.cursor = 'pointer';
          if (state.sort && state.sort.col === c.key) {
            th.classList.add('sorted');
            th.innerHTML = `${c.label} <span class="scanner-sort-arrow">${state.sort.dir === 'asc' ? '▲' : '▼'}</span>`;
          }
          th.addEventListener('click', () => onHeaderClick(c.key));
        }
        htr.appendChild(th);
      });
      thead.appendChild(htr);
      table.appendChild(thead);

      const tbody = el('tbody');
      if (!rows.length) {
        const tr = el('tr');
        const td = el('td', 'empty-row', config.emptyText || 'No results.');
        td.colSpan = columns.length;
        tr.appendChild(td);
        tbody.appendChild(tr);
      } else {
        rows.forEach(row => {
          const tr = el('tr', 'scanner-row');
          columns.forEach(c => {
            const td = el('td');
            if (c.align) td.style.textAlign = c.align;
            const out = c.render ? c.render(row) : row[c.key];
            if (out instanceof Node) td.appendChild(out); else td.innerHTML = out == null ? '' : String(out);
            tr.appendChild(td);
          });
          if (config.onRowClick) {
            tr.style.cursor = 'pointer';
            tr.addEventListener('click', () => config.onRowClick(row));
          }
          tbody.appendChild(tr);
        });
      }
      table.appendChild(tbody);
      wrap.appendChild(table);
      return wrap;
    }

    // ── Render ────────────────────────────────────────────────────────────────
    function render() {
      tabs.forEach(t => tabButtons[t.id] && tabButtons[t.id].classList.toggle('active', t.id === state.activeTab));
      const tab = tabs.find(t => t.id === state.activeTab) || tabs[0];
      content.innerHTML = '';
      if (!tab) return;
      if (typeof tab.custom === 'function') { tab.custom(content); return; }
      const rows = sortRows(config.getRows ? (config.getRows(tab.id) || []) : []);
      if (tab.intro) content.appendChild(el('div', 'scanner-intro', tab.intro));
      content.appendChild(buildTable(rows));
    }

    function showTab(id) {
      if (state.activeTab === id) { render(); return; }
      state.activeTab = id;
      // Reset sort to the tab's own default so switching tabs is predictable.
      state.sort = config.defaultSort ? { ...config.defaultSort } : null;
      render();
    }

    render();
    return {
      render,
      showTab,
      get activeTab() { return state.activeTab; },
    };
  }

  root.Scanner = { create: createScanner };
})(window);
