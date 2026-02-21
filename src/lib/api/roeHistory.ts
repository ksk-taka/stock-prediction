/**
 * ROE推移取得（年次、過去5年分）
 * Yahoo Finance fundamentalsTimeSeries から計算
 */

import YahooFinance from "yahoo-finance2";
import { yfQueue } from "@/lib/utils/requestQueue";
import type { RoeHistoryEntry } from "@/types/yutai";

const yf = new YahooFinance();

/**
 * 過去5年分の年次ROEを取得
 * @returns 新しい年度順にソートされたROE配列
 */
export async function getRoeHistory(symbol: string): Promise<RoeHistoryEntry[]> {
  try {
    const period1 = new Date();
    period1.setFullYear(period1.getFullYear() - 6); // 余裕をもって6年分取得

    const [financials, balanceSheet] = await Promise.all([
      yfQueue.add(() =>
        yf.fundamentalsTimeSeries(symbol, {
          period1,
          type: "annual" as const,
          module: "financials" as const,
        })
      ).catch(() => []),
      yfQueue.add(() =>
        yf.fundamentalsTimeSeries(symbol, {
          period1,
          type: "annual" as const,
          module: "balance-sheet" as const,
        })
      ).catch(() => []),
    ]);

    if (!financials?.length || !balanceSheet?.length) return [];

    // 年度ごとにnetIncomeとequityをマッチング
    const netIncomeByYear = new Map<number, number>();
    for (const row of financials) {
      const rec = row as Record<string, unknown>;
      const dateField = rec.date ?? rec.asOfDate;
      if (!dateField) continue;
      const year = new Date(dateField as string | number).getFullYear();
      const netIncome = (rec.annualNetIncome ?? rec.netIncome) as number | undefined;
      if (netIncome != null) {
        netIncomeByYear.set(year, netIncome);
      }
    }

    const equityByYear = new Map<number, number>();
    for (const row of balanceSheet) {
      const rec = row as Record<string, unknown>;
      const dateField = rec.date ?? rec.asOfDate;
      if (!dateField) continue;
      const year = new Date(dateField as string | number).getFullYear();
      const equity =
        (rec.stockholdersEquity as number) ??
        (rec.totalEquityGrossMinorityInterest as number);
      if (equity != null && equity > 0) {
        equityByYear.set(year, equity);
      }
    }

    // ROE計算
    const entries: RoeHistoryEntry[] = [];
    for (const [year, netIncome] of netIncomeByYear) {
      const equity = equityByYear.get(year);
      if (equity && equity > 0) {
        const roe = Math.round((netIncome / equity) * 10000) / 10000;
        entries.push({ year, roe });
      }
    }

    // EDINET XBRL 補完: YFで取得できなかった年度を追加
    try {
      const { getCachedEdinetFinancials } = await import("@/lib/cache/edinetCache");
      const edinet = getCachedEdinetFinancials(symbol);
      if (edinet?.netIncome != null && edinet?.stockholdersEquity != null && edinet.stockholdersEquity > 0 && edinet.fiscalYearEnd) {
        const edinetYear = new Date(edinet.fiscalYearEnd).getFullYear();
        const hasYear = entries.some(e => e.year === edinetYear);
        if (!hasYear) {
          const roe = Math.round((edinet.netIncome / edinet.stockholdersEquity) * 10000) / 10000;
          entries.push({ year: edinetYear, roe });
        }
      }
    } catch { /* EDINET cache not available */ }

    // 新しい年度順にソート、最大5件
    entries.sort((a, b) => b.year - a.year);
    return entries.slice(0, 5);
  } catch (err) {
    console.error(`[roeHistory] Error for ${symbol}:`, err);
    return [];
  }
}
