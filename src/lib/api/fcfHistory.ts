/**
 * FCF（フリーキャッシュフロー）推移取得（年次、過去5年分）
 * Yahoo Finance fundamentalsTimeSeries の cash-flow モジュールから取得
 */

import YahooFinance from "yahoo-finance2";
import { yfQueue } from "@/lib/utils/requestQueue";
import type { FcfHistoryEntry } from "@/types/yutai";

const yf = new YahooFinance();

/**
 * 過去5年分の年次FCFを取得
 * @returns 新しい年度順にソートされたFCF配列
 */
export async function getFcfHistory(symbol: string): Promise<FcfHistoryEntry[]> {
  try {
    const period1 = new Date();
    period1.setFullYear(period1.getFullYear() - 6); // 余裕をもって6年分取得

    const cashFlowData = await yfQueue.add(() =>
      yf.fundamentalsTimeSeries(symbol, {
        period1,
        type: "annual" as const,
        module: "cash-flow" as const,
      })
    ).catch(() => []);

    if (!cashFlowData?.length) return [];

    const entries: FcfHistoryEntry[] = [];
    for (const row of cashFlowData) {
      const rec = row as Record<string, unknown>;
      const dateField = rec.date ?? rec.asOfDate;
      if (!dateField) continue;
      const year = new Date(dateField as string | number).getFullYear();

      const fcf = rec.freeCashFlow as number | undefined;
      const ocf = (rec.operatingCashFlow ?? rec.cashFlowFromContinuingOperatingActivities) as number | undefined;
      const capex = rec.capitalExpenditure as number | undefined;

      // FCFが直接あればそれを使用、なければOCF+CAPEXから算出
      const fcfValue = fcf ?? (ocf != null && capex != null ? ocf + capex : null);
      if (fcfValue != null) {
        entries.push({
          year,
          fcf: fcfValue,
          ocf: (ocf as number) ?? 0,
          capex: (capex as number) ?? 0,
        });
      }
    }

    // 新しい年度順にソート、最大5件
    entries.sort((a, b) => b.year - a.year);
    return entries.slice(0, 5);
  } catch (err) {
    console.error(`[fcfHistory] Error for ${symbol}:`, err);
    return [];
  }
}
