// ============================================================
// kabuステーションAPI クライアント
// https://kabucom.github.io/kabusapi/reference/
// ============================================================

import type {
  KabuMode,
  KabuTokenResponse,
  KabuSendOrderRequest,
  KabuOrderResponse,
  KabuOrder,
  KabuPosition,
  KabuWalletCash,
  KabuBoard,
  KabuExchange,
  KabuSide,
} from "@/types/kabuStation";
import { toKabuSymbol } from "@/types/kabuStation";

// ---------- インターフェース ----------

export interface IKabuStationClient {
  getToken(): Promise<string>;
  sendOrder(order: KabuSendOrderRequest): Promise<KabuOrderResponse>;
  cancelOrder(orderId: string, password: string): Promise<{ Result: number }>;
  getOrders(params?: { symbol?: string; state?: number }): Promise<KabuOrder[]>;
  getPositions(params?: { symbol?: string }): Promise<KabuPosition[]>;
  getWallet(symbol?: string): Promise<KabuWalletCash>;
  getBoard(symbol: string): Promise<KabuBoard>;
  isConnected(): Promise<boolean>;
}

// ---------- 実クライアント ----------

export class KabuStationClient implements IKabuStationClient {
  private baseUrl: string;
  private apiPassword: string;
  private token: string | null = null;
  private tokenExpiry: number = 0;

  constructor(baseUrl?: string, apiPassword?: string) {
    this.baseUrl = baseUrl || process.env.KABU_API_URL || "http://localhost:18080/kabusapi";
    this.apiPassword = apiPassword || process.env.KABU_API_PASSWORD || "";
  }

  async getToken(): Promise<string> {
    // トークンキャッシュ（12時間有効）
    if (this.token && Date.now() < this.tokenExpiry) {
      return this.token;
    }

    const res = await fetch(`${this.baseUrl}/token`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ APIPassword: this.apiPassword }),
    });

    if (!res.ok) {
      throw new Error(`kabu Station token error: ${res.status} ${res.statusText}`);
    }

    const data: KabuTokenResponse = await res.json();
    this.token = data.Token;
    this.tokenExpiry = Date.now() + 12 * 60 * 60 * 1000; // 12h
    return this.token;
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const token = await this.getToken();
    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        "X-API-KEY": token,
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(`kabu Station API error: ${method} ${path} → ${res.status} ${text}`);
    }

    return res.json();
  }

  async sendOrder(order: KabuSendOrderRequest): Promise<KabuOrderResponse> {
    return this.request<KabuOrderResponse>("POST", "/sendorder", order);
  }

  async cancelOrder(orderId: string, password: string): Promise<{ Result: number }> {
    return this.request("PUT", "/cancelorder", { OrderId: orderId, Password: password });
  }

  async getOrders(params?: { symbol?: string; state?: number }): Promise<KabuOrder[]> {
    const query = new URLSearchParams();
    if (params?.symbol) query.set("symbol", toKabuSymbol(params.symbol));
    if (params?.state) query.set("state", String(params.state));
    const qs = query.toString();
    return this.request<KabuOrder[]>("GET", `/orders${qs ? `?${qs}` : ""}`);
  }

  async getPositions(params?: { symbol?: string }): Promise<KabuPosition[]> {
    const query = new URLSearchParams();
    if (params?.symbol) query.set("symbol", toKabuSymbol(params.symbol));
    const qs = query.toString();
    return this.request<KabuPosition[]>("GET", `/positions${qs ? `?${qs}` : ""}`);
  }

  async getWallet(symbol?: string): Promise<KabuWalletCash> {
    const path = symbol ? `/wallet/cash/${toKabuSymbol(symbol)}` : "/wallet/cash";
    return this.request<KabuWalletCash>("GET", path);
  }

  async getBoard(symbol: string): Promise<KabuBoard> {
    // Board API は "{symbol}@{exchange}" 形式
    const sym = toKabuSymbol(symbol);
    return this.request<KabuBoard>("GET", `/board/${sym}@1`);
  }

  async isConnected(): Promise<boolean> {
    try {
      await this.getToken();
      return true;
    } catch {
      return false;
    }
  }
}

// ---------- モッククライアント ----------

export class MockKabuStationClient implements IKabuStationClient {
  async getToken(): Promise<string> {
    return "mock-token-12345";
  }

  async sendOrder(order: KabuSendOrderRequest): Promise<KabuOrderResponse> {
    console.log("[MOCK] sendOrder:", order.Symbol, order.Side === "2" ? "買" : "売", `${order.Qty}株`);
    return {
      Result: 0,
      OrderId: `MOCK-${Date.now()}`,
    };
  }

  async cancelOrder(orderId: string): Promise<{ Result: number }> {
    console.log("[MOCK] cancelOrder:", orderId);
    return { Result: 0 };
  }

  async getOrders(): Promise<KabuOrder[]> {
    return [];
  }

  async getPositions(): Promise<KabuPosition[]> {
    return [];
  }

  async getWallet(): Promise<KabuWalletCash> {
    return { StockAccountWallet: 1_000_000 };
  }

  async getBoard(symbol: string): Promise<KabuBoard> {
    const sym = toKabuSymbol(symbol);
    return {
      Symbol: sym,
      SymbolName: `Mock ${sym}`,
      Exchange: 1 as KabuExchange,
      ExchangeName: "東証",
      CurrentPrice: 2500,
      CurrentPriceTime: new Date().toISOString(),
      CurrentPriceChangeStatus: "0",
      CurrentPriceStatus: 1,
      CalcPrice: 2500,
      PreviousClose: 2480,
      PreviousCloseTime: "",
      ChangePreviousClose: 20,
      ChangePreviousClosePer: 0.81,
      OpeningPrice: 2490,
      HighPrice: 2520,
      LowPrice: 2470,
      TradingVolume: 150000,
      TradingVolumeTime: "",
      VWAP: 2495,
      TradingValue: 374250000,
      BidQty: 1000,
      BidPrice: 2501,
      BidTime: "",
      BidSign: "0",
      MarketOrderSellQty: 0,
      AskQty: 800,
      AskPrice: 2499,
      AskTime: "",
      AskSign: "0",
      MarketOrderBuyQty: 0,
    };
  }

  async isConnected(): Promise<boolean> {
    return true;
  }
}

// ---------- ファクトリ ----------

let _client: IKabuStationClient | null = null;

export function getKabuClient(): IKabuStationClient {
  if (_client) return _client;

  const mode = (process.env.KABU_MODE || "mock") as KabuMode;

  switch (mode) {
    case "production":
    case "demo":
      _client = new KabuStationClient();
      break;
    case "mock":
    default:
      _client = new MockKabuStationClient();
      break;
  }

  return _client;
}

// ---------- 注文ヘルパー ----------

/** 現物買い注文を簡易作成 */
export function createBuyOrder(
  symbol: string,
  qty: number,
  options?: {
    orderType?: "market" | "limit";
    price?: number;
    expireDay?: number;
  },
): KabuSendOrderRequest {
  const password = process.env.KABU_ORDER_PASSWORD || "";
  const orderType = options?.orderType ?? "market";

  return {
    Password: password,
    Symbol: toKabuSymbol(symbol),
    Exchange: 1, // 東証
    SecurityType: 1,
    Side: "2" as KabuSide, // 買
    CashMargin: 1, // 現物
    DelivType: 2,  // お預り金
    AccountType: 4, // 特定口座
    Qty: qty,
    FrontOrderType: orderType === "market" ? 10 : 13,
    Price: orderType === "market" ? 0 : (options?.price ?? 0),
    ExpireDay: options?.expireDay ?? 0, // 当日
  };
}

/** 現物売り注文を簡易作成 */
export function createSellOrder(
  symbol: string,
  qty: number,
  options?: {
    orderType?: "market" | "limit";
    price?: number;
    expireDay?: number;
  },
): KabuSendOrderRequest {
  const password = process.env.KABU_ORDER_PASSWORD || "";
  const orderType = options?.orderType ?? "market";

  return {
    Password: password,
    Symbol: toKabuSymbol(symbol),
    Exchange: 1,
    SecurityType: 1,
    Side: "1" as KabuSide, // 売
    CashMargin: 1,
    DelivType: 0,  // 指定なし
    AccountType: 4,
    Qty: qty,
    FrontOrderType: orderType === "market" ? 10 : 13,
    Price: orderType === "market" ? 0 : (options?.price ?? 0),
    ExpireDay: options?.expireDay ?? 0,
  };
}
