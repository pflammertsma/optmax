// src/glossary.js — Centralized Glossary Registry & Interactive Modal Controller

const GLOSSARY_TERMS = {
  'scan-interval': {
    id: 'scan-interval',
    term: 'Opportunity Scan Interval',
    category: 'Options & Scoring',
    short: 'Frequency for automatic full options watchlist scanning.',
    definition: `
      <p>The <strong>Opportunity Scan Interval</strong> controls how frequently PortMax automatically evaluates your tracked options watchlist against current market data to identify new covered call or cash-secured put opportunities.</p>
      <p>When the interval elapses, PortMax scans active option chains for your watchlist tickers, evaluating implied volatility, bid-ask spreads, earnings dates, and strike delta ranges.</p>
    `,
    related: ['options-scoring', 'kill-switches', 'delta-range']
  },
  'min-otm-margin': {
    id: 'min-otm-margin',
    term: 'Minimum OTM Margin',
    category: 'Options & Scoring',
    short: 'Filter for put options where strike is at least X% below current stock price for downside protection.',
    definition: `
      <p>The <strong>Minimum Out-Of-The-Money (OTM) Margin</strong> defines the minimum percentage gap required between the current stock price and the option's strike price.</p>
      <p>For example, a 5% OTM margin on a $100 stock filters for put options with strikes of $95 or lower. This provides downside margin of safety before option assignment is triggered.</p>
    `,
    related: ['delta-range', 'options-scoring']
  },
  'price-refresh-frequency': {
    id: 'price-refresh-frequency',
    term: 'Price Update Frequency',
    category: 'IBKR & Gateway',
    short: 'Frequency for automatic underlying stock price updates.',
    definition: `
      <p>The <strong>Price Update Frequency</strong> specifies how often PortMax fetches current stock quotes from Interactive Brokers or market data APIs for your tracked holdings and watchlist stocks.</p>
      <p>Frequent updates keep portfolio valuations, concentration ratios, and options strike metrics aligned with live market prices without performing full option chain scans.</p>
    `,
    related: ['ibkr-gateway', 'scan-interval']
  },
  'options-scoring': {
    id: 'options-scoring',
    term: 'Scoring Engine & Grade Thresholds',
    category: 'Options & Scoring',
    short: '100-point scoring algorithm grading option trades from A to E.',
    definition: `
      <p>PortMax scores options opportunities on a <strong>100-point scale</strong> combining annual yield potential, downside delta safety, liquidity (bid-ask spread), volatility rank, and earnings proximity.</p>
      <p>Candidates are assigned grades:
        <ul>
          <li><strong>Grade A</strong>: Exceptional yield &amp; safety profile.</li>
          <li><strong>Grade B</strong>: Strong risk-reward candidate.</li>
          <li><strong>Grade C</strong>: Average candidate meeting minimum criteria.</li>
          <li><strong>Grade D</strong>: Higher risk or lower margin of safety.</li>
          <li><strong>Grade E</strong>: Marginal trade quality.</li>
        </ul>
      </p>
    `,
    related: ['kill-switches', 'yield-targets', 'delta-range']
  },
  'kill-switches': {
    id: 'kill-switches',
    term: 'Kill Switches',
    category: 'Options & Scoring',
    short: 'Hard filters that automatically disqualify options candidates regardless of total score.',
    definition: `
      <p><strong>Kill Switches</strong> are strict safety constraints that instantly reject an option opportunity regardless of how high its yield or technical score might be.</p>
      <p>PortMax supports three primary kill switches:
        <ul>
          <li><strong>Earnings Proximity</strong>: Rejects trades where quarterly earnings fall inside the option expiration window (high gap risk).</li>
          <li><strong>Bid-Ask Spread Limit</strong>: Rejects illiquid option contracts with wide spreads (&gt; $0.50).</li>
          <li><strong>Extreme Volatility (IV &gt; 80%)</strong>: Rejects options with hyper-inflated IV indicating distressed assets or impending corporate actions.</li>
        </ul>
      </p>
    `,
    related: ['options-scoring', 'delta-range']
  },
  'yield-targets': {
    id: 'yield-targets',
    term: 'Yield Targets',
    category: 'Options & Scoring',
    short: 'Monthly premium yield target relative to cash risk and calculated annual auto rate.',
    definition: `
      <p><strong>Yield Targets</strong> specify the desired monthly option premium yield on collateralized capital.</p>
      <p>A monthly target of <strong>1.0%</strong> translates automatically to a <strong>12.0% annual auto yield</strong>. Option candidates yielding below your monthly target receive reduced scoring weight.</p>
    `,
    related: ['options-scoring', 'delta-range']
  },
  'delta-range': {
    id: 'delta-range',
    term: 'Preferred Delta Range',
    category: 'Options & Scoring',
    short: 'Target put option delta range (typically 0.25 to 0.35).',
    definition: `
      <p><strong>Option Delta</strong> measures the rate of change of the option's price relative to the underlying stock. For put sellers, delta serves as an approximate proxy for probability of in-the-money expiration.</p>
      <p>The standard preferred range of <strong>0.25 to 0.35 delta</strong> strikes an optimal balance between collecting meaningful premium and maintaining a 65–75% probability of expiring worthless.</p>
    `,
    related: ['options-scoring', 'yield-targets', 'min-otm-margin']
  },
  'glidepath': {
    id: 'glidepath',
    term: 'Retirement Glidepath Base',
    category: 'Portfolio Architecture',
    short: 'Formula: target_equity % = Base - Age. Standard base is 110. Automatically shifts asset mix from equities to defensive assets as you age.',
    definition: `
      <p>The <strong>Retirement Glidepath</strong> automatically adjusts your target stock vs. bond/cash allocation as you age to reduce drawdown risk closer to retirement.</p>
      <p>PortMax uses the formula: <code>Target Equity % = Glidepath Base - Age</code>. With a standard base of 110 and an age of 40, your recommended allocation is 70% equities and 30% defensive assets (bonds/cash).</p>
    `,
    related: ['cash-drag', 'concentration-limit']
  },
  'cash-drag': {
    id: 'cash-drag',
    term: 'Cash Drag Buffer',
    category: 'Portfolio Architecture',
    short: 'Fires alert if uninvested cash exceeds this buffer and represents >10% of portfolio value.',
    definition: `
      <p><strong>Cash Drag</strong> occurs when excessive uninvested cash sits idle in your portfolio, eroding purchasing power due to inflation and missing out on compound growth.</p>
      <p>The Cash Drag Buffer sets the dollar floor (e.g. $5,000) for operational liquidity. Cash above this buffer that exceeds 10% of portfolio NAV triggers rebalancing alerts and Tax-Smart Buy Ideas.</p>
    `,
    related: ['glidepath', 'dividend-tax']
  },
  'concentration-limit': {
    id: 'concentration-limit',
    term: 'Concentration Limit',
    category: 'Portfolio Architecture',
    short: 'Maximum single-stock holding percentage before triggering concentration warnings and Trim recommendations. Critical alert triggers at 1.5x.',
    definition: `
      <p>The <strong>Concentration Limit</strong> enforces single-stock risk limits to protect your portfolio against company-specific catastrophic risk.</p>
      <p>When a single position exceeds your target threshold (e.g. 10% of portfolio value), PortMax flags a concentration warning. When it exceeds 1.5x the limit (15%), a critical Trim alert is issued along with a quarterly sell-down schedule.</p>
    `,
    related: ['employer-tickers', 'glidepath']
  },
  'employer-tickers': {
    id: 'employer-tickers',
    term: 'Employer Stock Exposure',
    category: 'Portfolio Architecture',
    short: 'Comma-separated list of stock tickers received from your employer, used to track total employer exposure.',
    definition: `
      <p><strong>Employer Stock Exposure</strong> aggregates both direct shares of your employer's stock and indirect exposure held inside broad equity index funds (e.g. S&P 500 ETFs).</p>
      <p>Holding substantial equity in your employer creates double risk: your income and your investment portfolio are tied to the same company. PortMax caps health scores if total employer exposure exceeds 25%.</p>
    `,
    related: ['concentration-limit', 'glidepath']
  },
  'dividend-tax': {
    id: 'dividend-tax',
    term: 'Effective Dividend Tax Rate',
    category: 'Tax & Expat Rules',
    short: 'Your combined effective rate on dividend income (Swiss tax + US qualified rate interplay). Ranks buy ideas by annual tax drag.',
    definition: `
      <p>The <strong>Effective Dividend Tax Rate</strong> accounts for dividend taxation across your tax residency (e.g. Swiss ordinary income tax) and source withholding (e.g. US 15–30% dividend tax).</p>
      <p>PortMax computes the annual dividend tax drag (<code>Yield × Dividend Tax Rate</code>) on buy candidates to prioritize tax-efficient growth ETFs over high-drag income funds.</p>
    `,
    related: ['pfic', 'us-tax-person']
  },
  'ibkr-gateway': {
    id: 'ibkr-gateway',
    term: 'IBKR Client Portal Gateway',
    category: 'IBKR & Gateway',
    short: 'Client Portal Gateway setup and secure local OS credential manager.',
    definition: `
      <p>The <strong>Interactive Brokers Client Portal Gateway</strong> is a lightweight local REST API server provided by IBKR for connecting third-party tools like PortMax to your brokerage account.</p>
      <p>PortMax manages gateway startup, connection health checks, and secure credential storage via native OS vaults (Windows Credential Manager / macOS Keychain).</p>
    `,
    related: ['price-refresh-frequency']
  },
  'pfic': {
    id: 'pfic',
    term: 'Passive Foreign Investment Company (PFIC)',
    category: 'Tax & Expat Rules',
    short: 'Passive Foreign Investment Company. Any fund registered outside the United States. Only US persons are hit by these punitive rules.',
    definition: `
      <p>A <strong>PFIC</strong> is any non-US registered mutual fund or ETF (such as European UCITS ETFs domiciled in Ireland, Luxembourg, or Switzerland).</p>
      <p>Under US tax law (IRS §1291), US citizens and Green Card holders holding PFICs face punitive ordinary income taxation at top marginal rates plus compound interest penalties on unrealized gains. PortMax flags non-US funds and provides US-domiciled ETF replacement ideas.</p>
    `,
    related: ['us-tax-person', 'pfic-estimator']
  },
  'pfic-estimator': {
    id: 'pfic-estimator',
    term: 'PFIC Exit-Cost Estimator',
    category: 'Tax & Expat Rules',
    short: 'Estimates §1291 punitive tax and compound interest on non-US domiciled funds for US taxpayers.',
    definition: `
      <p>The <strong>PFIC Exit-Cost Estimator</strong> models the tax liabilities and compound interest penalties of selling non-US domiciled fund positions under IRS §1291 rules.</p>
      <p>Parameters include:
        <ul>
          <li><strong>US Filing Status &amp; Marginal Rate</strong>: Top tax rate applied to current-year gain slices.</li>
          <li><strong>IRS Underpayment Interest</strong>: Annual interest rate (typically 7–8%) compounded over prior tax years.</li>
          <li><strong>Holding Period</strong>: Years held to compute per-year gain allocation.</li>
        </ul>
      </p>
    `,
    related: ['pfic', 'us-tax-person', 'capital-gains']
  },
  'us-tax-person': {
    id: 'us-tax-person',
    term: 'US Tax Person & Green Card Status',
    category: 'Tax & Expat Rules',
    short: 'Green-card holders and US citizens are taxed like US citizens even while residing abroad.',
    definition: `
      <p>Under US citizenship-based taxation, <strong>US Citizens</strong> and <strong>US Green Card Holders</strong> are subject to full US federal tax reporting regardless of where they live or earn income.</p>
      <p>This triggers US expat rules including PFIC foreign fund restrictions, FBAR reporting, and US capital gains tax on global asset sales.</p>
    `,
    related: ['pfic', 'pfic-estimator', 'capital-gains']
  },
  'capital-gains': {
    id: 'capital-gains',
    term: 'Capital Gains Taxation',
    category: 'Tax & Expat Rules',
    short: 'Tax on profit when selling assets. Swiss residents enjoy 0% capital gains tax on private assets, while US persons owe US capital gains tax.',
    definition: `
      <p><strong>Capital Gains Taxation</strong> applies to realized profits when selling securities.</p>
      <p>While Swiss tax law exempts private investors from capital gains tax (0% tax on stock sales), US tax persons remain liable for US federal capital gains tax (up to 20% long-term / 37% short-term) on international sales.</p>
    `,
    related: ['us-tax-person', 'pfic-estimator']
  }
};

class GlossaryController {
  constructor() {
    this.modalEl = null;
    this.searchTerm = '';
    this.activeCategory = 'ALL';
    this.currentTermId = null;
  }

  init() {
    this.modalEl = document.getElementById('glossary-modal-overlay');
    if (!this.modalEl) return;

    this.bindEvents();
  }

  bindEvents() {
    // Global delegation for [data-glossary] click elements
    document.body.addEventListener('click', (e) => {
      const trigger = e.target.closest('[data-glossary]');
      if (trigger) {
        e.preventDefault();
        e.stopPropagation();
        const termId = trigger.getAttribute('data-glossary');
        this.open(termId);
      }
    });

    // Modal close handlers
    const closeBtn = document.getElementById('glossary-modal-close');
    if (closeBtn) closeBtn.addEventListener('click', () => this.close());

    if (this.modalEl) {
      this.modalEl.addEventListener('click', (e) => {
        if (e.target === this.modalEl) this.close();
      });
    }

    // Search bar listener
    const searchInput = document.getElementById('glossary-search-input');
    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        this.searchTerm = e.target.value.toLowerCase().trim();
        this.renderSidebar();
      });
    }

    // Category Filter buttons
    const catContainer = document.getElementById('glossary-categories');
    if (catContainer) {
      catContainer.addEventListener('click', (e) => {
        const btn = e.target.closest('.tab-btn');
        if (btn && btn.dataset.category) {
          catContainer.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          this.activeCategory = btn.dataset.category;
          this.renderSidebar();
        }
      });
    }
  }

  open(termId = null) {
    if (!this.modalEl) return;
    this.modalEl.classList.remove('hidden');

    if (termId && GLOSSARY_TERMS[termId]) {
      this.selectTerm(termId);
    } else if (!this.currentTermId) {
      const firstKey = Object.keys(GLOSSARY_TERMS)[0];
      this.selectTerm(firstKey);
    }
  }

  close() {
    if (this.modalEl) this.modalEl.classList.add('hidden');
  }

  selectTerm(termId) {
    if (!GLOSSARY_TERMS[termId]) return;
    this.currentTermId = termId;

    this.renderSidebar();
    this.renderDetail(termId);
  }

  renderSidebar() {
    const listEl = document.getElementById('glossary-term-list');
    if (!listEl) return;

    const terms = Object.values(GLOSSARY_TERMS).filter(item => {
      const matchesCat = this.activeCategory === 'ALL' || item.category === this.activeCategory;
      const matchesSearch = !this.searchTerm ||
        item.term.toLowerCase().includes(this.searchTerm) ||
        item.short.toLowerCase().includes(this.searchTerm) ||
        item.category.toLowerCase().includes(this.searchTerm);
      return matchesCat && matchesSearch;
    });

    if (terms.length === 0) {
      listEl.innerHTML = `<div style="padding:16px; font-size:12px; color:var(--text-muted); text-align:center;">No matching terms found.</div>`;
      return;
    }

    listEl.innerHTML = terms.map(item => `
      <button class="glossary-item-btn ${item.id === this.currentTermId ? 'active' : ''}" data-id="${item.id}">
        <span class="glossary-item-title">${item.term}</span>
        <span class="glossary-item-cat">${item.category}</span>
      </button>
    `).join('');

    listEl.querySelectorAll('.glossary-item-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        this.selectTerm(btn.dataset.id);
      });
    });
  }

  renderDetail(termId) {
    const detailEl = document.getElementById('glossary-detail-content');
    if (!detailEl) return;

    const item = GLOSSARY_TERMS[termId];
    if (!item) return;

    const relatedHtml = (item.related || []).map(relId => {
      const relItem = GLOSSARY_TERMS[relId];
      if (!relItem) return '';
      return `<button class="related-term-pill" data-glossary="${relItem.id}">${relItem.term} →</button>`;
    }).filter(Boolean).join(' ');

    detailEl.innerHTML = `
      <div class="glossary-detail-header">
        <span class="glossary-cat-badge">${item.category}</span>
        <h2 class="glossary-detail-title">${item.term}</h2>
      </div>

      <div class="glossary-detail-body">
        ${item.definition}
      </div>

      ${relatedHtml ? `
        <div class="glossary-related-section">
          <span class="glossary-related-label">Related Terms:</span>
          <div class="glossary-related-pills">${relatedHtml}</div>
        </div>
      ` : ''}
    `;
  }
}

// Global singleton instance
window.glossaryController = new GlossaryController();

document.addEventListener('DOMContentLoaded', () => {
  window.glossaryController.init();
});
