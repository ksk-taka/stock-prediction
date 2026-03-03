import { NextRequest, NextResponse } from "next/server";
import {
  fetchIncomeHistory,
  detectTurnaround,
  DEFAULT_OPTIONS,
} from "@/lib/screener/turnaround";
import { getQuoteBatch } from "@/lib/api/yahooFinance";

export interface TurnaroundScreenRow {
  symbol: string;
  name: string;
  marketSegment: string;
  // turnaround detection
  turnaroundFiscalYear: number;
  consecutiveLossYears: number;
  priorLossAmountMM: number;        // 百万円
  turnaroundProfitAmountMM: number;  // 百万円
  revenueGrowthPct: number | null;
  turnaroundDate: string;
  // quote data
  price: number;
  changePercent: number;
  marketCap: number | null;          // 億円
  per: number | null;
  pbr: number | null;
  volume: number;
  // income history for sparkline
  incomeHistory: { fiscalYear: number; opIncomeMM: number }[];
}

/**
 * GET /api/turnaround-screen?symbols=7203.T,9984.T,...&minLoss=1
 * ターンアラウンドスクリーニング用バッチデータ取得 (最大50銘柄)
 */
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const symbolsParam = searchParams.get("symbols");
  const minLoss = parseInt(searchParams.get("minLoss") ?? "1", 10);

  if (!symbolsParam) {
    return NextResponse.json(
      { error: "symbols parameter is required" },
      { status: 400 },
    );
  }

  const symbols = symbolsParam.split(",").slice(0, 50);

  try {
    // 1. quote バッチ取得
    let quotes: Awaited<ReturnType<typeof getQuoteBatch>> = [];
    try {
      quotes = await getQuoteBatch(symbols);
    } catch (e: unknown) {
      const code = (e as { code?: number }).code;
      if (code === 429) {
        console.warn("[turnaround] Yahoo Finance 429 rate limit");
      } else {
        throw e;
      }
    }
    const quoteMap = new Map(quotes.map((q) => [q.symbol, q]));

    // 2. 各銘柄のターンアラウンド判定
    const options = { ...DEFAULT_OPTIONS, minConsecutiveLoss: minLoss };
    const rows: TurnaroundScreenRow[] = [];

    const results = await Promise.allSettled(
      symbols.map(async (symbol) => {
        const history = await fetchIncomeHistory(symbol);
        return { symbol, history };
      })
    );

    for (const result of results) {
      if (result.status !== "fulfilled") continue;
      const { symbol, history } = result.value;

      const detection = detectTurnaround(history, options);
      if (!detection) continue;

      const quote = quoteMap.get(symbol);
      const price = quote?.price ?? 0;
      const changePercent = quote?.changePercent ?? 0;
      const marketCapRaw = quote?.marketCap ?? null;
      const per = quote?.per ?? null;
      const pbr = quote?.pbr ?? null;
      const volume = quote?.volume ?? 0;
      const name = quote?.name ?? symbol;
      const marketSegment = (quote as Record<string, unknown>)?.marketSegment as string ?? "";

      rows.push({
        symbol,
        name,
        marketSegment,
        turnaroundFiscalYear: detection.turnaroundFiscalYear,
        consecutiveLossYears: detection.consecutiveLossYears,
        priorLossAmountMM: Math.round(detection.priorLossAmount / 1e6),
        turnaroundProfitAmountMM: Math.round(detection.turnaroundProfitAmount / 1e6),
        revenueGrowthPct: detection.revenueGrowthPct,
        turnaroundDate: detection.turnaroundDate,
        price,
        changePercent,
        marketCap: marketCapRaw != null ? Math.round(marketCapRaw / 1e8) : null,
        per: per != null ? Math.round(per * 10) / 10 : null,
        pbr: pbr != null ? Math.round(pbr * 100) / 100 : null,
        volume,
        incomeHistory: history.map((h) => ({
          fiscalYear: h.fiscalYear,
          opIncomeMM: Math.round(h.operatingIncome / 1e6),
        })),
      });
    }

    return NextResponse.json({ rows });
  } catch (error) {
    console.error("[turnaround-screen] Error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
