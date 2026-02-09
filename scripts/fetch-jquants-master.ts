#!/usr/bin/env npx tsx
// ============================================================
// J-Quants マスタデータ取得 & ウォッチリスト銘柄情報の充実化
//
// 使い方:
//   npx tsx scripts/fetch-jquants-master.ts              # ウォッチリスト更新
//   npx tsx scripts/fetch-jquants-master.ts --dry-run    # プレビューのみ
//   npx tsx scripts/fetch-jquants-master.ts --dump       # 全マスタをCSV出力
//   npx tsx scripts/fetch-jquants-master.ts --code 7203  # 特定銘柄のみ表示
// ============================================================

import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { readFileSync, writeFileSync } from "fs";
import { join } from "path";
import { getMasterData } from "@/lib/api/jquants";
import { fromJQuantsCode } from "@/types/jquants";
import type { JQuantsMasterItem } from "@/types/jquants";
import {
  getCachedMaster,
  setCachedMaster,
} from "@/lib/cache/jquantsCache";

// ── CLI引数 ──

function parseArgs() {
  const args = process.argv.slice(2);
  const get = (flag: string) => {
    const idx = args.indexOf(flag);
    return idx >= 0 && idx + 1 < args.length ? args[idx + 1] : undefined;
  };
  return {
    dryRun: args.includes("--dry-run"),
    dump: args.includes("--dump"),
    code: get("--code"),
    force: args.includes("--force"),
  };
}

// ── ウォッチリスト ──

interface WatchlistStock {
  symbol: string;
  name: string;
  market: string;
  marketSegment?: string;
  sectors?: string[];
  favorite?: boolean;
  fundamental?: unknown;
}

interface Watchlist {
  stocks: WatchlistStock[];
  updatedAt: string;
}

function loadWatchlist(): Watchlist {
  const raw = readFileSync(join(process.cwd(), "data", "watchlist.json"), "utf-8");
  return JSON.parse(raw);
}

function saveWatchlist(wl: Watchlist) {
  wl.updatedAt = new Date().toISOString();
  writeFileSync(
    join(process.cwd(), "data", "watchlist.json"),
    JSON.stringify(wl, null, 2),
    "utf-8"
  );
}

// ── マスタデータ取得 ──

async function fetchMasterData(opts: ReturnType<typeof parseArgs>): Promise<JQuantsMasterItem[]> {
  // 特定銘柄指定
  if (opts.code) {
    console.log(`銘柄コード ${opts.code} のマスタデータを取得...`);
    return getMasterData({ code: opts.code });
  }

  // キャッシュ確認
  if (!opts.force) {
    const cached = getCachedMaster("all");
    if (cached) {
      console.log(`キャッシュから ${cached.length} 件のマスタデータを読み込み`);
      return cached;
    }
  }

  // API呼び出し
  console.log("J-Quants API から全銘柄マスタデータを取得中...");
  const data = await getMasterData();
  console.log(`${data.length} 件取得完了`);

  // キャッシュ保存
  setCachedMaster("all", data);
  return data;
}

// ── CSVダンプ ──

function dumpToCSV(data: JQuantsMasterItem[]) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const fileName = `jquants-master-${timestamp}.csv`;
  const filePath = join(process.cwd(), "data", fileName);

  const headers = ["Code", "Symbol", "CoName", "CoNameEn", "S17", "S17Nm", "S33", "S33Nm", "ScaleCat", "Mkt", "MktNm"];
  const rows = data.map((d) =>
    [
      d.Code,
      fromJQuantsCode(d.Code),
      `"${d.CoName}"`,
      `"${d.CoNameEn}"`,
      d.S17,
      `"${d.S17Nm}"`,
      d.S33,
      `"${d.S33Nm}"`,
      `"${d.ScaleCat}"`,
      d.Mkt,
      `"${d.MktNm}"`,
    ].join(",")
  );

  writeFileSync(filePath, [headers.join(","), ...rows].join("\n"), "utf-8");
  console.log(`\nCSV出力: ${filePath} (${data.length}件)`);
}

// ── ウォッチリスト更新 ──

function updateWatchlist(wl: Watchlist, masterMap: Map<string, JQuantsMasterItem>, dryRun: boolean) {
  let updated = 0;

  for (const stock of wl.stocks) {
    if (stock.market !== "JP") continue;

    // "7203.T" → "72030" でマスタ検索
    const code4 = stock.symbol.replace(/\.T$/, "");
    const code5 = code4.length === 4 ? code4 + "0" : code4;
    const master = masterMap.get(code5);

    if (!master) continue;

    // セクター情報更新
    const newSectors = [master.S33Nm];
    if (master.S17Nm && master.S17Nm !== master.S33Nm) {
      newSectors.push(master.S17Nm);
    }

    const sectorsChanged =
      !stock.sectors ||
      stock.sectors.length !== newSectors.length ||
      stock.sectors.some((s, i) => s !== newSectors[i]);

    // 市場区分更新
    const marketSegmentMap: Record<string, "プライム" | "スタンダード" | "グロース"> = {
      プライム: "プライム",
      スタンダード: "スタンダード",
      グロース: "グロース",
    };
    const newSegment = marketSegmentMap[master.MktNm] ?? undefined;
    const segmentChanged = newSegment && stock.marketSegment !== newSegment;

    if (sectorsChanged || segmentChanged) {
      if (dryRun) {
        console.log(
          `  [DRY] ${stock.symbol} ${stock.name}: ` +
            `sectors: [${stock.sectors?.join(", ") ?? "なし"}] → [${newSectors.join(", ")}]` +
            (segmentChanged ? `, segment: ${stock.marketSegment ?? "なし"} → ${newSegment}` : "")
        );
      } else {
        stock.sectors = newSectors;
        if (newSegment) stock.marketSegment = newSegment;
      }
      updated++;
    }
  }

  return updated;
}

// ── メイン ──

async function main() {
  const opts = parseArgs();

  console.log("=".repeat(60));
  console.log("J-Quants マスタデータ取得");
  console.log(`  モード: ${opts.dump ? "CSVダンプ" : opts.dryRun ? "プレビュー" : "ウォッチリスト更新"}`);
  console.log("=".repeat(60));

  const masterData = await fetchMasterData(opts);

  if (masterData.length === 0) {
    console.log("マスタデータが取得できませんでした");
    return;
  }

  // 特定銘柄表示
  if (opts.code) {
    for (const item of masterData) {
      console.log(`\n--- ${fromJQuantsCode(item.Code)} (${item.Code}) ---`);
      console.log(`  会社名: ${item.CoName} (${item.CoNameEn})`);
      console.log(`  17業種: [${item.S17}] ${item.S17Nm}`);
      console.log(`  33業種: [${item.S33}] ${item.S33Nm}`);
      console.log(`  規模: ${item.ScaleCat}`);
      console.log(`  市場: [${item.Mkt}] ${item.MktNm}`);
      console.log(`  基準日: ${item.Date}`);
    }
    return;
  }

  // CSVダンプ
  if (opts.dump) {
    dumpToCSV(masterData);
    return;
  }

  // ウォッチリスト更新
  const masterMap = new Map<string, JQuantsMasterItem>();
  for (const item of masterData) {
    masterMap.set(item.Code, item);
  }

  const wl = loadWatchlist();
  const jpStocks = wl.stocks.filter((s) => s.market === "JP");
  console.log(`\nウォッチリスト: ${jpStocks.length} 銘柄 (JP)`);
  console.log(`マスタデータ: ${masterData.length} 件`);

  const updated = updateWatchlist(wl, masterMap, opts.dryRun);

  if (opts.dryRun) {
    console.log(`\n${updated} 銘柄が更新対象 (--dry-run のため保存しません)`);
  } else if (updated > 0) {
    saveWatchlist(wl);
    console.log(`\n${updated} 銘柄のセクター情報を更新しました`);
  } else {
    console.log("\n更新対象の銘柄はありませんでした");
  }

  console.log("=".repeat(60));
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
