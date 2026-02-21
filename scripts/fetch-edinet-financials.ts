#!/usr/bin/env npx tsx
// ============================================================
// EDINET XBRL 財務データ バッチ取得スクリプト
//
// EDINET API v2 の有価証券報告書 XBRL から財務諸表データ
// (B/S, P/L, C/F) を抽出し、edinetCache に保存する。
//
// 使い方:
//   npx tsx scripts/fetch-edinet-financials.ts                    # お気に入り銘柄
//   npx tsx scripts/fetch-edinet-financials.ts --all              # 全銘柄
//   npx tsx scripts/fetch-edinet-financials.ts --symbol 7203.T    # 単一銘柄
//   npx tsx scripts/fetch-edinet-financials.ts --csv              # CSV出力
//   npx tsx scripts/fetch-edinet-financials.ts --dry-run          # 検索のみ(DLなし)
//   npx tsx scripts/fetch-edinet-financials.ts --force            # キャッシュ無視
// ============================================================

import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { writeFileSync } from "fs";
import { join } from "path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  getEdinetFinancials,
  getEdinetFinancialsBatch,
  formatFinancialsForLLM,
  type EdinetFinancialData,
} from "../src/lib/api/edinetFinancials";

// ── CLI引数 ──

interface CLIArgs {
  symbol?: string;
  all: boolean;
  csv: boolean;
  dryRun: boolean;
  force: boolean;
  searchDays: number;
}

function parseArgs(): CLIArgs {
  const args = process.argv.slice(2);
  const get = (flag: string) => {
    const idx = args.indexOf(flag);
    return idx >= 0 && idx + 1 < args.length ? args[idx + 1] : undefined;
  };
  return {
    symbol: get("--symbol"),
    all: args.includes("--all"),
    csv: args.includes("--csv"),
    dryRun: args.includes("--dry-run"),
    force: args.includes("--force"),
    searchDays: parseInt(get("--days") ?? "400", 10),
  };
}

// ── Supabase ──

function createServiceClient(): SupabaseClient {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

interface StockInfo {
  symbol: string;
  name: string;
}

async function getFavoriteStocks(supabase: SupabaseClient): Promise<StockInfo[]> {
  const PAGE_SIZE = 1000;
  const allStocks: StockInfo[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .from("stocks")
      .select("symbol, name")
      .eq("favorite", true)
      .order("created_at", { ascending: true })
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    const rows = (data ?? []) as Array<{ symbol: string; name: string }>;
    allStocks.push(...rows);
    if (rows.length < PAGE_SIZE) break;
  }
  return allStocks;
}

async function getAllStocks(supabase: SupabaseClient): Promise<StockInfo[]> {
  const PAGE_SIZE = 1000;
  const allStocks: StockInfo[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .from("stocks")
      .select("symbol, name")
      .order("symbol", { ascending: true })
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    const rows = (data ?? []) as Array<{ symbol: string; name: string }>;
    allStocks.push(...rows);
    if (rows.length < PAGE_SIZE) break;
  }
  return allStocks;
}

// ── メイン ──

const OKU = 100_000_000;

function fmtOku(n: number | null): string {
  if (n == null) return "N/A";
  return `${(n / OKU).toFixed(0)}`;
}

async function main() {
  const args = parseArgs();
  const startTime = Date.now();

  const apiKey = process.env.EDINET_API_KEY;
  if (!apiKey) {
    console.error("EDINET_API_KEY が設定されていません (.env.local に追加)");
    process.exit(1);
  }

  // 対象銘柄取得
  let stocks: StockInfo[];
  if (args.symbol) {
    const sym = args.symbol.endsWith(".T") ? args.symbol : `${args.symbol}.T`;
    stocks = [{ symbol: sym, name: sym }];
  } else {
    const supabase = createServiceClient();
    if (args.all) {
      console.log("全銘柄をSupabaseから取得中...");
      stocks = await getAllStocks(supabase);
    } else {
      console.log("お気に入り銘柄をSupabaseから取得中...");
      stocks = await getFavoriteStocks(supabase);
    }
  }

  console.log(`\n${stocks.length}銘柄のEDINET財務データを取得します`);
  if (args.dryRun) console.log("  (dry-run: XBRL DL・キャッシュ保存なし)");
  if (args.force) console.log("  (force: キャッシュ無視)");
  console.log();

  // ─── 単一銘柄 ───
  if (stocks.length === 1) {
    const { symbol, name } = stocks[0];
    console.log(`--- ${symbol} ${name} ---`);

    const data = await getEdinetFinancials(symbol, apiKey, {
      searchDays: args.searchDays,
      forceRefresh: args.force,
    });

    if (data) {
      console.log(`\n${formatFinancialsForLLM(data)}`);
      console.log(`\nキャッシュ保存済み`);
    } else {
      console.log("データ取得失敗");
    }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    console.log(`\n完了 (${elapsed}秒)`);
    return;
  }

  // ─── 複数銘柄 (バッチ) ───
  const symbols = stocks.map((s) => s.symbol);
  const nameMap = new Map(stocks.map((s) => [s.symbol, s.name]));
  let successCount = 0;
  let failCount = 0;

  const results = await getEdinetFinancialsBatch(
    symbols,
    apiKey,
    { searchDays: args.searchDays, forceRefresh: args.force },
    (done, total, sym) => {
      const name = nameMap.get(sym) ?? sym;
      const data = results.get(sym);
      if (data) {
        successCount++;
        process.stdout.write(`\r  ${done}/${total} ${sym} ${name} -> OK    `);
      } else {
        failCount++;
        process.stdout.write(`\r  ${done}/${total} ${sym} ${name} -> FAIL  `);
      }
    },
  );
  console.log();

  // 結果集計
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  const cachedCount = results.size - successCount;

  console.log(`\n${"=".repeat(60)}`);
  console.log(`  完了: ${results.size}取得 (${successCount}新規 + ${cachedCount}キャッシュ) / ${stocks.length - results.size}失敗 (${elapsed}秒)`);
  console.log(`${"=".repeat(60)}\n`);

  // テーブル表示
  console.log("  コード      売上高(億) 営業利益(億) 純利益(億) 流動資産(億) 投資有価(億) 負債合計(億) 決算期末");
  console.log("  " + "-".repeat(95));

  const sorted = [...results.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  for (const [sym, data] of sorted) {
    const name = (nameMap.get(sym) ?? "").slice(0, 8).padEnd(8);
    console.log(
      `  ${sym.padEnd(10)} ${fmtOku(data.netSales).padStart(8)} ${fmtOku(data.operatingIncome).padStart(10)}` +
      ` ${fmtOku(data.netIncome).padStart(8)} ${fmtOku(data.currentAssets).padStart(10)}` +
      ` ${fmtOku(data.investmentSecurities).padStart(10)} ${fmtOku(data.totalLiabilities).padStart(10)}` +
      `  ${data.fiscalYearEnd || "N/A"}`,
    );
  }

  // CSV出力
  if (args.csv) {
    const header = "symbol,name,net_sales,operating_income,ordinary_income,net_income,current_assets,investment_securities,total_assets,total_liabilities,stockholders_equity,net_assets,operating_cf,investing_cf,fcf,capex,dps,fiscal_year_end,filing_date,doc_id";
    const csvRows = sorted.map(([sym, d]) =>
      [
        sym,
        `"${nameMap.get(sym) ?? ""}"`,
        d.netSales ?? "",
        d.operatingIncome ?? "",
        d.ordinaryIncome ?? "",
        d.netIncome ?? "",
        d.currentAssets ?? "",
        d.investmentSecurities ?? "",
        d.totalAssets ?? "",
        d.totalLiabilities ?? "",
        d.stockholdersEquity ?? "",
        d.netAssets ?? "",
        d.operatingCashFlow ?? "",
        d.investingCashFlow ?? "",
        d.freeCashFlow ?? "",
        d.capitalExpenditure ?? "",
        d.dividendPerShare ?? "",
        d.fiscalYearEnd,
        d.filingDate,
        d.docId,
      ].join(","),
    );
    const csv = [header, ...csvRows].join("\n");
    const filename = `edinet_financials_${new Date().toISOString().split("T")[0]}.csv`;
    const filepath = join(process.cwd(), "data", filename);
    writeFileSync(filepath, csv, "utf-8");
    console.log(`\nCSV出力: ${filepath}`);
  }

  // 未取得銘柄
  const missing = stocks.filter((s) => !results.has(s.symbol));
  if (missing.length > 0) {
    console.log(`\n未取得銘柄 (${missing.length}件):`);
    for (const s of missing.slice(0, 20)) {
      console.log(`  ${s.symbol} ${s.name}`);
    }
    if (missing.length > 20) console.log(`  ... 他${missing.length - 20}件`);
  }
}

main().catch((e) => {
  console.error("Fatal error:", e);
  process.exit(1);
});
