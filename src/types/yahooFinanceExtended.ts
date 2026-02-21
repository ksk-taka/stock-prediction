/**
 * Yahoo Finance 拡張型定義
 *
 * yahoo-finance2 ライブラリの型定義が不完全な部分を補完する。
 * quoteSummary の各モジュールで返される可能性のあるフィールドを定義。
 */

/**
 * financialData モジュール
 */
export interface YahooFinancialData {
  // 収益性
  profitMargins?: number;
  grossMargins?: number;
  operatingMargins?: number;
  ebitdaMargins?: number;

  // キャッシュフロー
  freeCashflow?: number;
  operatingCashflow?: number;

  // 成長率
  revenueGrowth?: number;
  earningsGrowth?: number;

  // 財務状態
  totalDebt?: number;
  totalCash?: number;
  debtToEquity?: number;
  currentRatio?: number;
  quickRatio?: number;

  // 評価
  returnOnAssets?: number;
  returnOnEquity?: number;

  // 収益
  totalRevenue?: number;
  grossProfits?: number;
  ebitda?: number;

  // ターゲット
  targetHighPrice?: number;
  targetLowPrice?: number;
  targetMeanPrice?: number;
  targetMedianPrice?: number;
  recommendationKey?: string;
  recommendationMean?: number;
  numberOfAnalystOpinions?: number;
}

/**
 * defaultKeyStatistics モジュール
 */
export interface YahooKeyStatistics {
  // 株式情報
  sharesOutstanding?: number;
  floatShares?: number;
  sharesShort?: number;
  shortRatio?: number;
  shortPercentOfFloat?: number;

  // 保有情報
  heldPercentInstitutions?: number;
  heldPercentInsiders?: number;

  // 評価指標
  forwardPE?: number;
  trailingEps?: number;
  forwardEps?: number;
  pegRatio?: number;
  priceToBook?: number;
  enterpriseValue?: number;
  enterpriseToRevenue?: number;
  enterpriseToEbitda?: number;

  // ベータ・配当
  beta?: number;
  beta3Year?: number;
  trailingAnnualDividendYield?: number;
  trailingAnnualDividendRate?: number;
  fiveYearAvgDividendYield?: number;
  payoutRatio?: number;

  // 日付
  lastSplitDate?: number;
  lastDividendDate?: number;
  exDividendDate?: number;

  // 52週
  "52WeekChange"?: number;
  SandP52WeekChange?: number;
}

/**
 * calendarEvents モジュール
 */
export interface YahooCalendarEvents {
  // 配当
  dividendDate?: number | Date;
  exDividendDate?: number | Date;

  // 決算
  earnings?: {
    earningsDate?: (number | Date)[];
    earningsAverage?: number;
    earningsLow?: number;
    earningsHigh?: number;
    revenueAverage?: number;
    revenueLow?: number;
    revenueHigh?: number;
  };
}

/**
 * assetProfile モジュール
 */
export interface YahooAssetProfile {
  sector?: string;
  industry?: string;
  fullTimeEmployees?: number;
  website?: string;
  longBusinessSummary?: string;
  city?: string;
  state?: string;
  country?: string;
  phone?: string;
  address1?: string;
  zip?: string;
}

/**
 * quoteSummary 全体の型
 */
export interface YahooQuoteSummary {
  financialData?: YahooFinancialData;
  defaultKeyStatistics?: YahooKeyStatistics;
  calendarEvents?: YahooCalendarEvents;
  assetProfile?: YahooAssetProfile;
}

/**
 * balanceSheetHistory のアイテム
 */
export interface YahooBalanceSheetItem {
  endDate?: number | Date;

  // 資産
  totalAssets?: number;
  currentAssets?: number;
  cash?: number;
  cashAndCashEquivalents?: number;
  shortTermInvestments?: number;
  netReceivables?: number;
  inventory?: number;
  otherCurrentAssets?: number;

  // 固定資産
  totalNonCurrentAssets?: number;
  propertyPlantEquipment?: number;
  goodWill?: number;
  intangibleAssets?: number;
  longTermInvestments?: number;

  // 投資・有価証券
  investmentinFinancialAssets?: number;
  availableForSaleSecurities?: number;
  investmentsAndAdvances?: number;

  // 負債
  totalLiabilities?: number;
  totalLiabilitiesNetMinorityInterest?: number;
  currentLiabilities?: number;
  totalCurrentLiabilities?: number;
  accountsPayable?: number;
  shortLongTermDebt?: number;
  longTermDebt?: number;
  otherCurrentLiabilities?: number;
  totalNonCurrentLiabilities?: number;

  // 株主資本
  totalStockholderEquity?: number;
  retainedEarnings?: number;
  commonStock?: number;
  treasuryStock?: number;
}
