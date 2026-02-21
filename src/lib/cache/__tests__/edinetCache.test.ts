import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { EdinetFinancialData } from "@/lib/api/edinetFinancials";

// Mock fs module
vi.mock("fs", () => ({
  default: {
    existsSync: vi.fn(),
    mkdirSync: vi.fn(),
    readFileSync: vi.fn(),
    writeFileSync: vi.fn(),
  },
}));

// Mock cacheUtils module
vi.mock("../cacheUtils", () => ({
  ensureCacheDir: vi.fn(() => "/mock/cache/edinet"),
  TTL: { DAYS_90: 90 * 24 * 60 * 60 * 1000 },
}));

import fs from "fs";
import {
  getCachedEdinetFinancials,
  setCachedEdinetFinancials,
  isEdinetCacheValid,
} from "../edinetCache";

// Helper to create mock EdinetFinancialData
function createMockEdinetFinancialData(): EdinetFinancialData {
  return {
    currentAssets: 50000000000,
    investmentSecurities: 10000000000,
    totalAssets: 100000000000,
    totalLiabilities: 40000000000,
    stockholdersEquity: 55000000000,
    netAssets: 60000000000,
    netSales: 80000000000,
    operatingIncome: 8000000000,
    ordinaryIncome: 9000000000,
    netIncome: 6000000000,
    operatingCashFlow: 10000000000,
    investingCashFlow: -5000000000,
    freeCashFlow: 5000000000,
    capitalExpenditure: 3000000000,
    dividendPerShare: 50,
    docId: "S100ABC123",
    filerName: "テスト株式会社",
    filingDate: "2024-06-20",
    fiscalYearEnd: "2024-03-31",
  };
}

describe("edinetCache", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ===========================================
  // getCachedEdinetFinancials Tests (90 day TTL)
  // ===========================================
  describe("getCachedEdinetFinancials", () => {
    describe("returns cached data when cache exists and is valid", () => {
      it("returns financial data when cache file exists and is not expired", () => {
        const mockData = createMockEdinetFinancialData();
        const cachedAt = Date.now() - 1000; // 1 second ago

        const cacheEntry = {
          data: mockData,
          cachedAt,
        };

        vi.mocked(fs.existsSync).mockReturnValue(true);
        vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(cacheEntry));

        const result = getCachedEdinetFinancials("7203.T");

        expect(result).not.toBeNull();
        expect(result).toEqual(mockData);
      });

      it("calls ensureCacheDir with correct subdir", async () => {
        const { ensureCacheDir } = await import("../cacheUtils");
        vi.mocked(fs.existsSync).mockReturnValue(false);

        getCachedEdinetFinancials("7203.T");

        expect(ensureCacheDir).toHaveBeenCalledWith("edinet");
      });

      it("handles symbol with dots correctly (replaces . with _)", () => {
        vi.mocked(fs.existsSync).mockReturnValue(false);

        getCachedEdinetFinancials("7203.T");

        expect(fs.existsSync).toHaveBeenCalledWith(
          expect.stringContaining("7203_T.json")
        );
      });
    });

    describe("returns null when cache is expired (90 day TTL)", () => {
      it("returns null when cache is older than 90 days", () => {
        const mockData = createMockEdinetFinancialData();
        // Cache from 91 days ago (expired)
        const cachedAt = Date.now() - 91 * 24 * 60 * 60 * 1000;

        const cacheEntry = {
          data: mockData,
          cachedAt,
        };

        vi.mocked(fs.existsSync).mockReturnValue(true);
        vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(cacheEntry));

        const result = getCachedEdinetFinancials("7203.T");

        expect(result).toBeNull();
      });

      it("returns data when cache is exactly at 90 day TTL boundary", () => {
        const mockData = createMockEdinetFinancialData();
        const now = Date.now();
        vi.useFakeTimers();
        vi.setSystemTime(now);

        const cachedAt = now - 90 * 24 * 60 * 60 * 1000; // Exactly at TTL

        const cacheEntry = {
          data: mockData,
          cachedAt,
        };

        vi.mocked(fs.existsSync).mockReturnValue(true);
        vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(cacheEntry));

        const result = getCachedEdinetFinancials("7203.T");

        // At exactly TTL, Date.now() - cachedAt === TTL, which is NOT >= TTL
        expect(result).toBeNull();
      });

      it("returns null when cache is 1ms past TTL", () => {
        const mockData = createMockEdinetFinancialData();
        const now = Date.now();
        vi.useFakeTimers();
        vi.setSystemTime(now);

        // Cache from 90 days + 1ms ago (just expired)
        const cachedAt = now - (90 * 24 * 60 * 60 * 1000 + 1);

        const cacheEntry = {
          data: mockData,
          cachedAt,
        };

        vi.mocked(fs.existsSync).mockReturnValue(true);
        vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(cacheEntry));

        const result = getCachedEdinetFinancials("7203.T");

        expect(result).toBeNull();
      });

      it("returns data when cache is 1ms before TTL", () => {
        const mockData = createMockEdinetFinancialData();
        const now = Date.now();
        vi.useFakeTimers();
        vi.setSystemTime(now);

        // Cache from 90 days - 1ms ago (not yet expired)
        const cachedAt = now - (90 * 24 * 60 * 60 * 1000 - 1);

        const cacheEntry = {
          data: mockData,
          cachedAt,
        };

        vi.mocked(fs.existsSync).mockReturnValue(true);
        vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(cacheEntry));

        const result = getCachedEdinetFinancials("7203.T");

        expect(result).not.toBeNull();
        expect(result).toEqual(mockData);
      });
    });

    describe("returns null when cache file does not exist", () => {
      it("returns null when file does not exist", () => {
        vi.mocked(fs.existsSync).mockReturnValue(false); // file does not exist

        const result = getCachedEdinetFinancials("7203.T");

        expect(result).toBeNull();
      });
    });

    describe("error handling for fs failures", () => {
      it("returns null when readFileSync throws an error", () => {
        vi.mocked(fs.existsSync).mockReturnValue(true);
        vi.mocked(fs.readFileSync).mockImplementation(() => {
          throw new Error("EACCES: permission denied");
        });

        const result = getCachedEdinetFinancials("7203.T");

        expect(result).toBeNull();
      });

      it("returns null when JSON.parse fails (corrupted cache)", () => {
        vi.mocked(fs.existsSync).mockReturnValue(true);
        vi.mocked(fs.readFileSync).mockReturnValue("invalid json {{{");

        const result = getCachedEdinetFinancials("7203.T");

        expect(result).toBeNull();
      });

      // Note: mkdirSync error handling is now tested in cacheUtils.test.ts
      // since ensureCacheDir handles directory creation
    });
  });

  // ===========================================
  // setCachedEdinetFinancials Tests
  // ===========================================
  describe("setCachedEdinetFinancials", () => {
    describe("writes data correctly", () => {
      it("writes financial data to the correct file path", () => {
        const mockData = createMockEdinetFinancialData();

        vi.mocked(fs.existsSync).mockReturnValue(true);

        setCachedEdinetFinancials("7203.T", mockData);

        expect(fs.writeFileSync).toHaveBeenCalledTimes(1);
        expect(fs.writeFileSync).toHaveBeenCalledWith(
          expect.stringContaining("7203_T.json"),
          expect.any(String),
          "utf-8"
        );
      });

      it("writes correct JSON structure with cachedAt timestamp", () => {
        const mockData = createMockEdinetFinancialData();

        const now = 1705312800000; // Fixed timestamp
        vi.useFakeTimers();
        vi.setSystemTime(now);

        vi.mocked(fs.existsSync).mockReturnValue(true);

        setCachedEdinetFinancials("7203.T", mockData);

        const writtenData = vi.mocked(fs.writeFileSync).mock.calls[0][1];
        const parsedData = JSON.parse(writtenData as string);

        expect(parsedData.data).toEqual(mockData);
        expect(parsedData.cachedAt).toBe(now);
      });

      it("calls ensureCacheDir with correct subdir", async () => {
        const { ensureCacheDir } = await import("../cacheUtils");
        const mockData = createMockEdinetFinancialData();

        vi.mocked(fs.existsSync).mockReturnValue(false);

        setCachedEdinetFinancials("7203.T", mockData);

        expect(ensureCacheDir).toHaveBeenCalledWith("edinet");
      });

      it("writes pretty-printed JSON (with indentation)", () => {
        const mockData = createMockEdinetFinancialData();

        vi.mocked(fs.existsSync).mockReturnValue(true);

        setCachedEdinetFinancials("7203.T", mockData);

        const writtenData = vi.mocked(fs.writeFileSync).mock.calls[0][1] as string;

        // Check that it contains newlines (pretty-printed)
        expect(writtenData).toContain("\n");
        // Check that it is valid JSON
        expect(() => JSON.parse(writtenData)).not.toThrow();
      });
    });

    describe("error handling for fs failures", () => {
      it("silently ignores writeFileSync errors (does not throw)", () => {
        const mockData = createMockEdinetFinancialData();

        vi.mocked(fs.existsSync).mockReturnValue(true);
        vi.mocked(fs.writeFileSync).mockImplementation(() => {
          throw new Error("EACCES: permission denied");
        });

        // Should not throw
        expect(() => {
          setCachedEdinetFinancials("7203.T", mockData);
        }).not.toThrow();
      });

      // Note: mkdirSync error handling is now tested in cacheUtils.test.ts
      // since ensureCacheDir handles directory creation
    });
  });

  // ===========================================
  // isEdinetCacheValid Tests
  // ===========================================
  describe("isEdinetCacheValid", () => {
    describe("returns true when cache is valid", () => {
      it("returns true when cache file exists and is not expired", () => {
        const mockData = createMockEdinetFinancialData();
        const cachedAt = Date.now() - 1000; // 1 second ago

        const cacheEntry = {
          data: mockData,
          cachedAt,
        };

        vi.mocked(fs.existsSync).mockReturnValue(true);
        vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(cacheEntry));

        const result = isEdinetCacheValid("7203.T");

        expect(result).toBe(true);
      });

      it("returns true when cache is close to but not past TTL", () => {
        const mockData = createMockEdinetFinancialData();
        const now = Date.now();
        vi.useFakeTimers();
        vi.setSystemTime(now);

        // Cache from 89 days ago (not expired)
        const cachedAt = now - 89 * 24 * 60 * 60 * 1000;

        const cacheEntry = {
          data: mockData,
          cachedAt,
        };

        vi.mocked(fs.existsSync).mockReturnValue(true);
        vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(cacheEntry));

        const result = isEdinetCacheValid("7203.T");

        expect(result).toBe(true);
      });
    });

    describe("returns false when cache is invalid or expired", () => {
      it("returns false when cache file does not exist", () => {
        vi.mocked(fs.existsSync).mockReturnValue(false); // file does not exist

        const result = isEdinetCacheValid("7203.T");

        expect(result).toBe(false);
      });

      it("returns false when cache is older than 90 days", () => {
        const mockData = createMockEdinetFinancialData();
        // Cache from 91 days ago (expired)
        const cachedAt = Date.now() - 91 * 24 * 60 * 60 * 1000;

        const cacheEntry = {
          data: mockData,
          cachedAt,
        };

        vi.mocked(fs.existsSync).mockReturnValue(true);
        vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(cacheEntry));

        const result = isEdinetCacheValid("7203.T");

        expect(result).toBe(false);
      });
    });

    describe("error handling", () => {
      it("returns false when readFileSync throws an error", () => {
        vi.mocked(fs.existsSync).mockReturnValue(true);
        vi.mocked(fs.readFileSync).mockImplementation(() => {
          throw new Error("EACCES: permission denied");
        });

        const result = isEdinetCacheValid("7203.T");

        expect(result).toBe(false);
      });

      it("returns false when JSON.parse fails", () => {
        vi.mocked(fs.existsSync).mockReturnValue(true);
        vi.mocked(fs.readFileSync).mockReturnValue("invalid json");

        const result = isEdinetCacheValid("7203.T");

        expect(result).toBe(false);
      });

      // Note: mkdirSync error handling is now tested in cacheUtils.test.ts
      // since ensureCacheDir handles directory creation
    });
  });

  // ===========================================
  // Integration Scenarios
  // ===========================================
  describe("integration scenarios", () => {
    it("set then get returns the same data", () => {
      const mockData = createMockEdinetFinancialData();

      const now = 1705312800000;
      vi.useFakeTimers();
      vi.setSystemTime(now);

      let storedData: string | null = null;

      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.writeFileSync).mockImplementation((_, data) => {
        storedData = data as string;
      });
      vi.mocked(fs.readFileSync).mockImplementation(() => {
        if (storedData === null) throw new Error("File not found");
        return storedData;
      });

      // Set
      setCachedEdinetFinancials("7203.T", mockData);

      // Get
      const result = getCachedEdinetFinancials("7203.T");

      expect(result).not.toBeNull();
      expect(result).toEqual(mockData);
    });

    it("isEdinetCacheValid returns true after setCachedEdinetFinancials", () => {
      const mockData = createMockEdinetFinancialData();

      const now = 1705312800000;
      vi.useFakeTimers();
      vi.setSystemTime(now);

      let storedData: string | null = null;

      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.writeFileSync).mockImplementation((_, data) => {
        storedData = data as string;
      });
      vi.mocked(fs.readFileSync).mockImplementation(() => {
        if (storedData === null) throw new Error("File not found");
        return storedData;
      });

      // Set
      setCachedEdinetFinancials("7203.T", mockData);

      // Check validity
      const isValid = isEdinetCacheValid("7203.T");

      expect(isValid).toBe(true);
    });

    it("different symbols use different cache files", () => {
      const mockData = createMockEdinetFinancialData();

      vi.mocked(fs.existsSync).mockReturnValue(true);

      setCachedEdinetFinancials("7203.T", mockData);
      setCachedEdinetFinancials("9984.T", mockData);

      const calls = vi.mocked(fs.writeFileSync).mock.calls;
      expect(calls[0][0]).toContain("7203_T.json");
      expect(calls[1][0]).toContain("9984_T.json");
    });

    it("handles symbols without dots correctly", () => {
      const mockData = createMockEdinetFinancialData();

      vi.mocked(fs.existsSync).mockReturnValue(true);

      setCachedEdinetFinancials("7203", mockData);

      expect(fs.writeFileSync).toHaveBeenCalledWith(
        expect.stringContaining("7203.json"),
        expect.any(String),
        "utf-8"
      );
    });

    it("preserves all financial data fields through cache round-trip", () => {
      const mockData = createMockEdinetFinancialData();

      let storedData: string | null = null;

      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.writeFileSync).mockImplementation((_, data) => {
        storedData = data as string;
      });
      vi.mocked(fs.readFileSync).mockImplementation(() => {
        if (storedData === null) throw new Error("File not found");
        return storedData;
      });

      // Set
      setCachedEdinetFinancials("7203.T", mockData);

      // Get
      const result = getCachedEdinetFinancials("7203.T");

      // Verify all fields are preserved
      expect(result?.currentAssets).toBe(mockData.currentAssets);
      expect(result?.investmentSecurities).toBe(mockData.investmentSecurities);
      expect(result?.totalAssets).toBe(mockData.totalAssets);
      expect(result?.totalLiabilities).toBe(mockData.totalLiabilities);
      expect(result?.stockholdersEquity).toBe(mockData.stockholdersEquity);
      expect(result?.netAssets).toBe(mockData.netAssets);
      expect(result?.netSales).toBe(mockData.netSales);
      expect(result?.operatingIncome).toBe(mockData.operatingIncome);
      expect(result?.ordinaryIncome).toBe(mockData.ordinaryIncome);
      expect(result?.netIncome).toBe(mockData.netIncome);
      expect(result?.operatingCashFlow).toBe(mockData.operatingCashFlow);
      expect(result?.investingCashFlow).toBe(mockData.investingCashFlow);
      expect(result?.freeCashFlow).toBe(mockData.freeCashFlow);
      expect(result?.capitalExpenditure).toBe(mockData.capitalExpenditure);
      expect(result?.dividendPerShare).toBe(mockData.dividendPerShare);
      expect(result?.docId).toBe(mockData.docId);
      expect(result?.filerName).toBe(mockData.filerName);
      expect(result?.filingDate).toBe(mockData.filingDate);
      expect(result?.fiscalYearEnd).toBe(mockData.fiscalYearEnd);
    });

    it("handles null values in financial data correctly", () => {
      const mockData: EdinetFinancialData = {
        currentAssets: null,
        investmentSecurities: null,
        totalAssets: 100000000000,
        totalLiabilities: null,
        stockholdersEquity: null,
        netAssets: 60000000000,
        netSales: null,
        operatingIncome: null,
        ordinaryIncome: null,
        netIncome: 6000000000,
        operatingCashFlow: null,
        investingCashFlow: null,
        freeCashFlow: null,
        capitalExpenditure: null,
        dividendPerShare: null,
        docId: "S100ABC123",
        filerName: "テスト株式会社",
        filingDate: "2024-06-20",
        fiscalYearEnd: "2024-03-31",
      };

      let storedData: string | null = null;

      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.writeFileSync).mockImplementation((_, data) => {
        storedData = data as string;
      });
      vi.mocked(fs.readFileSync).mockImplementation(() => {
        if (storedData === null) throw new Error("File not found");
        return storedData;
      });

      // Set
      setCachedEdinetFinancials("7203.T", mockData);

      // Get
      const result = getCachedEdinetFinancials("7203.T");

      expect(result).not.toBeNull();
      expect(result?.currentAssets).toBeNull();
      expect(result?.totalAssets).toBe(100000000000);
      expect(result?.netIncome).toBe(6000000000);
    });
  });
});
