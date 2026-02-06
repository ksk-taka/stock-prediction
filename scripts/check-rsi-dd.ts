import YahooFinance from "yahoo-finance2";
import { calcRSI } from "../src/lib/utils/indicators";
import type { PriceData } from "../src/types";

const yahooFinance = new YahooFinance();

const STOCKS = [
  "7203.T", "6758.T", "8306.T", "9984.T", "6501.T",
  "4063.T", "6902.T", "7267.T", "6861.T", "9433.T",
  "6920.T", "8035.T", "6723.T", "4568.T", "3382.T",
];

// optimized preset: period=10, oversold=20, overbought=80
const RSI_PERIOD = 10;
const OVERSOLD = 20;
const OVERBOUGHT = 80;

async function fetchData(symbol: string): Promise<PriceData[]> {
  const end = new Date();
  const start = new Date();
  start.setFullYear(start.getFullYear() - 3);
  const result = await yahooFinance.chart(symbol, {
    period1: start.toISOString().slice(0, 10),
    period2: end.toISOString().slice(0, 10),
    interval: "1d",
  });
  return (result.quotes ?? [])
    .filter((q: any) => q.close != null && q.open != null)
    .map((q: any) => ({
      date: new Date(q.date).toISOString().slice(0, 10),
      open: q.open, high: q.high, low: q.low, close: q.close, volume: q.volume ?? 0,
    }));
}

async function main() {
  console.log("RSI逆張り 最大含み損分析 (最適化プリセット: period=10, oversold=20, overbought=80)\n");
  console.log(`${"銘柄".padEnd(10)} ${"取引数".padStart(6)} ${"最大含み損%".padStart(12)} ${"保有日数".padStart(8)} ${"詳細"}`);
  console.log("─".repeat(90));

  let worstOverall = { symbol: "", dd: 0, days: 0, buyDate: "", buyPrice: 0, worstPrice: 0, worstDate: "" };
  const allTrades: { symbol: string; buyDate: string; buyPrice: number; sellDate: string; sellPrice: number; holdDays: number; returnPct: number; maxDDPct: number; maxDDDays: number }[] = [];

  for (const symbol of STOCKS) {
    try {
      const data = await fetchData(symbol);
      const rsi = calcRSI(data, RSI_PERIOD);

      let inPosition = false;
      let buyPrice = 0;
      let buyIdx = 0;
      let buyDate = "";
      let maxDD = 0;
      let maxDDDays = 0;
      let worstCase = { buyDate: "", buyPrice: 0, worstPrice: 0, worstDate: "", dd: 0, days: 0 };
      let trades = 0;
      let tradeMaxDD = 0;
      let tradeMaxDDDays = 0;

      for (let i = 0; i < data.length; i++) {
        if (rsi[i] == null) continue;

        if (!inPosition && rsi[i]! < OVERSOLD) {
          inPosition = true;
          buyPrice = data[i].close;
          buyIdx = i;
          buyDate = data[i].date;
          trades++;
          tradeMaxDD = 0;
          tradeMaxDDDays = 0;
        } else if (inPosition) {
          const unrealizedLow = ((data[i].low - buyPrice) / buyPrice) * 100;
          const holdDays = i - buyIdx;

          if (unrealizedLow < tradeMaxDD) {
            tradeMaxDD = unrealizedLow;
            tradeMaxDDDays = holdDays;
          }

          if (unrealizedLow < maxDD) {
            maxDD = unrealizedLow;
            maxDDDays = holdDays;
            worstCase = { buyDate, buyPrice, worstPrice: data[i].low, worstDate: data[i].date, dd: unrealizedLow, days: holdDays };
          }

          if (rsi[i]! > OVERBOUGHT) {
            inPosition = false;
            const returnPct = ((data[i].close - buyPrice) / buyPrice) * 100;
            allTrades.push({
              symbol, buyDate, buyPrice, sellDate: data[i].date, sellPrice: data[i].close,
              holdDays: i - buyIdx, returnPct, maxDDPct: tradeMaxDD, maxDDDays: tradeMaxDDDays,
            });
          }
        }
      }

      // 未決済ポジション
      if (inPosition) {
        const last = data[data.length - 1];
        const returnPct = ((last.close - buyPrice) / buyPrice) * 100;
        allTrades.push({
          symbol, buyDate, buyPrice, sellDate: "(保有中)", sellPrice: last.close,
          holdDays: data.length - 1 - buyIdx, returnPct, maxDDPct: tradeMaxDD, maxDDDays: tradeMaxDDDays,
        });
      }

      const name = symbol.replace(".T", "").padEnd(10);
      console.log(
        `${name} ${String(trades).padStart(6)} ${maxDD.toFixed(1).padStart(12)}% ${String(maxDDDays).padStart(6)}日  ${worstCase.buyDate} @${Math.round(worstCase.buyPrice).toLocaleString()} → ${worstCase.worstDate} 安値${Math.round(worstCase.worstPrice).toLocaleString()}`
      );

      if (maxDD < worstOverall.dd) {
        worstOverall = { ...worstCase, symbol, dd: maxDD, days: maxDDDays };
      }
    } catch (e: any) {
      console.log(`${symbol.padEnd(10)} エラー: ${e.message}`);
    }
  }

  console.log("\n" + "─".repeat(90));
  console.log(`\n全体最悪: ${worstOverall.symbol} ${worstOverall.dd.toFixed(1)}% (${worstOverall.days}日保有中)`);
  console.log(`  買: ${worstOverall.buyDate} @${Math.round(worstOverall.buyPrice).toLocaleString()}`);
  console.log(`  底: ${worstOverall.worstDate} @${Math.round(worstOverall.worstPrice).toLocaleString()}`);

  // 含み損が大きかったトレード TOP10
  console.log("\n\n含み損ワースト10トレード:");
  console.log(`${"銘柄".padEnd(10)} ${"買日付".padEnd(12)} ${"買値".padStart(8)} ${"最大DD%".padStart(8)} ${"DD日数".padStart(6)} ${"結果%".padStart(8)} ${"保有日数".padStart(8)} ${"売日付"}`);
  console.log("─".repeat(90));
  allTrades
    .sort((a, b) => a.maxDDPct - b.maxDDPct)
    .slice(0, 10)
    .forEach((t) => {
      console.log(
        `${t.symbol.replace(".T", "").padEnd(10)} ${t.buyDate.padEnd(12)} ${Math.round(t.buyPrice).toLocaleString().padStart(8)} ${t.maxDDPct.toFixed(1).padStart(8)}% ${String(t.maxDDDays).padStart(5)}日 ${t.returnPct.toFixed(1).padStart(8)}% ${String(t.holdDays).padStart(7)}日  ${t.sellDate}`);
    });
}

main();
