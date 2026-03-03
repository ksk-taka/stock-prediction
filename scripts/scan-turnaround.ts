#!/usr/bin/env npx tsx
// ============================================================
// ターンアラウンド（営業赤字→黒字転換）スクリーナー
//
// 営業利益が赤字→黒字に転換した銘柄を検出する。
// ピーター・リンチのターンアラウンド投資手法に基づく。
//
// Usage:
//   npx tsx scripts/scan-turnaround.ts               # お気に入りのみ
//   npx tsx scripts/scan-turnaround.ts --all          # 全銘柄
//   npx tsx scripts/scan-turnaround.ts --csv          # CSV出力
//   npx tsx scripts/scan-turnaround.ts --verify       # 検証銘柄のみ
//
// Options:
//   --all              全TSE銘柄
//   --segment <name>   市場区分フィルタ (prime/standard/growth/プライム/スタンダード/グロース)
//   --min-loss <N>     最小連続赤字年数 (default: 1)
//   --max-loss <N>     最大連続赤字年数
//   --max-mcap <N>     時価総額上限(億円)
//   --max-price <N>    株価上限(円)
//   --revenue-growth   増収黒字転換のみ
//   --csv              CSV出力
//   --verify           検証銘柄のみ
//   --limit <N>        スキャン件数制限
// ============================================================

import { readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { getArgs, hasFlag, parseFlag, parseIntFlag } from "@/lib/utils/cli";
import {
  screenTurnaround,
  DEFAULT_OPTIONS,
  type TurnaroundResult,
  type TurnaroundScreenerOptions,
} from "@/lib/screener/turnaround";

// ── 定数 ──

const EXCLUDE_SYMBOLS = new Set(["7817.T"]); // パラマウントベッドHD (YF data error)

const VERIFY_STOCKS = [
  { symbol: "4506.T", name: "住友ファーマ" },
  { symbol: "7003.T", name: "三井E&S" },
  // 記事で挙げられた候補銘柄
  { symbol: "3401.T", name: "帝人" },
  { symbol: "4324.T", name: "電通グループ" },
  { symbol: "4902.T", name: "コニカミノルタ" },
  { symbol: "5201.T", name: "AGC" },
  { symbol: "6963.T", name: "ローム" },
  { symbol: "4676.T", name: "フジ・メディアHD" },
  { symbol: "7201.T", name: "日産自動車" },
];

const SEGMENT_MAP: Record<string, string> = {
  prime: "プライム",
  standard: "スタンダード",
  growth: "グロース",
};

// ── 銘柄読み込み ──

interface WatchlistStock {
  symbol: string;
  name: string;
  market: string;
  marketSegment?: string;
  favorite?: boolean;
  sectors?: string[];
}

function loadStocks(opts: {
  allStocks: boolean;
  favoritesOnly: boolean;
  segment: string | null;
  limit: number;
  verifyOnly: boolean;
}): WatchlistStock[] {
  if (opts.verifyOnly) {
    return VERIFY_STOCKS.map((s) => ({
      symbol: s.symbol,
      name: s.name,
      market: "JP",
    }));
  }

  const raw = readFileSync(join(process.cwd(), "data", "watchlist.json"), "utf-8");
  const watchlist = JSON.parse(raw) as { stocks: WatchlistStock[] };
  let stocks = watchlist.stocks.filter((s) => {
    if (EXCLUDE_SYMBOLS.has(s.symbol)) return false;
    if (s.market !== "JP") return false;
    if (opts.favoritesOnly) return s.favorite === true;
    if (opts.allStocks) return true;
    if (opts.segment) return s.marketSegment === opts.segment;
    return s.favorite === true; // default: favorites
  });

  if (opts.limit > 0) {
    stocks = stocks.slice(0, opts.limit);
  }

  return stocks;
}

// ── CLI引数パース ──

function parseCliArgs() {
  const args = getArgs();
  const allStocks = hasFlag(args, "--all");
  const verifyOnly = hasFlag(args, "--verify");
  const outputCsv = hasFlag(args, "--csv");
  const requireRevenueGrowth = hasFlag(args, "--revenue-growth");
  const limit = parseIntFlag(args, "--limit", 0);
  const minLoss = parseIntFlag(args, "--min-loss", 1);
  const maxLossStr = parseFlag(args, "--max-loss");
  const maxLoss = maxLossStr ? parseInt(maxLossStr, 10) : Infinity;
  const maxMcapStr = parseFlag(args, "--max-mcap");
  const maxMcap = maxMcapStr ? parseFloat(maxMcapStr) : null;
  const maxPriceStr = parseFlag(args, "--max-price");
  const maxPrice = maxPriceStr ? parseFloat(maxPriceStr) : null;
  const segmentRaw = parseFlag(args, "--segment");
  const segment = segmentRaw
    ? SEGMENT_MAP[segmentRaw.toLowerCase()] ?? segmentRaw
    : null;

  const favoritesOnly = !allStocks && !verifyOnly && !segment;

  return {
    allStocks,
    favoritesOnly,
    verifyOnly,
    outputCsv,
    limit,
    segment,
    options: {
      ...DEFAULT_OPTIONS,
      minConsecutiveLoss: minLoss,
      maxConsecutiveLoss: maxLoss,
      requireRevenueGrowth,
      maxMarketCapBillionYen: maxMcap,
      maxPriceYen: maxPrice,
    } as TurnaroundScreenerOptions,
  };
}

// ── 表示 ──

function printResults(results: TurnaroundResult[]) {
  if (results.length === 0) {
    console.log("\n  ターンアラウンド候補は見つかりませんでした。\n");
    return;
  }

  // ヘッダー
  console.log("");
  console.log(
    "コード    | 企業名               | 業種           | 時価総額(億) | 株価     | 連赤字 | 黒転FY | OP前年(百万) | OP黒転(百万) | 売上変化%  | PER     | PBR"
  );
  console.log(
    "----------|----------------------|----------------|-------------|---------|--------|--------|-------------|-------------|-----------|---------|------"
  );

  for (const r of results) {
    const nameStr = (r.name ?? "").padEnd(20).slice(0, 20);
    const segmentStr = (r.marketSegment ?? "-").padEnd(14).slice(0, 14);
    const mcapStr = r.marketCap != null
      ? String(r.marketCap.toLocaleString()).padStart(11)
      : "          -";
    const priceStr = r.currentPrice != null
      ? r.currentPrice.toLocaleString().padStart(7)
      : "      -";
    const lossYrsStr = String(r.consecutiveLossYears).padStart(5);
    const fyStr = String(r.turnaroundFiscalYear).padStart(6);
    const opPriorStr = (r.priorLossAmount / 1e6).toFixed(0).padStart(11);
    const opTurnStr = (r.turnaroundProfitAmount / 1e6).toFixed(0).padStart(11);
    const revGrowthStr = r.revenueGrowthPct != null
      ? `${r.revenueGrowthPct.toFixed(1)}%`.padStart(9)
      : "        -";
    const perStr = r.per != null ? r.per.toFixed(1).padStart(7) : "      -";
    const pbrStr = r.pbr != null ? r.pbr.toFixed(2).padStart(5) : "    -";

    const code = r.symbol.replace(".T", "").padEnd(8);
    console.log(
      `${code}  | ${nameStr} | ${segmentStr} | ${mcapStr} | ${priceStr} | ${lossYrsStr}  | ${fyStr} | ${opPriorStr} | ${opTurnStr} | ${revGrowthStr} | ${perStr} | ${pbrStr}`
    );
  }

  console.log(`\n  合計: ${results.length} 銘柄\n`);
}

function writeCsv(results: TurnaroundResult[], filename: string) {
  const headers = [
    "symbol",
    "name",
    "marketSegment",
    "sectors",
    "consecutiveLossYears",
    "turnaroundFiscalYear",
    "opIncomePriorMM",
    "opIncomeTurnaroundMM",
    "revenueGrowthPct",
    "marketCapBillionYen",
    "currentPrice",
    "per",
    "pbr",
    "turnaroundDate",
    "incomeHistory",
  ].join(",");

  const rows = results.map((r) => {
    const opPriorMM = (r.priorLossAmount / 1e6).toFixed(0);
    const opTurnMM = (r.turnaroundProfitAmount / 1e6).toFixed(0);
    const historyStr = r.incomeHistory
      .map((h) => `${h.fiscalYear}:${(h.operatingIncome / 1e6).toFixed(0)}`)
      .join(";");
    return [
      r.symbol,
      `"${r.name}"`,
      r.marketSegment ?? "",
      `"${r.sectors.join(",")}"`,
      r.consecutiveLossYears,
      r.turnaroundFiscalYear,
      opPriorMM,
      opTurnMM,
      r.revenueGrowthPct ?? "",
      r.marketCap ?? "",
      r.currentPrice ?? "",
      r.per ?? "",
      r.pbr ?? "",
      r.turnaroundDate,
      `"${historyStr}"`,
    ].join(",");
  });

  const csv = [headers, ...rows].join("\n");
  const outPath = join(process.cwd(), "data", filename);
  writeFileSync(outPath, csv, "utf-8");
  console.log(`  CSV saved: ${outPath}`);
}

// ── メイン ──

async function main() {
  const opts = parseCliArgs();
  const stocks = loadStocks(opts);

  console.log("=".repeat(70));
  console.log("  ターンアラウンド（営業赤字→黒字転換）スクリーナー");
  console.log("=".repeat(70));
  console.log(`  対象: ${stocks.length} 銘柄`);
  console.log(`  最小連続赤字: ${opts.options.minConsecutiveLoss}年`);
  if (opts.options.maxConsecutiveLoss < Infinity) {
    console.log(`  最大連続赤字: ${opts.options.maxConsecutiveLoss}年`);
  }
  if (opts.options.requireRevenueGrowth) {
    console.log("  増収黒字転換のみ: ON");
  }
  if (opts.options.maxMarketCapBillionYen != null) {
    console.log(`  時価総額上限: ${opts.options.maxMarketCapBillionYen}億円`);
  }
  if (opts.options.maxPriceYen != null) {
    console.log(`  株価上限: ${opts.options.maxPriceYen}円`);
  }
  console.log("");

  const results: TurnaroundResult[] = [];
  const BATCH_SIZE = 30;
  let processed = 0;

  for (let i = 0; i < stocks.length; i += BATCH_SIZE) {
    const batch = stocks.slice(i, i + BATCH_SIZE);
    const batchResults = await Promise.allSettled(
      batch.map((stock) =>
        screenTurnaround(
          stock.symbol,
          stock.name,
          stock.marketSegment ?? null,
          stock.sectors ?? [],
          opts.options
        )
      )
    );

    for (const result of batchResults) {
      if (result.status === "fulfilled" && result.value != null) {
        results.push(result.value);
      }
    }

    processed += batch.length;
    process.stdout.write(
      `\r  スキャン中... ${processed}/${stocks.length} (検出: ${results.length})`
    );
  }

  console.log(
    `\r  スキャン完了: ${processed} 銘柄, 検出: ${results.length} 銘柄            `
  );

  // 連続赤字年数(降順) → 黒転FY(降順) でソート
  results.sort((a, b) => {
    if (b.consecutiveLossYears !== a.consecutiveLossYears) {
      return b.consecutiveLossYears - a.consecutiveLossYears;
    }
    return b.turnaroundFiscalYear - a.turnaroundFiscalYear;
  });

  printResults(results);

  if (opts.outputCsv) {
    const date = new Date().toISOString().split("T")[0];
    writeCsv(results, `turnaround-${date}.csv`);
  }
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
