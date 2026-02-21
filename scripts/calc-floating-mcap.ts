#!/usr/bin/env npx tsx
// ============================================================
// 浮動株時価総額 バッチ計算スクリプト
//
// EDINET API v2 の有価証券報告書 XBRL から大株主・自己株式データを
// 抽出し、浮動株比率を推計 → statsCache に保存する。
//
// --symbol 指定時: 1銘柄ずつ逐次処理 (EDINET検索+DL+パース)
// 複数銘柄時:       Phase1でEDINET一括検索 → Phase2で並列DL+パース
//
// 使い方:
//   npx tsx scripts/calc-floating-mcap.ts                    # お気に入り銘柄
//   npx tsx scripts/calc-floating-mcap.ts --symbol 7203.T    # 単一銘柄
//   npx tsx scripts/calc-floating-mcap.ts --all              # 全銘柄
//   npx tsx scripts/calc-floating-mcap.ts --csv              # CSV出力
//   npx tsx scripts/calc-floating-mcap.ts --dry-run          # 検索のみ(DLなし)
//   npx tsx scripts/calc-floating-mcap.ts --concurrency 5    # DL並列数(デフォルト3)
// ============================================================

import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { writeFileSync, mkdirSync, existsSync } from "fs";
import { sleep, getArgs, parseFlag, hasFlag, parseIntFlag } from "@/lib/utils/cli";
import { join } from "path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  searchAnnualReportBatch,
  downloadXbrlZip,
  extractMajorShareholders,
  extractTreasuryShares,
  extractTotalShares,
  estimateFloatingRatio,
  findXbrlFiles as findXbrlFilesFromModule,
  type ShareholderEntry,
} from "../src/lib/api/edinetXbrl";
import { setCachedStatsPartial, getCachedStatsAll, setStatsCacheToSupabase } from "../src/lib/cache/statsCache";

// ── 設定 ──

const DL_DELAY_MS = 500; // XBRL DL 間の遅延

// ── CLI引数 ──

interface CLIArgs {
  symbol?: string;
  all: boolean;
  csv: boolean;
  dryRun: boolean;
  debug: boolean;
  searchDays: number;
  concurrency: number;
  skipCached: boolean;
  syncSupabase: boolean;
}

function parseCliArgs(): CLIArgs {
  const args = getArgs();
  return {
    symbol: parseFlag(args, "--symbol"),
    all: hasFlag(args, "--all"),
    csv: hasFlag(args, "--csv"),
    dryRun: hasFlag(args, "--dry-run"),
    debug: hasFlag(args, "--debug"),
    searchDays: parseIntFlag(args, "--days", 400),
    concurrency: parseIntFlag(args, "--concurrency", 3),
    skipCached: hasFlag(args, "--skip-cached"),
    syncSupabase: hasFlag(args, "--sync-supabase"),
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

// ── XBRL パース (ZIP → 浮動株比率) ──

interface ParsedResult {
  majorShareholders: ShareholderEntry[];
  majorShareholderShares: number;
  treasuryShares: number;
  fixedShares: number;
  floatingRatio: number;
  totalShares: number | null;
}

function parseXbrlForFloating(zipBuffer: Buffer, filerName: string): ParsedResult | null {
  const xbrlFiles = findXbrlFilesFromModule(zipBuffer);
  if (xbrlFiles.length === 0) return null;

  let majorShareholders: ShareholderEntry[] = [];
  let treasuryShares = 0;
  let totalSharesXbrl: number | null = null;

  for (const file of xbrlFiles) {
    if (majorShareholders.length === 0) {
      const sh = extractMajorShareholders(file.content);
      if (sh.length > 0) majorShareholders = sh;
    }
    if (treasuryShares === 0) {
      const ts = extractTreasuryShares(file.content);
      if (ts > 0) treasuryShares = ts;
    }
    if (totalSharesXbrl == null) {
      totalSharesXbrl = extractTotalShares(file.content);
    }
  }

  if (majorShareholders.length === 0) return null;

  const majorShareholderShares = majorShareholders.reduce((sum, s) => sum + s.shares, 0);

  // ─── 方法1 (推奨): 大株主の持株比率 (%) から直接計算 ───
  // 有報テーブルの「割合(%)」カラムを使う。totalShares の精度に依存しない。
  const ratioSum = majorShareholders.reduce((sum, s) => sum + s.ratioPct, 0);
  if (ratioSum > 1 && ratioSum <= 100) {
    // 大株主比率合計 = 固定株比率 (概算、自己株式は大株主リスト外の場合が多い)
    // 有報の「割合」は「発行済株式(自己株式除く)に対する」ことが多いので、
    // 自己株式は別途考慮不要 (分母から既に除外済み)
    const floatingRatio = Math.max(0, 1 - ratioSum / 100);
    return {
      majorShareholders,
      majorShareholderShares,
      treasuryShares,
      fixedShares: majorShareholderShares,
      floatingRatio,
      totalShares: totalSharesXbrl,
    };
  }

  // ─── 方法2: 株数ベースの計算 (比率データがない場合のフォールバック) ───
  let totalShares = totalSharesXbrl;
  if (!totalShares || totalShares <= 0) {
    // 大株主の割合合計から逆算 (ratioPct が % で入っている)
    const sharesSum = majorShareholders.reduce((sum, s) => sum + s.shares, 0);
    if (ratioSum > 0 && sharesSum > 0) {
      totalShares = Math.round(sharesSum / (ratioSum / 100));
    }
  }
  if (!totalShares || totalShares <= 0) return null;

  // 大株主に自社名義が含まれる場合は treasury 重複除外
  const filerLower = filerName.toLowerCase();
  const treasuryInMajor = majorShareholders.some(
    (s) => filerLower && s.name.toLowerCase().includes(filerLower),
  );

  let fixedShares = majorShareholderShares;
  if (!treasuryInMajor) fixedShares += treasuryShares;
  if (fixedShares > totalShares) fixedShares = totalShares;

  return {
    majorShareholders,
    majorShareholderShares,
    treasuryShares,
    fixedShares,
    floatingRatio: 1 - fixedShares / totalShares,
    totalShares,
  };
}

// ── 結果型 ──

interface ResultRow {
  symbol: string;
  name: string;
  floatingRatio: number | null;
  majorShareholderShares: number;
  treasuryShares: number;
  fixedShares: number;
  totalShares: number | null;
  docId: string | null;
  filingDate: string | null;
  error: string | null;
}

// ── デバッグ ──

const DEBUG_MAX_DUMPS = 5; // 最大5銘柄分のXBRLをダンプ
let debugDumpCount = 0;

function dumpXbrlDebug(symbol: string, zipBuffer: Buffer, docId: string) {
  const debugDir = join(process.cwd(), "data", "debug-xbrl");
  if (!existsSync(debugDir)) mkdirSync(debugDir, { recursive: true });

  const files = findXbrlFilesFromModule(zipBuffer);
  const symClean = symbol.replace(".T", "");
  const summaryPath = join(debugDir, `${symClean}_${docId}_summary.txt`);

  const lines: string[] = [
    `Symbol: ${symbol}`,
    `DocID: ${docId}`,
    `Files in ZIP (PublicDoc):`,
    ...files.map((f) => `  ${f.name} (${f.content.length} chars)`),
    "",
  ];

  // 各ファイルの先頭を出力 + 大株主関連キーワードの有無
  for (const f of files) {
    const hasTextBlock = /majorshareholderstextblock/i.test(f.content);
    const hasNonNumeric = /nonnumeric/i.test(f.content) && /majorshareholder/i.test(f.content);
    const hasDaikabunushi = f.content.includes("大株主");
    const hasShareTable = /所有株式数/.test(f.content);
    lines.push(`--- ${f.name} ---`);
    lines.push(`  MajorShareholdersTextBlock: ${hasTextBlock}`);
    lines.push(`  nonNumeric+MajorShareholder: ${hasNonNumeric}`);
    lines.push(`  大株主キーワード: ${hasDaikabunushi}`);
    lines.push(`  所有株式数: ${hasShareTable}`);

    // テーブルを含むか
    const tableCount = (f.content.match(/<table/gi) ?? []).length;
    lines.push(`  テーブル数: ${tableCount}`);

    // 大株主テーブル周辺のHTML抜粋
    if (hasDaikabunushi || hasShareTable) {
      const idx = f.content.indexOf("大株主") !== -1
        ? f.content.indexOf("大株主")
        : f.content.indexOf("所有株式数");
      if (idx >= 0) {
        const start = Math.max(0, idx - 200);
        const end = Math.min(f.content.length, idx + 2000);
        lines.push(`  === 抜粋 (offset ${start}-${end}) ===`);
        lines.push(f.content.slice(start, end));
        lines.push("  === /抜粋 ===");
      }
    }
    lines.push("");
  }

  writeFileSync(summaryPath, lines.join("\n"), "utf-8");
  console.log(`  🐛 debug dump: ${summaryPath}`);
}

// ── メイン ──

async function main() {
  const args = parseCliArgs();
  const startTime = Date.now();

  // --sync-supabase: ファイルキャッシュからSupabaseに一括投入
  if (args.syncSupabase) {
    const supabase = createServiceClient();
    console.log("📋 全銘柄をSupabaseから取得中...");
    const allStocksForSync = await getAllStocks(supabase);
    console.log(`🔄 ${allStocksForSync.length}銘柄のファイルキャッシュ → Supabase同期`);
    let synced = 0;
    let skipped = 0;
    for (const { symbol } of allStocksForSync) {
      const cached = getCachedStatsAll(symbol);
      if (cached.floatingRatio !== undefined && cached.floatingRatio !== null) {
        await setStatsCacheToSupabase(symbol, { floatingRatio: cached.floatingRatio });
        synced++;
        if (synced % 100 === 0) process.stdout.write(`  ${synced}件同期済み\r`);
      } else {
        skipped++;
      }
    }
    console.log(`  ✅ ${synced}件同期 / ${skipped}件スキップ (${((Date.now() - startTime) / 1000).toFixed(1)}秒)`);
    return;
  }

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
      console.log("📋 全銘柄をSupabaseから取得中...");
      stocks = await getAllStocks(supabase);
    } else {
      console.log("📋 お気に入り銘柄をSupabaseから取得中...");
      stocks = await getFavoriteStocks(supabase);
    }
  }

  // --skip-cached: キャッシュ済み銘柄をスキップ
  if (args.skipCached && stocks.length > 1) {
    const before = stocks.length;
    stocks = stocks.filter((s) => {
      const cached = getCachedStatsAll(s.symbol);
      return cached.floatingRatio === undefined;
    });
    const skipped = before - stocks.length;
    if (skipped > 0) {
      console.log(`⏭️  ${skipped}件キャッシュ済み → スキップ (残り${stocks.length}件)`);
    }
  }

  console.log(`\n🔍 ${stocks.length}銘柄の浮動株比率を推計します`);
  if (args.dryRun) console.log("  (dry-run: XBRL DL・キャッシュ保存なし)");
  console.log();

  // ─── 単一銘柄: 従来の逐次処理 ───
  if (stocks.length === 1) {
    const { symbol, name } = stocks[0];
    console.log(`━━━ ${symbol} ${name} ━━━`);

    const result = await estimateFloatingRatio(symbol, apiKey, undefined, args.searchDays);
    if (result && !args.dryRun) {
      setCachedStatsPartial(symbol, { floatingRatio: result.floatingRatio });
      console.log(`  ✅ キャッシュ保存: ${(result.floatingRatio * 100).toFixed(1)}%`);
    }

    printResults(result ? [{
      symbol, name,
      floatingRatio: result.floatingRatio,
      majorShareholderShares: result.majorShareholderShares,
      treasuryShares: result.treasuryShares,
      fixedShares: result.fixedShares,
      totalShares: result.totalShares,
      docId: result.docId,
      filingDate: result.filingDate,
      error: null,
    }] : [{
      symbol, name,
      floatingRatio: null, majorShareholderShares: 0, treasuryShares: 0,
      fixedShares: 0, totalShares: null, docId: null, filingDate: null,
      error: "データ取得失敗",
    }], args, startTime);
    return;
  }

  // ─── 複数銘柄: Phase1 一括検索 → Phase2 並列DL+パース ───

  // Phase 1: EDINET 一括検索
  console.log("━━━ Phase 1: EDINET 有報一括検索 ━━━");
  const symbols = stocks.map((s) => s.symbol);
  const docMap = await searchAnnualReportBatch(symbols, apiKey, args.searchDays, (searched, total, found) => {
    process.stdout.write(`  ${searched}/${total}営業日スキャン済み, ${found}/${symbols.length}銘柄発見\r`);
  });
  console.log(`  ✅ ${docMap.size}/${symbols.length}銘柄の有報を発見                    `);
  console.log();

  if (args.dryRun) {
    // dry-run: 検索結果だけ表示して終了
    const results: ResultRow[] = stocks.map(({ symbol, name }) => {
      const doc = docMap.get(symbol);
      return {
        symbol, name,
        floatingRatio: null,
        majorShareholderShares: 0, treasuryShares: 0, fixedShares: 0,
        totalShares: null,
        docId: doc?.docId ?? null,
        filingDate: doc?.filingDate ?? null,
        error: doc ? "(dry-run)" : "有報なし",
      };
    });
    printResults(results, args, startTime);
    return;
  }

  // Phase 2: XBRL DL + パース (並列)
  console.log(`━━━ Phase 2: XBRL DL+パース (${args.concurrency}並列) ━━━`);
  const nameMap = new Map(stocks.map((s) => [s.symbol, s.name]));
  const results: ResultRow[] = [];
  let successCount = 0;
  let failCount = 0;
  let processed = 0;

  // docMap のエントリをキューとして並列処理
  const queue = [...docMap.entries()];
  // 有報が見つからなかった銘柄を先に結果に追加
  for (const { symbol, name } of stocks) {
    if (!docMap.has(symbol)) {
      failCount++;
      results.push({
        symbol, name,
        floatingRatio: null, majorShareholderShares: 0, treasuryShares: 0,
        fixedShares: 0, totalShares: null, docId: null, filingDate: null,
        error: "有報なし",
      });
    }
  }

  // 並列ワーカー
  async function worker() {
    while (queue.length > 0) {
      const item = queue.shift();
      if (!item) break;
      const [symbol, doc] = item;
      const name = nameMap.get(symbol) ?? symbol;

      try {
        const zipBuffer = await downloadXbrlZip(doc.docId, apiKey!);
        await sleep(DL_DELAY_MS);

        if (!zipBuffer) {
          failCount++;
          results.push({
            symbol, name, floatingRatio: null, majorShareholderShares: 0,
            treasuryShares: 0, fixedShares: 0, totalShares: null,
            docId: doc.docId, filingDate: doc.filingDate, error: "XBRL DL失敗",
          });
        } else {
          // TODO: totalShares をYFから取得すればより正確
          // 現状はXBRL内の大株主割合合計からの逆算に依存
          const parsed = parseXbrlForFloating(zipBuffer, doc.filerName);

          if (parsed) {
            successCount++;
            setCachedStatsPartial(symbol, { floatingRatio: parsed.floatingRatio });
            results.push({
              symbol, name,
              floatingRatio: parsed.floatingRatio,
              majorShareholderShares: parsed.majorShareholderShares,
              treasuryShares: parsed.treasuryShares,
              fixedShares: parsed.fixedShares,
              totalShares: parsed.totalShares,
              docId: doc.docId, filingDate: doc.filingDate, error: null,
            });
          } else {
            failCount++;
            results.push({
              symbol, name, floatingRatio: null, majorShareholderShares: 0,
              treasuryShares: 0, fixedShares: 0, totalShares: null,
              docId: doc.docId, filingDate: doc.filingDate, error: "XBRLパース失敗",
            });
            // デバッグ: 失敗したXBRLのファイル一覧とサンプル内容をダンプ
            if (args.debug && debugDumpCount < DEBUG_MAX_DUMPS) {
              debugDumpCount++;
              dumpXbrlDebug(symbol, zipBuffer, doc.docId);
            }
          }
        }
      } catch (e) {
        failCount++;
        results.push({
          symbol, name, floatingRatio: null, majorShareholderShares: 0,
          treasuryShares: 0, fixedShares: 0, totalShares: null,
          docId: doc.docId, filingDate: doc.filingDate,
          error: e instanceof Error ? e.message : String(e),
        });
      }

      processed++;
      process.stdout.write(`  ${processed}/${docMap.size} DL+パース完了 (${successCount}成功/${failCount}失敗)\r`);
    }
  }

  // concurrency 個のワーカーを並列起動
  await Promise.all(Array.from({ length: args.concurrency }, () => worker()));
  console.log(`  ✅ ${processed}/${docMap.size} 完了                                    `);
  console.log();

  printResults(results, args, startTime);
}

// ── 結果出力 ──

function printResults(results: ResultRow[], args: CLIArgs, startTime: number) {
  const successCount = results.filter((r) => r.floatingRatio != null).length;
  const failCount = results.filter((r) => r.floatingRatio == null).length;
  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

  console.log(`${"═".repeat(60)}`);
  console.log(`  完了: ${successCount}成功 / ${failCount}失敗 / ${results.length}銘柄 (${elapsed}秒)`);
  console.log(`${"═".repeat(60)}\n`);

  // テーブル表示
  console.log("  コード      浮動株比率  大株主保有  自己株式    固定株数      書類日");
  console.log("  " + "─".repeat(70));
  // 成功分をソートして表示
  const sorted = [...results].sort((a, b) => a.symbol.localeCompare(b.symbol));
  for (const r of sorted) {
    if (r.floatingRatio != null) {
      console.log(
        `  ${r.symbol.padEnd(10)} ${(r.floatingRatio * 100).toFixed(1).padStart(6)}%` +
        `  ${r.majorShareholderShares.toLocaleString().padStart(12)}` +
        `  ${r.treasuryShares.toLocaleString().padStart(10)}` +
        `  ${r.fixedShares.toLocaleString().padStart(12)}` +
        `  ${r.filingDate ?? "N/A"}`,
      );
    } else {
      console.log(`  ${r.symbol.padEnd(10)}  ── ${r.error ?? "N/A"}`);
    }
  }

  // CSV出力
  if (args.csv) {
    const header = "symbol,name,floating_ratio,major_shareholder_shares,treasury_shares,fixed_shares,total_shares,doc_id,filing_date";
    const csvRows = results
      .filter((r) => r.floatingRatio != null)
      .map((r) =>
        [
          r.symbol,
          `"${r.name}"`,
          r.floatingRatio?.toFixed(4) ?? "",
          r.majorShareholderShares,
          r.treasuryShares,
          r.fixedShares,
          r.totalShares ?? "",
          r.docId ?? "",
          r.filingDate ?? "",
        ].join(","),
      );
    const csv = [header, ...csvRows].join("\n");
    const filename = `floating_mcap_${new Date().toISOString().split("T")[0]}.csv`;
    const filepath = join(process.cwd(), "data", filename);
    writeFileSync(filepath, csv, "utf-8");
    console.log(`\n📄 CSV出力: ${filepath}`);
  }
}

main().catch((e) => {
  console.error("Fatal error:", e);
  process.exit(1);
});
