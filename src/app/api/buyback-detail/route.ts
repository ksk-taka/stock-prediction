import { NextResponse } from "next/server";
import {
  getCachedBuybackDetailBatch,
  getBuybackDetailFromSupabase,
} from "@/lib/cache/buybackDetailCache";
import { getCachedBuybackCodes, getBuybackCodesWithFallback } from "@/lib/cache/buybackCache";
import { getQuoteBatch } from "@/lib/api/yahooFinance";
import type { BuybackDetail, BuybackDetailWithImpact } from "@/types/buyback";

export const dynamic = "force-dynamic";

const isVercel = !!process.env.VERCEL;

export async function GET() {
  try {
    // 対象銘柄コード一覧を取得
    let codes = getCachedBuybackCodes();
    if (!codes) {
      codes = await getBuybackCodesWithFallback();
    }
    if (!codes || codes.size === 0) {
      return NextResponse.json({
        stocks: [],
        error: "buyback銘柄リストがありません。scan:buyback を実行してください。",
      });
    }

    const symbols = [...codes].map((c) => `${c}.T`);

    // ファイルキャッシュから取得
    const detailMap = getCachedBuybackDetailBatch(symbols);

    // Vercel上 or ファイルキャッシュ不足時はSupabaseから補完
    const missing = symbols.filter((s) => !detailMap.has(s));
    if (missing.length > 0 && (isVercel || missing.length > symbols.length * 0.5)) {
      const sbData = await getBuybackDetailFromSupabase(missing);
      for (const [sym, data] of sbData) {
        detailMap.set(sym, data);
      }
    }

    const details: BuybackDetail[] = [...detailMap.values()];

    // YF quote で平均出来高を取得
    const detailSymbols = details.map((d) => `${d.stockCode}.T`);
    const volumeMap = new Map<string, number>();
    try {
      // 50件ずつバッチ取得
      for (let i = 0; i < detailSymbols.length; i += 50) {
        const batch = detailSymbols.slice(i, i + 50);
        const quotes = await getQuoteBatch(batch);
        for (const q of quotes) {
          if (q.averageDailyVolume3Month != null) {
            volumeMap.set(q.symbol, q.averageDailyVolume3Month);
          }
        }
      }
    } catch {
      // YF取得失敗してもbuybkack詳細自体は返す
    }

    // インパクト日数を計算して付加
    const stocks: BuybackDetailWithImpact[] = details.map((d) => {
      const r = d.latestReport;
      const maxShares = r?.maxShares ?? null;
      const cumShares = r?.cumulativeShares ?? null;
      const remainingShares =
        maxShares != null && cumShares != null ? maxShares - cumShares : null;
      const avgVol = volumeMap.get(`${d.stockCode}.T`) ?? null;

      let impactDays: number | null = null;
      if (remainingShares != null && remainingShares > 0 && avgVol != null && avgVol > 0) {
        // 25%ルール: 1日の買付上限 = 平均出来高の25%
        impactDays = Math.ceil(remainingShares / (avgVol * 0.25));
      }

      return {
        ...d,
        remainingShares,
        avgDailyVolume: avgVol,
        impactDays,
      };
    });

    stocks.sort((a, b) => {
      // 実施中を先に、金額進捗降順
      if (a.isActive !== b.isActive) return a.isActive ? -1 : 1;
      return (b.progressAmount ?? -1) - (a.progressAmount ?? -1);
    });

    return NextResponse.json({
      stocks,
      totalBuybackCodes: codes.size,
      detailCount: stocks.length,
    });
  } catch (err) {
    return NextResponse.json(
      { stocks: [], error: String(err) },
      { status: 500 },
    );
  }
}
