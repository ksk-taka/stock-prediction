import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { LLMAnalysis, SentimentData } from "@/types";

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
  ensureCacheDir: vi.fn(() => "/mock/cache/analysis"),
  TTL: {
    HOURS_24: 24 * 60 * 60 * 1000,
  },
}));

import fs from "fs";
import { getCachedAnalysis, setCachedAnalysis } from "../analysisCache";

// Helper to create mock LLMAnalysis
function createMockAnalysis(): LLMAnalysis {
  return {
    summary: "Test analysis summary",
    outlook: "bullish",
    keyPoints: ["Point 1", "Point 2", "Point 3"],
    risks: ["Risk 1"],
    opportunities: ["Opportunity 1"],
    priceTarget: {
      short: 1100,
      medium: 1200,
    },
    confidence: "high",
    analyzedAt: "2024-01-15T10:00:00Z",
  };
}

// Helper to create mock SentimentData
function createMockSentiment(): SentimentData {
  return {
    score: 0.7,
    label: "positive",
    confidence: 0.85,
    sources: {
      news: 0.6,
      sns: 0.8,
      analyst: 0.7,
    },
  };
}

describe("analysisCache", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset Date.now mock if any
    vi.useRealTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("getCachedAnalysis", () => {
    describe("returns cached data when cache exists and is valid", () => {
      it("returns analysis entry when cache file exists and is not expired", () => {
        const mockAnalysis = createMockAnalysis();
        const mockSentiment = createMockSentiment();
        const cachedAt = Date.now() - 1000; // 1 second ago

        const cacheEntry = {
          analysis: mockAnalysis,
          sentiment: mockSentiment,
          cachedAt,
        };

        vi.mocked(fs.existsSync).mockReturnValue(true);
        vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(cacheEntry));

        const result = getCachedAnalysis("7203.T");

        expect(result).not.toBeNull();
        expect(result?.analysis).toEqual(mockAnalysis);
        expect(result?.sentiment).toEqual(mockSentiment);
        expect(result?.cachedAt).toBe(cachedAt);
      });

      it("uses ensureCacheDir to get cache directory", async () => {
        const { ensureCacheDir } = await import("../cacheUtils");
        vi.mocked(fs.existsSync).mockReturnValue(false);

        getCachedAnalysis("7203.T");

        expect(ensureCacheDir).toHaveBeenCalledWith("analysis");
      });

      it("handles symbol with dots correctly (replaces . with _)", () => {
        vi.mocked(fs.existsSync).mockReturnValue(false);

        getCachedAnalysis("7203.T");

        // Check that readFileSync was called with the correct path
        expect(fs.existsSync).toHaveBeenCalledWith(
          expect.stringContaining("7203_T.json")
        );
      });
    });

    describe("returns null when cache is expired", () => {
      it("returns null when cache is older than 24 hours", () => {
        const mockAnalysis = createMockAnalysis();
        const mockSentiment = createMockSentiment();
        // Cache from 25 hours ago (expired)
        const cachedAt = Date.now() - 25 * 60 * 60 * 1000;

        const cacheEntry = {
          analysis: mockAnalysis,
          sentiment: mockSentiment,
          cachedAt,
        };

        vi.mocked(fs.existsSync).mockReturnValue(true);
        vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(cacheEntry));

        const result = getCachedAnalysis("7203.T");

        expect(result).toBeNull();
      });

      it("returns data when cache is exactly at TTL boundary", () => {
        const mockAnalysis = createMockAnalysis();
        const mockSentiment = createMockSentiment();
        // Cache from exactly 24 hours ago (at boundary)
        const now = Date.now();
        vi.useFakeTimers();
        vi.setSystemTime(now);

        const cachedAt = now - 24 * 60 * 60 * 1000; // Exactly at TTL

        const cacheEntry = {
          analysis: mockAnalysis,
          sentiment: mockSentiment,
          cachedAt,
        };

        vi.mocked(fs.existsSync).mockReturnValue(true);
        vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(cacheEntry));

        const result = getCachedAnalysis("7203.T");

        // At exactly TTL, Date.now() - cachedAt === TTL, which is NOT > TTL
        expect(result).not.toBeNull();
      });

      it("returns null when cache is 1ms past TTL", () => {
        const mockAnalysis = createMockAnalysis();
        const mockSentiment = createMockSentiment();
        const now = Date.now();
        vi.useFakeTimers();
        vi.setSystemTime(now);

        // Cache from 24 hours + 1ms ago (just expired)
        const cachedAt = now - (24 * 60 * 60 * 1000 + 1);

        const cacheEntry = {
          analysis: mockAnalysis,
          sentiment: mockSentiment,
          cachedAt,
        };

        vi.mocked(fs.existsSync).mockReturnValue(true);
        vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(cacheEntry));

        const result = getCachedAnalysis("7203.T");

        expect(result).toBeNull();
      });
    });

    describe("returns null when cache file does not exist", () => {
      it("returns null when file does not exist", () => {
        vi.mocked(fs.existsSync)
          .mockReturnValueOnce(true) // directory exists
          .mockReturnValueOnce(false); // file does not exist

        const result = getCachedAnalysis("7203.T");

        expect(result).toBeNull();
      });
    });

    describe("error handling for fs failures", () => {
      it("returns null when readFileSync throws an error", () => {
        vi.mocked(fs.existsSync).mockReturnValue(true);
        vi.mocked(fs.readFileSync).mockImplementation(() => {
          throw new Error("EACCES: permission denied");
        });

        const result = getCachedAnalysis("7203.T");

        expect(result).toBeNull();
      });

      it("returns null when JSON.parse fails (corrupted cache)", () => {
        vi.mocked(fs.existsSync).mockReturnValue(true);
        vi.mocked(fs.readFileSync).mockReturnValue("invalid json {{{");

        const result = getCachedAnalysis("7203.T");

        expect(result).toBeNull();
      });

      // Note: mkdirSync error handling is now tested in cacheUtils.test.ts
      // since ensureCacheDir handles directory creation
    });
  });

  describe("setCachedAnalysis", () => {
    describe("writes data correctly", () => {
      it("writes analysis data to the correct file path", () => {
        const mockAnalysis = createMockAnalysis();
        const mockSentiment = createMockSentiment();

        vi.mocked(fs.existsSync).mockReturnValue(true);

        setCachedAnalysis("7203.T", mockAnalysis, mockSentiment);

        expect(fs.writeFileSync).toHaveBeenCalledTimes(1);
        expect(fs.writeFileSync).toHaveBeenCalledWith(
          expect.stringContaining("7203_T.json"),
          expect.any(String),
          "utf-8"
        );
      });

      it("writes correct JSON structure with cachedAt timestamp", () => {
        const mockAnalysis = createMockAnalysis();
        const mockSentiment = createMockSentiment();

        const now = 1705312800000; // Fixed timestamp
        vi.useFakeTimers();
        vi.setSystemTime(now);

        vi.mocked(fs.existsSync).mockReturnValue(true);

        setCachedAnalysis("7203.T", mockAnalysis, mockSentiment);

        const writtenData = vi.mocked(fs.writeFileSync).mock.calls[0][1];
        const parsedData = JSON.parse(writtenData as string);

        expect(parsedData.analysis).toEqual(mockAnalysis);
        expect(parsedData.sentiment).toEqual(mockSentiment);
        expect(parsedData.cachedAt).toBe(now);
      });

      it("calls ensureCacheDir with correct subdir", async () => {
        const { ensureCacheDir } = await import("../cacheUtils");
        const mockAnalysis = createMockAnalysis();
        const mockSentiment = createMockSentiment();

        vi.mocked(fs.existsSync).mockReturnValue(false);

        setCachedAnalysis("7203.T", mockAnalysis, mockSentiment);

        expect(ensureCacheDir).toHaveBeenCalledWith("analysis");
      });

      it("handles symbol with special characters correctly", () => {
        const mockAnalysis = createMockAnalysis();
        const mockSentiment = createMockSentiment();

        vi.mocked(fs.existsSync).mockReturnValue(true);

        setCachedAnalysis("AAPL.US", mockAnalysis, mockSentiment);

        expect(fs.writeFileSync).toHaveBeenCalledWith(
          expect.stringContaining("AAPL_US.json"),
          expect.any(String),
          "utf-8"
        );
      });
    });

    describe("error handling for fs failures", () => {
      it("silently ignores writeFileSync errors", () => {
        const mockAnalysis = createMockAnalysis();
        const mockSentiment = createMockSentiment();

        vi.mocked(fs.existsSync).mockReturnValue(true);
        vi.mocked(fs.writeFileSync).mockImplementation(() => {
          throw new Error("EACCES: permission denied");
        });

        // Should not throw
        expect(() => {
          setCachedAnalysis("7203.T", mockAnalysis, mockSentiment);
        }).not.toThrow();
      });

      // Note: mkdirSync error handling is now tested in cacheUtils.test.ts
      // since ensureCacheDir handles directory creation
    });
  });

  describe("integration scenarios", () => {
    it("set then get returns the same data", () => {
      const mockAnalysis = createMockAnalysis();
      const mockSentiment = createMockSentiment();

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
      setCachedAnalysis("7203.T", mockAnalysis, mockSentiment);

      // Get
      const result = getCachedAnalysis("7203.T");

      expect(result).not.toBeNull();
      expect(result?.analysis).toEqual(mockAnalysis);
      expect(result?.sentiment).toEqual(mockSentiment);
      expect(result?.cachedAt).toBe(now);
    });

    it("different symbols use different cache files", () => {
      const mockAnalysis = createMockAnalysis();
      const mockSentiment = createMockSentiment();

      vi.mocked(fs.existsSync).mockReturnValue(true);

      setCachedAnalysis("7203.T", mockAnalysis, mockSentiment);
      setCachedAnalysis("9984.T", mockAnalysis, mockSentiment);

      const calls = vi.mocked(fs.writeFileSync).mock.calls;
      expect(calls[0][0]).toContain("7203_T.json");
      expect(calls[1][0]).toContain("9984_T.json");
    });
  });
});
