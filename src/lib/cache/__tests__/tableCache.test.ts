import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock idb-keyval
vi.mock("idb-keyval", () => ({
  get: vi.fn(),
  set: vi.fn(),
  del: vi.fn(),
}));

import { get, set, del } from "idb-keyval";
import {
  getTableCache,
  setTableCache,
  clearTableCache,
  type StockTableRow,
} from "../tableCache";

// Mock localStorage
const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: vi.fn((key: string) => store[key] || null),
    setItem: vi.fn((key: string, value: string) => { store[key] = value; }),
    removeItem: vi.fn((key: string) => { delete store[key]; }),
    clear: vi.fn(() => { store = {}; }),
  };
})();

Object.defineProperty(globalThis, "localStorage", { value: localStorageMock });

const createSampleRow = (symbol: string): StockTableRow => ({
  symbol,
  name: `Test Stock ${symbol}`,
  price: 1000,
  changePercent: 1.5,
  volume: 100000,
  per: 15.0,
  eps: 66.67,
  pbr: 1.2,
  simpleNcRatio: null,
  cnPer: null,
  dayHigh: 1050,
  dayLow: 980,
  weekHigh: 1100,
  weekLow: 950,
  monthHigh: 1200,
  monthLow: 900,
  yearHigh: 1500,
  yearLow: 800,
  lastYearHigh: 1400,
  lastYearLow: 750,
  earningsDate: "2024-08-01",
  fiscalYearEnd: "3月",
  marketCap: 100000000000,
  sharpe1y: 1.5,
  roe: 12.5,
  latestDividend: 50,
  previousDividend: 45,
  latestIncrease: 11.1,
  hasYutai: true,
  yutaiContent: "QUOカード",
  recordDate: "2024/03/27",
  sellRecommendDate: null,
  daysUntilSell: null,
  dividendYield: 5.0,
  roeHistory: [{ year: 2023, roe: 12.0 }, { year: 2024, roe: 12.5 }],
  fcfHistory: null,
  currentRatio: 1.5,
  psr: 2.0,
  pegRatio: 1.2,
  equityRatio: 45.0,
  totalDebt: 50000000000,
  profitGrowthRate: 10.0,
  prevProfitGrowthRate: 8.0,
  revenueGrowth: 15.0,
  operatingMargins: 8.5,
  topixScale: "TOPIX Large70",
  isNikkei225: true,
  firstTradeDate: "1990-01-01",
  sharesOutstanding: 1000000000,
  floatingRatio: 70.0,
  floatingMarketCap: 70000000000,
  hasBuyback: false,
  buybackProgressAmount: null,
  buybackProgressShares: null,
  buybackImpactDays: null,
  buybackMaxAmount: null,
  buybackCumulativeAmount: null,
  buybackRemainingShares: null,
  buybackPeriodTo: null,
  buybackIsActive: null,
});

describe("tableCache", () => {
  const CACHE_VERSION = 4;
  const CACHE_TTL = 6 * 60 * 60 * 1000; // 6時間

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-06-15T10:00:00Z"));
    localStorageMock.clear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ============================================================
  // getTableCache
  // ============================================================
  describe("getTableCache", () => {
    it("キャッシュヒット時にMapを返す", async () => {
      const sampleData = {
        "7203.T": createSampleRow("7203.T"),
        "9984.T": createSampleRow("9984.T"),
      };
      const envelope = {
        version: CACHE_VERSION,
        timestamp: Date.now() - 1000 * 60, // 1分前
        data: sampleData,
      };

      vi.mocked(get).mockResolvedValue(envelope);

      const result = await getTableCache();

      expect(result).toBeInstanceOf(Map);
      expect(result?.size).toBe(2);
      expect(result?.get("7203.T")?.name).toBe("Test Stock 7203.T");
    });

    it("キャッシュがない場合nullを返す", async () => {
      vi.mocked(get).mockResolvedValue(undefined);

      const result = await getTableCache();

      expect(result).toBeNull();
    });

    it("バージョン不一致の場合nullを返す", async () => {
      const envelope = {
        version: 1, // 古いバージョン
        timestamp: Date.now(),
        data: {},
      };

      vi.mocked(get).mockResolvedValue(envelope);

      const result = await getTableCache();

      expect(result).toBeNull();
    });

    it("TTL期限切れの場合nullを返す", async () => {
      const envelope = {
        version: CACHE_VERSION,
        timestamp: Date.now() - CACHE_TTL - 1000, // 期限切れ
        data: { "7203.T": createSampleRow("7203.T") },
      };

      vi.mocked(get).mockResolvedValue(envelope);

      const result = await getTableCache();

      expect(result).toBeNull();
    });

    it("TTL境界（ちょうど期限内）の場合Mapを返す", async () => {
      const envelope = {
        version: CACHE_VERSION,
        timestamp: Date.now() - CACHE_TTL + 1000, // ぎりぎり期限内
        data: { "7203.T": createSampleRow("7203.T") },
      };

      vi.mocked(get).mockResolvedValue(envelope);

      const result = await getTableCache();

      expect(result).toBeInstanceOf(Map);
      expect(result?.size).toBe(1);
    });

    it("IndexedDBエラー時はnullを返す", async () => {
      vi.mocked(get).mockRejectedValue(new Error("IndexedDB error"));

      const result = await getTableCache();

      expect(result).toBeNull();
    });

    describe("localStorage移行", () => {
      it("旧localStorageデータをIndexedDBに移行する", async () => {
        const legacyData = {
          version: 2,
          timestamp: Date.now() - 1000,
          data: { "7203.T": createSampleRow("7203.T") },
        };
        localStorageMock.getItem.mockReturnValue(JSON.stringify(legacyData));
        vi.mocked(get).mockResolvedValue(undefined);

        const result = await getTableCache();

        expect(set).toHaveBeenCalled();
        expect(localStorageMock.removeItem).toHaveBeenCalledWith("stock-table-v1");
        expect(result?.size).toBe(1);
      });

      it("旧localStorage期限切れの場合は移行せず削除のみ", async () => {
        const legacyData = {
          version: 2,
          timestamp: Date.now() - CACHE_TTL - 1000,
          data: { "7203.T": createSampleRow("7203.T") },
        };
        localStorageMock.getItem.mockReturnValue(JSON.stringify(legacyData));
        vi.mocked(get).mockResolvedValue(undefined);

        const result = await getTableCache();

        expect(set).not.toHaveBeenCalled();
        expect(localStorageMock.removeItem).toHaveBeenCalledWith("stock-table-v1");
        expect(result).toBeNull();
      });

      it("旧localStorageが不正JSONの場合は削除のみ", async () => {
        localStorageMock.getItem.mockReturnValue("invalid json");
        vi.mocked(get).mockResolvedValue(undefined);

        const result = await getTableCache();

        expect(localStorageMock.removeItem).toHaveBeenCalledWith("stock-table-v1");
        expect(result).toBeNull();
      });
    });
  });

  // ============================================================
  // setTableCache
  // ============================================================
  describe("setTableCache", () => {
    it("MapをIndexedDBに保存する", async () => {
      const data = new Map<string, StockTableRow>();
      data.set("7203.T", createSampleRow("7203.T"));
      data.set("9984.T", createSampleRow("9984.T"));

      await setTableCache(data);

      expect(set).toHaveBeenCalledTimes(1);
      const [key, envelope] = vi.mocked(set).mock.calls[0];
      expect(key).toBe("stock-table-v4");
      expect(envelope.version).toBe(CACHE_VERSION);
      expect(envelope.timestamp).toBe(Date.now());
      expect(Object.keys(envelope.data)).toHaveLength(2);
    });

    it("空のMapの場合は保存しない", async () => {
      const data = new Map<string, StockTableRow>();

      await setTableCache(data);

      expect(set).not.toHaveBeenCalled();
    });

    it("IndexedDBエラーは無視する", async () => {
      vi.mocked(set).mockRejectedValue(new Error("Quota exceeded"));

      const data = new Map<string, StockTableRow>();
      data.set("7203.T", createSampleRow("7203.T"));

      // Should not throw
      await expect(setTableCache(data)).resolves.toBeUndefined();
    });
  });

  // ============================================================
  // clearTableCache
  // ============================================================
  describe("clearTableCache", () => {
    it("キャッシュを削除する", async () => {
      await clearTableCache();

      expect(del).toHaveBeenCalledWith("stock-table-v4");
    });

    it("削除エラーは無視する", async () => {
      vi.mocked(del).mockRejectedValue(new Error("Delete error"));

      // Should not throw
      await expect(clearTableCache()).resolves.toBeUndefined();
    });
  });

  // ============================================================
  // Integration
  // ============================================================
  describe("Integration", () => {
    it("setしたデータをgetで取得できる", async () => {
      const data = new Map<string, StockTableRow>();
      data.set("7203.T", createSampleRow("7203.T"));

      let storedEnvelope: unknown = null;
      vi.mocked(set).mockImplementation(async (_key, value) => {
        storedEnvelope = value;
      });
      vi.mocked(get).mockImplementation(async () => storedEnvelope);

      await setTableCache(data);
      const result = await getTableCache();

      expect(result?.size).toBe(1);
      expect(result?.get("7203.T")?.symbol).toBe("7203.T");
    });

    it("大量データも保存可能", async () => {
      const data = new Map<string, StockTableRow>();
      for (let i = 0; i < 1000; i++) {
        const symbol = `${1000 + i}.T`;
        data.set(symbol, createSampleRow(symbol));
      }

      await setTableCache(data);

      expect(set).toHaveBeenCalled();
      const [, envelope] = vi.mocked(set).mock.calls[0];
      expect(Object.keys(envelope.data)).toHaveLength(1000);
    });
  });
});
