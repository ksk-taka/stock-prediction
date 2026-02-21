import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { DividendSummary } from "@/types";

// Mock fs module
vi.mock("fs", () => ({
  default: {
    existsSync: vi.fn(),
    mkdirSync: vi.fn(),
    readFileSync: vi.fn(),
    writeFileSync: vi.fn(),
    unlinkSync: vi.fn(),
  },
}));

// Mock cacheUtils module
vi.mock("../cacheUtils", () => ({
  ensureCacheDir: vi.fn(() => "/mock/cache/stats"),
  TTL: { HOURS_24: 24 * 60 * 60 * 1000, DAYS_7: 7 * 24 * 60 * 60 * 1000, DAYS_30: 30 * 24 * 60 * 60 * 1000 },
}));

// Mock Supabase service client
vi.mock("@/lib/supabase/service", () => ({
  createServiceClient: vi.fn(() => ({
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          single: vi.fn(() => Promise.resolve({ data: null, error: null })),
        })),
        in: vi.fn(() => Promise.resolve({ data: [], error: null })),
      })),
      upsert: vi.fn(() => Promise.resolve({ data: null, error: null })),
    })),
  })),
}));

import fs from "fs";
import {
  getCachedStats,
  setCachedStats,
  getCachedNcRatio,
  setCachedNcOnly,
  getCachedDividendSummary,
  setCachedDividendOnly,
  getCachedRoe,
  setCachedRoeOnly,
  getCachedStatsAll,
  getCachedStatsFull,
  setCachedStatsPartial,
  invalidateStatsCache,
  isNearEarningsDate,
  getStatsCacheFromSupabase,
  setStatsCacheToSupabase,
  getStatsCacheBatchFromSupabase,
} from "../statsCache";

// Sample dividend data for testing
const sampleDividendSummary: DividendSummary = {
  latestAmount: 100,
  previousAmount: 90,
  twoPrevAmount: 80,
  latestIncrease: 10,
  latestDate: "2024-03-15",
};

// Sample stats cache entry
const sampleStatsEntry = {
  per: 15.5,
  forwardPer: 14.0,
  pbr: 1.2,
  eps: 200,
  roe: 12.5,
  dividendYield: 2.5,
  simpleNcRatio: 0.85,
  marketCap: 1000000000,
  sharpe1y: 1.2,
  dividendSummary: sampleDividendSummary,
  cachedAt: Date.now(),
  ncCachedAt: Date.now(),
  dividendCachedAt: Date.now(),
  roeCachedAt: Date.now(),
};

describe("statsCache", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-01-17T10:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ===========================================
  // isNearEarningsDate
  // ===========================================
  describe("isNearEarningsDate", () => {
    it("returns false when earningsDate is null", () => {
      expect(isNearEarningsDate(null)).toBe(false);
    });

    it("returns false when earningsDate is undefined", () => {
      expect(isNearEarningsDate(undefined)).toBe(false);
    });

    it("returns false when earningsDate is invalid", () => {
      expect(isNearEarningsDate("invalid-date")).toBe(false);
    });

    it("returns true when earningsDate is within 3 days", () => {
      const twoDaysAgo = new Date("2024-01-15T10:00:00Z");
      expect(isNearEarningsDate(twoDaysAgo)).toBe(true);
    });

    it("returns true when earningsDate is in 2 days", () => {
      const twoDaysLater = new Date("2024-01-19T10:00:00Z");
      expect(isNearEarningsDate(twoDaysLater)).toBe(true);
    });

    it("returns false when earningsDate is more than 3 days ago", () => {
      const fiveDaysAgo = new Date("2024-01-12T10:00:00Z");
      expect(isNearEarningsDate(fiveDaysAgo)).toBe(false);
    });

    it("returns false when earningsDate is more than 3 days in future", () => {
      const fiveDaysLater = new Date("2024-01-22T10:00:00Z");
      expect(isNearEarningsDate(fiveDaysLater)).toBe(false);
    });

    it("accepts string date format", () => {
      expect(isNearEarningsDate("2024-01-16")).toBe(true);
    });

    it("accepts timestamp number", () => {
      const twoDaysAgo = new Date("2024-01-15T10:00:00Z").getTime();
      expect(isNearEarningsDate(twoDaysAgo)).toBe(true);
    });
  });

  // ===========================================
  // invalidateStatsCache
  // ===========================================
  describe("invalidateStatsCache", () => {
    it("deletes cache file when it exists", () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.unlinkSync).mockImplementation(() => {});

      const result = invalidateStatsCache("7203.T");

      expect(result).toBe(true);
      expect(fs.unlinkSync).toHaveBeenCalled();
    });

    it("returns false when cache file does not exist", () => {
      vi.mocked(fs.existsSync).mockImplementation((path) => {
        if (typeof path === "string" && path.endsWith(".json")) {
          return false;
        }
        return true; // directory exists
      });

      const result = invalidateStatsCache("7203.T");

      expect(result).toBe(false);
      expect(fs.unlinkSync).not.toHaveBeenCalled();
    });

    it("returns false when unlink throws an error", () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.unlinkSync).mockImplementation(() => {
        throw new Error("Permission denied");
      });

      const result = invalidateStatsCache("7203.T");

      expect(result).toBe(false);
    });
  });

  // ===========================================
  // getCachedStats
  // ===========================================
  describe("getCachedStats", () => {
    it("returns cached data when file exists and TTL is valid (24h)", () => {
      const cachedEntry = {
        ...sampleStatsEntry,
        cachedAt: Date.now() - 1000 * 60 * 60, // 1 hour ago
      };

      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(cachedEntry));

      const result = getCachedStats("7203.T");

      expect(result).not.toBeNull();
      expect(result?.per).toBe(15.5);
      expect(result?.roe).toBe(12.5);
    });

    it("returns null when cache file does not exist", () => {
      vi.mocked(fs.existsSync).mockImplementation((path) => {
        if (typeof path === "string" && path.endsWith(".json")) {
          return false;
        }
        return true;
      });

      const result = getCachedStats("7203.T");

      expect(result).toBeNull();
    });

    it("returns null when cache has expired (> 24h)", () => {
      const cachedEntry = {
        ...sampleStatsEntry,
        cachedAt: Date.now() - 1000 * 60 * 60 * 25, // 25 hours ago
      };

      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(cachedEntry));

      const result = getCachedStats("7203.T");

      expect(result).toBeNull();
    });

    it("returns null when readFileSync throws an error", () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockImplementation(() => {
        throw new Error("File read error");
      });

      const result = getCachedStats("7203.T");

      expect(result).toBeNull();
    });

    it("returns null when JSON parsing fails", () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue("invalid json");

      const result = getCachedStats("7203.T");

      expect(result).toBeNull();
    });

    it("handles symbols with dots correctly", () => {
      const cachedEntry = {
        ...sampleStatsEntry,
        cachedAt: Date.now() - 1000 * 60,
      };

      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(cachedEntry));

      getCachedStats("7203.T");

      const readFileCalls = vi.mocked(fs.readFileSync).mock.calls;
      expect(readFileCalls[0][0]).toContain("7203_T.json");
    });
  });

  // ===========================================
  // setCachedStats
  // ===========================================
  describe("setCachedStats", () => {
    it("writes stats data to cache file correctly", () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);

      const data = {
        per: 15.5,
        forwardPer: 14.0,
        pbr: 1.2,
        eps: 200,
        roe: 12.5,
        dividendYield: 2.5,
      };

      setCachedStats("7203.T", data);

      expect(fs.writeFileSync).toHaveBeenCalledTimes(1);

      const writeCall = vi.mocked(fs.writeFileSync).mock.calls[0];
      expect(writeCall[0]).toContain("7203_T.json");

      const writtenData = JSON.parse(writeCall[1] as string);
      expect(writtenData.per).toBe(15.5);
      expect(writtenData.roe).toBe(12.5);
      expect(writtenData.cachedAt).toBe(Date.now());
    });

    it("calls ensureCacheDir with correct subdir", async () => {
      const { ensureCacheDir } = await import("../cacheUtils");
      vi.mocked(fs.existsSync).mockReturnValue(false);

      setCachedStats("7203.T", {
        per: null,
        forwardPer: null,
        pbr: null,
        eps: null,
        roe: null,
        dividendYield: null,
      });

      expect(ensureCacheDir).toHaveBeenCalledWith("stats");
    });

    it("silently ignores write errors", () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.writeFileSync).mockImplementation(() => {
        throw new Error("Write error");
      });

      expect(() => {
        setCachedStats("7203.T", {
          per: null,
          forwardPer: null,
          pbr: null,
          eps: null,
          roe: null,
          dividendYield: null,
        });
      }).not.toThrow();
    });
  });

  // ===========================================
  // getCachedNcRatio
  // ===========================================
  describe("getCachedNcRatio", () => {
    it("returns NC ratio when cache is valid (7 day TTL)", () => {
      const cachedEntry = {
        ...sampleStatsEntry,
        ncCachedAt: Date.now() - 1000 * 60 * 60 * 24 * 3, // 3 days ago
        simpleNcRatio: 0.85,
      };

      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(cachedEntry));

      const result = getCachedNcRatio("7203.T");

      expect(result).toBe(0.85);
    });

    it("returns undefined when NC cache has expired (> 7 days)", () => {
      const cachedEntry = {
        ...sampleStatsEntry,
        ncCachedAt: Date.now() - 1000 * 60 * 60 * 24 * 8, // 8 days ago
        simpleNcRatio: 0.85,
      };

      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(cachedEntry));

      const result = getCachedNcRatio("7203.T");

      expect(result).toBeUndefined();
    });

    it("returns null when NC ratio is null (computed as no data)", () => {
      const cachedEntry = {
        ...sampleStatsEntry,
        ncCachedAt: Date.now() - 1000 * 60,
        simpleNcRatio: null,
      };

      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(cachedEntry));

      const result = getCachedNcRatio("7203.T");

      expect(result).toBeNull();
    });

    it("returns undefined when cache file does not exist", () => {
      vi.mocked(fs.existsSync).mockImplementation((path) => {
        if (typeof path === "string" && path.endsWith(".json")) {
          return false;
        }
        return true;
      });

      const result = getCachedNcRatio("7203.T");

      expect(result).toBeUndefined();
    });

    it("falls back to cachedAt when ncCachedAt is not present", () => {
      const cachedEntry = {
        per: null,
        forwardPer: null,
        pbr: null,
        eps: null,
        roe: null,
        dividendYield: null,
        simpleNcRatio: 0.75,
        cachedAt: Date.now() - 1000 * 60 * 60 * 24 * 5, // 5 days ago (within 7 day TTL)
        // ncCachedAt not present
      };

      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(cachedEntry));

      const result = getCachedNcRatio("7203.T");

      expect(result).toBe(0.75);
    });
  });

  // ===========================================
  // setCachedNcOnly
  // ===========================================
  describe("setCachedNcOnly", () => {
    it("updates existing entry with NC ratio only", () => {
      const existingEntry = {
        per: 15.5,
        forwardPer: 14.0,
        pbr: 1.2,
        eps: 200,
        roe: 12.5,
        dividendYield: 2.5,
        cachedAt: Date.now() - 1000 * 60 * 60, // 1 hour ago
      };

      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(existingEntry));

      setCachedNcOnly("7203.T", 0.9);

      const writeCall = vi.mocked(fs.writeFileSync).mock.calls[0];
      const writtenData = JSON.parse(writeCall[1] as string);

      expect(writtenData.simpleNcRatio).toBe(0.9);
      expect(writtenData.per).toBe(15.5); // preserved
      expect(writtenData.ncCachedAt).toBe(Date.now());
      expect(writtenData.cachedAt).toBe(existingEntry.cachedAt); // preserved
    });

    it("creates new entry when file does not exist", () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockImplementation(() => {
        throw new Error("File not found");
      });

      setCachedNcOnly("7203.T", 0.9);

      const writeCall = vi.mocked(fs.writeFileSync).mock.calls[0];
      const writtenData = JSON.parse(writeCall[1] as string);

      expect(writtenData.simpleNcRatio).toBe(0.9);
      expect(writtenData.per).toBeNull();
      expect(writtenData.cachedAt).toBe(Date.now());
      expect(writtenData.ncCachedAt).toBe(Date.now());
    });

    it("handles null NC ratio", () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockImplementation(() => {
        throw new Error("File not found");
      });

      setCachedNcOnly("7203.T", null);

      const writeCall = vi.mocked(fs.writeFileSync).mock.calls[0];
      const writtenData = JSON.parse(writeCall[1] as string);

      expect(writtenData.simpleNcRatio).toBeNull();
    });
  });

  // ===========================================
  // getCachedDividendSummary
  // ===========================================
  describe("getCachedDividendSummary", () => {
    it("returns dividend summary when cache is valid (30 day TTL)", () => {
      const cachedEntry = {
        ...sampleStatsEntry,
        dividendCachedAt: Date.now() - 1000 * 60 * 60 * 24 * 15, // 15 days ago
        dividendSummary: sampleDividendSummary,
      };

      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(cachedEntry));

      const result = getCachedDividendSummary("7203.T");

      expect(result).toEqual(sampleDividendSummary);
    });

    it("returns undefined when dividend cache has expired (> 30 days)", () => {
      const cachedEntry = {
        ...sampleStatsEntry,
        dividendCachedAt: Date.now() - 1000 * 60 * 60 * 24 * 31, // 31 days ago
        dividendSummary: sampleDividendSummary,
      };

      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(cachedEntry));

      const result = getCachedDividendSummary("7203.T");

      expect(result).toBeUndefined();
    });

    it("returns null when dividendSummary is null (no dividend)", () => {
      const cachedEntry = {
        ...sampleStatsEntry,
        dividendCachedAt: Date.now() - 1000 * 60,
        dividendSummary: null,
      };

      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(cachedEntry));

      const result = getCachedDividendSummary("7203.T");

      expect(result).toBeNull();
    });
  });

  // ===========================================
  // setCachedDividendOnly
  // ===========================================
  describe("setCachedDividendOnly", () => {
    it("updates existing entry with dividend summary only", () => {
      const existingEntry = {
        per: 15.5,
        forwardPer: 14.0,
        pbr: 1.2,
        eps: 200,
        roe: 12.5,
        dividendYield: 2.5,
        cachedAt: Date.now() - 1000 * 60 * 60,
      };

      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(existingEntry));

      setCachedDividendOnly("7203.T", sampleDividendSummary);

      const writeCall = vi.mocked(fs.writeFileSync).mock.calls[0];
      const writtenData = JSON.parse(writeCall[1] as string);

      expect(writtenData.dividendSummary).toEqual(sampleDividendSummary);
      expect(writtenData.per).toBe(15.5); // preserved
      expect(writtenData.dividendCachedAt).toBe(Date.now());
    });

    it("creates new entry when file does not exist", () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockImplementation(() => {
        throw new Error("File not found");
      });

      setCachedDividendOnly("7203.T", sampleDividendSummary);

      const writeCall = vi.mocked(fs.writeFileSync).mock.calls[0];
      const writtenData = JSON.parse(writeCall[1] as string);

      expect(writtenData.dividendSummary).toEqual(sampleDividendSummary);
      expect(writtenData.per).toBeNull();
    });
  });

  // ===========================================
  // getCachedRoe
  // ===========================================
  describe("getCachedRoe", () => {
    it("returns ROE when cache is valid (30 day TTL)", () => {
      const cachedEntry = {
        ...sampleStatsEntry,
        roeCachedAt: Date.now() - 1000 * 60 * 60 * 24 * 15, // 15 days ago
        roe: 12.5,
      };

      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(cachedEntry));

      const result = getCachedRoe("7203.T");

      expect(result).toBe(12.5);
    });

    it("returns undefined when ROE cache has expired (> 30 days)", () => {
      const cachedEntry = {
        ...sampleStatsEntry,
        roeCachedAt: Date.now() - 1000 * 60 * 60 * 24 * 31, // 31 days ago
        roe: 12.5,
      };

      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(cachedEntry));

      const result = getCachedRoe("7203.T");

      expect(result).toBeUndefined();
    });

    it("returns null when ROE is null", () => {
      const cachedEntry = {
        ...sampleStatsEntry,
        roeCachedAt: Date.now() - 1000 * 60,
        roe: null,
      };

      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(cachedEntry));

      const result = getCachedRoe("7203.T");

      expect(result).toBeNull();
    });
  });

  // ===========================================
  // setCachedRoeOnly
  // ===========================================
  describe("setCachedRoeOnly", () => {
    it("updates existing entry with ROE only", () => {
      const existingEntry = {
        per: 15.5,
        forwardPer: 14.0,
        pbr: 1.2,
        eps: 200,
        roe: 10.0,
        dividendYield: 2.5,
        cachedAt: Date.now() - 1000 * 60 * 60,
      };

      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(existingEntry));

      setCachedRoeOnly("7203.T", 15.0);

      const writeCall = vi.mocked(fs.writeFileSync).mock.calls[0];
      const writtenData = JSON.parse(writeCall[1] as string);

      expect(writtenData.roe).toBe(15.0);
      expect(writtenData.per).toBe(15.5); // preserved
      expect(writtenData.roeCachedAt).toBe(Date.now());
    });

    it("creates new entry when file does not exist", () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockImplementation(() => {
        throw new Error("File not found");
      });

      setCachedRoeOnly("7203.T", 15.0);

      const writeCall = vi.mocked(fs.writeFileSync).mock.calls[0];
      const writtenData = JSON.parse(writeCall[1] as string);

      expect(writtenData.roe).toBe(15.0);
      expect(writtenData.per).toBeNull();
    });
  });

  // ===========================================
  // setCachedStatsPartial
  // ===========================================
  describe("setCachedStatsPartial", () => {
    it("updates multiple fields at once", () => {
      const existingEntry = {
        per: 15.5,
        forwardPer: 14.0,
        pbr: 1.2,
        eps: 200,
        roe: 10.0,
        dividendYield: 2.5,
        cachedAt: Date.now() - 1000 * 60 * 60,
      };

      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(existingEntry));

      setCachedStatsPartial("7203.T", {
        nc: 0.85,
        roe: 15.0,
        dividend: sampleDividendSummary,
      });

      const writeCall = vi.mocked(fs.writeFileSync).mock.calls[0];
      const writtenData = JSON.parse(writeCall[1] as string);

      expect(writtenData.simpleNcRatio).toBe(0.85);
      expect(writtenData.roe).toBe(15.0);
      expect(writtenData.dividendSummary).toEqual(sampleDividendSummary);
      expect(writtenData.ncCachedAt).toBe(Date.now());
      expect(writtenData.roeCachedAt).toBe(Date.now());
      expect(writtenData.dividendCachedAt).toBe(Date.now());
    });

    it("creates new entry when file does not exist", () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockImplementation(() => {
        throw new Error("File not found");
      });

      setCachedStatsPartial("7203.T", {
        nc: 0.85,
      });

      const writeCall = vi.mocked(fs.writeFileSync).mock.calls[0];
      const writtenData = JSON.parse(writeCall[1] as string);

      expect(writtenData.simpleNcRatio).toBe(0.85);
      expect(writtenData.per).toBeNull();
    });

    it("updates extra metrics with shared timestamp", () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockImplementation(() => {
        throw new Error("File not found");
      });

      setCachedStatsPartial("7203.T", {
        pegRatio: 1.5,
        equityRatio: 0.45,
        totalDebt: 5000000,
        profitGrowthRate: 0.15,
      });

      const writeCall = vi.mocked(fs.writeFileSync).mock.calls[0];
      const writtenData = JSON.parse(writeCall[1] as string);

      expect(writtenData.pegRatio).toBe(1.5);
      expect(writtenData.equityRatio).toBe(0.45);
      expect(writtenData.totalDebt).toBe(5000000);
      expect(writtenData.profitGrowthRate).toBe(0.15);
      expect(writtenData.extraMetricsCachedAt).toBe(Date.now());
    });

    it("updates floatingRatio with dedicated timestamp", () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockImplementation(() => {
        throw new Error("File not found");
      });

      setCachedStatsPartial("7203.T", {
        floatingRatio: 0.35,
      });

      const writeCall = vi.mocked(fs.writeFileSync).mock.calls[0];
      const writtenData = JSON.parse(writeCall[1] as string);

      expect(writtenData.floatingRatio).toBe(0.35);
      expect(writtenData.floatingRatioCachedAt).toBe(Date.now());
    });

    it("updates ROE history", () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockImplementation(() => {
        throw new Error("File not found");
      });

      const roeHistory = [
        { year: 2023, roe: 12.5 },
        { year: 2022, roe: 11.0 },
      ];

      setCachedStatsPartial("7203.T", {
        roeHistory,
      });

      const writeCall = vi.mocked(fs.writeFileSync).mock.calls[0];
      const writtenData = JSON.parse(writeCall[1] as string);

      expect(writtenData.roeHistory).toEqual(roeHistory);
      expect(writtenData.roeHistoryCachedAt).toBe(Date.now());
    });

    it("updates FCF history", () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockImplementation(() => {
        throw new Error("File not found");
      });

      const fcfHistory = [
        { year: 2023, fcf: 100, ocf: 200, capex: 100 },
        { year: 2022, fcf: 80, ocf: 180, capex: 100 },
      ];

      setCachedStatsPartial("7203.T", {
        fcfHistory,
      });

      const writeCall = vi.mocked(fs.writeFileSync).mock.calls[0];
      const writtenData = JSON.parse(writeCall[1] as string);

      expect(writtenData.fcfHistory).toEqual(fcfHistory);
      expect(writtenData.fcfHistoryCachedAt).toBe(Date.now());
    });
  });

  // ===========================================
  // getCachedStatsAll
  // ===========================================
  describe("getCachedStatsAll", () => {
    it("returns all cached stats when valid", () => {
      const cachedEntry = {
        ...sampleStatsEntry,
        cachedAt: Date.now() - 1000 * 60 * 60,
        ncCachedAt: Date.now() - 1000 * 60 * 60,
        dividendCachedAt: Date.now() - 1000 * 60 * 60,
        roeCachedAt: Date.now() - 1000 * 60 * 60,
        currentRatioCachedAt: Date.now() - 1000 * 60 * 60,
        extraMetricsCachedAt: Date.now() - 1000 * 60 * 60,
        floatingRatioCachedAt: Date.now() - 1000 * 60 * 60,
        currentRatio: 1.5,
        pegRatio: 1.2,
        equityRatio: 0.45,
        totalDebt: 5000000,
        profitGrowthRate: 0.15,
        floatingRatio: 0.35,
      };

      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(cachedEntry));

      const result = getCachedStatsAll("7203.T");

      expect(result.nc).toBe(0.85);
      expect(result.roe).toBe(12.5);
      expect(result.dividend).toEqual(sampleDividendSummary);
      expect(result.currentRatio).toBe(1.5);
      expect(result.pegRatio).toBe(1.2);
      expect(result.equityRatio).toBe(0.45);
      expect(result.floatingRatio).toBe(0.35);
    });

    it("returns undefined for expired items", () => {
      const cachedEntry = {
        ...sampleStatsEntry,
        cachedAt: Date.now() - 1000 * 60 * 60 * 24 * 35, // 35 days ago (all expired)
        ncCachedAt: Date.now() - 1000 * 60 * 60 * 24 * 8, // 8 days (NC expired)
        roeCachedAt: Date.now() - 1000 * 60 * 60 * 24 * 35, // 35 days (ROE expired)
      };

      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(cachedEntry));

      const result = getCachedStatsAll("7203.T");

      expect(result.nc).toBeUndefined();
      expect(result.roe).toBeUndefined();
    });

    it("returns empty result when file does not exist", () => {
      vi.mocked(fs.existsSync).mockImplementation((path) => {
        if (typeof path === "string" && path.endsWith(".json")) {
          return false;
        }
        return true;
      });

      const result = getCachedStatsAll("7203.T");

      expect(result.nc).toBeUndefined();
      expect(result.dividend).toBeUndefined();
      expect(result.roe).toBeUndefined();
    });

    it("invalidates ROE when near earnings date", () => {
      const cachedEntry = {
        ...sampleStatsEntry,
        cachedAt: Date.now() - 1000 * 60 * 60, // 1 hour ago
        roeCachedAt: Date.now() - 1000 * 60 * 60, // 1 hour ago
        roeHistoryCachedAt: Date.now() - 1000 * 60 * 60,
        fcfHistoryCachedAt: Date.now() - 1000 * 60 * 60,
        extraMetricsCachedAt: Date.now() - 1000 * 60 * 60,
        roeHistory: [{ year: 2023, roe: 12.5 }],
        fcfHistory: [{ year: 2023, fcf: 100, ocf: 200, capex: 100 }],
        pegRatio: 1.2,
      };

      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(cachedEntry));

      // Earnings date is 1 day ago (within 3 days)
      const earningsDate = new Date("2024-01-16");
      const result = getCachedStatsAll("7203.T", earningsDate);

      // ROE and related should be invalidated near earnings
      expect(result.roe).toBeUndefined();
      expect(result.roeHistory).toBeUndefined();
      expect(result.fcfHistory).toBeUndefined();
      expect(result.pegRatio).toBeUndefined();

      // NC and dividend should still be valid
      expect(result.nc).toBe(0.85);
      expect(result.dividend).toEqual(sampleDividendSummary);
    });
  });

  // ===========================================
  // getCachedStatsFull
  // ===========================================
  describe("getCachedStatsFull", () => {
    it("returns all stats with proper TTL checks", () => {
      const cachedEntry = {
        ...sampleStatsEntry,
        cachedAt: Date.now() - 1000 * 60 * 60, // 1 hour ago (main TTL valid)
        ncCachedAt: Date.now() - 1000 * 60 * 60,
        dividendCachedAt: Date.now() - 1000 * 60 * 60,
        roeCachedAt: Date.now() - 1000 * 60 * 60,
        roeHistoryCachedAt: Date.now() - 1000 * 60 * 60,
        fcfHistoryCachedAt: Date.now() - 1000 * 60 * 60,
        roeHistory: [{ year: 2023, roe: 12.5 }],
        fcfHistory: [{ year: 2023, fcf: 100, ocf: 200, capex: 100 }],
      };

      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(cachedEntry));

      const result = getCachedStatsFull("7203.T");

      expect(result).not.toBeNull();
      expect(result?.per).toBe(15.5);
      expect(result?.pbr).toBe(1.2);
      expect(result?.roe).toBe(12.5);
      expect(result?.simpleNcRatio).toBe(0.85);
      expect(result?.marketCap).toBe(1000000000);
      expect(result?.sharpe1y).toBe(1.2);
      expect(result?.latestDividend).toBe(100);
      expect(result?.latestIncrease).toBe(10);
      expect(result?.roeHistory).toEqual([{ year: 2023, roe: 12.5 }]);
    });

    it("returns null when file does not exist", () => {
      vi.mocked(fs.existsSync).mockImplementation((path) => {
        if (typeof path === "string" && path.endsWith(".json")) {
          return false;
        }
        return true;
      });

      const result = getCachedStatsFull("7203.T");

      expect(result).toBeNull();
    });

    it("returns undefined for expired main TTL items", () => {
      const cachedEntry = {
        ...sampleStatsEntry,
        cachedAt: Date.now() - 1000 * 60 * 60 * 25, // 25 hours (main TTL expired)
        ncCachedAt: Date.now() - 1000 * 60, // NC still valid
      };

      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(cachedEntry));

      const result = getCachedStatsFull("7203.T");

      expect(result?.per).toBeUndefined();
      expect(result?.pbr).toBeUndefined();
      expect(result?.simpleNcRatio).toBe(0.85); // NC has separate TTL
    });
  });

  // ===========================================
  // Supabase functions
  // ===========================================
  describe("getStatsCacheFromSupabase", () => {
    it("returns empty result when no data found", async () => {
      const result = await getStatsCacheFromSupabase("7203.T");

      expect(result.nc).toBeUndefined();
      expect(result.dividend).toBeUndefined();
      expect(result.roe).toBeUndefined();
    });
  });

  describe("setStatsCacheToSupabase", () => {
    it("does not throw on error", async () => {
      await expect(
        setStatsCacheToSupabase("7203.T", { nc: 0.85 })
      ).resolves.not.toThrow();
    });
  });

  describe("getStatsCacheBatchFromSupabase", () => {
    it("returns empty map for empty symbols array", async () => {
      const result = await getStatsCacheBatchFromSupabase([]);

      expect(result.size).toBe(0);
    });

    it("returns empty map when no data found", async () => {
      const result = await getStatsCacheBatchFromSupabase(["7203.T", "9984.T"]);

      expect(result.size).toBe(0);
    });
  });

  // ===========================================
  // Integration scenarios
  // ===========================================
  describe("Integration scenarios", () => {
    it("can write and read back stats data", () => {
      let storedData: string | null = null;

      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.writeFileSync).mockImplementation((_, data) => {
        storedData = data as string;
      });
      vi.mocked(fs.readFileSync).mockImplementation(() => {
        if (!storedData) throw new Error("No data");
        return storedData;
      });

      // Write
      setCachedStats("7203.T", {
        per: 15.5,
        forwardPer: 14.0,
        pbr: 1.2,
        eps: 200,
        roe: 12.5,
        dividendYield: 2.5,
      });

      // Read
      const result = getCachedStats("7203.T");

      expect(result?.per).toBe(15.5);
      expect(result?.roe).toBe(12.5);
    });

    it("partial updates preserve existing data", () => {
      let storedData: string | null = null;

      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.writeFileSync).mockImplementation((_, data) => {
        storedData = data as string;
      });
      vi.mocked(fs.readFileSync).mockImplementation(() => {
        if (!storedData) throw new Error("No data");
        return storedData;
      });

      // First write - NC ratio
      setCachedNcOnly("7203.T", 0.85);

      // Second write - ROE only
      setCachedRoeOnly("7203.T", 15.0);

      // Read back
      const parsed = JSON.parse(storedData!);
      expect(parsed.simpleNcRatio).toBe(0.85); // preserved
      expect(parsed.roe).toBe(15.0); // updated
    });

    it("handles concurrent writes to different fields", () => {
      let storedData: string | null = null;

      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.writeFileSync).mockImplementation((_, data) => {
        storedData = data as string;
      });
      vi.mocked(fs.readFileSync).mockImplementation(() => {
        if (!storedData) throw new Error("No data");
        return storedData;
      });

      // Write multiple fields using partial update
      setCachedStatsPartial("7203.T", {
        nc: 0.85,
        roe: 15.0,
        dividend: sampleDividendSummary,
        currentRatio: 1.5,
        pegRatio: 1.2,
        floatingRatio: 0.35,
      });

      // Read and verify all
      const result = getCachedStatsAll("7203.T");

      expect(result.nc).toBe(0.85);
      expect(result.roe).toBe(15.0);
      expect(result.dividend).toEqual(sampleDividendSummary);
      expect(result.currentRatio).toBe(1.5);
      expect(result.pegRatio).toBe(1.2);
      expect(result.floatingRatio).toBe(0.35);
    });
  });
});
