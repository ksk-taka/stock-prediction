/**
 * 成長オーナー企業 - 複数年連続チェック
 * screen-growth-owner.ts の73銘柄について、
 * 売上成長≥20% & 営業利益率≥10% が何年連続しているか調べる
 *
 * fundamentalsTimeSeries (income-statement) を使用
 */
import { readFileSync } from "fs";
import { join } from "path";
import YahooFinance from "yahoo-finance2";
import { RequestQueue } from "@/lib/utils/requestQueue";

const yf = new YahooFinance({ suppressNotices: ["yahooSurvey"] });
const queue = new RequestQueue(8);

// CSV読み込み
function loadCandidates(): { symbol: string; name: string }[] {
  const csv = readFileSync(join(process.cwd(), "data", "screen-growth-owner.csv"), "utf-8");
  const lines = csv.trim().split("\n").slice(1);
  return lines.map((line) => {
    const cols = line.split(",");
    return { symbol: cols[0], name: cols[1] };
  });
}

interface YearData {
  fiscalYear: string;
  revenue: number;
  operatingIncome: number;
  revenueGrowth: number | null;
  operatingMargin: number;
  meetsCondition: boolean;
}

async function getMultiYearFinancials(symbol: string): Promise<YearData[]> {
  try {
    const period1 = new Date();
    period1.setFullYear(period1.getFullYear() - 6);

    const data = await queue.add(() =>
      yf.fundamentalsTimeSeries(symbol, {
        period1,
        type: "annual",
        module: "financials",
      }, { validateResult: false })
    );

    if (!data || data.length === 0) return [];

    // 各年度の売上・営業利益を抽出 (TYPE=FINANCIALS のみ)
    type FinEntry = { date: Date | null; revenue: number; opIncome: number };
    const entries: FinEntry[] = data
      .map((row: Record<string, unknown>): FinEntry | null => {
        if (row.TYPE !== "FINANCIALS") return null;
        const dateVal = row.date;
        const date = dateVal instanceof Date ? dateVal : null;
        const revenue = (row.totalRevenue as number) ?? (row.operatingRevenue as number) ?? 0;
        const opIncome = (row.operatingIncome as number) ?? 0;
        return { date, revenue, opIncome };
      })
      .filter((e: FinEntry | null): e is FinEntry => e != null && e.date != null && e.revenue > 0)
      .sort((a: FinEntry, b: FinEntry) => a.date!.getTime() - b.date!.getTime());

    // EDINET XBRL 補完: YFで取得できなかった年度を追加
    try {
      const { getCachedEdinetFinancials } = await import("../src/lib/cache/edinetCache");
      const edinet = getCachedEdinetFinancials(symbol);
      if (edinet?.netSales != null && edinet.netSales > 0 && edinet.fiscalYearEnd) {
        const eDate = new Date(edinet.fiscalYearEnd);
        const existingYears = new Set(entries.map((e: FinEntry) => e.date!.getFullYear()));
        if (!existingYears.has(eDate.getFullYear())) {
          entries.push({
            date: eDate,
            revenue: edinet.netSales,
            opIncome: edinet.operatingIncome ?? 0,
          });
          entries.sort((a: FinEntry, b: FinEntry) => a.date!.getTime() - b.date!.getTime());
        }
      }
    } catch { /* EDINET cache not available */ }

    const years: YearData[] = [];
    for (let i = 0; i < entries.length; i++) {
      const e = entries[i];
      const fy = `${e.date!.getFullYear()}-${String(e.date!.getMonth() + 1).padStart(2, "0")}`;
      const margin = (e.opIncome / e.revenue) * 100;
      let growth: number | null = null;
      if (i > 0 && entries[i - 1].revenue > 0) {
        growth = ((e.revenue - entries[i - 1].revenue) / entries[i - 1].revenue) * 100;
      }
      years.push({
        fiscalYear: fy,
        revenue: e.revenue,
        operatingIncome: e.opIncome,
        revenueGrowth: growth != null ? Math.round(growth * 10) / 10 : null,
        operatingMargin: Math.round(margin * 10) / 10,
        meetsCondition: growth != null && growth >= 20 && margin >= 10,
      });
    }
    return years;
  } catch {
    return [];
  }
}

function countConsecutiveFromLatest(years: YearData[]): number {
  let count = 0;
  for (let i = years.length - 1; i >= 0; i--) {
    if (years[i].meetsCondition) count++;
    else break;
  }
  return count;
}

async function main() {
  const candidates = loadCandidates();
  console.log(`=== 複数年連続 売上成長≥20% & 営業利益率≥10% チェック ===`);
  console.log(`対象: ${candidates.length}銘柄\n`);

  const results: { symbol: string; name: string; years: YearData[]; consecutive: number }[] = [];
  let done = 0;

  await Promise.all(
    candidates.map(async (c) => {
      const years = await getMultiYearFinancials(c.symbol);
      const consecutive = countConsecutiveFromLatest(years);
      results.push({ ...c, years, consecutive });
      done++;
      if (done % 20 === 0 || done === candidates.length) {
        process.stdout.write(`\r  取得中: ${done}/${candidates.length}`);
      }
    })
  );
  console.log("\n");

  results.sort((a, b) => b.consecutive - a.consecutive);

  // 2年以上連続
  const multiYear = results.filter((r) => r.consecutive >= 2);

  if (multiYear.length === 0) {
    console.log("2年以上連続で条件を満たす銘柄はありませんでした。\n");
  } else {
    console.log(`=== ${multiYear.length}銘柄が2年以上連続で条件達成 ===\n`);
  }

  for (const r of multiYear) {
    console.log(`■ ${r.symbol} ${r.name}  【${r.consecutive}年連続】`);
    for (const y of r.years) {
      const mark = y.meetsCondition ? "✓" : " ";
      const growthStr = y.revenueGrowth != null ? `${y.revenueGrowth > 0 ? "+" : ""}${y.revenueGrowth}%` : "  N/A ";
      console.log(
        `  ${mark} ${y.fiscalYear}  売上${(y.revenue / 1e6).toFixed(0).padStart(8)}百万  成長${growthStr.padStart(8)}  営利率${y.operatingMargin.toFixed(1).padStart(6)}%`
      );
    }
    console.log();
  }

  // 1年のみ
  const singleYear = results.filter((r) => r.consecutive === 1);
  if (singleYear.length > 0) {
    console.log(`--- 直近1年のみ条件達成: ${singleYear.length}銘柄 ---`);
    for (const r of singleYear) {
      const latest = r.years[r.years.length - 1];
      const prev = r.years.length >= 2 ? r.years[r.years.length - 2] : null;
      console.log(
        `  ${r.symbol} ${r.name.slice(0, 22).padEnd(24)}` +
        `最新: 成長${latest?.revenueGrowth != null ? `${latest.revenueGrowth > 0 ? "+" : ""}${latest.revenueGrowth}%` : "N/A"}  営利率${latest?.operatingMargin.toFixed(1)}%` +
        (prev ? `  │ 前年: 成長${prev.revenueGrowth != null ? `${prev.revenueGrowth > 0 ? "+" : ""}${prev.revenueGrowth}%` : "N/A"}  営利率${prev.operatingMargin.toFixed(1)}%` : "")
      );
    }
  }

  // 0年 (データはあるが直近年で未達)
  const zeroYear = results.filter((r) => r.consecutive === 0 && r.years.length > 0);
  if (zeroYear.length > 0) {
    console.log(`\n--- 直近年で未達: ${zeroYear.length}銘柄 ---`);
    for (const r of zeroYear) {
      const latest = r.years[r.years.length - 1];
      const reason = [];
      if (latest.revenueGrowth != null && latest.revenueGrowth < 20) reason.push(`成長${latest.revenueGrowth > 0 ? "+" : ""}${latest.revenueGrowth}%`);
      if (latest.operatingMargin < 10) reason.push(`営利率${latest.operatingMargin.toFixed(1)}%`);
      if (latest.revenueGrowth == null) reason.push("成長N/A(初年度)");
      console.log(`  ${r.symbol} ${r.name.slice(0, 22).padEnd(24)} ${reason.join(", ")}`);
    }
  }

  // データなし
  const noData = results.filter((r) => r.years.length === 0);
  if (noData.length > 0) {
    console.log(`\n--- 損益計算書データなし: ${noData.length}銘柄 (上場直後等) ---`);
    console.log(`  ${noData.map((r) => r.symbol).join(", ")}`);
  }
}

main().catch(console.error);
