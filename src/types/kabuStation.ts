// ============================================================
// kabuステーションAPI 型定義
// https://kabucom.github.io/kabusapi/reference/
// ============================================================

// ---------- 認証 ----------

export interface KabuTokenRequest {
  APIPassword: string;
}

export interface KabuTokenResponse {
  ResultCode: number;
  Token: string;
}

// ---------- 注文 ----------

/** 売買区分 */
export type KabuSide = "1" | "2"; // 1=売, 2=買

/** 現物/信用区分 */
export type KabuCashMargin = 1 | 2 | 3; // 1=現物, 2=新規信用, 3=返済信用

/** 口座区分 */
export type KabuAccountType = 2 | 4 | 12; // 2=一般, 4=特定, 12=法人

/** 注文タイプ */
export type KabuFrontOrderType =
  | 10  // 成行
  | 13  // 指値
  | 14  // 逆指値（成行）
  | 15  // 逆指値（指値）
  | 17  // 不成
  | 18  // 対当指値
  | 20  // 引成（前場）
  | 21  // 引指（前場）
  | 22  // 引成（後場）
  | 23  // 引指（後場）
  | 24  // 不成（前場）
  | 25  // 不成（後場）
  | 26  // IOC成行
  | 27; // IOC指値

/** 受渡区分 */
export type KabuDelivType = 0 | 1 | 2; // 0=指定なし, 1=自動, 2=お預り金

/** 市場コード */
export type KabuExchange =
  | 1  // 東証
  | 3  // 名証
  | 5  // 福証
  | 6; // 札証

/** 注文リクエスト（現物） */
export interface KabuSendOrderRequest {
  Password: string;
  Symbol: string;        // "7203" (数字のみ、.Tなし)
  Exchange: KabuExchange;
  SecurityType: 1;       // 1=株式
  Side: KabuSide;
  CashMargin: KabuCashMargin;
  DelivType: KabuDelivType;
  FundType?: string;     // 信用取引時のみ
  AccountType: KabuAccountType;
  Qty: number;           // 株数
  FrontOrderType: KabuFrontOrderType;
  Price: number;         // 0=成行
  ExpireDay: number;     // 0=当日, yyyyMMdd
}

/** 注文レスポンス */
export interface KabuOrderResponse {
  Result: number;        // 0=成功
  OrderId: string;
  ResultMessage?: string;
}

/** 取消注文リクエスト */
export interface KabuCancelOrderRequest {
  Password: string;
  OrderId: string;
}

// ---------- 注文照会 ----------

/** 注文状態 */
export type KabuOrderState =
  | 1  // 待機（未発注）
  | 2  // 処理中
  | 3  // 処理済
  | 4  // 訂正取消送信中
  | 5; // 終了

/** 注文照会レスポンス（1件分） */
export interface KabuOrder {
  ID: string;
  State: KabuOrderState;
  OrderState: KabuOrderState;
  OrdType: number;
  RecvTime: string;       // ISO8601
  Symbol: string;
  SymbolName: string;
  Exchange: KabuExchange;
  ExchangeName: string;
  Side: KabuSide;
  CashMargin: KabuCashMargin;
  AccountType: KabuAccountType;
  DelivType: KabuDelivType;
  ExpireDay: number;
  Price: number;
  Qty: number;
  CumQty: number;         // 約定数量
  Details: KabuOrderDetail[];
}

export interface KabuOrderDetail {
  SeqNum: number;
  ID: string;
  RecvTime: string;
  ExchangeID: string;
  State: KabuOrderState;
  OrdType: number;
  Price: number;
  Qty: number;
  ExecutionID: string;
  ExecutionDay: string;
  DelivDay: number;
  Commission: number;
  CommissionTax: number;
}

// ---------- ポジション ----------

export interface KabuPosition {
  ExecutionID: string;
  AccountType: KabuAccountType;
  Symbol: string;
  SymbolName: string;
  Exchange: KabuExchange;
  ExchangeName: string;
  SecurityType: number;
  ExecutionDay: number;   // yyyyMMdd
  Price: number;           // 建値
  LeavesQty: number;      // 残数量
  HoldQty: number;        // 拘束数量
  Side: KabuSide;
  Expenses: number;
  Commission: number;
  CommissionTax: number;
  ExpireDay: number;
  MarginTradeType: number;
  CurrentPrice: number;
  Valuation: number;       // 評価額
  ProfitLoss: number;      // 評価損益
  ProfitLossRate: number;  // 評価損益率
}

// ---------- 残高 ----------

export interface KabuWalletCash {
  StockAccountWallet: number; // 現物買付可能額
}

export interface KabuWalletMargin {
  MarginAccountWallet: number;      // 信用新規建可能額
  DepositkeepRate: number | null;   // 保証金維持率
  ConsignmentDepositRate: number | null;
  CashOfConsignmentDepositRate: number | null;
}

// ---------- 板情報 ----------

export interface KabuBoard {
  Symbol: string;
  SymbolName: string;
  Exchange: KabuExchange;
  ExchangeName: string;
  CurrentPrice: number;
  CurrentPriceTime: string;
  CurrentPriceChangeStatus: string;
  CurrentPriceStatus: number;
  CalcPrice: number;
  PreviousClose: number;
  PreviousCloseTime: string;
  ChangePreviousClose: number;
  ChangePreviousClosePer: number;
  OpeningPrice: number;
  HighPrice: number;
  LowPrice: number;
  TradingVolume: number;
  TradingVolumeTime: string;
  VWAP: number;
  TradingValue: number;
  // 気配値（最良5本）
  BidQty: number;         // 最良売気配数量
  BidPrice: number;        // 最良売気配値
  BidTime: string;
  BidSign: string;
  MarketOrderSellQty: number;
  Sell1?: KabuQuote;
  Sell2?: KabuQuote;
  Sell3?: KabuQuote;
  Sell4?: KabuQuote;
  Sell5?: KabuQuote;
  AskQty: number;          // 最良買気配数量
  AskPrice: number;        // 最良買気配値
  AskTime: string;
  AskSign: string;
  MarketOrderBuyQty: number;
  Buy1?: KabuQuote;
  Buy2?: KabuQuote;
  Buy3?: KabuQuote;
  Buy4?: KabuQuote;
  Buy5?: KabuQuote;
}

export interface KabuQuote {
  Price: number;
  Qty: number;
  Sign: string;
  Time: string;
}

// ---------- ヘルパー型 ----------

/** アプリ内注文情報（ローカル履歴用） */
export interface OrderHistoryEntry {
  orderId: string;
  symbol: string;          // "7203.T" (アプリ内形式)
  symbolName: string;
  side: "buy" | "sell";
  qty: number;
  price: number;
  orderType: KabuFrontOrderType;
  state: "pending" | "executed" | "cancelled" | "failed";
  executedQty?: number;
  executedPrice?: number;
  strategyId?: string;
  createdAt: string;       // ISO8601
  executedAt?: string;
}

/** kabuステーション接続モード */
export type KabuMode = "mock" | "demo" | "production";

// ---------- ユーティリティ ----------

/** "7203.T" → "7203" */
export function toKabuSymbol(appSymbol: string): string {
  return appSymbol.replace(/\.T$/, "");
}

/** "7203" → "7203.T" */
export function toAppSymbol(kabuSymbol: string): string {
  return kabuSymbol.includes(".") ? kabuSymbol : `${kabuSymbol}.T`;
}
