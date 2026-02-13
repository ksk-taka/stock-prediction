/** 株主優待情報（Kabutanからスクレイピング） */
export interface YutaiInfo {
  hasYutai: boolean;
  content: string | null;          // 優待内容
  recordMonth: string | null;      // 権利確定月 ("3月、9月")
  minimumShares: string | null;    // 最低必要株数 ("100株")
  recordDate: string | null;       // 権利付最終日 ("2026/03/27")
  longTermBenefit: string | null;  // 長期保有優遇 ("あり" / "なし")
  yutaiYield: string | null;       // 優待利回り ("1.5%")
}

/** ROE推移（年次） */
export interface RoeHistoryEntry {
  year: number;
  roe: number; // 小数 (0.152 = 15.2%)
}

/** FCF推移（年次） */
export interface FcfHistoryEntry {
  year: number;
  fcf: number; // 円建て（正=プラス, 負=マイナス）
  ocf: number; // 営業CF
  capex: number; // 設備投資（負の値）
}
