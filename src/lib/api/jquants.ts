// ============================================================
// J-Quants API v2 クライアント
//
// Freeプランで利用可能なエンドポイント:
//   1. /equities/master      - 上場銘柄一覧
//   2. /equities/bars/daily   - 株価四本値
//   3. /fins/summary          - 財務情報サマリー
//   4. /equities/earnings-calendar - 決算発表予定日
//   5. /markets/calendar      - 取引カレンダー
//
// 認証: x-api-key ヘッダー（JQUANTS_API_KEY 環境変数）
// データ期間(Free): 12週間前 ～ 2年12週間前
// ============================================================

import type {
  JQuantsMasterItem,
  JQuantsMasterResponse,
  JQuantsDailyBar,
  JQuantsDailyResponse,
  JQuantsFinSummary,
  JQuantsFinSummaryResponse,
  JQuantsEarningsCalendar,
  JQuantsEarningsCalendarResponse,
  JQuantsMarketCalendar,
  JQuantsMarketCalendarResponse,
} from "@/types/jquants";
import { toJQuantsCode, jqDateToISO, dateToJQFormat } from "@/types/jquants";
import type { PriceData } from "@/types";
import { jqQueue } from "@/lib/utils/requestQueue";

const BASE_URL = "https://api.jquants.com/v2";

function getApiKey(): string {
  const key = process.env.JQUANTS_API_KEY;
  if (!key) throw new Error("JQUANTS_API_KEY is not set in environment variables");
  return key;
}

/** 共通fetchヘルパー（認証 + エラーハンドリング） */
async function jqFetch<T>(path: string, params?: Record<string, string>): Promise<T> {
  const url = new URL(`${BASE_URL}${path}`);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined) url.searchParams.set(k, v);
    }
  }

  const res = await fetch(url.toString(), {
    headers: { "x-api-key": getApiKey() },
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`J-Quants API error: ${res.status} ${res.statusText} [${path}] ${text}`);
  }

  return res.json() as Promise<T>;
}

// ============================================================
// 1. 上場銘柄一覧
// ============================================================

/**
 * 上場銘柄マスタデータを取得
 * @param options.code - 銘柄コード ("7203.T" or "72030" or "7203")
 * @param options.date - 基準日
 */
export async function getMasterData(options?: {
  code?: string;
  date?: Date;
}): Promise<JQuantsMasterItem[]> {
  const params: Record<string, string> = {};
  if (options?.code) {
    params.code = options.code.includes(".")
      ? toJQuantsCode(options.code)
      : options.code;
  }
  if (options?.date) {
    params.date = dateToJQFormat(options.date);
  }

  const allItems: JQuantsMasterItem[] = [];
  let paginationKey: string | undefined;

  do {
    const fetchParams = { ...params };
    if (paginationKey) fetchParams.pagination_key = paginationKey;

    const res = await jqQueue.add(() =>
      jqFetch<JQuantsMasterResponse>("/equities/master", fetchParams)
    );
    allItems.push(...res.data);
    paginationKey = res.pagination_key;
  } while (paginationKey);

  return allItems;
}

// ============================================================
// 2. 株価四本値
// ============================================================

/**
 * 日足OHLCV（自動ページネーション対応）
 * @param options.code - 銘柄コード ("7203.T" or "72030")
 * @param options.from - 取得開始日
 * @param options.to   - 取得終了日
 * @param options.date - 特定日（from/toと排他）
 */
export async function getDailyBars(options: {
  code: string;
  from?: Date;
  to?: Date;
  date?: Date;
}): Promise<JQuantsDailyBar[]> {
  const code = options.code.includes(".")
    ? toJQuantsCode(options.code)
    : options.code;
  const params: Record<string, string> = { code };

  if (options.date) {
    params.date = dateToJQFormat(options.date);
  } else {
    if (options.from) params.from = dateToJQFormat(options.from);
    if (options.to) params.to = dateToJQFormat(options.to);
  }

  const allBars: JQuantsDailyBar[] = [];
  let paginationKey: string | undefined;

  do {
    const fetchParams = { ...params };
    if (paginationKey) fetchParams.pagination_key = paginationKey;

    const res = await jqQueue.add(() =>
      jqFetch<JQuantsDailyResponse>("/equities/bars/daily", fetchParams)
    );
    allBars.push(...res.data);
    paginationKey = res.pagination_key;
  } while (paginationKey);

  return allBars;
}

/**
 * 株価データをアプリ共通の PriceData[] 形式で取得（調整済み値を使用）
 */
export async function getHistoricalPricesJQ(
  symbol: string,
  from: Date,
  to: Date,
): Promise<PriceData[]> {
  const bars = await getDailyBars({ code: symbol, from, to });
  return bars
    .filter((b) => b.AdjO > 0 && b.AdjC > 0)
    .map((b) => ({
      date: jqDateToISO(b.Date),
      open: b.AdjO,
      high: b.AdjH,
      low: b.AdjL,
      close: b.AdjC,
      volume: b.AdjVo,
      adjustedClose: b.AdjC,
    }));
}

// ============================================================
// 3. 財務情報サマリー
// ============================================================

/**
 * 財務情報サマリー（決算短信ベース）
 * @param options.code - 銘柄コード
 * @param options.date - 特定日
 */
export async function getFinSummary(options: {
  code?: string;
  date?: Date;
}): Promise<JQuantsFinSummary[]> {
  const params: Record<string, string> = {};
  if (options.code) {
    params.code = options.code.includes(".")
      ? toJQuantsCode(options.code)
      : options.code;
  }
  if (options.date) {
    params.date = dateToJQFormat(options.date);
  }

  const allItems: JQuantsFinSummary[] = [];
  let paginationKey: string | undefined;

  do {
    const fetchParams = { ...params };
    if (paginationKey) fetchParams.pagination_key = paginationKey;

    const res = await jqQueue.add(() =>
      jqFetch<JQuantsFinSummaryResponse>("/fins/summary", fetchParams)
    );
    allItems.push(...res.data);
    paginationKey = res.pagination_key;
  } while (paginationKey);

  return allItems;
}

// ============================================================
// 4. 決算発表予定日
// ============================================================

/** 決算発表予定日カレンダーを取得 */
export async function getEarningsCalendar(): Promise<JQuantsEarningsCalendar[]> {
  const allItems: JQuantsEarningsCalendar[] = [];
  let paginationKey: string | undefined;

  do {
    const params: Record<string, string> = {};
    if (paginationKey) params.pagination_key = paginationKey;

    const res = await jqQueue.add(() =>
      jqFetch<JQuantsEarningsCalendarResponse>("/equities/earnings-calendar", params)
    );
    allItems.push(...res.data);
    paginationKey = res.pagination_key;
  } while (paginationKey);

  return allItems;
}

// ============================================================
// 5. 取引カレンダー
// ============================================================

/**
 * 取引カレンダー（営業日・休業日・祝日取引）
 * @param options.from - 開始日
 * @param options.to   - 終了日
 */
export async function getMarketCalendar(options?: {
  from?: Date;
  to?: Date;
}): Promise<JQuantsMarketCalendar[]> {
  const params: Record<string, string> = {};
  if (options?.from) params.from = dateToJQFormat(options.from);
  if (options?.to) params.to = dateToJQFormat(options.to);

  const allItems: JQuantsMarketCalendar[] = [];
  let paginationKey: string | undefined;

  do {
    const fetchParams = { ...params };
    if (paginationKey) fetchParams.pagination_key = paginationKey;

    const res = await jqQueue.add(() =>
      jqFetch<JQuantsMarketCalendarResponse>("/markets/calendar", fetchParams)
    );
    allItems.push(...res.data);
    paginationKey = res.pagination_key;
  } while (paginationKey);

  return allItems;
}
