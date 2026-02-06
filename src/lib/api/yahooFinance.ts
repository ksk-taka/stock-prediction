import YahooFinance from "yahoo-finance2";
import type { PriceData } from "@/types";
import { getStartDate, type Period } from "@/lib/utils/date";

const yf = new YahooFinance();

/**
 * 取引時間内かどうかを判定
 * 日本株: 前場 9:00-11:30, 後場 12:30-15:00 (JST)
 * 米国株: 9:30-16:00 (EST/EDT)
 */
function isDuringTradingHours(date: Date, isJP: boolean): boolean {
  if (isJP) {
    // JST = UTC + 9
    const jstHours = (date.getUTCHours() + 9) % 24;
    const jstMinutes = date.getUTCMinutes();
    const m = jstHours * 60 + jstMinutes;
    // 前場 9:00-11:30 (540-690) or 後場 12:30-15:00 (750-900)
    return (m >= 540 && m <= 690) || (m >= 750 && m <= 900);
  }
  // 米国: EST = UTC - 5 (冬) / EDT = UTC - 4 (夏) — 簡易的にUTC 14:30-21:00で判定
  const utcM = date.getUTCHours() * 60 + date.getUTCMinutes();
  return utcM >= 870 && utcM <= 1260; // 14:30-21:00 UTC
}

/**
 * 株価の履歴データを取得
 */
export async function getHistoricalPrices(
  symbol: string,
  period: Period
): Promise<PriceData[]> {
  const startDate = getStartDate(period);
  const isJP = symbol.endsWith(".T");

  // 分足はchartモジュール（取引時間フィルター付き）
  const intradayIntervals: Record<string, "1m" | "5m" | "15m"> = {
    "1min": "1m",
    "5min": "5m",
    "15min": "15m",
  };

  const yfIntraday = intradayIntervals[period];
  if (yfIntraday) {
    const result = await yf.chart(symbol, {
      period1: startDate,
      period2: new Date(),
      interval: yfIntraday,
    });

    return result.quotes
      .filter((row) => {
        if (!(row.date instanceof Date)) return true;
        return isDuringTradingHours(row.date, isJP);
      })
      .filter((row) => (row.open ?? 0) > 0 && (row.close ?? 0) > 0)
      .map((row) => ({
        date:
          row.date instanceof Date
            ? row.date.toISOString()
            : String(row.date),
        open: row.open ?? 0,
        high: row.high ?? 0,
        low: row.low ?? 0,
        close: row.close ?? 0,
        volume: row.volume ?? 0,
      }));
  }

  // 日足・週足・月足は historical モジュール
  const intervalMap: Record<string, "1d" | "1wk" | "1mo"> = {
    daily: "1d",
    weekly: "1wk",
    monthly: "1mo",
  };
  const yfInterval = intervalMap[period] ?? "1d";

  const result = await yf.historical(symbol, {
    period1: startDate,
    period2: new Date(),
    interval: yfInterval,
  });

  return result.map((row) => ({
    date:
      row.date instanceof Date
        ? row.date.toISOString().split("T")[0]
        : String(row.date),
    open: row.open ?? 0,
    high: row.high ?? 0,
    low: row.low ?? 0,
    close: row.close ?? 0,
    volume: row.volume ?? 0,
    adjustedClose: row.adjClose ?? undefined,
  }));
}

/**
 * 現在の株価情報を取得
 */
export async function getQuote(symbol: string) {
  const result = await yf.quote(symbol);
  const r = result as Record<string, unknown>;
  return {
    symbol: result.symbol,
    name:
      (r.shortName as string | null) ??
      (r.longName as string | null) ??
      symbol,
    price: result.regularMarketPrice ?? 0,
    previousClose: (r.regularMarketPreviousClose as number) ?? 0,
    change: result.regularMarketChange ?? 0,
    changePercent: result.regularMarketChangePercent ?? 0,
    volume: result.regularMarketVolume ?? 0,
    marketCap: (r.marketCap as number) ?? 0,
    currency: result.currency ?? "JPY",
    // ファンダメンタル指標
    per: (r.trailingPE as number) ?? null,
    forwardPer: (r.forwardPE as number) ?? null,
    pbr: (r.priceToBook as number) ?? null,
    eps: (r.epsTrailingTwelveMonths as number) ?? null,
    dividendYield: (r.trailingAnnualDividendYield as number) ?? null,
  };
}

/**
 * ROE等の財務指標を取得（quoteSummary経由）
 */
export async function getFinancialData(symbol: string) {
  try {
    const result = await yf.quoteSummary(symbol, { modules: ["financialData", "defaultKeyStatistics"] });
    const fd = result.financialData;
    const ks = result.defaultKeyStatistics;
    return {
      roe: (fd as Record<string, unknown> | undefined)?.returnOnEquity as number | null ?? null,
      roa: (fd as Record<string, unknown> | undefined)?.returnOnAssets as number | null ?? null,
      debtToEquity: (fd as Record<string, unknown> | undefined)?.debtToEquity as number | null ?? null,
      forwardEps: (ks as Record<string, unknown> | undefined)?.forwardEps as number | null ?? null,
      pegRatio: (ks as Record<string, unknown> | undefined)?.pegRatio as number | null ?? null,
    };
  } catch {
    return { roe: null, roa: null, debtToEquity: null, forwardEps: null, pegRatio: null };
  }
}

/**
 * 銘柄を検索
 */
export async function searchSymbol(query: string) {
  const result = await yf.search(query);
  return result.quotes
    .filter(
      (q): q is typeof q & { symbol: string } =>
        "quoteType" in q && (q as Record<string, unknown>).quoteType === "EQUITY"
    )
    .map((q) => ({
      symbol: q.symbol,
      name:
        ("shortname" in q ? (q as Record<string, unknown>).shortname : null) ??
        ("longname" in q ? (q as Record<string, unknown>).longname : null) ??
        q.symbol,
      exchange: ("exchange" in q ? (q as Record<string, unknown>).exchange : "") as string,
    }));
}
