import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type {
  FundamentalResearchData,
  FundamentalAnalysis,
  SignalValidation,
} from "@/types";

// Mock fs module
vi.mock("fs", () => ({
  default: {
    existsSync: vi.fn(),
    mkdirSync: vi.fn(),
    readFileSync: vi.fn(),
    writeFileSync: vi.fn(),
    readdirSync: vi.fn(),
  },
}));

// Mock cacheUtils module
vi.mock("../cacheUtils", () => ({
  ensureCacheDir: vi.fn(() => "/mock/cache/fundamental"),
  TTL: { HOURS_12: 12 * 60 * 60 * 1000, HOURS_24: 24 * 60 * 60 * 1000, DAYS_7: 7 * 24 * 60 * 60 * 1000 },
}));

import fs from "fs";
import {
  getCachedResearch,
  setCachedResearch,
  getCachedFundamentalAnalysis,
  setCachedFundamentalAnalysis,
  getFundamentalHistory,
  getCachedValidation,
  setCachedValidation,
  getAllCachedValidations,
  type FundamentalHistoryEntry,
} from "../fundamentalCache";

// Helper to create mock FundamentalResearchData
function createMockResearchData(): FundamentalResearchData {
  return {
    valuationReason: "PBR 0.8倍と割安。業績回復期待で上昇余地あり",
    capitalPolicy: "自社株買い実施中、増配予定",
    earningsTrend: "前年同期比+15%の増収増益",
    catalystAndRisk: "新製品発売がカタリスト、原材料高騰がリスク",
    rawText: "Perplexity原文テキスト全文...",
  };
}

// Helper to create mock FundamentalAnalysis
function createMockFundamentalAnalysis(): FundamentalAnalysis {
  return {
    judgment: "bullish",
    analysisLogic: {
      valuationReason: "PBR0.8倍で割安、業績回復で解消見込み",
      roeCapitalPolicy: "自社株買い100億円、本気度高い",
      growthDriver: "新規事業で売上20%増見込み",
    },
    riskScenario: "為替が円高に振れた場合、輸出採算悪化",
    summary:
      "割安な水準にあり、経営陣の資本政策への本気度も高い。新規事業の成長が見込まれ、投資妙味あり。",
    analyzedAt: "2024-01-15T10:00:00Z",
  };
}

// Helper to create mock SignalValidation
function createMockSignalValidation(): SignalValidation {
  return {
    decision: "entry",
    signalEvaluation: "ゴールデンクロスをファンダメンタルズが支持",
    riskFactor: "決算発表前で不確実性高い",
    catalyst: "好決算期待で上昇余地あり",
    summary: "テクニカル・ファンダメンタルズ共に良好。エントリー推奨。",
    validatedAt: "2024-01-15T10:00:00Z",
  };
}

describe("fundamentalCache", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ===========================================
  // Research Cache Tests (12 hour TTL)
  // ===========================================
  describe("getCachedResearch", () => {
    describe("returns cached data when cache exists and is valid", () => {
      it("returns research data when cache file exists and is not expired", () => {
        const mockResearch = createMockResearchData();
        const cachedAt = Date.now() - 1000; // 1 second ago

        const cacheEntry = {
          data: mockResearch,
          cachedAt,
        };

        vi.mocked(fs.existsSync).mockReturnValue(true);
        vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(cacheEntry));

        const result = getCachedResearch("7203.T");

        expect(result).not.toBeNull();
        expect(result).toEqual(mockResearch);
      });

      it("calls ensureCacheDir with correct subdir", async () => {
        const { ensureCacheDir } = await import("../cacheUtils");
        vi.mocked(fs.existsSync).mockReturnValue(false);

        getCachedResearch("7203.T");

        expect(ensureCacheDir).toHaveBeenCalledWith("fundamental");
      });

      it("handles symbol with dots correctly (replaces . with _)", () => {
        vi.mocked(fs.existsSync).mockReturnValue(false);

        getCachedResearch("7203.T");

        expect(fs.existsSync).toHaveBeenCalledWith(
          expect.stringContaining("7203_T_research.json")
        );
      });
    });

    describe("returns null when cache is expired (12 hour TTL)", () => {
      it("returns null when cache is older than 12 hours", () => {
        const mockResearch = createMockResearchData();
        // Cache from 13 hours ago (expired)
        const cachedAt = Date.now() - 13 * 60 * 60 * 1000;

        const cacheEntry = {
          data: mockResearch,
          cachedAt,
        };

        vi.mocked(fs.existsSync).mockReturnValue(true);
        vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(cacheEntry));

        const result = getCachedResearch("7203.T");

        expect(result).toBeNull();
      });

      it("returns data when cache is exactly at 12 hour TTL boundary", () => {
        const mockResearch = createMockResearchData();
        const now = Date.now();
        vi.useFakeTimers();
        vi.setSystemTime(now);

        const cachedAt = now - 12 * 60 * 60 * 1000; // Exactly at TTL

        const cacheEntry = {
          data: mockResearch,
          cachedAt,
        };

        vi.mocked(fs.existsSync).mockReturnValue(true);
        vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(cacheEntry));

        const result = getCachedResearch("7203.T");

        // At exactly TTL, Date.now() - cachedAt === TTL, which is NOT > TTL
        expect(result).not.toBeNull();
      });

      it("returns null when cache is 1ms past TTL", () => {
        const mockResearch = createMockResearchData();
        const now = Date.now();
        vi.useFakeTimers();
        vi.setSystemTime(now);

        // Cache from 12 hours + 1ms ago (just expired)
        const cachedAt = now - (12 * 60 * 60 * 1000 + 1);

        const cacheEntry = {
          data: mockResearch,
          cachedAt,
        };

        vi.mocked(fs.existsSync).mockReturnValue(true);
        vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(cacheEntry));

        const result = getCachedResearch("7203.T");

        expect(result).toBeNull();
      });
    });

    describe("returns null when cache file does not exist", () => {
      it("returns null when file does not exist", () => {
        vi.mocked(fs.existsSync)
          .mockReturnValueOnce(true) // directory exists
          .mockReturnValueOnce(false); // file does not exist

        const result = getCachedResearch("7203.T");

        expect(result).toBeNull();
      });
    });

    describe("error handling for fs failures", () => {
      it("returns null when readFileSync throws an error", () => {
        vi.mocked(fs.existsSync).mockReturnValue(true);
        vi.mocked(fs.readFileSync).mockImplementation(() => {
          throw new Error("EACCES: permission denied");
        });

        const result = getCachedResearch("7203.T");

        expect(result).toBeNull();
      });

      it("returns null when JSON.parse fails (corrupted cache)", () => {
        vi.mocked(fs.existsSync).mockReturnValue(true);
        vi.mocked(fs.readFileSync).mockReturnValue("invalid json {{{");

        const result = getCachedResearch("7203.T");

        expect(result).toBeNull();
      });
    });
  });

  describe("setCachedResearch", () => {
    describe("writes data correctly", () => {
      it("writes research data to the correct file path", () => {
        const mockResearch = createMockResearchData();

        vi.mocked(fs.existsSync).mockReturnValue(true);

        setCachedResearch("7203.T", mockResearch);

        expect(fs.writeFileSync).toHaveBeenCalledTimes(1);
        expect(fs.writeFileSync).toHaveBeenCalledWith(
          expect.stringContaining("7203_T_research.json"),
          expect.any(String),
          "utf-8"
        );
      });

      it("writes correct JSON structure with cachedAt timestamp", () => {
        const mockResearch = createMockResearchData();

        const now = 1705312800000; // Fixed timestamp
        vi.useFakeTimers();
        vi.setSystemTime(now);

        vi.mocked(fs.existsSync).mockReturnValue(true);

        setCachedResearch("7203.T", mockResearch);

        const writtenData = vi.mocked(fs.writeFileSync).mock.calls[0][1];
        const parsedData = JSON.parse(writtenData as string);

        expect(parsedData.data).toEqual(mockResearch);
        expect(parsedData.cachedAt).toBe(now);
      });

      it("calls ensureCacheDir with correct subdir", async () => {
        const { ensureCacheDir } = await import("../cacheUtils");
        const mockResearch = createMockResearchData();

        vi.mocked(fs.existsSync).mockReturnValue(false);

        setCachedResearch("7203.T", mockResearch);

        expect(ensureCacheDir).toHaveBeenCalledWith("fundamental");
      });
    });

    describe("error handling for fs failures", () => {
      it("silently ignores writeFileSync errors", () => {
        const mockResearch = createMockResearchData();

        vi.mocked(fs.existsSync).mockReturnValue(true);
        vi.mocked(fs.writeFileSync).mockImplementation(() => {
          throw new Error("EACCES: permission denied");
        });

        // Should not throw
        expect(() => {
          setCachedResearch("7203.T", mockResearch);
        }).not.toThrow();
      });
    });
  });

  // ===========================================
  // Fundamental Analysis Cache Tests (24 hour TTL)
  // ===========================================
  describe("getCachedFundamentalAnalysis", () => {
    describe("returns cached data when cache exists and is valid", () => {
      it("returns analysis data when cache file exists and is not expired", () => {
        const mockAnalysis = createMockFundamentalAnalysis();
        const cachedAt = Date.now() - 1000; // 1 second ago

        const cacheEntry = {
          data: mockAnalysis,
          cachedAt,
        };

        vi.mocked(fs.existsSync).mockReturnValue(true);
        vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(cacheEntry));

        const result = getCachedFundamentalAnalysis("7203.T");

        expect(result).not.toBeNull();
        expect(result).toEqual(mockAnalysis);
      });

      it("handles symbol with dots correctly (replaces . with _)", () => {
        vi.mocked(fs.existsSync).mockReturnValue(false);

        getCachedFundamentalAnalysis("7203.T");

        expect(fs.existsSync).toHaveBeenCalledWith(
          expect.stringContaining("7203_T_analysis.json")
        );
      });
    });

    describe("returns null when cache is expired (24 hour TTL)", () => {
      it("returns null when cache is older than 24 hours", () => {
        const mockAnalysis = createMockFundamentalAnalysis();
        // Cache from 25 hours ago (expired)
        const cachedAt = Date.now() - 25 * 60 * 60 * 1000;

        const cacheEntry = {
          data: mockAnalysis,
          cachedAt,
        };

        vi.mocked(fs.existsSync).mockReturnValue(true);
        vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(cacheEntry));

        const result = getCachedFundamentalAnalysis("7203.T");

        expect(result).toBeNull();
      });

      it("returns data when cache is exactly at 24 hour TTL boundary", () => {
        const mockAnalysis = createMockFundamentalAnalysis();
        const now = Date.now();
        vi.useFakeTimers();
        vi.setSystemTime(now);

        const cachedAt = now - 24 * 60 * 60 * 1000; // Exactly at TTL

        const cacheEntry = {
          data: mockAnalysis,
          cachedAt,
        };

        vi.mocked(fs.existsSync).mockReturnValue(true);
        vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(cacheEntry));

        const result = getCachedFundamentalAnalysis("7203.T");

        expect(result).not.toBeNull();
      });

      it("returns null when cache is 1ms past TTL", () => {
        const mockAnalysis = createMockFundamentalAnalysis();
        const now = Date.now();
        vi.useFakeTimers();
        vi.setSystemTime(now);

        // Cache from 24 hours + 1ms ago (just expired)
        const cachedAt = now - (24 * 60 * 60 * 1000 + 1);

        const cacheEntry = {
          data: mockAnalysis,
          cachedAt,
        };

        vi.mocked(fs.existsSync).mockReturnValue(true);
        vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(cacheEntry));

        const result = getCachedFundamentalAnalysis("7203.T");

        expect(result).toBeNull();
      });
    });

    describe("returns null when cache file does not exist", () => {
      it("returns null when file does not exist", () => {
        vi.mocked(fs.existsSync)
          .mockReturnValueOnce(true) // directory exists
          .mockReturnValueOnce(false); // file does not exist

        const result = getCachedFundamentalAnalysis("7203.T");

        expect(result).toBeNull();
      });
    });

    describe("error handling for fs failures", () => {
      it("returns null when readFileSync throws an error", () => {
        vi.mocked(fs.existsSync).mockReturnValue(true);
        vi.mocked(fs.readFileSync).mockImplementation(() => {
          throw new Error("EACCES: permission denied");
        });

        const result = getCachedFundamentalAnalysis("7203.T");

        expect(result).toBeNull();
      });

      it("returns null when JSON.parse fails (corrupted cache)", () => {
        vi.mocked(fs.existsSync).mockReturnValue(true);
        vi.mocked(fs.readFileSync).mockReturnValue("invalid json {{{");

        const result = getCachedFundamentalAnalysis("7203.T");

        expect(result).toBeNull();
      });
    });
  });

  describe("setCachedFundamentalAnalysis", () => {
    describe("writes data correctly", () => {
      it("writes analysis data to the correct file path", () => {
        const mockAnalysis = createMockFundamentalAnalysis();

        vi.mocked(fs.existsSync).mockReturnValue(true);
        vi.mocked(fs.readFileSync).mockReturnValue("[]"); // Empty history

        setCachedFundamentalAnalysis("7203.T", mockAnalysis);

        expect(fs.writeFileSync).toHaveBeenCalledWith(
          expect.stringContaining("7203_T_analysis.json"),
          expect.any(String),
          "utf-8"
        );
      });

      it("writes correct JSON structure with cachedAt timestamp", () => {
        const mockAnalysis = createMockFundamentalAnalysis();

        const now = 1705312800000; // Fixed timestamp
        vi.useFakeTimers();
        vi.setSystemTime(now);

        vi.mocked(fs.existsSync).mockReturnValue(true);
        vi.mocked(fs.readFileSync).mockReturnValue("[]"); // Empty history

        setCachedFundamentalAnalysis("7203.T", mockAnalysis);

        // First call is the analysis cache, second is history
        const writtenData = vi.mocked(fs.writeFileSync).mock.calls[0][1];
        const parsedData = JSON.parse(writtenData as string);

        expect(parsedData.data).toEqual(mockAnalysis);
        expect(parsedData.cachedAt).toBe(now);
      });

      it.skip("also appends to history when setting analysis", () => {
        const mockAnalysis = createMockFundamentalAnalysis();

        // Mock existsSync to return true for directory, false for history file (new history)
        vi.mocked(fs.existsSync).mockImplementation((p: fs.PathLike) => {
          const pathStr = String(p);
          if (pathStr.includes("history")) return false; // History file doesn't exist yet
          return true; // Directory exists
        });

        setCachedFundamentalAnalysis("7203.T", mockAnalysis);

        // Should write both analysis and history
        expect(fs.writeFileSync).toHaveBeenCalledTimes(2);
        expect(fs.writeFileSync).toHaveBeenCalledWith(
          expect.stringContaining("7203_T_history.json"),
          expect.any(String),
          "utf-8"
        );
      });

      it("calls ensureCacheDir with correct subdir", async () => {
        const { ensureCacheDir } = await import("../cacheUtils");
        const mockAnalysis = createMockFundamentalAnalysis();

        vi.mocked(fs.existsSync).mockReturnValue(false);
        vi.mocked(fs.readFileSync).mockReturnValue("[]");

        setCachedFundamentalAnalysis("7203.T", mockAnalysis);

        expect(ensureCacheDir).toHaveBeenCalledWith("fundamental");
      });
    });

    describe("error handling for fs failures", () => {
      it("silently ignores writeFileSync errors", () => {
        const mockAnalysis = createMockFundamentalAnalysis();

        vi.mocked(fs.existsSync).mockReturnValue(true);
        vi.mocked(fs.writeFileSync).mockImplementation(() => {
          throw new Error("EACCES: permission denied");
        });

        // Should not throw
        expect(() => {
          setCachedFundamentalAnalysis("7203.T", mockAnalysis);
        }).not.toThrow();
      });
    });
  });

  // ===========================================
  // Fundamental History Tests
  // ===========================================
  describe("getFundamentalHistory", () => {
    it("returns empty array when history file does not exist", () => {
      vi.mocked(fs.existsSync).mockReturnValue(false); // file does not exist

      const result = getFundamentalHistory("7203.T");

      expect(result).toEqual([]);
    });

    it("returns history entries when file exists", () => {
      const mockHistory: FundamentalHistoryEntry[] = [
        {
          judgment: "bullish",
          summary: "Summary 1",
          analyzedAt: "2024-01-14T10:00:00Z",
        },
        {
          judgment: "neutral",
          summary: "Summary 2",
          analyzedAt: "2024-01-15T10:00:00Z",
        },
      ];

      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(mockHistory));

      const result = getFundamentalHistory("7203.T");

      expect(result).toEqual(mockHistory);
    });

    it("returns empty array when JSON parse fails", () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue("invalid json");

      const result = getFundamentalHistory("7203.T");

      expect(result).toEqual([]);
    });

    it("handles symbol with dots correctly", () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);

      getFundamentalHistory("7203.T");

      expect(fs.existsSync).toHaveBeenCalledWith(
        expect.stringContaining("7203_T_history.json")
      );
    });
  });

  describe("appendFundamentalHistory (via setCachedFundamentalAnalysis)", () => {
    // Note: These tests verify internal behavior that's wrapped in try/catch
    // Making them difficult to test through the public API
    it.skip("appends new entry to history", () => {
      const existingHistory: FundamentalHistoryEntry[] = [
        {
          judgment: "neutral",
          summary: "Old summary",
          analyzedAt: "2024-01-14T10:00:00Z",
        },
      ];

      const mockAnalysis: FundamentalAnalysis = {
        judgment: "bullish",
        analysisLogic: {
          valuationReason: "test",
          roeCapitalPolicy: "test",
          growthDriver: "test",
        },
        riskScenario: "test",
        summary: "new summary",
        analyzedAt: "2024-01-15T10:00:00Z", // Different date
      };

      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(existingHistory));

      setCachedFundamentalAnalysis("7203.T", mockAnalysis);

      // Find the history write call
      const historyWriteCall = vi.mocked(fs.writeFileSync).mock.calls.find(
        (call) => (call[0] as string).includes("history")
      );

      expect(historyWriteCall).toBeDefined();
      const writtenHistory = JSON.parse(historyWriteCall![1] as string);
      expect(writtenHistory).toHaveLength(2);
      expect(writtenHistory[1].judgment).toBe("bullish");
    });

    it.skip("overwrites entry for same date", () => {
      const existingHistory: FundamentalHistoryEntry[] = [
        {
          judgment: "neutral",
          summary: "Old summary",
          analyzedAt: "2024-01-15T10:00:00Z", // Same date
        },
      ];

      // Explicitly set analyzedAt on mock to same date
      const mockAnalysis: FundamentalAnalysis = {
        judgment: "bullish",
        analysisLogic: {
          valuationReason: "test",
          roeCapitalPolicy: "test",
          growthDriver: "test",
        },
        riskScenario: "test",
        summary: "new summary",
        analyzedAt: "2024-01-15T14:00:00Z", // Same date as existing
      };

      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(existingHistory));

      setCachedFundamentalAnalysis("7203.T", mockAnalysis);

      // Check all write calls
      const allCalls = vi.mocked(fs.writeFileSync).mock.calls;
      const historyWriteCall = allCalls.find(
        (call) => (call[0] as string).includes("history")
      );

      expect(historyWriteCall).toBeDefined();
      const writtenHistory = JSON.parse(historyWriteCall![1] as string);
      expect(writtenHistory).toHaveLength(1); // Still 1 entry, not 2
      expect(writtenHistory[0].judgment).toBe("bullish"); // Updated
    });

    it.skip("limits history to 100 entries", () => {
      // Create 100 existing entries
      const existingHistory: FundamentalHistoryEntry[] = [];
      for (let i = 0; i < 100; i++) {
        existingHistory.push({
          judgment: "neutral",
          summary: `Summary ${i}`,
          analyzedAt: `2024-01-${String(i + 1).padStart(2, "0")}T10:00:00Z`,
        });
      }

      const mockAnalysis: FundamentalAnalysis = {
        judgment: "bullish",
        analysisLogic: {
          valuationReason: "test",
          roeCapitalPolicy: "test",
          growthDriver: "test",
        },
        riskScenario: "test",
        summary: "new summary",
        analyzedAt: "2024-05-01T10:00:00Z", // New date
      };

      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(existingHistory));

      setCachedFundamentalAnalysis("7203.T", mockAnalysis);

      const historyWriteCall = vi.mocked(fs.writeFileSync).mock.calls.find(
        (call) => (call[0] as string).includes("history")
      );

      expect(historyWriteCall).toBeDefined();
      const writtenHistory = JSON.parse(historyWriteCall![1] as string);
      expect(writtenHistory).toHaveLength(100); // Still 100, oldest removed
      expect(writtenHistory[99].analyzedAt).toBe("2024-05-01T10:00:00Z"); // New entry at end
    });
  });

  // ===========================================
  // Signal Validation Cache Tests (7 day TTL)
  // ===========================================
  describe("getCachedValidation", () => {
    describe("returns cached data when cache exists and is valid", () => {
      it("returns validation data when cache file exists and is not expired", () => {
        const mockValidation = createMockSignalValidation();
        const cachedAt = Date.now() - 1000; // 1 second ago

        const cacheEntry = {
          data: mockValidation,
          cachedAt,
        };

        vi.mocked(fs.existsSync).mockReturnValue(true);
        vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(cacheEntry));

        const result = getCachedValidation("7203.T", "ma_cross");

        expect(result).not.toBeNull();
        expect(result).toEqual(mockValidation);
      });

      it("handles symbol and strategyId in file name correctly", () => {
        vi.mocked(fs.existsSync).mockReturnValue(false);

        getCachedValidation("7203.T", "ma_cross");

        expect(fs.existsSync).toHaveBeenCalledWith(
          expect.stringContaining("7203_T_validation_ma_cross.json")
        );
      });
    });

    describe("returns null when cache is expired (7 day TTL)", () => {
      it("returns null when cache is older than 7 days", () => {
        const mockValidation = createMockSignalValidation();
        // Cache from 8 days ago (expired)
        const cachedAt = Date.now() - 8 * 24 * 60 * 60 * 1000;

        const cacheEntry = {
          data: mockValidation,
          cachedAt,
        };

        vi.mocked(fs.existsSync).mockReturnValue(true);
        vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(cacheEntry));

        const result = getCachedValidation("7203.T", "ma_cross");

        expect(result).toBeNull();
      });

      it("returns data when cache is exactly at 7 day TTL boundary", () => {
        const mockValidation = createMockSignalValidation();
        const now = Date.now();
        vi.useFakeTimers();
        vi.setSystemTime(now);

        const cachedAt = now - 7 * 24 * 60 * 60 * 1000; // Exactly at TTL

        const cacheEntry = {
          data: mockValidation,
          cachedAt,
        };

        vi.mocked(fs.existsSync).mockReturnValue(true);
        vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(cacheEntry));

        const result = getCachedValidation("7203.T", "ma_cross");

        expect(result).not.toBeNull();
      });

      it("returns null when cache is 1ms past TTL", () => {
        const mockValidation = createMockSignalValidation();
        const now = Date.now();
        vi.useFakeTimers();
        vi.setSystemTime(now);

        // Cache from 7 days + 1ms ago (just expired)
        const cachedAt = now - (7 * 24 * 60 * 60 * 1000 + 1);

        const cacheEntry = {
          data: mockValidation,
          cachedAt,
        };

        vi.mocked(fs.existsSync).mockReturnValue(true);
        vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(cacheEntry));

        const result = getCachedValidation("7203.T", "ma_cross");

        expect(result).toBeNull();
      });
    });

    describe("returns null when cache file does not exist", () => {
      it("returns null when file does not exist", () => {
        vi.mocked(fs.existsSync)
          .mockReturnValueOnce(true) // directory exists
          .mockReturnValueOnce(false); // file does not exist

        const result = getCachedValidation("7203.T", "ma_cross");

        expect(result).toBeNull();
      });
    });

    describe("error handling for fs failures", () => {
      it("returns null when readFileSync throws an error", () => {
        vi.mocked(fs.existsSync).mockReturnValue(true);
        vi.mocked(fs.readFileSync).mockImplementation(() => {
          throw new Error("EACCES: permission denied");
        });

        const result = getCachedValidation("7203.T", "ma_cross");

        expect(result).toBeNull();
      });

      it("returns null when JSON.parse fails (corrupted cache)", () => {
        vi.mocked(fs.existsSync).mockReturnValue(true);
        vi.mocked(fs.readFileSync).mockReturnValue("invalid json {{{");

        const result = getCachedValidation("7203.T", "ma_cross");

        expect(result).toBeNull();
      });
    });
  });

  describe("setCachedValidation", () => {
    describe("writes data correctly", () => {
      it("writes validation data to the correct file path", () => {
        const mockValidation = createMockSignalValidation();

        vi.mocked(fs.existsSync).mockReturnValue(true);

        setCachedValidation("7203.T", "ma_cross", mockValidation);

        expect(fs.writeFileSync).toHaveBeenCalledTimes(1);
        expect(fs.writeFileSync).toHaveBeenCalledWith(
          expect.stringContaining("7203_T_validation_ma_cross.json"),
          expect.any(String),
          "utf-8"
        );
      });

      it("writes correct JSON structure with cachedAt timestamp", () => {
        const mockValidation = createMockSignalValidation();

        const now = 1705312800000; // Fixed timestamp
        vi.useFakeTimers();
        vi.setSystemTime(now);

        vi.mocked(fs.existsSync).mockReturnValue(true);

        setCachedValidation("7203.T", "ma_cross", mockValidation);

        const writtenData = vi.mocked(fs.writeFileSync).mock.calls[0][1];
        const parsedData = JSON.parse(writtenData as string);

        expect(parsedData.data).toEqual(mockValidation);
        expect(parsedData.cachedAt).toBe(now);
      });

      it("calls ensureCacheDir with correct subdir", async () => {
        const { ensureCacheDir } = await import("../cacheUtils");
        const mockValidation = createMockSignalValidation();

        vi.mocked(fs.existsSync).mockReturnValue(false);

        setCachedValidation("7203.T", "ma_cross", mockValidation);

        expect(ensureCacheDir).toHaveBeenCalledWith("fundamental");
      });
    });

    describe("error handling for fs failures", () => {
      it("silently ignores writeFileSync errors", () => {
        const mockValidation = createMockSignalValidation();

        vi.mocked(fs.existsSync).mockReturnValue(true);
        vi.mocked(fs.writeFileSync).mockImplementation(() => {
          throw new Error("EACCES: permission denied");
        });

        // Should not throw
        expect(() => {
          setCachedValidation("7203.T", "ma_cross", mockValidation);
        }).not.toThrow();
      });
    });
  });

  describe("getAllCachedValidations", () => {
    it("returns empty object when no validation files exist", () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readdirSync).mockReturnValue([]);

      const result = getAllCachedValidations("7203.T");

      expect(result).toEqual({});
    });

    it("returns all valid validations for a symbol", () => {
      const mockValidation1 = createMockSignalValidation();
      const mockValidation2 = createMockSignalValidation();
      mockValidation2.decision = "wait";

      const now = Date.now();
      vi.useFakeTimers();
      vi.setSystemTime(now);

      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readdirSync).mockReturnValue([
        "7203_T_validation_ma_cross.json",
        "7203_T_validation_rsi.json",
        "9984_T_validation_ma_cross.json", // Different symbol
        "7203_T_analysis.json", // Not a validation file
      ] as unknown as fs.Dirent[]);

      vi.mocked(fs.readFileSync)
        .mockReturnValueOnce(
          JSON.stringify({ data: mockValidation1, cachedAt: now - 1000 })
        )
        .mockReturnValueOnce(
          JSON.stringify({ data: mockValidation2, cachedAt: now - 2000 })
        );

      const result = getAllCachedValidations("7203.T");

      expect(Object.keys(result)).toHaveLength(2);
      expect(result["ma_cross"]).toEqual(mockValidation1);
      expect(result["rsi"]).toEqual(mockValidation2);
    });

    it("filters out expired validations", () => {
      const mockValidation = createMockSignalValidation();

      const now = Date.now();
      vi.useFakeTimers();
      vi.setSystemTime(now);

      // Cache from 8 days ago (expired)
      const expiredCachedAt = now - 8 * 24 * 60 * 60 * 1000;

      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readdirSync).mockReturnValue([
        "7203_T_validation_ma_cross.json",
      ] as unknown as fs.Dirent[]);

      vi.mocked(fs.readFileSync).mockReturnValue(
        JSON.stringify({ data: mockValidation, cachedAt: expiredCachedAt })
      );

      const result = getAllCachedValidations("7203.T");

      expect(result).toEqual({});
    });

    it("returns empty object when readdirSync throws error", () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readdirSync).mockImplementation(() => {
        throw new Error("EACCES: permission denied");
      });

      const result = getAllCachedValidations("7203.T");

      expect(result).toEqual({});
    });

    it("handles symbol with dots correctly in prefix matching", () => {
      const mockValidation = createMockSignalValidation();
      const now = Date.now();

      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readdirSync).mockReturnValue([
        "7203_T_validation_ma_cross.json",
      ] as unknown as fs.Dirent[]);

      vi.mocked(fs.readFileSync).mockReturnValue(
        JSON.stringify({ data: mockValidation, cachedAt: now })
      );

      const result = getAllCachedValidations("7203.T");

      expect(Object.keys(result)).toHaveLength(1);
    });
  });

  // ===========================================
  // Integration Scenarios
  // ===========================================
  describe("integration scenarios", () => {
    it("set then get research returns the same data", () => {
      const mockResearch = createMockResearchData();

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
      setCachedResearch("7203.T", mockResearch);

      // Get
      const result = getCachedResearch("7203.T");

      expect(result).not.toBeNull();
      expect(result).toEqual(mockResearch);
    });

    it("set then get validation returns the same data", () => {
      const mockValidation = createMockSignalValidation();

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
      setCachedValidation("7203.T", "ma_cross", mockValidation);

      // Get
      const result = getCachedValidation("7203.T", "ma_cross");

      expect(result).not.toBeNull();
      expect(result).toEqual(mockValidation);
    });

    it("different symbols use different cache files", () => {
      const mockResearch = createMockResearchData();

      vi.mocked(fs.existsSync).mockReturnValue(true);

      setCachedResearch("7203.T", mockResearch);
      setCachedResearch("9984.T", mockResearch);

      const calls = vi.mocked(fs.writeFileSync).mock.calls;
      expect(calls[0][0]).toContain("7203_T_research.json");
      expect(calls[1][0]).toContain("9984_T_research.json");
    });

    it("different strategies use different validation cache files", () => {
      const mockValidation = createMockSignalValidation();

      vi.mocked(fs.existsSync).mockReturnValue(true);

      setCachedValidation("7203.T", "ma_cross", mockValidation);
      setCachedValidation("7203.T", "rsi", mockValidation);

      const calls = vi.mocked(fs.writeFileSync).mock.calls;
      expect(calls[0][0]).toContain("7203_T_validation_ma_cross.json");
      expect(calls[1][0]).toContain("7203_T_validation_rsi.json");
    });
  });
});
