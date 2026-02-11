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

  // データ取得
  const [quote, summary, chart] = await Promise.all([
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
  ]);

  const fd = summary.financialData ?? {};
  const ks = summary.defaultKeyStatistics ?? {};
  const cal = summary.calendarEvents ?? {};
  const ap = summary.assetProfile ?? {};

  // 株価データ
  const price = quote.regularMarketPrice ?? 0;
  const prevClose = quote.regularMarketPreviousClose ?? 0;
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
  const pbr = quote.priceToBook;
  const eps = quote.epsTrailingTwelveMonths;
  const divYield = quote.dividendYield;

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
1. 業績の現状と見通し（決算資料があれば参照）
2. バリュエーション面の評価（割安/割高/適正）
3. チャートのトレンドと需給分析
4. 業界/セクターの動向とこの銘柄への影響
5. リスク要因の洗い出し
6. 総合的な投資判断: Go（買い推奨）/ No Go（見送り）/ 様子見、その理由
`;

  // 出力
  if (copyToClipboard) {
    try {
      const { execSync } = await import("child_process");
      // Windows: clip, macOS: pbcopy
      const cmd =
        process.platform === "win32" ? "clip" : "pbcopy";
      execSync(cmd, { input: prompt });
      console.error(`[info] プロンプトをクリップボードにコピーしました (${prompt.length.toLocaleString()}文字)`);
    } catch {
      console.error("[warn] クリップボードコピーに失敗。標準出力に出力します。");
      console.log(prompt);
    }
  } else {
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
