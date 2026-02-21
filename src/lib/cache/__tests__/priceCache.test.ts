import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { PriceData } from "@/types";

// Mock fs module
vi.mock("fs", () => ({
  default: {
    existsSync: vi.fn(),
    mkdirSync: vi.fn(),
    readFileSync: vi.fn(),
    writeFileSync: vi.fn(),
  },
}));

// Mock date module
vi.mock("@/lib/utils/date", () => ({
  isMarketOpen: vi.fn(),
}));

// Mock cacheUtils module
vi.mock("../cacheUtils", () => ({
  ensureCacheDir: vi.fn(() => "/mock/cache/prices"),
  TTL: { MINUTES_5: 5 * 60 * 1000, HOURS_24: 24 * 60 * 60 * 1000 },
}));

import fs from "fs";
import { isMarketOpen } from "@/lib/utils/date";
import { getCachedPrices, setCachedPrices } from "../priceCache";

// Sample price data for testing
const samplePriceData: PriceData[] = [
  {
    date: "2024-01-15",
    open: 1000,
    high: 1050,
    low: 990,
    close: 1030,
    volume: 100000,
  },
  {
    date: "2024-01-16",
    open: 1030,
    high: 1080,
    low: 1020,
    close: 1060,
    volume: 120000,
  },
];

describe("priceCache", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-01-17T10:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("getCachedPrices", () => {
    describe("Cache hit", () => {
      it("returns cached data when file exists and TTL is valid (market closed)", () => {
        const cachedEntry = {
          data: samplePriceData,
          cachedAt: Date.now() - 1000 * 60 * 60, // 1 hour ago
        };

        vi.mocked(fs.existsSync).mockReturnValue(true);
        vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(cachedEntry));
        vi.mocked(isMarketOpen).mockReturnValue(false);

        const result = getCachedPrices("7203.T", "daily", "JP");

        expect(result).toEqual(samplePriceData);
        expect(fs.existsSync).toHaveBeenCalled(); // cacheFile check (ensureDir is now mocked)
        expect(fs.readFileSync).toHaveBeenCalled();
      });

      it("returns cached data when file exists and TTL is valid (market open, within 5 min)", () => {
        const cachedEntry = {
          data: samplePriceData,
          cachedAt: Date.now() - 1000 * 60 * 2, // 2 minutes ago
        };

        vi.mocked(fs.existsSync).mockReturnValue(true);
        vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(cachedEntry));
        vi.mocked(isMarketOpen).mockReturnValue(true);

        const result = getCachedPrices("7203.T", "daily", "JP");

        expect(result).toEqual(samplePriceData);
      });

      it("handles symbols with dots correctly", () => {
        const cachedEntry = {
          data: samplePriceData,
          cachedAt: Date.now() - 1000 * 60,
        };

        vi.mocked(fs.existsSync).mockReturnValue(true);
        vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(cachedEntry));
        vi.mocked(isMarketOpen).mockReturnValue(false);

        getCachedPrices("7203.T", "daily", "JP");

        // Verify that the file path uses underscore instead of dot
        const readFileCalls = vi.mocked(fs.readFileSync).mock.calls;
        expect(readFileCalls[0][0]).toContain("7203_T_daily.json");
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
        vi.mocked(isMarketOpen).mockReturnValue(false);

        const result = getCachedPrices("7203.T", "daily", "JP");

        expect(result).toBeNull();
      });

      it("returns null when cache has expired (market closed, > 24h)", () => {
        const cachedEntry = {
          data: samplePriceData,
          cachedAt: Date.now() - 1000 * 60 * 60 * 25, // 25 hours ago
        };

        vi.mocked(fs.existsSync).mockReturnValue(true);
        vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(cachedEntry));
        vi.mocked(isMarketOpen).mockReturnValue(false);

        const result = getCachedPrices("7203.T", "daily", "JP");

        expect(result).toBeNull();
      });

      it("returns null when cache has expired (market open, > 5 min)", () => {
        const cachedEntry = {
          data: samplePriceData,
          cachedAt: Date.now() - 1000 * 60 * 6, // 6 minutes ago
        };

        vi.mocked(fs.existsSync).mockReturnValue(true);
        vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(cachedEntry));
        vi.mocked(isMarketOpen).mockReturnValue(true);

        const result = getCachedPrices("7203.T", "daily", "JP");

        expect(result).toBeNull();
      });
    });

    describe("Error handling", () => {
      it("returns null when readFileSync throws an error", () => {
        vi.mocked(fs.existsSync).mockReturnValue(true);
        vi.mocked(fs.readFileSync).mockImplementation(() => {
          throw new Error("File read error");
        });

        const result = getCachedPrices("7203.T", "daily", "JP");

        expect(result).toBeNull();
      });

      it("returns null when JSON parsing fails", () => {
        vi.mocked(fs.existsSync).mockReturnValue(true);
        vi.mocked(fs.readFileSync).mockReturnValue("invalid json");

        const result = getCachedPrices("7203.T", "daily", "JP");

        expect(result).toBeNull();
      });

      it("calls ensureCacheDir with correct subdir", async () => {
        const { ensureCacheDir } = await import("../cacheUtils");
        vi.mocked(fs.existsSync).mockReturnValue(false);

        getCachedPrices("7203.T", "daily", "JP");

        expect(ensureCacheDir).toHaveBeenCalledWith("prices");
      });
    });

    describe("Market-specific TTL", () => {
      it("uses 5 minute TTL when JP market is open", () => {
        // Cache from 4 minutes ago should be valid
        const validCache = {
          data: samplePriceData,
          cachedAt: Date.now() - 1000 * 60 * 4,
        };

        vi.mocked(fs.existsSync).mockReturnValue(true);
        vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(validCache));
        vi.mocked(isMarketOpen).mockReturnValue(true);

        const result = getCachedPrices("7203.T", "daily", "JP");
        expect(result).toEqual(samplePriceData);
      });

      it("uses 24 hour TTL when JP market is closed", () => {
        // Cache from 20 hours ago should be valid when market is closed
        const validCache = {
          data: samplePriceData,
          cachedAt: Date.now() - 1000 * 60 * 60 * 20,
        };

        vi.mocked(fs.existsSync).mockReturnValue(true);
        vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(validCache));
        vi.mocked(isMarketOpen).mockReturnValue(false);

        const result = getCachedPrices("7203.T", "daily", "JP");
        expect(result).toEqual(samplePriceData);
      });

      it("uses correct TTL for US market", () => {
        const cachedEntry = {
          data: samplePriceData,
          cachedAt: Date.now() - 1000 * 60 * 3, // 3 minutes ago
        };

        vi.mocked(fs.existsSync).mockReturnValue(true);
        vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(cachedEntry));
        vi.mocked(isMarketOpen).mockReturnValue(true);

        const result = getCachedPrices("AAPL", "daily", "US");

        expect(isMarketOpen).toHaveBeenCalledWith("US");
        expect(result).toEqual(samplePriceData);
      });
    });
  });

  describe("setCachedPrices", () => {
    describe("Cache write", () => {
      it("writes price data to cache file correctly", () => {
        vi.mocked(fs.existsSync).mockReturnValue(true);

        setCachedPrices("7203.T", "daily", samplePriceData);

        expect(fs.writeFileSync).toHaveBeenCalledTimes(1);

        const writeCall = vi.mocked(fs.writeFileSync).mock.calls[0];
        expect(writeCall[0]).toContain("7203_T_daily.json");

        const writtenData = JSON.parse(writeCall[1] as string);
        expect(writtenData.data).toEqual(samplePriceData);
        expect(writtenData.cachedAt).toBe(Date.now());
      });

      it("calls ensureCacheDir with correct subdir", async () => {
        const { ensureCacheDir } = await import("../cacheUtils");
        vi.mocked(fs.existsSync).mockReturnValue(false);

        setCachedPrices("7203.T", "daily", samplePriceData);

        expect(ensureCacheDir).toHaveBeenCalledWith("prices");
      });

      it("handles different period values", () => {
        vi.mocked(fs.existsSync).mockReturnValue(true);

        setCachedPrices("7203.T", "weekly", samplePriceData);

        const writeCall = vi.mocked(fs.writeFileSync).mock.calls[0];
        expect(writeCall[0]).toContain("7203_T_weekly.json");
      });

      it("handles US stock symbols", () => {
        vi.mocked(fs.existsSync).mockReturnValue(true);

        setCachedPrices("AAPL", "daily", samplePriceData);

        const writeCall = vi.mocked(fs.writeFileSync).mock.calls[0];
        expect(writeCall[0]).toContain("AAPL_daily.json");
      });

      it("stores cachedAt timestamp with current time", () => {
        vi.mocked(fs.existsSync).mockReturnValue(true);
        const currentTime = Date.now();

        setCachedPrices("7203.T", "daily", samplePriceData);

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
          setCachedPrices("7203.T", "daily", samplePriceData);
        }).not.toThrow();
      });

      // Note: mkdirSync error handling is now tested in cacheUtils.test.ts
      // since ensureCacheDir handles directory creation
    });
  });

  describe("Integration scenarios", () => {
    it("can write and read back price data", () => {
      let storedData: string | null = null;

      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.writeFileSync).mockImplementation((_, data) => {
        storedData = data as string;
      });
      vi.mocked(fs.readFileSync).mockImplementation(() => {
        if (!storedData) throw new Error("No data");
        return storedData;
      });
      vi.mocked(isMarketOpen).mockReturnValue(false);

      // Write
      setCachedPrices("7203.T", "daily", samplePriceData);

      // Read
      const result = getCachedPrices("7203.T", "daily", "JP");

      expect(result).toEqual(samplePriceData);
    });

    it("handles empty price data array", () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);

      const emptyData: PriceData[] = [];
      setCachedPrices("7203.T", "daily", emptyData);

      const writeCall = vi.mocked(fs.writeFileSync).mock.calls[0];
      const writtenData = JSON.parse(writeCall[1] as string);
      expect(writtenData.data).toEqual([]);
    });

    it("handles large price data arrays", () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);

      const largePriceData: PriceData[] = Array.from({ length: 1000 }, (_, i) => ({
        date: `2024-01-${String((i % 28) + 1).padStart(2, "0")}`,
        open: 1000 + i,
        high: 1050 + i,
        low: 990 + i,
        close: 1030 + i,
        volume: 100000 + i * 100,
      }));

      setCachedPrices("7203.T", "daily", largePriceData);

      const writeCall = vi.mocked(fs.writeFileSync).mock.calls[0];
      const writtenData = JSON.parse(writeCall[1] as string);
      expect(writtenData.data).toHaveLength(1000);
    });
  });
});
