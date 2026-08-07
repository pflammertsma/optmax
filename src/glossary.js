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
  },
  'nav': {
    id: 'nav',
    term: 'Net Asset Value (NAV)',
    category: 'Portfolio Architecture',
    short: 'The total value of all your cash and holdings minus liabilities.',
    definition: `
      <p><strong>Net Asset Value (NAV)</strong> represents the total net dollar value of your entire investment portfolio, combining cash reserves and market value of equity holdings.</p>
    `,
    related: ['glidepath', 'cash-drag']
  },
  'covered-call': {
    id: 'covered-call',
    term: 'Covered Call',
    category: 'Options & Scoring',
    short: 'An options strategy where you sell call options against stock shares you already own to generate income.',
    definition: `
      <p>A <strong>Covered Call</strong> involves selling a call option contract against 100 shares of underlying stock you already hold in your portfolio to collect premium yield.</p>
    `,
    related: ['cash-secured-put', 'options-scoring', 'yield-targets']
  },
  'cash-secured-put': {
    id: 'cash-secured-put',
    term: 'Cash-Secured Put (CSP)',
    category: 'Options & Scoring',
    short: 'An options strategy where you sell put options while setting aside cash to buy the stock if assigned.',
    definition: `
      <p>A <strong>Cash-Secured Put</strong> involves selling a put option while reserving 100% of the cash required to purchase the underlying stock at the strike price if assigned.</p>
    `,
    related: ['covered-call', 'delta-range', 'collateral']
  },
  'implied-volatility': {
    id: 'implied-volatility',
    term: 'Implied Volatility (IV)',
    category: 'Options & Scoring',
    short: 'The market\'s forecast of a stock\'s price fluctuation, directly determining option premium prices.',
    definition: `
      <p><strong>Implied Volatility (IV)</strong> reflects the options market\'s expected price movement for the underlying security over the life of the contract.</p>
    `,
    related: ['kill-switches', 'options-scoring']
  },
  'bid-ask-spread': {
    id: 'bid-ask-spread',
    term: 'Bid-Ask Spread',
    category: 'Options & Scoring',
    short: 'The gap between the highest price a buyer pays (bid) and the lowest price a seller accepts (ask).',
    definition: `
      <p>The <strong>Bid-Ask Spread</strong> measures liquidity in option contracts. Wide spreads increase execution slippage and lower effective trade quality.</p>
    `,
    related: ['kill-switches', 'options-scoring']
  },
  'delta': {
    id: 'delta',
    term: 'Option Delta',
    category: 'Options & Scoring',
    short: 'Measures how much an option price moves per $1 stock price change and estimates expiration probability.',
    definition: `
      <p><strong>Option Delta</strong> measures price sensitivity relative to the underlying stock and serves as an approximate proxy for probability of expiring in-the-money.</p>
    `,
    related: ['delta-range', 'theta']
  },
  'theta': {
    id: 'theta',
    term: 'Option Theta (Time Decay)',
    category: 'Options & Scoring',
    short: 'The rate at which an option\'s premium value decays each day as expiration approaches.',
    definition: `
      <p><strong>Theta</strong> represents daily time decay. As an option seller, theta works in your favor as option value erodes toward expiration.</p>
    `,
    related: ['delta', 'dte']
  },
  'dte': {
    id: 'dte',
    term: 'Days to Expiration (DTE)',
    category: 'Options & Scoring',
    short: 'The number of days remaining until an option contract expires.',
    definition: `
      <p><strong>Days to Expiration (DTE)</strong> is the remaining lifespan of an option contract, governing time decay rate and earnings exposure.</p>
    `,
    related: ['theta', 'scan-interval']
  },
  'otm': {
    id: 'otm',
    term: 'Out-Of-The-Money (OTM)',
    category: 'Options & Scoring',
    short: 'An option with no intrinsic value, providing a safety buffer before assignment.',
    definition: `
      <p>An <strong>Out-Of-The-Money (OTM)</strong> option strike price is favorable compared to current stock price, providing a downside margin of safety.</p>
    `,
    related: ['min-otm-margin', 'itm']
  },
  'itm': {
    id: 'itm',
    term: 'In-The-Money (ITM)',
    category: 'Options & Scoring',
    short: 'An option that has intrinsic value and carries assignment risk.',
    definition: `
      <p>An <strong>In-The-Money (ITM)</strong> option has crossed its strike price, creating intrinsic value and high probability of assignment.</p>
    `,
    related: ['otm', 'option-assignment']
  },
  'annualized-yield': {
    id: 'annualized-yield',
    term: 'Annualized Premium Yield (APY)',
    category: 'Options & Scoring',
    short: 'The extrapolated annual return rate generated from option premiums.',
    definition: `
      <p><strong>Annualized Premium Yield (APY)</strong> normalizes option return across different expirations into a standardized annual return metric.</p>
    `,
    related: ['yield-targets', 'options-scoring']
  },
  'sharpe-ratio': {
    id: 'sharpe-ratio',
    term: 'Sharpe Ratio',
    category: 'Portfolio Architecture',
    short: 'Measures risk-adjusted performance by comparing portfolio return to risk-free rate per unit of volatility.',
    definition: `
      <p>The <strong>Sharpe Ratio</strong> evaluates how effectively your portfolio return compensates for taking market volatility risk.</p>
    `,
    related: ['max-drawdown', 'glidepath']
  },
  'max-drawdown': {
    id: 'max-drawdown',
    term: 'Maximum Drawdown',
    category: 'Portfolio Architecture',
    short: 'The peak-to-trough percentage decline observed in portfolio value before a new peak.',
    definition: `
      <p><strong>Maximum Drawdown</strong> measures severe historical portfolio decline to assess downside tail risk during market shocks.</p>
    `,
    related: ['sharpe-ratio', 'concentration-limit']
  },
  'tax-drag': {
    id: 'tax-drag',
    term: 'Annual Tax Drag',
    category: 'Tax & Expat Rules',
    short: 'The annual performance loss resulting from taxes on dividends and capital distributions.',
    definition: `
      <p><strong>Tax Drag</strong> quantifies compounding growth lost every year to dividend tax and non-resident withholding tax.</p>
    `,
    related: ['dividend-tax', 'pfic']
  },
  'ucits': {
    id: 'ucits',
    term: 'UCITS Funds',
    category: 'Tax & Expat Rules',
    short: 'European domiciled funds (Ireland, Luxembourg) that trigger severe US PFIC tax penalties for US persons.',
    definition: `
      <p><strong>UCITS</strong> funds are EU-regulated investment funds. For US taxpayers, holding UCITS ETFs triggers onerous IRS §1291 PFIC tax rules.</p>
    `,
    related: ['pfic', 'us-tax-person']
  },
  'fbar': {
    id: 'fbar',
    term: 'Foreign Bank Account Report (FBAR)',
    category: 'Tax & Expat Rules',
    short: 'FinCEN reporting required for US persons holding non-US financial accounts exceeding $10,000 in aggregate.',
    definition: `
      <p><strong>FBAR (FinCEN Form 114)</strong> requires US citizens and green card holders to report foreign financial accounts annually.</p>
    `,
    related: ['us-tax-person', 'pfic']
  },
  'option-assignment': {
    id: 'option-assignment',
    term: 'Option Assignment',
    category: 'Options & Scoring',
    short: 'The fulfillment process where a put seller is required to purchase 100 shares at the strike price.',
    definition: `
      <p><strong>Option Assignment</strong> occurs when an option buyer exercises their contract, requiring the seller to buy or sell the underlying shares.</p>
    `,
    related: ['cash-secured-put', 'covered-call', 'collateral']
  },
  'collateral': {
    id: 'collateral',
    term: 'Option Collateral',
    category: 'Options & Scoring',
    short: 'The cash or stock equity reserved to cover potential assignment liabilities.',
    definition: `
      <p><strong>Option Collateral</strong> is the cash required to secure sold put contracts or shares required for covered calls.</p>
    `,
    related: ['cash-secured-put', 'covered-call']
  },
  'unrealized-pnl': {
    id: 'unrealized-pnl',
    term: 'Unrealized P&L',
    category: 'Portfolio Architecture',
    short: 'Paper profit or loss on active positions that have not yet been sold.',
    definition: `
      <p><strong>Unrealized Profit &amp; Loss</strong> reflects paper gains or losses based on current market prices before closing a trade.</p>
    `,
    related: ['realized-pnl', 'capital-gains']
  },
  'realized-pnl': {
    id: 'realized-pnl',
    term: 'Realized P&L',
    category: 'Portfolio Architecture',
    short: 'Actual profit or loss locked in after closing or selling a position.',
    definition: `
      <p><strong>Realized Profit &amp; Loss</strong> is the net gain or loss locked in upon closing or settling an asset position.</p>
    `,
    related: ['unrealized-pnl', 'capital-gains']
  },
  'asset-allocation': {
    id: 'asset-allocation',
    term: 'Asset Allocation',
    category: 'Portfolio Architecture',
    short: 'The distribution of portfolio capital across equities, fixed income, and defensive cash reserves.',
    definition: `
      <p><strong>Asset Allocation</strong> balances risk and reward by adjusting asset proportions according to financial goals and horizon.</p>
    `,
    related: ['glidepath', 'cash-drag']
  },
  'margin-of-safety': {
    id: 'margin-of-safety',
    term: 'Margin of Safety',
    category: 'Options & Scoring',
    short: 'The percentage buffer between current stock price and option strike price to cushion against market drops.',
    definition: `
      <p><strong>Margin of Safety</strong> provides a downside buffer protecting against market declines before option assignment is triggered.</p>
    `,
    related: ['min-otm-margin', 'otm']
  },
  'core-bucket': {
    id: 'core-bucket',
    term: 'Core Bucket',
    category: 'Portfolio Architecture',
    short: 'Broad index funds (e.g. VTI, VEA) forming the low-cost, diversified foundation of your portfolio.',
    definition: `
      <p>The <strong>Core Bucket</strong> consists of broad-market equity and fixed-income index ETFs (such as total market or S&P 500 funds) designed to capture long-term compounding growth with low expense ratios.</p>
    `,
    related: ['satellite-bucket', 'cash-bucket', 'asset-allocation']
  },
  'satellite-bucket': {
    id: 'satellite-bucket',
    term: 'Satellite Bucket',
    category: 'Portfolio Architecture',
    short: 'Individual stock picks and options income trades designed for tactical outperformance.',
    definition: `
      <p>The <strong>Satellite Bucket</strong> contains opportunistic holdings such as individual equities, options income strategies (covered calls, cash-secured puts), or sector bets surrounding your core foundation.</p>
    `,
    related: ['core-bucket', 'cash-bucket', 'options-scoring']
  },
  'cash-bucket': {
    id: 'cash-bucket',
    term: 'Cash Bucket',
    category: 'Portfolio Architecture',
    short: 'Uninvested liquid funds held for operational liquidity, emergency reserves, and collateral for put selling.',
    definition: `
      <p>The <strong>Cash Bucket</strong> holds uninvested cash reserves to maintain operational liquidity, buffer against cash drag, and serve as 100% collateral for cash-secured put options.</p>
    `,
    related: ['core-bucket', 'satellite-bucket', 'cash-drag']
  },
  'rebalancing': {
    id: 'rebalancing',
    term: 'Rebalancing',
    category: 'Portfolio Architecture',
    short: 'Adjusting asset weights back to target allocation to maintain risk control.',
    definition: `
      <p><strong>Rebalancing</strong> involves periodically selling overweighted assets or deploying fresh capital into underweighted buckets to maintain your desired risk-return profile.</p>
    `,
    related: ['asset-allocation', 'core-bucket', 'satellite-bucket']
  },
  'stock': {
    id: 'stock',
    term: 'Stock (Equity)',
    category: 'Portfolio Architecture',
    short: 'A security representing fractional ownership in a corporation.',
    definition: `
      <p>A <strong>Stock</strong> (or equity) represents a fractional ownership share in a corporation.</p>
      <p>Stockholders hold a claim on the company's underlying assets and net earnings. Stocks can appreciate in market price over time and may pay cash dividends to shareholders.</p>
    `,
    related: ['option', 'etf', 'market-cap', 'dividend']
  },
  'option': {
    id: 'option',
    term: 'Option Contract',
    category: 'Options & Scoring',
    short: 'A derivative contract granting the right, but not obligation, to buy or sell an asset at a set price.',
    definition: `
      <p>An <strong>Option</strong> is a financial contract granting the buyer the right (without the obligation) to buy or sell an underlying security at a fixed strike price on or before an expiration date.</p>
      <p>Option sellers (writers) receive upfront cash premium in exchange for taking on contractual obligation.</p>
    `,
    related: ['call', 'put', 'short', 'long', 'strike-price', 'premium']
  },
  'call': {
    id: 'call',
    term: 'Call Option',
    category: 'Options & Scoring',
    short: 'A contract granting the buyer the right to buy stock at a set strike price, or the seller the obligation to sell.',
    definition: `
      <p>A <strong>Call Option</strong> gives the buyer the right to purchase 100 shares of a stock at a specified strike price prior to expiration.</p>
      <p>In a <strong>Covered Call</strong> strategy, an investor sells call options against stock shares they already own to generate income premium.</p>
    `,
    related: ['option', 'put', 'short', 'covered-call']
  },
  'put': {
    id: 'put',
    term: 'Put Option',
    category: 'Options & Scoring',
    short: 'A contract granting the buyer the right to sell stock at a set strike price, or the seller the obligation to buy.',
    definition: `
      <p>A <strong>Put Option</strong> gives the buyer the right to sell 100 shares of stock at a specified strike price prior to expiration.</p>
      <p>In a <strong>Cash-Secured Put</strong> strategy, an investor sells put options while holding cash collateral to earn income premium while offering to buy the stock at a discount.</p>
    `,
    related: ['option', 'call', 'cash-secured-put', 'short']
  },
  'short': {
    id: 'short',
    term: 'Short Position (Selling Short)',
    category: 'Options & Scoring',
    short: 'Selling a contract or security first with the intent of buying it back later or collecting premium.',
    definition: `
      <p>Going <strong>Short</strong> means selling an asset or derivative contract first, opening a negative position.</p>
      <p>In options trading, selling a put or call option to collect upfront premium is opening a short option position. In stock trading, shorting involves borrowing shares to profit from a price decline.</p>
    `,
    related: ['option', 'put', 'call', 'long']
  },
  'long': {
    id: 'long',
    term: 'Long Position',
    category: 'Portfolio Architecture',
    short: 'Owning an asset or contract with the expectation that its value will increase over time.',
    definition: `
      <p>Going <strong>Long</strong> means purchasing and holding an asset (such as shares of stock, ETFs, or long options contracts) with the expectation that its market price will appreciate over time.</p>
    `,
    related: ['stock', 'etf', 'short', 'option']
  },
  'strike-price': {
    id: 'strike-price',
    term: 'Strike Price',
    category: 'Options & Scoring',
    short: 'The set price per share at which an option contract can be exercised.',
    definition: `
      <p>The <strong>Strike Price</strong> (or exercise price) is the fixed price per share at which an option contract buyer can exercise their contract to buy (for calls) or sell (for puts) the underlying stock.</p>
    `,
    related: ['option', 'delta-range', 'expiration-date', 'otm']
  },
  'expiration-date': {
    id: 'expiration-date',
    term: 'Expiration Date (DTE)',
    category: 'Options & Scoring',
    short: 'The final date on which an option contract is valid and can be exercised.',
    definition: `
      <p>The <strong>Expiration Date</strong> (or Expiry) is the last day an option contract can be exercised.</p>
      <p>Days to Expiration (DTE) measures the remaining life of the contract. After this date, the option contract expires either in-the-money (exercised) or worthless (out-of-the-money).</p>
    `,
    related: ['option', 'strike-price', 'dte', 'theta']
  },
  'premium': {
    id: 'premium',
    term: 'Option Premium',
    category: 'Options & Scoring',
    short: 'The cash price paid by an option buyer to the option seller upfront for taking contract risk.',
    definition: `
      <p><strong>Option Premium</strong> is the total upfront cash price paid by the option buyer to the seller.</p>
      <p>For cash-secured put sellers, the premium collected serves as immediate cash income that buffers downside purchase cost.</p>
    `,
    related: ['option', 'yield-targets', 'cash-secured-put']
  },
  'underlying': {
    id: 'underlying',
    term: 'Underlying Asset',
    category: 'Options & Scoring',
    short: 'The stock or ETF upon which an option contract is written.',
    definition: `
      <p>The <strong>Underlying Asset</strong> is the specific stock, ETF, or index upon which a derivative option contract is based and settled.</p>
    `,
    related: ['option', 'stock', 'etf']
  },
  'etf': {
    id: 'etf',
    term: 'Exchange-Traded Fund (ETF)',
    category: 'Portfolio Architecture',
    short: 'A basket of securities traded on a stock exchange like a single share.',
    definition: `
      <p>An <strong>Exchange-Traded Fund (ETF)</strong> is an investment fund traded on public stock exchanges that holds a basket of underlying assets such as stocks or bonds.</p>
      <p>ETFs provide instant diversification across broad indexes or specific sectors at low expense ratios.</p>
    `,
    related: ['stock', 'core-bucket', 'satellite-bucket']
  },
  'dividend': {
    id: 'dividend',
    term: 'Dividend & Dividend Yield',
    category: 'Portfolio Architecture',
    short: 'A cash distribution of corporate earnings paid out to shareholders.',
    definition: `
      <p>A <strong>Dividend</strong> is a cash payout made regularly by a company to its eligible shareholders from net profits.</p>
      <p><strong>Dividend Yield</strong> measures the annualized dividend payout relative to current share price (<code>Annual Payout / Stock Price</code>).</p>
    `,
    related: ['stock', 'dividend-tax', 'tax-drag']
  },
  'market-cap': {
    id: 'market-cap',
    term: 'Market Capitalization',
    category: 'Portfolio Architecture',
    short: 'The total dollar market value of a company\'s outstanding stock shares.',
    definition: `
      <p><strong>Market Capitalization</strong> (Market Cap) measures a company's total equity value on the stock market (calculated as <code>Share Price × Total Shares Outstanding</code>).</p>
      <p>Large-cap stocks (&gt;$10B) generally offer lower volatility and higher liquidity than small-cap stocks.</p>
    `,
    related: ['stock', 'volatility', 'liquidity']
  },
  'volatility': {
    id: 'volatility',
    term: 'Volatility & Implied Volatility',
    category: 'Options & Scoring',
    short: 'Degree of variation of a trading price series, reflecting market uncertainty.',
    definition: `
      <p><strong>Volatility</strong> quantifies the magnitude of price fluctuations for a stock or asset.</p>
      <p><strong>Historical Volatility (HV)</strong> measures past price swings, while <strong>Implied Volatility (IV)</strong> reflects the market's forward-looking pricing of risk in options contracts.</p>
    `,
    related: ['option', 'implied-volatility', 'historical-volatility', 'iv-rank']
  }
};

function renderGlossaryTerm(termId, textOverride = null, tooltipOverride = null) {
  const item = GLOSSARY_TERMS[termId];
  const text = textOverride || (item ? item.term : termId);
  const tooltip = tooltipOverride || (item ? `${item.short} Click for glossary.` : 'Click for glossary.');
  return `<span class="glossary-term" data-glossary="${termId}" title="${tooltip.replace(/"/g, '&quot;')}">${text}</span>`;
}
window.renderGlossaryTerm = renderGlossaryTerm;

class GlossaryController {
  constructor() {
    this.modalEl = null;
    this.searchTerm = '';
    this.activeCategory = 'ALL';
    this.currentTermId = null;
  }

  wrapTerms(container = document.body) {
    if (!container) return;
    const target = typeof container === 'string' ? document.querySelector(container) : container;
    if (!target) return;

    const phraseMap = [];
    for (const item of Object.values(GLOSSARY_TERMS)) {
      const cleanTerm = item.term.replace(/\s*\([^)]*\)/g, '').trim();
      const phrases = new Set([
        item.term,
        cleanTerm,
        item.id.replace(/-/g, ' ')
      ]);
      if (item.id === 'stock') { phrases.add('stocks'); phrases.add('equity'); }
      if (item.id === 'option') { phrases.add('options'); }
      if (item.id === 'put') { phrases.add('puts'); }
      if (item.id === 'call') { phrases.add('calls'); }

      for (const p of phrases) {
        if (p && p.length >= 3) {
          phraseMap.push({ phrase: p, item });
        }
      }
    }
    phraseMap.sort((a, b) => b.phrase.length - a.phrase.length);

    const textNodes = [];
    const walk = document.createTreeWalker(target, NodeFilter.SHOW_TEXT, {
      acceptNode: (node) => {
        const parent = node.parentElement;
        if (!parent) return NodeFilter.FILTER_REJECT;
        const tag = parent.tagName.toLowerCase();
        if (['script', 'style', 'input', 'textarea', 'select', 'button', 'a', 'h1', 'h2'].includes(tag)) return NodeFilter.FILTER_REJECT;
        if (parent.closest('[data-glossary], .glossary-term, .no-glossary, .glossary-detail-title')) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    });

    while (walk.nextNode()) textNodes.push(walk.currentNode);

    for (const node of textNodes) {
      let content = node.nodeValue;
      if (!content || !content.trim()) continue;

      for (const entry of phraseMap) {
        const regex = new RegExp(`\\b(${entry.phrase.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')})\\b`, 'i');
        if (regex.test(content)) {
          const span = document.createElement('span');
          span.innerHTML = content.replace(regex, (match) => {
            const shortTooltip = (entry.item.short || entry.item.term) + ' Click for glossary.';
            return `<span class="glossary-term" data-glossary="${entry.item.id}" title="${shortTooltip.replace(/"/g, '&quot;')}">${match}</span>`;
          });
          node.parentNode.replaceChild(span, node);
          break;
        }
      }
    }
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
        if (termId && GLOSSARY_TERMS[termId]) {
          this.open(termId);
        }
      }
    });

    // Sidebar Glossary button handler
    const sidebarBtn = document.getElementById('sidebar-glossary-btn');
    if (sidebarBtn) {
      sidebarBtn.addEventListener('click', (e) => {
        e.preventDefault();
        this.open();
      });
      sidebarBtn.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          this.open();
        }
      });
    }

    // Modal close handlers
    const closeBtn = document.getElementById('glossary-modal-close');
    if (closeBtn) closeBtn.addEventListener('click', () => this.close());

    if (this.modalEl) {
      this.modalEl.addEventListener('click', (e) => {
        if (e.target === this.modalEl) this.close();
      });
    }

    // Search input
    const searchInput = document.getElementById('glossary-search-input');
    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        this.searchTerm = e.target.value.toLowerCase().trim();
        this.renderSidebar();
      });
    }

    // Category filter tabs
    const catContainer = document.getElementById('glossary-categories');
    if (catContainer) {
      catContainer.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          catContainer.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          this.activeCategory = btn.dataset.category;
          this.renderSidebar();
        });
      });
    }
  }

  open(termId = null) {
    if (!this.modalEl) return;
    this.modalEl.classList.remove('hidden');

    if (termId && GLOSSARY_TERMS[termId]) {
      this.selectTerm(termId);
    } else if (!this.currentTermId) {
      const sortedKeys = Object.values(GLOSSARY_TERMS)
        .sort((a, b) => a.term.localeCompare(b.term))
        .map(t => t.id);
      this.selectTerm(sortedKeys[0] || Object.keys(GLOSSARY_TERMS)[0]);
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

    terms.sort((a, b) => a.term.localeCompare(b.term));

    if (terms.length === 0) {
      listEl.innerHTML = `<div style="padding:16px; font-size:12px; color:var(--text-muted); text-align:center;">No matching terms found.</div>`;
      return;
    }

    listEl.innerHTML = terms.map(item => `
      <button class="glossary-item-btn ${item.id === this.currentTermId ? 'active' : ''}" data-id="${item.id}" title="${item.term.replace(/"/g, '&quot;')}">
        <span class="glossary-item-title">${item.term}</span>
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

    const bodyEl = detailEl.querySelector('.glossary-detail-body');
    if (bodyEl) {
      this.wrapTerms(bodyEl);
    }
  }
}

// Global singleton instance
window.glossaryController = new GlossaryController();

document.addEventListener('DOMContentLoaded', () => {
  window.glossaryController.init();
});
