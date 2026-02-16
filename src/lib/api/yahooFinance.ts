import YahooFinance from "yahoo-finance2";
import type { PriceData, DividendSummary } from "@/types";
import { getStartDate, type Period } from "@/lib/utils/date";
import { yfQueue } from "@/lib/utils/requestQueue";

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
    const result = await yfQueue.add(() =>
      yf.chart(symbol, {
        period1: startDate,
        period2: new Date(),
        interval: yfIntraday,
      })
    );

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

  const result = await yfQueue.add(() =>
    yf.historical(symbol, {
      period1: startDate,
      period2: new Date(),
      interval: yfInterval,
    })
  );

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
  const result = await yfQueue.add(() => yf.quote(symbol));
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
    const result = await yfQueue.add(() =>
      yf.quoteSummary(symbol, { modules: ["financialData", "defaultKeyStatistics"] })
    );
    const fd = result.financialData;
    const ks = result.defaultKeyStatistics;
    const debtToEquity = (fd as Record<string, unknown> | undefined)?.debtToEquity as number | null ?? null;
    // 自己資本比率 = 100 / (1 + D/E ratio / 100)
    const equityRatio = debtToEquity != null && debtToEquity >= 0
      ? Math.round((100 / (1 + debtToEquity / 100)) * 10) / 10
      : null;

    return {
      roe: (fd as Record<string, unknown> | undefined)?.returnOnEquity as number | null ?? null,
      roa: (fd as Record<string, unknown> | undefined)?.returnOnAssets as number | null ?? null,
      debtToEquity,
      equityRatio,
      forwardEps: (ks as Record<string, unknown> | undefined)?.forwardEps as number | null ?? null,
      pegRatio: (ks as Record<string, unknown> | undefined)?.pegRatio as number | null ?? null,
    };
  } catch {
    return { roe: null, roa: null, debtToEquity: null, equityRatio: null, forwardEps: null, pegRatio: null };
  }
}

/**
 * 簡易ネットキャッシュ比率を取得（fundamentalsTimeSeries経由）
 * NC = 流動資産 + 投資有価証券×70% - 負債合計
 * NC比率 = NC / 時価総額 × 100 (%)
 */
export async function getSimpleNetCashRatio(symbol: string, marketCap: number): Promise<number | null> {
  if (marketCap <= 0) return null;
  try {
    const period1 = new Date();
    period1.setFullYear(period1.getFullYear() - 1);

    const bsResult = await yfQueue.add(() =>
      yf.fundamentalsTimeSeries(symbol, {
        period1,
        type: "quarterly",
        module: "balance-sheet",
      })
    );
    if (!bsResult || bsResult.length === 0) return null;

    const bs = bsResult[bsResult.length - 1] as Record<string, unknown>;
    const currentAssets = (bs.currentAssets as number) ?? 0;
    const investmentInFA =
      (bs.investmentinFinancialAssets as number) ??
      (bs.availableForSaleSecurities as number) ??
      (bs.investmentsAndAdvances as number) ??
      0;
    const totalLiabilities = (bs.totalLiabilitiesNetMinorityInterest as number) ?? 0;

    if (currentAssets === 0 && totalLiabilities === 0) return null;

    const netCash = currentAssets + investmentInFA * 0.7 - totalLiabilities;
    return Math.round((netCash / marketCap) * 1000) / 10; // % (小数1桁)
  } catch {
    return null;
  }
}

/**
 * 財務指標を一括取得（NC比率 + ROE）
 * balance-sheet（fundamentalsTimeSeries）と incomeStatementHistoryQuarterly（quoteSummary）を使用
 */
export interface FinancialMetrics {
  ncRatio: number | null;
  roe: number | null;
  fiscalYearEnd: string | null;
  currentRatio: number | null;
  pegRatio: number | null;
  equityRatio: number | null;      // 自己資本比率 (%)
  totalDebt: number | null;        // 有利子負債 (円)
  profitGrowthRate: number | null;  // 増益率 (%, YoY EBIT growth)
}

export async function getFinancialMetrics(symbol: string, marketCap: number): Promise<FinancialMetrics> {
  const result: FinancialMetrics = { ncRatio: null, roe: null, fiscalYearEnd: null, currentRatio: null, pegRatio: null, equityRatio: null, totalDebt: null, profitGrowthRate: null };

  try {
    const period1 = new Date();
    period1.setFullYear(period1.getFullYear() - 2);

    // balance-sheet と incomeStatementHistoryQuarterly を並列取得
    const [bsResult, isResult] = await Promise.all([
      yfQueue.add(() =>
        yf.fundamentalsTimeSeries(symbol, {
          period1,
          type: "quarterly",
          module: "balance-sheet",
        })
      ),
      yfQueue.add(() =>
        yf.quoteSummary(symbol, { modules: ["incomeStatementHistoryQuarterly", "defaultKeyStatistics", "financialData"] })
      ),
    ]);

    // NC比率の計算
    if (bsResult && bsResult.length > 0 && marketCap > 0) {
      const bs = bsResult[bsResult.length - 1] as Record<string, unknown>;
      const currentAssets = (bs.currentAssets as number) ?? 0;
      const investmentInFA =
        (bs.investmentinFinancialAssets as number) ??
        (bs.availableForSaleSecurities as number) ??
        (bs.investmentsAndAdvances as number) ??
        0;
      const totalLiabilities = (bs.totalLiabilitiesNetMinorityInterest as number) ?? 0;

      if (currentAssets !== 0 || totalLiabilities !== 0) {
        const netCash = currentAssets + investmentInFA * 0.7 - totalLiabilities;
        result.ncRatio = Math.round((netCash / marketCap) * 1000) / 10;
      }
    }

    // ROEの計算: 直近4四半期の純利益合計 / 自己資本
    const statements = isResult?.incomeStatementHistoryQuarterly?.incomeStatementHistory;
    if (bsResult && bsResult.length > 0 && statements && statements.length > 0) {
      const latestBs = bsResult[bsResult.length - 1] as Record<string, unknown>;
      const equity =
        (latestBs.stockholdersEquity as number) ??
        (latestBs.totalEquityGrossMinorityInterest as number) ??
        0;

      if (equity > 0) {
        // 直近4四半期の純利益を合計（年間純利益の推定）
        const recentQuarters = statements.slice(0, 4); // 新しい順に並んでいる
        let annualNetIncome = 0;
        for (const q of recentQuarters) {
          const netIncome = (q as unknown as Record<string, unknown>).netIncome as number | undefined;
          if (netIncome != null) {
            annualNetIncome += netIncome;
          }
        }

        if (annualNetIncome !== 0) {
          // ROE = 純利益 / 自己資本（小数で返す、例: 0.15 = 15%）
          result.roe = Math.round((annualNetIncome / equity) * 10000) / 10000;
        }
      }
    }

    // 決算日（nextFiscalYearEnd）
    const ks = isResult?.defaultKeyStatistics;
    const nextFYE = (ks as Record<string, unknown> | undefined)?.nextFiscalYearEnd;
    if (nextFYE instanceof Date) {
      result.fiscalYearEnd = nextFYE.toISOString().split("T")[0];
    }

    // 流動比率（financialData.currentRatio）
    const fd = isResult?.financialData;
    const cr = (fd as Record<string, unknown> | undefined)?.currentRatio as number | null ?? null;
    if (cr != null && cr > 0) {
      result.currentRatio = Math.round(cr * 100) / 100;
    }

    // PEG Ratio（defaultKeyStatistics.pegRatio）
    const pegVal = (ks as Record<string, unknown> | undefined)?.pegRatio as number | null ?? null;
    if (pegVal != null) {
      result.pegRatio = Math.round(pegVal * 100) / 100;
    }

    // 自己資本比率（financialData.debtToEquity → 計算）
    const debtToEquity = (fd as Record<string, unknown> | undefined)?.debtToEquity as number | null ?? null;
    if (debtToEquity != null && debtToEquity >= 0) {
      result.equityRatio = Math.round((100 / (1 + debtToEquity / 100)) * 10) / 10;
    }

    // 有利子負債（financialData.totalDebt）
    const tdVal = (fd as Record<string, unknown> | undefined)?.totalDebt as number | null ?? null;
    if (tdVal != null) {
      result.totalDebt = tdVal;
    }

    // 増益率: TTM EBIT YoY成長率
    if (statements && statements.length >= 5) {
      const getEbit = (q: unknown): number | null => {
        const rec = q as Record<string, unknown>;
        return (rec.ebit as number | undefined) ??
               (rec.operatingIncome as number | undefined) ?? null;
      };

      const currentQuarters = statements.slice(0, 4);
      const priorQuarters = statements.slice(4, 8);

      if (priorQuarters.length >= 4) {
        let currentTTM = 0, priorTTM = 0;
        let currentValid = true, priorValid = true;

        for (const q of currentQuarters) {
          const ebit = getEbit(q);
          if (ebit != null) currentTTM += ebit;
          else currentValid = false;
        }
        for (const q of priorQuarters) {
          const ebit = getEbit(q);
          if (ebit != null) priorTTM += ebit;
          else priorValid = false;
        }

        if (currentValid && priorValid && Math.abs(priorTTM) > 0) {
          result.profitGrowthRate = Math.round(
            ((currentTTM - priorTTM) / Math.abs(priorTTM)) * 1000
          ) / 10;
        }
      }
    }
  } catch {
    // エラー時はnullのまま返す
  }

  return result;
}

/**
 * 四半期EPS履歴を取得（earningsHistory経由）
 */
export async function getEarningsHistory(symbol: string) {
  try {
    const result = await yfQueue.add(() =>
      yf.quoteSummary(symbol, { modules: ["earningsHistory"] })
    );
    const eh = result.earningsHistory;
    if (!eh?.history) return [];
    return eh.history
      .filter((h) => h.quarter != null)
      .map((h) => ({
        quarter:
          h.quarter instanceof Date
            ? h.quarter.toISOString().split("T")[0]
            : String(h.quarter),
        epsActual: h.epsActual ?? null,
        epsEstimate: h.epsEstimate ?? null,
      }))
      .sort((a, b) => a.quarter.localeCompare(b.quarter));
  } catch {
    return [];
  }
}

/**
 * 配当履歴を取得（直近maxCount回分）
 * 日本株は年2回配当が一般的なので5年で最大10件
 */
export async function getDividendHistory(
  symbol: string,
  maxCount = 10
): Promise<{ date: string; amount: number }[]> {
  try {
    const period1 = new Date();
    period1.setFullYear(period1.getFullYear() - 6);

    const result = await yfQueue.add(() =>
      yf.historical(symbol, {
        period1,
        period2: new Date(),
        events: "dividends" as "dividends",
      })
    );

    const rows = result as unknown as { date: Date; dividends: number }[];
    if (!Array.isArray(rows)) return [];

    return rows
      .filter((r) => r.dividends > 0)
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
      .slice(0, maxCount)
      .map((row) => ({
        date:
          row.date instanceof Date
            ? row.date.toISOString().split("T")[0]
            : String(row.date),
        amount: row.dividends,
      }));
  } catch {
    return [];
  }
}

/**
 * 配当履歴からサマリーを算出（StockCard・テーブル用）
 */
export function computeDividendSummary(
  history: { date: string; amount: number }[]
): DividendSummary {
  const latest = history[0]?.amount ?? null;
  const previous = history[1]?.amount ?? null;
  const twoPrev = history[2]?.amount ?? null;
  const latestIncrease =
    latest !== null && previous !== null ? Math.round((latest - previous) * 100) / 100 : null;
  return {
    latestAmount: latest,
    previousAmount: previous,
    twoPrevAmount: twoPrev,
    latestIncrease,
    latestDate: history[0]?.date ?? null,
  };
}

/**
 * 配当履歴から増配傾向を算出（LLM分析用）
 * 日本株は年2回配当が多いので、年ごとに合算して比較
 */
export function computeDividendTrend(
  history: { date: string; amount: number }[]
): { consecutiveYears: number; latestGrowthPct: number | null; summary: string } {
  if (history.length < 2) {
    return { consecutiveYears: 0, latestGrowthPct: null, summary: "配当データ不足" };
  }

  // 年ごとに合算（日本株は中間+期末の年2回）
  const byYear = new Map<number, number>();
  for (const h of history) {
    const year = new Date(h.date).getFullYear();
    byYear.set(year, (byYear.get(year) ?? 0) + h.amount);
  }

  // 年降順でソート
  const years = [...byYear.entries()].sort((a, b) => b[0] - a[0]);
  if (years.length < 2) {
    return { consecutiveYears: 0, latestGrowthPct: null, summary: "年次比較データ不足" };
  }

  // 連続増配年数（最新年から遡る）
  let consecutive = 0;
  for (let i = 0; i < years.length - 1; i++) {
    if (years[i][1] > years[i + 1][1]) {
      consecutive++;
    } else {
      break;
    }
  }

  // 直近の増配率
  const latestGrowthPct = years[1][1] > 0
    ? Math.round(((years[0][1] - years[1][1]) / years[1][1]) * 1000) / 10
    : null;

  // サマリー文生成
  let summary: string;
  if (consecutive >= 3) {
    summary = `${consecutive}年連続増配 (直近${latestGrowthPct != null ? latestGrowthPct > 0 ? "+" : "" : ""}${latestGrowthPct ?? "N/A"}%)`;
  } else if (consecutive >= 1) {
    summary = `${consecutive}年連続増配 (直近${latestGrowthPct != null ? latestGrowthPct > 0 ? "+" : "" : ""}${latestGrowthPct ?? "N/A"}%)`;
  } else if (latestGrowthPct != null && latestGrowthPct < 0) {
    summary = `直近減配 (${latestGrowthPct}%)`;
  } else {
    summary = "横ばいまたは不定期配当";
  }

  return { consecutiveYears: consecutive, latestGrowthPct, summary };
}

/**
 * 複数銘柄の株価情報をバッチ取得（テーブル表示用）
 */
export async function getQuoteBatch(symbols: string[]) {
  if (symbols.length === 0) return [];

  // yahoo-finance2のバッチquote（配列版）を使用
  const results = await yfQueue.add(() => yf.quote(symbols));
  const arr = Array.isArray(results) ? results : [results];

  return arr.map((result) => {
    const r = result as Record<string, unknown>;
    const earningsTs =
      r.earningsTimestamp ?? r.earningsTimestampStart ?? r.earningsTimestampEnd;
    return {
      symbol: result.symbol,
      name:
        (r.shortName as string | null) ??
        (r.longName as string | null) ??
        result.symbol,
      price: result.regularMarketPrice ?? 0,
      previousClose: (r.regularMarketPreviousClose as number) ?? 0,
      change: result.regularMarketChange ?? 0,
      changePercent: result.regularMarketChangePercent ?? 0,
      volume: result.regularMarketVolume ?? 0,
      per: (r.trailingPE as number) ?? null,
      pbr: (r.priceToBook as number) ?? null,
      eps: (r.epsTrailingTwelveMonths as number) ?? null,
      dayHigh: (r.regularMarketDayHigh as number) ?? null,
      dayLow: (r.regularMarketDayLow as number) ?? null,
      yearHigh: (r.fiftyTwoWeekHigh as number) ?? null,
      yearLow: (r.fiftyTwoWeekLow as number) ?? null,
      marketCap: (r.marketCap as number) ?? 0,
      dividendYield: (r.trailingAnnualDividendYield as number) ?? null,
      psr: (r.priceToSalesTrailing12Months as number) ?? null,
      earningsDate:
        earningsTs instanceof Date
          ? earningsTs.toISOString().split("T")[0]
          : null,
      firstTradeDate:
        r.firstTradeDateMilliseconds instanceof Date
          ? (r.firstTradeDateMilliseconds as Date).toISOString().split("T")[0]
          : null,
    };
  });
}

/**
 * 銘柄を検索
 */
export async function searchSymbol(query: string) {
  const result = await yfQueue.add(() => yf.search(query));
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
