import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { NewsItem } from "@/types";

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
  ensureCacheDir: vi.fn(() => "/mock/cache/news"),
  TTL: { HOURS_6: 6 * 60 * 60 * 1000 },
}));

import fs from "fs";
import { getCachedNews, setCachedNews } from "../newsCache";

// Sample news data for testing
const sampleNewsData: NewsItem[] = [
  {
    title: "Company reports record earnings",
    source: "Reuters",
    url: "https://example.com/news/1",
    publishedAt: "2024-01-15T10:00:00Z",
    summary: "The company reported better than expected results.",
    sentiment: "positive",
  },
  {
    title: "Market analysis: tech sector outlook",
    source: "Bloomberg",
    url: "https://example.com/news/2",
    publishedAt: "2024-01-15T09:00:00Z",
    sentiment: "neutral",
  },
];

const sampleSnsOverview = "Overall positive sentiment on social media";
const sampleAnalystRating = "Buy - target price $150";

describe("newsCache", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-01-17T10:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("getCachedNews", () => {
    describe("Cache hit", () => {
      it("returns cached data when file exists and TTL is valid", () => {
        const cachedEntry = {
          news: sampleNewsData,
          snsOverview: sampleSnsOverview,
          analystRating: sampleAnalystRating,
          cachedAt: Date.now() - 1000 * 60 * 60, // 1 hour ago
        };

        vi.mocked(fs.existsSync).mockReturnValue(true);
        vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(cachedEntry));

        const result = getCachedNews("7203.T");

        expect(result).toEqual(cachedEntry);
        expect(result?.news).toEqual(sampleNewsData);
        expect(result?.snsOverview).toBe(sampleSnsOverview);
        expect(result?.analystRating).toBe(sampleAnalystRating);
        expect(fs.existsSync).toHaveBeenCalled(); // cacheFile check (ensureDir is now mocked)
        expect(fs.readFileSync).toHaveBeenCalled();
      });

      it("returns cached data when cache is exactly at TTL boundary", () => {
        const sixHoursInMs = 6 * 60 * 60 * 1000;
        const cachedEntry = {
          news: sampleNewsData,
          snsOverview: sampleSnsOverview,
          analystRating: sampleAnalystRating,
          cachedAt: Date.now() - sixHoursInMs + 1000, // Just under 6 hours
        };

        vi.mocked(fs.existsSync).mockReturnValue(true);
        vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(cachedEntry));

        const result = getCachedNews("7203.T");

        expect(result).toEqual(cachedEntry);
      });

      it("handles symbols with dots correctly", () => {
        const cachedEntry = {
          news: sampleNewsData,
          snsOverview: sampleSnsOverview,
          analystRating: sampleAnalystRating,
          cachedAt: Date.now() - 1000 * 60,
        };

        vi.mocked(fs.existsSync).mockReturnValue(true);
        vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(cachedEntry));

        getCachedNews("7203.T");

        // Verify that the file path uses underscore instead of dot
        const readFileCalls = vi.mocked(fs.readFileSync).mock.calls;
        expect(readFileCalls[0][0]).toContain("7203_T.json");
      });

      it("handles US stock symbols", () => {
        const cachedEntry = {
          news: sampleNewsData,
          snsOverview: sampleSnsOverview,
          analystRating: sampleAnalystRating,
          cachedAt: Date.now() - 1000 * 60,
        };

        vi.mocked(fs.existsSync).mockReturnValue(true);
        vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(cachedEntry));

        getCachedNews("AAPL");

        const readFileCalls = vi.mocked(fs.readFileSync).mock.calls;
        expect(readFileCalls[0][0]).toContain("AAPL.json");
      });
    });

    describe("Cache miss", () => {
      it("returns null when cache file does not exist", () => {
        vi.mocked(fs.existsSync).mockImplementation((path) => {
          // Return true for directory check, false for file check
          if (typeof path === "string" && path.endsWith(".json")) {
            return false;
          }
          return true;
        });

        const result = getCachedNews("7203.T");

        expect(result).toBeNull();
      });

      it("returns null when cache has expired (> 6 hours)", () => {
        const cachedEntry = {
          news: sampleNewsData,
          snsOverview: sampleSnsOverview,
          analystRating: sampleAnalystRating,
          cachedAt: Date.now() - 1000 * 60 * 60 * 7, // 7 hours ago
        };

        vi.mocked(fs.existsSync).mockReturnValue(true);
        vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(cachedEntry));

        const result = getCachedNews("7203.T");

        expect(result).toBeNull();
      });

      it("returns null when cache is exactly at expiration", () => {
        const sixHoursInMs = 6 * 60 * 60 * 1000;
        const cachedEntry = {
          news: sampleNewsData,
          snsOverview: sampleSnsOverview,
          analystRating: sampleAnalystRating,
          cachedAt: Date.now() - sixHoursInMs - 1, // Just over 6 hours
        };

        vi.mocked(fs.existsSync).mockReturnValue(true);
        vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(cachedEntry));

        const result = getCachedNews("7203.T");

        expect(result).toBeNull();
      });
    });

    describe("Error handling", () => {
      it("returns null when readFileSync throws an error", () => {
        vi.mocked(fs.existsSync).mockReturnValue(true);
        vi.mocked(fs.readFileSync).mockImplementation(() => {
          throw new Error("File read error");
        });

        const result = getCachedNews("7203.T");

        expect(result).toBeNull();
      });

      it("returns null when JSON parsing fails", () => {
        vi.mocked(fs.existsSync).mockReturnValue(true);
        vi.mocked(fs.readFileSync).mockReturnValue("invalid json");

        const result = getCachedNews("7203.T");

        expect(result).toBeNull();
      });

      it("calls ensureCacheDir with correct subdir", async () => {
        const { ensureCacheDir } = await import("../cacheUtils");
        vi.mocked(fs.existsSync).mockReturnValue(false);

        getCachedNews("7203.T");

        expect(ensureCacheDir).toHaveBeenCalledWith("news");
      });
    });
  });

  describe("setCachedNews", () => {
    describe("Cache write", () => {
      it("writes news data to cache file correctly", () => {
        vi.mocked(fs.existsSync).mockReturnValue(true);

        setCachedNews("7203.T", sampleNewsData, sampleSnsOverview, sampleAnalystRating);

        expect(fs.writeFileSync).toHaveBeenCalledTimes(1);

        const writeCall = vi.mocked(fs.writeFileSync).mock.calls[0];
        expect(writeCall[0]).toContain("7203_T.json");

        const writtenData = JSON.parse(writeCall[1] as string);
        expect(writtenData.news).toEqual(sampleNewsData);
        expect(writtenData.snsOverview).toBe(sampleSnsOverview);
        expect(writtenData.analystRating).toBe(sampleAnalystRating);
        expect(writtenData.cachedAt).toBe(Date.now());
      });

      it("calls ensureCacheDir with correct subdir", async () => {
        const { ensureCacheDir } = await import("../cacheUtils");
        vi.mocked(fs.existsSync).mockReturnValue(false);

        setCachedNews("7203.T", sampleNewsData, sampleSnsOverview, sampleAnalystRating);

        expect(ensureCacheDir).toHaveBeenCalledWith("news");
      });

      it("handles US stock symbols", () => {
        vi.mocked(fs.existsSync).mockReturnValue(true);

        setCachedNews("AAPL", sampleNewsData, sampleSnsOverview, sampleAnalystRating);

        const writeCall = vi.mocked(fs.writeFileSync).mock.calls[0];
        expect(writeCall[0]).toContain("AAPL.json");
      });

      it("handles symbols with multiple dots", () => {
        vi.mocked(fs.existsSync).mockReturnValue(true);

        setCachedNews("BRK.A", sampleNewsData, sampleSnsOverview, sampleAnalystRating);

        const writeCall = vi.mocked(fs.writeFileSync).mock.calls[0];
        expect(writeCall[0]).toContain("BRK_A.json");
      });

      it("stores cachedAt timestamp with current time", () => {
        vi.mocked(fs.existsSync).mockReturnValue(true);
        const currentTime = Date.now();

        setCachedNews("7203.T", sampleNewsData, sampleSnsOverview, sampleAnalystRating);

        const writeCall = vi.mocked(fs.writeFileSync).mock.calls[0];
        const writtenData = JSON.parse(writeCall[1] as string);
        expect(writtenData.cachedAt).toBe(currentTime);
      });
    });

    describe("Error handling", () => {
      it("silently ignores write errors", () => {
        vi.mocked(fs.existsSync).mockReturnValue(true);
        vi.mocked(fs.writeFileSync).mockImplementation(() => {
          throw new Error("Write error");
        });

        // Should not throw
        expect(() => {
          setCachedNews("7203.T", sampleNewsData, sampleSnsOverview, sampleAnalystRating);
        }).not.toThrow();
      });

      // Note: mkdirSync error handling is now tested in cacheUtils.test.ts
      // since ensureCacheDir handles directory creation
    });
  });

  describe("Integration scenarios", () => {
    it("can write and read back news data", () => {
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
      setCachedNews("7203.T", sampleNewsData, sampleSnsOverview, sampleAnalystRating);

      // Read
      const result = getCachedNews("7203.T");

      expect(result?.news).toEqual(sampleNewsData);
      expect(result?.snsOverview).toBe(sampleSnsOverview);
      expect(result?.analystRating).toBe(sampleAnalystRating);
    });

    it("handles empty news data array", () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);

      const emptyNews: NewsItem[] = [];
      setCachedNews("7203.T", emptyNews, "", "");

      const writeCall = vi.mocked(fs.writeFileSync).mock.calls[0];
      const writtenData = JSON.parse(writeCall[1] as string);
      expect(writtenData.news).toEqual([]);
      expect(writtenData.snsOverview).toBe("");
      expect(writtenData.analystRating).toBe("");
    });

    it("handles large news data arrays", () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);

      const largeNewsData: NewsItem[] = Array.from({ length: 100 }, (_, i) => ({
        title: `News item ${i}`,
        source: "Test Source",
        url: `https://example.com/news/${i}`,
        publishedAt: `2024-01-15T${String(i % 24).padStart(2, "0")}:00:00Z`,
        sentiment: "neutral" as const,
      }));

      setCachedNews("7203.T", largeNewsData, sampleSnsOverview, sampleAnalystRating);

      const writeCall = vi.mocked(fs.writeFileSync).mock.calls[0];
      const writtenData = JSON.parse(writeCall[1] as string);
      expect(writtenData.news).toHaveLength(100);
    });

    it("handles news items with optional fields", () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);

      const minimalNews: NewsItem[] = [
        {
          title: "Minimal news item",
          source: "Source",
          url: "https://example.com",
          publishedAt: "2024-01-15T10:00:00Z",
          // summary and sentiment are optional
        },
      ];

      setCachedNews("7203.T", minimalNews, sampleSnsOverview, sampleAnalystRating);

      const writeCall = vi.mocked(fs.writeFileSync).mock.calls[0];
      const writtenData = JSON.parse(writeCall[1] as string);
      expect(writtenData.news[0]).not.toHaveProperty("summary");
      expect(writtenData.news[0]).not.toHaveProperty("sentiment");
    });
  });
});
