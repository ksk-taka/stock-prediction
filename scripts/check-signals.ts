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
    "6920.T", "6526.T", "6723.T", "285A.T", "3993.T",
    "3778.T", "9613.T", "7014.T", "7003.T", "7012.T",
    "9101.T", "9104.T", "6702.T", "6965.T", "2802.T",
    "4202.T", "4118.T", "4151.T", "7013.T", "186A.T",
    "5765.T", "9432.T", "4704.T", "3857.T", "2326.T",
    "3692.T", "7974.T", "7832.T", "4816.T", "9468.T",
    "4751.T", "6326.T", "6310.T", "2897.T", "1333.T",
    "2931.T", "5020.T", "4204.T", "9531.T", "9532.T",
    "9519.T", "1801.T", "1812.T", "1802.T", "1803.T",
    "1721.T", "9755.T", "7821.T", "4519.T", "4568.T",
    "4502.T", "4523.T", "4587.T", "4565.T", "7711.T",
    "4026.T", "5310.T", "5713.T", "4063.T", "6988.T",
    "5706.T", "6269.T", "9301.T", "9303.T", "1893.T",
    "1890.T", "7701.T", "7721.T", "9433.T", "9434.T",
    "5803.T", "5802.T", "6330.T", "6814.T",
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
    "6920.T": "レーザーテック",
    "6526.T": "ソシオネクスト",
    "6723.T": "ルネサスエレクトロニクス",
    "285A.T": "キオクシア",
    "3993.T": "PKSHA Technology",
    "3778.T": "さくらインターネット",
    "9613.T": "NTTデータグループ",
    "7014.T": "名村造船所",
    "7003.T": "三井E&S",
    "7012.T": "川崎重工業",
    "9101.T": "日本郵船",
    "9104.T": "商船三井",
    "6702.T": "富士通",
    "6965.T": "浜松ホトニクス",
    "2802.T": "味の素",
    "4202.T": "ダイセル",
    "4118.T": "カネカ",
    "4151.T": "協和キリン",
    "7013.T": "IHI",
    "186A.T": "アストロスケールHD",
    "5765.T": "QPS研究所",
    "9432.T": "NTT",
    "4704.T": "トレンドマイクロ",
    "3857.T": "ラック",
    "2326.T": "デジタルアーツ",
    "3692.T": "FFRIセキュリティ",
    "7974.T": "任天堂",
    "7832.T": "バンダイナムコHD",
    "4816.T": "東映アニメーション",
    "9468.T": "KADOKAWA",
    "4751.T": "サイバーエージェント",
    "6326.T": "クボタ",
    "6310.T": "井関農機",
    "2897.T": "日清食品HD",
    "1333.T": "マルハニチロ",
    "2931.T": "ユーグレナ",
    "5020.T": "ENEOS HD",
    "4204.T": "積水化学工業",
    "9531.T": "東京ガス",
    "9532.T": "大阪ガス",
    "9519.T": "レノバ",
    "1801.T": "大成建設",
    "1812.T": "鹿島建設",
    "1802.T": "大林組",
    "1803.T": "清水建設",
    "1721.T": "コムシスHD",
    "9755.T": "応用地質",
    "7821.T": "前田工繊",
    "4519.T": "中外製薬",
    "4568.T": "第一三共",
    "4502.T": "武田薬品",
    "4523.T": "エーザイ",
    "4587.T": "ペプチドリーム",
    "4565.T": "そーせいグループ",
    "7711.T": "助川電気工業",
    "4026.T": "神島化学工業",
    "5310.T": "東洋炭素",
    "5713.T": "住友金属鉱山",
    "4063.T": "信越化学工業",
    "6988.T": "日東電工",
    "5706.T": "三井金属鉱業",
    "6269.T": "三井海洋開発",
    "9301.T": "三菱倉庫",
    "9303.T": "住友倉庫",
    "1893.T": "五洋建設",
    "1890.T": "東洋建設",
    "7701.T": "島津製作所",
    "7721.T": "東京計器",
    "9433.T": "KDDI",
    "9434.T": "ソフトバンク",
    "5803.T": "フジクラ",
    "5802.T": "住友電気工業",
    "6330.T": "東洋エンジニアリング",
    "6814.T": "古野電気",
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
