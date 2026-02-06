/**
 * JPX上場銘柄一覧を取得してwatchlist.jsonを更新するスクリプト
 *
 * JPXが公開しているExcelファイルをダウンロード・パースし、
 * 全上場銘柄をwatchlist.jsonに登録する。
 * 既存のfundamentalデータやsectorsカスタマイズは保持する。
 *
 * Usage: npx tsx scripts/fetch-all-stocks.ts
 */

import * as fs from "fs";
import * as path from "path";
import * as XLSX from "xlsx";

const JPX_URL =
  "https://www.jpx.co.jp/markets/statistics-equities/misc/tvdivq0000001vg2-att/data_j.xls";

const WATCHLIST_PATH = path.join(process.cwd(), "data", "watchlist.json");

interface ExistingStock {
  symbol: string;
  name: string;
  market: "JP" | "US";
  marketSegment?: string;
  sectors?: string[];
  fundamental?: {
    judgment: "bullish" | "neutral" | "bearish";
    memo: string;
    analyzedAt: string;
  };
}

interface WatchList {
  stocks: ExistingStock[];
  updatedAt: string;
}

// 市場区分のマッピング
const SEGMENT_MAP: Record<string, "プライム" | "スタンダード" | "グロース"> = {
  プライム: "プライム",
  "プライム（内国株式）": "プライム",
  スタンダード: "スタンダード",
  "スタンダード（内国株式）": "スタンダード",
  グロース: "グロース",
  "グロース（内国株式）": "グロース",
};

async function fetchExcel(): Promise<Buffer> {
  console.log(`Fetching JPX listed stocks from: ${JPX_URL}`);
  const res = await fetch(JPX_URL);
  if (!res.ok) {
    throw new Error(`Failed to fetch: ${res.status} ${res.statusText}`);
  }
  const arrayBuffer = await res.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

function parseExcel(buffer: Buffer): ExistingStock[] {
  const workbook = XLSX.read(buffer, { type: "buffer" });
  const sheetName = workbook.SheetNames[0];
  const sheet = workbook.Sheets[sheetName];
  const rows = XLSX.utils.sheet_to_json<Record<string, string>>(sheet);

  console.log(`Parsed ${rows.length} rows from Excel`);

  // Debug: show first row keys
  if (rows.length > 0) {
    console.log("Columns:", Object.keys(rows[0]).join(", "));
  }

  const stocks: ExistingStock[] = [];

  for (const row of rows) {
    // JPXのExcelカラム名（日本語）
    const code = row["コード"] ?? row["銘柄コード"] ?? "";
    const name = row["銘柄名"] ?? row["会社名"] ?? "";
    const market = row["市場・商品区分"] ?? row["市場区分"] ?? "";
    const sector33 = row["33業種コード"] ?? "";
    const sector33Name = row["33業種区分"] ?? "";

    if (!code || !name) continue;

    // ETF、REIT、インフラファンド等を除外（株式のみ）
    const marketStr = String(market);
    if (
      marketStr.includes("ETF") ||
      marketStr.includes("REIT") ||
      marketStr.includes("インフラ") ||
      marketStr.includes("出資証券") ||
      marketStr.includes("PRO Market")
    ) {
      continue;
    }

    // 市場区分を判定
    let marketSegment: "プライム" | "スタンダード" | "グロース" | undefined;
    for (const [key, value] of Object.entries(SEGMENT_MAP)) {
      if (marketStr.includes(key)) {
        marketSegment = value;
        break;
      }
    }

    // 株式以外をスキップ（市場区分が判定できないもの）
    if (!marketSegment) continue;

    const symbol = `${String(code).trim()}.T`;
    const sectors: string[] = [];
    if (sector33Name) sectors.push(String(sector33Name).trim());

    stocks.push({
      symbol,
      name: String(name).trim(),
      market: "JP",
      marketSegment,
      sectors,
    });
  }

  return stocks;
}

function mergeWithExisting(
  newStocks: ExistingStock[],
  existing: WatchList
): WatchList {
  // 既存のfundamentalとカスタムsectorsを保持
  const existingMap = new Map<string, ExistingStock>();
  for (const stock of existing.stocks) {
    existingMap.set(stock.symbol, stock);
  }

  const merged = newStocks.map((stock) => {
    const prev = existingMap.get(stock.symbol);
    if (prev) {
      // 既存銘柄: fundamentalとカスタムsectorsを引き継ぎ
      const mergedSectors = new Set([
        ...(stock.sectors ?? []),
        ...(prev.sectors ?? []).filter(
          (s) =>
            // JPXの33業種以外のカスタムセクターを保持
            !stock.sectors?.length || !isJPXSector(s)
        ),
      ]);
      return {
        ...stock,
        sectors: Array.from(mergedSectors),
        fundamental: prev.fundamental,
      };
    }
    return stock;
  });

  // 米国株など、JPX以外の既存銘柄も保持
  for (const stock of existing.stocks) {
    if (stock.market !== "JP") {
      merged.push(stock);
    }
  }

  return {
    stocks: merged,
    updatedAt: new Date().toISOString(),
  };
}

// JPXの33業種かどうかを判定するヘルパー
const JPX_SECTORS_33 = new Set([
  "水産・農林業",
  "鉱業",
  "建設業",
  "食料品",
  "繊維製品",
  "パルプ・紙",
  "化学",
  "医薬品",
  "石油・石炭製品",
  "ゴム製品",
  "ガラス・土石製品",
  "鉄鋼",
  "非鉄金属",
  "金属製品",
  "機械",
  "電気機器",
  "輸送用機器",
  "精密機器",
  "その他製品",
  "電気・ガス業",
  "陸運業",
  "海運業",
  "空運業",
  "倉庫・運輸関連業",
  "情報・通信業",
  "卸売業",
  "小売業",
  "銀行業",
  "証券、商品先物取引業",
  "保険業",
  "その他金融業",
  "不動産業",
  "サービス業",
]);

function isJPXSector(sector: string): boolean {
  return JPX_SECTORS_33.has(sector);
}

async function main() {
  // 1. JPXからExcelダウンロード
  const buffer = await fetchExcel();

  // 2. パース
  const newStocks = parseExcel(buffer);
  console.log(`Found ${newStocks.length} stocks (ETF/REIT excluded)`);

  // 市場区分別カウント
  const segmentCounts = { プライム: 0, スタンダード: 0, グロース: 0 };
  for (const s of newStocks) {
    if (s.marketSegment && s.marketSegment in segmentCounts) {
      segmentCounts[s.marketSegment as keyof typeof segmentCounts]++;
    }
  }
  console.log(
    `  プライム: ${segmentCounts["プライム"]}, スタンダード: ${segmentCounts["スタンダード"]}, グロース: ${segmentCounts["グロース"]}`
  );

  // 3. 既存データとマージ
  let existing: WatchList = { stocks: [], updatedAt: "" };
  if (fs.existsSync(WATCHLIST_PATH)) {
    existing = JSON.parse(fs.readFileSync(WATCHLIST_PATH, "utf-8"));
    console.log(`Existing watchlist: ${existing.stocks.length} stocks`);
  }

  const merged = mergeWithExisting(newStocks, existing);
  console.log(`Merged watchlist: ${merged.stocks.length} stocks`);

  // 4. 書き出し
  fs.writeFileSync(WATCHLIST_PATH, JSON.stringify(merged, null, 2), "utf-8");
  console.log(`Written to ${WATCHLIST_PATH}`);
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
