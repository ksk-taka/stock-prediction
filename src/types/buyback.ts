/** 自社株買い月次報告データ（EDINET XBRL TextBlock から抽出） */
export interface BuybackReport {
  reportPeriodFrom: string | null;      // 報告対象期間 開始日 (YYYY-MM-DD)
  reportPeriodTo: string | null;        // 報告対象期間 終了日 (YYYY-MM-DD)
  resolutionDate: string | null;        // 取締役会決議日 (テキスト)
  acquisitionPeriodFrom: string | null; // 取得期間 開始日
  acquisitionPeriodTo: string | null;   // 取得期間 終了日
  maxShares: number | null;             // 取得上限株数
  maxAmount: number | null;             // 取得上限金額（円）
  sharesAcquired: number | null;        // 当月取得株数
  amountSpent: number | null;           // 当月取得金額（円）
  cumulativeShares: number | null;      // 累計取得株数
  cumulativeAmount: number | null;      // 累計取得金額（円）
  progressSharesPct: number | null;     // 株数進捗率 (0-100)
  progressAmountPct: number | null;     // 金額進捗率 (0-100)
  docId: string;
  filingDate: string;
}

/** EDINET documents.json から取得した文書メタデータ */
export interface BuybackDocEntry {
  docId: string;
  secCode: string;         // 5桁 EDINET コード
  stockCode: string;       // 4桁銘柄コード
  filerName: string;
  docDescription: string;
  filingDate: string;
}

/** 銘柄別の自社株買い詳細（統合結果） */
export interface BuybackDetail {
  stockCode: string;                    // 4桁コード
  filerName: string;                    // 企業名
  latestReport: BuybackReport | null;   // 最新の月次報告
  allReports: BuybackReport[];          // 全月次報告（新しい順）
  progressShares: number | null;        // 株数進捗率 (0-100%)
  progressAmount: number | null;        // 金額進捗率 (0-100%)
  isActive: boolean;                    // 取得期間中かどうか
  scannedAt: string;                    // ISO date
}

/** API レスポンス用: BuybackDetail + 出来高インパクト情報 */
export interface BuybackDetailWithImpact extends BuybackDetail {
  remainingShares: number | null;       // 残り取得可能株数
  avgDailyVolume: number | null;        // 3ヶ月平均出来高
  impactDays: number | null;            // 買付完了までの営業日数 (25%ルール)
}
