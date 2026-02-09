import { NextResponse } from "next/server";
import { readdirSync, readFileSync } from "fs";
import { join } from "path";

export const dynamic = "force-dynamic";

interface NewHighStock {
  code: string;
  symbol: string;
  name: string;
  market: string;
  price: number;
  changePct: number;
  volume: number;
  per: number | null;
  pbr: number | null;
  yield: number | null;
  fiftyTwoWeekHigh: number;
  currentYfPrice: number;
  isTrue52wBreakout: boolean;
  pctAbove52wHigh: number;
  consolidationDays: number;
  consolidationRangePct: number;
}

function parseRow(header: string[], row: string): NewHighStock | null {
  // Handle quoted fields
  const fields: string[] = [];
  let current = "";
  let inQuote = false;
  for (const ch of row) {
    if (ch === '"') {
      inQuote = !inQuote;
    } else if (ch === "," && !inQuote) {
      fields.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  fields.push(current);

  if (fields.length < header.length) return null;

  const get = (name: string) => fields[header.indexOf(name)] ?? "";
  const num = (name: string) => {
    const v = get(name);
    return v === "" ? null : parseFloat(v);
  };

  return {
    code: get("code"),
    symbol: get("symbol"),
    name: get("name"),
    market: get("market"),
    price: num("price") ?? 0,
    changePct: num("changePct") ?? 0,
    volume: num("volume") ?? 0,
    per: num("per"),
    pbr: num("pbr"),
    yield: num("yield"),
    fiftyTwoWeekHigh: num("fiftyTwoWeekHigh") ?? 0,
    currentYfPrice: num("currentYfPrice") ?? 0,
    isTrue52wBreakout: get("isTrue52wBreakout") === "TRUE",
    pctAbove52wHigh: num("pctAbove52wHigh") ?? 0,
    consolidationDays: num("consolidationDays") ?? 0,
    consolidationRangePct: num("consolidationRangePct") ?? 0,
  };
}

export async function GET() {
  try {
    const dataDir = join(process.cwd(), "data");
    const files = readdirSync(dataDir)
      .filter((f) => f.startsWith("new-highs-") && f.endsWith(".csv"))
      .sort()
      .reverse();

    if (files.length === 0) {
      return NextResponse.json({
        stocks: [],
        scannedAt: null,
        error: "CSVデータがありません。npm run scan:highs:csv を実行してください。",
      });
    }

    const latestFile = files[0];
    // Extract timestamp from filename: new-highs-2026-02-08T13-08-15.csv
    const tsMatch = latestFile.match(/new-highs-(.+)\.csv/);
    const scannedAt = tsMatch
      ? tsMatch[1].replace(/T/, "T").replace(/-(\d{2})-(\d{2})$/, ":$1:$2")
      : null;

    const content = readFileSync(join(dataDir, latestFile), "utf-8");
    const lines = content.trim().split("\n");
    if (lines.length < 2) {
      return NextResponse.json({ stocks: [], scannedAt, error: "CSVが空です" });
    }

    const header = lines[0].split(",");
    const stocks: NewHighStock[] = [];
    for (let i = 1; i < lines.length; i++) {
      const row = parseRow(header, lines[i]);
      if (row) stocks.push(row);
    }

    return NextResponse.json({ stocks, scannedAt, file: latestFile });
  } catch (err) {
    return NextResponse.json(
      { stocks: [], error: String(err) },
      { status: 500 },
    );
  }
}
