const YahooFinance = require('yahoo-finance2').default;
const yahooFinance = new YahooFinance({ suppressNotices: ['yahooSurvey'] });

async function run() {
  const symbols = ['VTI', 'CSPX', 'BND', 'AAPL', 'CSPX.AS', 'VWRL.AS'];
  for (const sym of symbols) {
    try {
      const q = await yahooFinance.quote(sym);
      console.log(`--- ${sym} ---`);
      console.log({
        symbol: q.symbol,
        quoteType: q.quoteType,
        exchange: q.exchange,
        currency: q.currency,
        market: q.market,
        longName: q.longName,
        shortName: q.shortName,
        exchangeName: q.exchangeName,
        fullExchangeName: q.fullExchangeName
      });
    } catch (e) {
      console.error(`Error fetching ${sym}:`, e.message);
    }
  }
}

run();
