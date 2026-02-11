#!/usr/bin/env npx tsx
// ============================================================
// ネットキャッシュ比率スキャナー (Yahoo Finance版)
//
// ネットキャッシュ = 流動資産 + 投資有価証券×70% - 負債
// ネットキャッシュ比率 = ネットキャッシュ / 時価総額
//
// 使い方:
//   npx tsx scripts/scan-net-cash.ts                    # 全銘柄スキャン
//   npx tsx scripts/scan-net-cash.ts --favorites        # お気に入りのみ
//   npx tsx scripts/scan-net-cash.ts --segment prime    # プライム市場のみ
//   npx tsx scripts/scan-net-cash.ts --csv              # CSV出力
//   npx tsx scripts/scan-net-cash.ts --debug            # 生データ確認
//   npx tsx scripts/scan-net-cash.ts --limit 10         # 10銘柄のみ
//   npx tsx scripts/scan-net-cash.ts --symbol 7203.T    # 特定銘柄のみ
// ============================================================

import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { readFileSync, writeFileSync } from "fs";
import { join } from "path";
import YahooFinance from "yahoo-finance2";
import { yfQueue } from "@/lib/utils/requestQueue";

const yf = new YahooFinance({ suppressNotices: ["yahooSurvey"] });

const EXCLUDE_SYMBOLS = new Set(["7817.T"]);

// ── Types ──────────────────────────────────────────────────

interface WatchlistStock {
  symbol: string;
  name: string;
  market: string;
  marketSegment?: string;
  favorite?: boolean;
}

interface NetCashResult {
  symbol: string;
  name: string;
  marketSegment: string;
  marketCap: number;                  // 億円
  currentAssets: number;              // 億円 (流動資産)
  investmentInFinancialAssets: number; // 億円 (投資有価証券近似)
  totalLiabilities: number;           // 億円 (負債合計)
  netCash: number;                    // 億円
  netCashRatio: number;               // %
  per: number | null;
  pbr: number | null;
}

// ── CLI Args ───────────────────────────────────────────────

function parseArgs() {
  const args = process.argv.slice(2);
  const has = (flag: string) => args.includes(flag);
  const get = (flag: string) => {
    const idx = args.indexOf(flag);
    return idx >= 0 && idx + 1 < args.length ? args[idx + 1] : undefined;
  };
  return {
    favorites: has("--favorites"),
    segment: get("--segment"),
    csv: has("--csv"),
    debug: has("--debug"),
    limit: get("--limit") ? parseInt(get("--limit")!, 10) : undefined,
    symbol: get("--symbol"),
  };
}

// ── Load Stocks ────────────────────────────────────────────

function loadStocks(opts: ReturnType<typeof parseArgs>): WatchlistStock[] {
  const raw = readFileSync(join(process.cwd(), "data", "watchlist.json"), "utf-8");
  const watchlist = JSON.parse(raw) as { stocks: WatchlistStock[] };
  let stocks = watchlist.stocks.filter((s) => !EXCLUDE_SYMBOLS.has(s.symbol));

  if (opts.symbol) {
    stocks = stocks.filter((s) => s.symbol === opts.symbol);
    if (stocks.length === 0) {
      console.error(`銘柄が見つかりません: ${opts.symbol}`);
      process.exit(1);
    }
    return stocks;
  }
  if (opts.favorites) {
    stocks = stocks.filter((s) => s.favorite);
  }
  if (opts.segment) {
    const seg = opts.segment.toLowerCase();
    const segMap: Record<string, string> = {
      prime: "プライム",
      standard: "スタンダード",
      growth: "グロース",
    };
    const target = segMap[seg] ?? opts.segment;
    stocks = stocks.filter((s) => s.marketSegment === target);
  }
  if (opts.limit) {
    stocks = stocks.slice(0, opts.limit);
  }
  return stocks;
}

// ── Fetch Balance Sheet + Quote ────────────────────────────

const OKU = 100_000_000; // 1億

async function fetchNetCash(stock: WatchlistStock, debug: boolean): Promise<NetCashResult | null> {
  try {
    // fundamentalsTimeSeries(B/S)とquoteを並列取得
    const period1 = new Date();
    period1.setFullYear(period1.getFullYear() - 1);

    const [bsResult, quoteResult] = await Promise.all([
      yfQueue.add(() =>
        yf.fundamentalsTimeSeries(stock.symbol, {
          period1,
          type: "quarterly",
          module: "balance-sheet",
        })
      ),
      yfQueue.add(() => yf.quote(stock.symbol)),
    ]);

    const q = quoteResult as Record<string, unknown>;
    const marketCap = (q.marketCap as number) ?? 0;
    if (marketCap <= 0) return null;

    const per = (q.trailingPE as number) ?? null;
    const pbr = (q.priceToBook as number) ?? null;

    // 直近の四半期B/Sを取得 (配列の末尾が最新)
    if (!bsResult || bsResult.length === 0) return null;
    const bs = bsResult[bsResult.length - 1] as Record<string, unknown>;

    if (debug) {
      console.log(`\n=== ${stock.symbol} ${stock.name} ===`);
      const keys = Object.keys(bs).filter((k) => bs[k] != null).sort();
      console.log(`有効フィールド (${keys.length}個):`);
      for (const k of keys) {
        const v = bs[k];
        if (typeof v === "number") {
          console.log(`  ${k}: ${(v / OKU).toFixed(1)}億 (${v.toLocaleString()})`);
        } else {
          console.log(`  ${k}: ${v}`);
        }
      }
      return null;
    }

    // 流動資産
    const currentAssets = (bs.currentAssets as number) ?? 0;
    // 投資有価証券の近似: investmentinFinancialAssets > availableForSaleSecurities > investmentsAndAdvances
    const investmentInFA =
      (bs.investmentinFinancialAssets as number) ??
      (bs.availableForSaleSecurities as number) ??
      (bs.investmentsAndAdvances as number) ??
      0;
    // 負債合計
    const totalLiabilities = (bs.totalLiabilitiesNetMinorityInterest as number) ?? 0;

    const netCash = currentAssets + investmentInFA * 0.7 - totalLiabilities;
    const netCashRatio = (netCash / marketCap) * 100;

    return {
      symbol: stock.symbol,
      name: stock.name,
      marketSegment: stock.marketSegment ?? "",
      marketCap: marketCap / OKU,
      currentAssets: currentAssets / OKU,
      investmentInFinancialAssets: investmentInFA / OKU,
      totalLiabilities: totalLiabilities / OKU,
      netCash: netCash / OKU,
      netCashRatio,
      per,
      pbr,
    };
  } catch {
    return null;
  }
}

// ── Main ───────────────────────────────────────────────────

async function main() {
  const opts = parseArgs();
  const stocks = loadStocks(opts);

  console.log(`ネットキャッシュ比率スキャン開始: ${stocks.length} 銘柄`);
  if (opts.debug) {
    console.log("(デバッグモード: 生データ出力)");
  }

  const results: NetCashResult[] = [];
  let completed = 0;
  let errors = 0;

  const BATCH_SIZE = 30;

  for (let i = 0; i < stocks.length; i += BATCH_SIZE) {
    const batch = stocks.slice(i, i + BATCH_SIZE);

    const batchResults = await Promise.allSettled(
      batch.map((stock) => fetchNetCash(stock, opts.debug))
    );

    for (const r of batchResults) {
      completed++;
      if (r.status === "fulfilled" && r.value) {
        results.push(r.value);
      } else if (r.status === "rejected") {
        errors++;
      }
    }

    if (!opts.debug) {
      process.stdout.write(
        `\r  [${completed}/${stocks.length}] 取得完了 (${results.length} 件取得, ${errors} エラー)`
      );
    }
  }

  if (!opts.debug) {
    console.log("");
  }

  if (opts.debug) {
    console.log("\nデバッグモード完了。フィールド名を確認してください。");
    return;
  }

  // ネットキャッシュ比率降順ソート（高い＝割安）
  results.sort((a, b) => b.netCashRatio - a.netCashRatio);

  // ── コンソール出力 ──
  console.log(`\n=== ネットキャッシュ比率ランキング (${results.length} 銘柄) ===\n`);

  console.log(
    [
      "順位".padEnd(4),
      "銘柄".padEnd(12),
      "名前".padEnd(20),
      "市場".padEnd(8),
      "時価総額(億)".padStart(12),
      "NC比率(%)".padStart(10),
      "NC(億)".padStart(10),
      "PER".padStart(8),
      "PBR".padStart(8),
    ].join("  ")
  );
  console.log("-".repeat(110));

  const top = results.slice(0, 50);
  top.forEach((r, i) => {
    console.log(
      [
        String(i + 1).padEnd(4),
        r.symbol.padEnd(12),
        r.name.slice(0, 18).padEnd(20),
        r.marketSegment.slice(0, 6).padEnd(8),
        r.marketCap.toFixed(0).padStart(12),
        r.netCashRatio.toFixed(1).padStart(10),
        r.netCash.toFixed(0).padStart(10),
        (r.per != null ? r.per.toFixed(1) : "-").padStart(8),
        (r.pbr != null ? r.pbr.toFixed(2) : "-").padStart(8),
      ].join("  ")
    );
  });

  // NC比率 > 100% の銘柄数
  const over100 = results.filter((r) => r.netCashRatio > 100).length;
  const over50 = results.filter((r) => r.netCashRatio > 50).length;
  console.log(`\n--- サマリー ---`);
  console.log(`NC比率 > 100%: ${over100} 銘柄 (時価総額以上のネットキャッシュ)`);
  console.log(`NC比率 > 50%:  ${over50} 銘柄`);
  console.log(`データ取得: ${results.length} / ${stocks.length} 銘柄 (${errors} エラー)`);

  // ── CSV出力 ──
  if (opts.csv) {
    const today = new Date().toISOString().split("T")[0];
    const csvPath = join(process.cwd(), "data", `net-cash-${today}.csv`);
    const header = [
      "symbol", "name", "marketSegment",
      "marketCap_oku", "currentAssets_oku", "investmentInFA_oku",
      "totalLiabilities_oku", "netCash_oku", "netCashRatio_pct", "per", "pbr",
    ].join(",");

    const rows = results.map((r) =>
      [
        r.symbol,
        `"${r.name}"`,
        r.marketSegment,
        r.marketCap.toFixed(1),
        r.currentAssets.toFixed(1),
        r.investmentInFinancialAssets.toFixed(1),
        r.totalLiabilities.toFixed(1),
        r.netCash.toFixed(1),
        r.netCashRatio.toFixed(2),
        r.per != null ? r.per.toFixed(1) : "",
        r.pbr != null ? r.pbr.toFixed(2) : "",
      ].join(",")
    );

    writeFileSync(csvPath, [header, ...rows].join("\n"), "utf-8");
    console.log(`\nCSV保存: ${csvPath}`);
  }
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
