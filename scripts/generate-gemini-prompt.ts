#!/usr/bin/env npx tsx
// ============================================================
// Gemini用 銘柄分析プロンプト生成スクリプト
//
// Yahoo Financeから定量データ+6ヶ月OHLCVを取得し、
// Geminiに貼り付けるためのプロンプトをMarkdown形式で出力する。
//
// 使い方:
//   npx tsx scripts/generate-gemini-prompt.ts 6503.T
//   npx tsx scripts/generate-gemini-prompt.ts 6503          # .T は自動付与
//   npx tsx scripts/generate-gemini-prompt.ts 6503.T --clip  # クリップボードにコピー
// ============================================================

import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import YahooFinance from "yahoo-finance2";

const yf = new YahooFinance({ suppressNotices: ["yahooSurvey"] });

// ---------- CLI引数 ----------

const args = process.argv.slice(2);
const copyToClipboard = args.includes("--clip");
const symbolArg = args.find((a) => !a.startsWith("--"));

if (!symbolArg) {
  console.log("使い方:");
  console.log("  npx tsx scripts/generate-gemini-prompt.ts 6503.T");
  console.log("  npx tsx scripts/generate-gemini-prompt.ts 6503");
  console.log("");
  console.log("オプション:");
  console.log("  --clip   生成したプロンプトをクリップボードにコピー");
  process.exit(0);
}

const symbol = symbolArg.includes(".T") ? symbolArg : `${symbolArg}.T`;

// ---------- ユーティリティ ----------

function fmt(n: number | null | undefined, decimals = 1): string {
  if (n == null || isNaN(n)) return "N/A";
  return n.toLocaleString("ja-JP", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

function fmtPct(n: number | null | undefined): string {
  if (n == null || isNaN(n)) return "N/A";
  const pct = n * 100;
  return `${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%`;
}

function fmtYen(n: number | null | undefined): string {
  if (n == null || isNaN(n)) return "N/A";
  if (Math.abs(n) >= 1e12) return `${(n / 1e12).toFixed(1)}兆円`;
  if (Math.abs(n) >= 1e8) return `${(n / 1e8).toFixed(0)}億円`;
  return `${n.toLocaleString()}円`;
}

// ---------- メイン ----------

async function main() {
  console.error(`[info] ${symbol} のデータを取得中...`);

  // 6ヶ月前の日付
  const sixMonthsAgo = new Date();
  sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
  const period1 = sixMonthsAgo.toISOString().slice(0, 10);
  const period2 = new Date().toISOString().slice(0, 10);

  // 配当履歴の取得期間（6年分）
  const sixYearsAgo = new Date();
  sixYearsAgo.setFullYear(sixYearsAgo.getFullYear() - 6);

  // バランスシートの取得期間（1年分）
  const oneYearAgo = new Date();
  oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);

  // シャープレシオ用: 3年分チャート
  const threeYearsAgo = new Date();
  threeYearsAgo.setFullYear(threeYearsAgo.getFullYear() - 3);

  // データ取得（quote, summary, chart6m, chart3y, バランスシート, 配当履歴）
  const [quote, summary, chart, chart3y, bsResult, dividendHistory] = await Promise.all([
    yf.quote(symbol),
    yf.quoteSummary(symbol, {
      modules: [
        "financialData",
        "defaultKeyStatistics",
        "calendarEvents",
        "assetProfile",
      ],
    }),
    yf.chart(symbol, { period1, period2, interval: "1d" as const }),
    yf.chart(symbol, { period1: threeYearsAgo.toISOString().slice(0, 10), period2, interval: "1d" as const }).catch(() => null),
    yf.fundamentalsTimeSeries(symbol, {
      period1: oneYearAgo,
      type: "quarterly" as const,
      module: "balance-sheet" as const,
    }).catch(() => []),
    yf.historical(symbol, {
      period1: sixYearsAgo,
      period2: new Date(),
      events: "dividends" as const,
    }).catch(() => []),
  ]);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fd = (summary.financialData ?? {}) as any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ks = (summary.defaultKeyStatistics ?? {}) as any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const cal = (summary.calendarEvents ?? {}) as any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ap = (summary.assetProfile ?? {}) as any;

  // 株価データ
  const price = quote.regularMarketPrice ?? 0;
  const change = quote.regularMarketChange ?? 0;
  const changePct = quote.regularMarketChangePercent ?? 0;
  const dayHigh = quote.regularMarketDayHigh;
  const dayLow = quote.regularMarketDayLow;
  const volume = quote.regularMarketVolume ?? 0;
  const avgVolume = quote.averageDailyVolume3Month ?? 1;
  const marketCap = quote.marketCap ?? 0;
  const w52High = quote.fiftyTwoWeekHigh ?? 0;
  const w52Low = quote.fiftyTwoWeekLow ?? 0;
  const ma50 = quote.fiftyDayAverage ?? 0;
  const ma200 = quote.twoHundredDayAverage ?? 0;

  // バリュエーション
  const per = quote.trailingPE;
  const forwardPE = quote.forwardPE;
  const eps = quote.epsTrailingTwelveMonths;
  const divYield = quote.dividendYield;

  // PBR: YFのbookValueは日本株で不正確なケースがあるため、バランスシートから自前計算
  let pbr: number | undefined = quote.priceToBook;
  if (bsResult && bsResult.length > 0 && quote.sharesOutstanding && price > 0) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const bsLatest = bsResult[bsResult.length - 1] as any;
    const equity = (bsLatest.stockholdersEquity as number) ?? 0;
    if (equity > 0) {
      const bvps = equity / quote.sharesOutstanding;
      pbr = price / bvps;
    }
  }

  // 財務
  const roe = fd.returnOnEquity;
  const roa = fd.returnOnAssets;
  const profitMargin = fd.profitMargins;
  const operatingMargin = fd.operatingMargins;
  const revenueGrowth = fd.revenueGrowth;
  const earningsGrowth = fd.earningsGrowth;
  const debtToEquity = fd.debtToEquity;
  const currentRatio = fd.currentRatio;
  const freeCashflow = fd.freeCashflow;
  const targetMeanPrice = fd.targetMeanPrice;
  const recommendationKey = fd.recommendationKey;
  const numberOfAnalysts = fd.numberOfAnalystOpinions;
  const beta = ks.beta;

  const shortName = quote.shortName ?? "";
  const longName = quote.longName ?? shortName;
  const industry = ap.industry ?? "";
  const sector = ap.sector ?? "";
  const businessSummary = ap.longBusinessSummary ?? "";

  // ---------- シャープレシオ算出（半年/1年/3年） ----------

  function calcSharpe(closes: number[]): number | null {
    if (closes.length < 20) return null;
    const returns: number[] = [];
    for (let i = 1; i < closes.length; i++) {
      returns.push((closes[i] - closes[i - 1]) / closes[i - 1]);
    }
    const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
    const variance =
      returns.reduce((a, r) => a + (r - mean) ** 2, 0) / (returns.length - 1);
    const stdDev = Math.sqrt(variance);
    if (stdDev === 0) return null;
    return Math.round((mean / stdDev) * Math.sqrt(252) * 100) / 100;
  }

  // 3年分のcloseを取得（chart3yから）、期間ごとにスライス
  const allCloses = (chart3y?.quotes ?? [])
    .map((r) => ({ date: new Date(r.date), close: r.close }))
    .filter((r): r is { date: Date; close: number } => r.close != null && r.close > 0)
    .sort((a, b) => a.date.getTime() - b.date.getTime());

  const now = new Date();
  const cutoff6m = new Date(now); cutoff6m.setMonth(cutoff6m.getMonth() - 6);
  const cutoff1y = new Date(now); cutoff1y.setFullYear(cutoff1y.getFullYear() - 1);

  const closes6m = allCloses.filter((r) => r.date >= cutoff6m).map((r) => r.close);
  const closes1y = allCloses.filter((r) => r.date >= cutoff1y).map((r) => r.close);
  const closes3y = allCloses.map((r) => r.close);

  const sharpe6m = calcSharpe(closes6m);
  const sharpe1y = calcSharpe(closes1y);
  const sharpe3y = calcSharpe(closes3y);

  // ---------- NC比率・CNPER計算 ----------

  let ncRatio: number | null = null;
  let cnper: number | null = null;

  if (bsResult && bsResult.length > 0 && marketCap > 0) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const bs = bsResult[bsResult.length - 1] as any;
    const currentAssets = (bs.currentAssets as number) ?? 0;
    const investmentInFA =
      (bs.investmentinFinancialAssets as number) ??
      (bs.availableForSaleSecurities as number) ??
      (bs.investmentsAndAdvances as number) ??
      0;
    const totalLiabilities = (bs.totalLiabilitiesNetMinorityInterest as number) ?? 0;

    if (currentAssets !== 0 || totalLiabilities !== 0) {
      const netCash = currentAssets + investmentInFA * 0.7 - totalLiabilities;
      ncRatio = Math.round((netCash / marketCap) * 1000) / 10;
      if (per != null) {
        cnper = Math.round(per * (1 - ncRatio / 100) * 100) / 100;
      }
    }
  }

  // ---------- 増配傾向算出 ----------

  let dividendTrendText = "N/A";
  {
    const divRows = (dividendHistory as unknown as { date: Date; dividends: number }[]) ?? [];
    const validDivs = Array.isArray(divRows) ? divRows.filter((r) => r.dividends > 0) : [];

    if (validDivs.length >= 2) {
      // 年ごとに合算（日本株は中間+期末の年2回）
      const byYear = new Map<number, number>();
      for (const d of validDivs) {
        const year = new Date(d.date).getFullYear();
        byYear.set(year, (byYear.get(year) ?? 0) + d.dividends);
      }
      const years = [...byYear.entries()].sort((a, b) => b[0] - a[0]);

      if (years.length >= 2) {
        // 連続増配年数
        let consecutive = 0;
        for (let i = 0; i < years.length - 1; i++) {
          if (years[i][1] > years[i + 1][1]) {
            consecutive++;
          } else {
            break;
          }
        }
        // 直近増配率
        const latestGrowthPct = years[1][1] > 0
          ? Math.round(((years[0][1] - years[1][1]) / years[1][1]) * 1000) / 10
          : null;

        // 各年の配当額
        const yearDetails = years.slice(0, 5).map(([y, amt]) => `${y}年: ${fmt(amt)}円`).join(", ");

        if (consecutive >= 1) {
          dividendTrendText = `${consecutive}年連続増配 (直近${latestGrowthPct != null ? (latestGrowthPct > 0 ? "+" : "") + latestGrowthPct : "N/A"}%) [${yearDetails}]`;
        } else if (latestGrowthPct != null && latestGrowthPct < 0) {
          dividendTrendText = `直近減配 (${latestGrowthPct}%) [${yearDetails}]`;
        } else {
          dividendTrendText = `横ばいまたは不定期 [${yearDetails}]`;
        }
      }
    }
  }

  // 決算日
  const earningsDate = cal.earnings?.earningsDate?.[0];
  const earningsDateStr = earningsDate
    ? new Date(earningsDate as string | number).toISOString().slice(0, 10)
    : "";

  // OHLCV
  const ohlcv = chart.quotes.map((r) => ({
    date: new Date(r.date).toISOString().slice(0, 10),
    open: r.open,
    high: r.high,
    low: r.low,
    close: r.close,
    volume: r.volume,
  }));

  // ---------- チャート分析ポイント自動生成 ----------

  const observations: string[] = [];

  // トレンド
  if (ohlcv.length >= 2) {
    const first = ohlcv[0].close ?? 0;
    const last = ohlcv[ohlcv.length - 1].close ?? 0;
    const trendPct = ((last - first) / first) * 100;
    const trendDir = trendPct > 3 ? "上昇" : trendPct < -3 ? "下落" : "横ばい";
    observations.push(
      `**6ヶ月トレンド**: ${ohlcv[0].date}の${fmt(first, 0)}円 → ${ohlcv[ohlcv.length - 1].date}の${fmt(last, 0)}円 (${trendPct >= 0 ? "+" : ""}${trendPct.toFixed(1)}%, ${trendDir})`,
    );
  }

  // 52週高値との距離
  if (w52High > 0) {
    const distFromHigh = ((price - w52High) / w52High) * 100;
    if (Math.abs(distFromHigh) < 2) {
      observations.push(`**52週高値圏**: 現在値 ${fmt(price, 0)}円 は52週高値 ${fmt(w52High, 0)}円 に近い (${distFromHigh.toFixed(1)}%)`);
    }
  }

  // 出来高スパイク検出 (上位3件)
  if (ohlcv.length >= 5) {
    const avgVol =
      ohlcv.reduce((s, r) => s + (r.volume ?? 0), 0) / ohlcv.length;
    const spikes = ohlcv
      .filter((r) => (r.volume ?? 0) > avgVol * 2.5)
      .sort((a, b) => (b.volume ?? 0) - (a.volume ?? 0))
      .slice(0, 3);
    for (const r of spikes) {
      observations.push(
        `**出来高急増 ${r.date}**: ${(r.volume ?? 0).toLocaleString()}株 (期間平均の${((r.volume ?? 0) / avgVol).toFixed(1)}倍)`,
      );
    }
  }

  // MA乖離
  if (ma50 > 0) {
    const ma50Dist = ((price - ma50) / ma50) * 100;
    observations.push(
      `**50DMA (${fmt(ma50, 0)}円)**: 現在 ${ma50Dist >= 0 ? "+" : ""}${ma50Dist.toFixed(1)}% ${ma50Dist >= 0 ? "上方" : "下方"}乖離`,
    );
  }
  if (ma200 > 0) {
    const ma200Dist = ((price - ma200) / ma200) * 100;
    observations.push(
      `**200DMA (${fmt(ma200, 0)}円)**: 現在 ${ma200Dist >= 0 ? "+" : ""}${ma200Dist.toFixed(1)}% ${ma200Dist >= 0 ? "上方" : "下方"}乖離`,
    );
  }

  // PER乖離
  if (per && forwardPE && Math.abs(per - forwardPE) / per > 0.3) {
    observations.push(
      `**PER実績 ${fmt(per)}倍 vs 予想 ${fmt(forwardPE)}倍**: 大幅乖離 → 特殊要因の可能性`,
    );
  }

  // ---------- プロンプト組み立て ----------

  const today = new Date().toLocaleDateString("ja-JP", { year: "numeric", month: "numeric", day: "numeric" });

  let prompt = `あなたは日本株の投資アナリストです。以下の銘柄について、投資判断（Go / No Go / 様子見）を行ってください。
添付の決算資料PDFがあれば、それも参照してください。

# 銘柄情報
- 銘柄: ${longName} (${symbol})
- 業種: ${industry} / ${sector}
- 時価総額: 約${fmtYen(marketCap)}
`;

  if (businessSummary) {
    // 事業概要は長すぎるので200文字に制限
    const summary =
      businessSummary.length > 200
        ? businessSummary.slice(0, 200) + "..."
        : businessSummary;
    prompt += `- 事業概要: ${summary}\n`;
  }

  prompt += `
# 株価情報 (${today} 終値)
- 現在株価: ${fmt(price, 0)}円 (前日比 ${change >= 0 ? "+" : ""}${fmt(change, 0)}円, ${changePct >= 0 ? "+" : ""}${changePct.toFixed(2)}%)
- 本日レンジ: ${fmt(dayLow, 0)} - ${fmt(dayHigh, 0)}円
- 出来高: ${volume.toLocaleString()}株 (3ヶ月平均: ${avgVolume.toLocaleString()}株 → ${(volume / avgVolume).toFixed(2)}倍)
- 52週高値: ${fmt(w52High, 0)}円 (現在 ${(((price - w52High) / w52High) * 100).toFixed(1)}%)
- 52週安値: ${fmt(w52Low, 1)}円 (現在 ${(((price - w52Low) / w52Low) * 100).toFixed(1)}%)
- 50日移動平均: ${fmt(ma50, 0)}円
- 200日移動平均: ${fmt(ma200, 0)}円

# バリュエーション
- PER (実績): ${per != null ? fmt(per) + "倍" : "N/A"}
- PER (予想): ${forwardPE != null ? fmt(forwardPE) + "倍" : "N/A"}
- PBR: ${pbr != null ? fmt(pbr) + "倍" : "N/A"}
- EPS: ${eps != null ? fmt(eps) + "円" : "N/A"}
- 配当利回り: ${divYield != null ? fmt(divYield) + "%" : "N/A"}
- Beta: ${beta != null ? fmt(beta, 3) : "N/A"}

# 財務指標
- ROE: ${roe != null ? (roe * 100).toFixed(2) + "%" : "N/A"}
- ROA: ${roa != null ? (roa * 100).toFixed(2) + "%" : "N/A"}
- 純利益率: ${profitMargin != null ? (profitMargin * 100).toFixed(2) + "%" : "N/A"}
- 営業利益率: ${operatingMargin != null ? (operatingMargin * 100).toFixed(2) + "%" : "N/A"}
- 売上成長率: ${revenueGrowth != null ? fmtPct(revenueGrowth) : "N/A"}
- 利益成長率: ${earningsGrowth != null ? fmtPct(earningsGrowth) : "N/A"}
- D/Eレシオ: ${debtToEquity != null ? fmt(debtToEquity) : "N/A"}
- 流動比率: ${currentRatio != null ? fmt(currentRatio) + "倍" : "N/A"}
- フリーキャッシュフロー: ${freeCashflow != null ? fmtYen(freeCashflow) : "N/A"}

# 資本効率・キャッシュ
- ネットキャッシュ比率: ${ncRatio != null ? fmt(ncRatio) + "%" : "N/A"}${ncRatio != null ? ` (= (流動資産 + 投資有価証券×70% − 総負債) / 時価総額)` : ""}
- CNPER（キャッシュニュートラルPER）: ${cnper != null ? fmt(cnper, 2) + "倍" : "N/A"}${cnper != null ? ` (= PER × (1 − NC比率))` : ""}
- 増配傾向: ${dividendTrendText}
- シャープレシオ: 6ヶ月 ${sharpe6m != null ? fmt(sharpe6m, 2) : "N/A"} / 1年 ${sharpe1y != null ? fmt(sharpe1y, 2) : "N/A"} / 3年 ${sharpe3y != null ? fmt(sharpe3y, 2) : "N/A"} (> 1.0 で優秀、< 0 はリターン負)
`;

  // アナリスト
  if (numberOfAnalysts && numberOfAnalysts > 0) {
    prompt += `
# アナリストコンセンサス
- 目標株価平均: ${targetMeanPrice != null ? fmt(targetMeanPrice, 0) + `円 (現在比 ${(((targetMeanPrice - price) / price) * 100).toFixed(1)}%)` : "N/A"}
- レーティング: ${recommendationKey ?? "N/A"} (${numberOfAnalysts}名のアナリスト)
`;
  }

  // 決算日
  if (earningsDateStr) {
    const earningsDt = new Date(earningsDateStr);
    const now = new Date();
    const daysUntil = Math.ceil(
      (earningsDt.getTime() - now.getTime()) / 86400000,
    );
    if (daysUntil > 0) {
      prompt += `- 決算発表: ${earningsDateStr} (あと${daysUntil}日)\n`;
    } else {
      prompt += `- 直近決算発表: ${earningsDateStr} (済み)\n`;
    }
  }

  // OHLCVテーブル
  prompt += `
# 直近6ヶ月の日足チャート (OHLCV)

| 日付 | 始値 | 高値 | 安値 | 終値 | 出来高 |
|------|------|------|------|------|--------|
`;
  for (const r of ohlcv) {
    const d = r.date.slice(5); // MM-DD
    prompt += `| ${d} | ${fmt(r.open, 0)} | ${fmt(r.high, 0)} | ${fmt(r.low, 0)} | ${fmt(r.close, 0)} | ${(r.volume ?? 0).toLocaleString()} |\n`;
  }

  // チャート注目ポイント
  if (observations.length > 0) {
    prompt += `\n## チャートの注目ポイント\n`;
    for (const obs of observations) {
      prompt += `- ${obs}\n`;
    }
  }

  // 分析依頼
  prompt += `
# 分析してほしいこと
1. **業績の現状と見通し**（決算資料があれば参照）
2. **バリュエーション面の評価**（割安/割高/適正）
   - 通常PERだけでなく、**CNPER（キャッシュニュートラルPER）**も考慮すること
   - CNPER = PER ×（1 − ネットキャッシュ比率）。NC比率が高い＝手元現金が厚い＝実質的なPERはもっと低い
   - CNPER < 5倍なら超割安圏。ただしROEが低い場合は「万年バリュートラップ」のリスクあり
3. **増配傾向と株主還元**
   - 連続増配年数、直近の増配率、配当性向を評価
   - 3年以上連続増配は経営陣のコミットメントと業績安定性を示す強いプラス材料
   - 逆に減配は業績悪化のシグナル。自社株買いの有無も確認
4. **シャープエッジ（競争優位性）の有無**
   - この企業は同業他社に対して明確な「尖った強み」を持っているか？
   - 参入障壁（特許・技術・ブランド・規制・スイッチングコスト）、ニッチトップ、独占的市場ポジション
   - シャープエッジがある企業は一時的な株価下落後の回復力が強い
   - シャープエッジが不明確ならコモディティ化リスクを指摘
5. **リスク調整後リターン（シャープレシオ）**
   - シャープレシオ > 1.0 はリスクに見合ったリターンが出ている優秀な銘柄
   - シャープレシオ < 0 はリターンが負でリスクを取る意味がない状態
   - ボラティリティが高い銘柄はシャープレシオが低くなりやすい。安定成長株との比較材料に
6. **チャートのトレンドと需給分析**
7. **業界/セクターの動向**とこの銘柄への影響
8. **リスク要因の洗い出し**
9. **総合的な投資判断**: Go（買い推奨）/ No Go（見送り）/ 様子見、その理由
`;

  // ファイル保存
  const { writeFileSync, mkdirSync } = await import("fs");
  const { join } = await import("path");
  const code = symbol.replace(".T", "");
  const outDir = join(process.cwd(), "data", "prompts");
  mkdirSync(outDir, { recursive: true });
  const outPath = join(outDir, `${code}.md`);
  writeFileSync(outPath, prompt, "utf-8");
  console.error(`[info] ファイル保存: ${outPath}`);

  // クリップボードコピー
  try {
    const { execSync } = await import("child_process");
    const cmd = process.platform === "win32" ? "clip" : "pbcopy";
    execSync(cmd, { input: prompt });
    console.error(`[info] クリップボードにもコピーしました`);
  } catch {
    // クリップボード失敗は無視
  }

  if (!copyToClipboard) {
    console.log(prompt);
  }

  console.error(
    `[info] 完了: ${symbol} (${prompt.length.toLocaleString()}文字)`,
  );
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
