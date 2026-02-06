import YahooFinance from "yahoo-finance2";

const yf = new YahooFinance();

interface PriceData {
  date: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

function calcBollingerBands(data: PriceData[], period = 20) {
  return data.map((_, i) => {
    if (i < period - 1) return { lower2: null as number | null };
    const slice = data.slice(i - period + 1, i + 1);
    const sum = slice.reduce((acc, d) => acc + d.close, 0);
    const mean = sum / period;
    const variance = slice.reduce((acc, d) => acc + (d.close - mean) ** 2, 0) / period;
    const stdDev = Math.sqrt(variance);
    return { lower2: mean - 2 * stdDev };
  });
}

function detectShitabanare(data: PriceData[]) {
  const bb = calcBollingerBands(data);
  const signals: { date: string; close: number; lower2: number }[] = [];

  for (let i = 2; i < data.length; i++) {
    const lower2 = bb[i]?.lower2;
    if (lower2 == null) continue;

    const gapDown = data[i - 1].open < data[i - 2].low;
    if (!gapDown) continue;

    const bearish1 = data[i - 1].close < data[i - 1].open;
    const bearish2 = data[i].close < data[i].open;
    if (!bearish1) continue;

    const nearLowerBand = data[i].close <= lower2 * 1.10;
    if (!nearLowerBand) continue;

    if (bearish2) {
      signals.push({ date: data[i].date, close: data[i].close, lower2 });
    }
  }
  return signals;
}

async function main() {
  const symbols = [
    "7203.T", "7011.T", "6701.T", "6503.T", "6758.T",
    "8035.T", "8306.T", "1605.T", "6501.T",
  ];
  const names: Record<string, string> = {
    "7203.T": "トヨタ自動車",
    "7011.T": "三菱重工業",
    "6701.T": "NEC",
    "6503.T": "三菱電機",
    "6758.T": "ソニーグループ",
    "8035.T": "東京エレクトロン",
    "8306.T": "三菱UFJ",
    "1605.T": "INPEX",
    "6501.T": "日立製作所",
  };

  const oneYearAgo = new Date();
  oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);

  for (const symbol of symbols) {
    try {
      const result = await yf.chart(symbol, {
        period1: oneYearAgo,
        period2: new Date(),
        interval: "1d",
      });

      const data: PriceData[] = result.quotes
        .filter((r) => (r.open ?? 0) > 0 && (r.close ?? 0) > 0)
        .map((r) => ({
          date: r.date instanceof Date ? r.date.toISOString().split("T")[0] : String(r.date),
          open: r.open ?? 0,
          high: r.high ?? 0,
          low: r.low ?? 0,
          close: r.close ?? 0,
          volume: r.volume ?? 0,
        }));

      const signals = detectShitabanare(data);
      const name = names[symbol] ?? symbol;

      if (signals.length > 0) {
        console.log(`\n=== ${name} (${symbol}) === ${signals.length}件 ===`);
        for (const s of signals) {
          console.log(`  ${s.date}  終値: ${s.close.toLocaleString()}  BB-2σ: ${Math.round(s.lower2).toLocaleString()}`);
        }
      } else {
        console.log(`${name} (${symbol}): シグナルなし`);
      }
    } catch (e: any) {
      console.error(`${symbol}: エラー - ${e.message}`);
    }
  }
}

main();
