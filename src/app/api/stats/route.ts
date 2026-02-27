import { NextRequest, NextResponse } from "next/server";
import { getQuote, getFinancialMetrics, getHistoricalPrices, getDividendHistory, computeDividendSummary } from "@/lib/api/yahooFinance";
import { getCachedStats, setCachedStats, getCachedStatsAll, getCachedDividendSummary, setCachedDividendOnly } from "@/lib/cache/statsCache";
import { calcSharpeRatioFromPrices } from "@/lib/utils/indicators";
import { yfQueue } from "@/lib/utils/requestQueue";
import YahooFinance from "yahoo-finance2";
import { subYears } from "date-fns";

const yf = new YahooFinance();

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const symbol = searchParams.get("symbol");

  if (!symbol) {
    return NextResponse.json(
      { error: "symbol parameter is required" },
      { status: 400 }
    );
  }

  // キャッシュチェック（24時間TTL）— NC率・時価総額が揃っている場合のみ返す
  const cached = getCachedStats(symbol);
  if (cached && cached.simpleNcRatio !== undefined && cached.marketCap !== undefined) {
    // 配当サマリーがキャッシュにない場合は独立して取得して補完
    if (cached.dividendSummary === undefined) {
      const cachedDiv = getCachedDividendSummary(symbol);
      if (cachedDiv !== undefined) {
        cached.dividendSummary = cachedDiv;
      } else {
        try {
          const divHistory = await getDividendHistory(symbol);
          const divSummary = divHistory.length > 0 ? computeDividendSummary(divHistory) : null;
          setCachedDividendOnly(symbol, divSummary);
          cached.dividendSummary = divSummary;
        } catch {
          cached.dividendSummary = null;
        }
      }
    }
    return NextResponse.json({ symbol, ...cached });
  }

  try {
    const quote = await getQuote(symbol);

    // NC率・ROE・PBRは一括取得（キャッシュがあればスキップ）
    const cachedMetrics = getCachedStatsAll(symbol);
    let simpleNcRatio = cachedMetrics.nc !== undefined ? cachedMetrics.nc : null;
    let roe = cachedMetrics.roe !== undefined ? cachedMetrics.roe : null;
    let bsPbr: number | null = cachedMetrics.pbr !== undefined ? (cachedMetrics.pbr ?? null) : null;

    // どちらかがキャッシュミスなら両方再取得
    if (cachedMetrics.nc === undefined || cachedMetrics.roe === undefined) {
      const metrics = await getFinancialMetrics(symbol, quote.marketCap);
      simpleNcRatio = metrics.ncRatio;
      roe = metrics.roe;
      bsPbr = metrics.pbr;
    }

    // シャープレシオ算出（1年 + 3年）を並列実行
    const [sharpe1yResult, sharpe3yResult] = await Promise.all([
      // 1年シャープレシオ
      (async () => {
        try {
          const daily1y = await getHistoricalPrices(symbol, "daily");
          return calcSharpeRatioFromPrices(daily1y);
        } catch {
          return null;
        }
      })(),
      // 3年シャープレシオ
      (async () => {
        try {
          const now = new Date();
          const raw3y = await yfQueue.add(() =>
            yf.historical(symbol, {
              period1: subYears(now, 3),
              period2: now,
              interval: "1d" as const,
            })
          );
          const daily3y = raw3y.map((row) => ({
            date: row.date instanceof Date ? row.date.toISOString().split("T")[0] : String(row.date),
            open: row.open ?? 0,
            high: row.high ?? 0,
            low: row.low ?? 0,
            close: row.close ?? 0,
            volume: row.volume ?? 0,
          }));
          return calcSharpeRatioFromPrices(daily3y);
        } catch {
          return null;
        }
      })(),
    ]);
    const sharpe1y = sharpe1yResult;
    const sharpe3y = sharpe3yResult;

    // 配当サマリー（7日キャッシュ）
    const cachedDiv = getCachedDividendSummary(symbol);
    let dividendSummary = cachedDiv !== undefined ? cachedDiv : undefined;
    if (dividendSummary === undefined) {
      try {
        const divHistory = await getDividendHistory(symbol);
        dividendSummary = divHistory.length > 0 ? computeDividendSummary(divHistory) : null;
        setCachedDividendOnly(symbol, dividendSummary);
      } catch {
        dividendSummary = null;
      }
    }

    const result = {
      per: quote.per,
      forwardPer: quote.forwardPer,
      pbr: bsPbr ?? quote.pbr,
      eps: quote.eps,
      roe,
      dividendYield: quote.dividendYield,
      simpleNcRatio,
      marketCap: quote.marketCap || null,
      sharpe1y,
      sharpe3y,
      dividendSummary,
    };

    // キャッシュ保存
    setCachedStats(symbol, result);

    return NextResponse.json({ symbol, ...result });
  } catch (error) {
    console.error("Stats API error:", error);
    return NextResponse.json(
      { error: "Failed to fetch stats" },
      { status: 500 }
    );
  }
}
