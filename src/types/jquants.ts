// ============================================================
// J-Quants API v2 型定義
// ============================================================

// --- 上場銘柄一覧 (/equities/master) ---

export interface JQuantsMasterItem {
  Date: string;          // YYYY-MM-DD
  Code: string;          // 5桁コード (例: "72030")
  CoName: string;        // 会社名（日本語）
  CoNameEn: string;      // 会社名（英語）
  S17: string;           // 17業種コード
  S17Nm: string;         // 17業種名
  S33: string;           // 33業種コード
  S33Nm: string;         // 33業種名
  ScaleCat: string;      // TOPIX規模区分
  Mkt: string;           // 市場区分コード
  MktNm: string;         // 市場区分名
}

export interface JQuantsMasterResponse {
  data: JQuantsMasterItem[];
  pagination_key?: string;
}

// --- 株価四本値 (/equities/bars/daily) ---

export interface JQuantsDailyBar {
  Date: string;          // YYYY-MM-DD
  Code: string;          // 5桁コード
  O: number;             // 始値
  H: number;             // 高値
  L: number;             // 安値
  C: number;             // 終値
  UL: number;            // ストップ高フラグ (0|1)
  LL: number;            // ストップ安フラグ (0|1)
  Vo: number;            // 出来高
  Va: number;            // 売買代金
  AdjFactor: number;     // 調整係数
  AdjO: number;          // 調整済始値
  AdjH: number;          // 調整済高値
  AdjL: number;          // 調整済安値
  AdjC: number;          // 調整済終値
  AdjVo: number;         // 調整済出来高
}

export interface JQuantsDailyResponse {
  data: JQuantsDailyBar[];
  pagination_key?: string;
}

// --- 財務情報サマリー (/fins/summary) ---

export interface JQuantsFinSummary {
  Date: string;
  Code: string;
  // カラム名はv2で短縮されている（実際のレスポンスに合わせて利用時に拡張）
  [key: string]: unknown;
}

export interface JQuantsFinSummaryResponse {
  data: JQuantsFinSummary[];
  pagination_key?: string;
}

// --- 決算発表予定日 (/equities/earnings-calendar) ---

export interface JQuantsEarningsCalendar {
  Date: string;
  Code: string;
  [key: string]: unknown;
}

export interface JQuantsEarningsCalendarResponse {
  data: JQuantsEarningsCalendar[];
  pagination_key?: string;
}

// --- 取引カレンダー (/markets/calendar) ---

export interface JQuantsMarketCalendar {
  Date: string;
  HolDiv: string;       // 休日区分
  [key: string]: unknown;
}

export interface JQuantsMarketCalendarResponse {
  data: JQuantsMarketCalendar[];
  pagination_key?: string;
}

// ============================================================
// シンボル変換ユーティリティ
// ============================================================

/** アプリシンボル → J-Quants 5桁コード: "7203.T" → "72030" */
export function toJQuantsCode(appSymbol: string): string {
  const base = appSymbol.replace(/\.T$/, "");
  return base.length === 4 ? base + "0" : base;
}

/** J-Quants 5桁コード → アプリシンボル: "72030" → "7203.T" */
export function fromJQuantsCode(jqCode: string): string {
  const base = jqCode.length === 5 ? jqCode.slice(0, 4) : jqCode;
  return `${base}.T`;
}

// ============================================================
// 日付変換ユーティリティ
// ============================================================

/** J-Quants日付 → ISO: "20240104" → "2024-01-04" */
export function jqDateToISO(yyyymmdd: string): string {
  if (yyyymmdd.includes("-")) return yyyymmdd; // 既にISO形式
  return `${yyyymmdd.slice(0, 4)}-${yyyymmdd.slice(4, 6)}-${yyyymmdd.slice(6, 8)}`;
}

/** Date → J-Quants日付: Date → "20240104" */
export function dateToJQFormat(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}${m}${day}`;
}
