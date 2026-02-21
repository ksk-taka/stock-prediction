import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

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
  ensureCacheDir: vi.fn(() => "/mock/cache/divergence"),
  TTL: { HOURS_24: 24 * 60 * 60 * 1000 },
}));

import fs from "fs";
import {
  getCachedDivergence,
  setCachedDivergence,
  invalidateDivergenceCache,
  type DivergenceData,
} from "../divergenceCache";

// Sample divergence data for testing
const sampleDivergenceData: DivergenceData[] = [
  {
    symbol: "7203.T",
    type: "bullish",
    indicator: "RSI",
    priceLow: 1000,
    indicatorLow: 30,
    startDate: "2024-01-10",
    endDate: "2024-01-15",
    strength: 75,
  },
  {
    symbol: "7203.T",
    type: "bearish",
    indicator: "MACD",
    priceHigh: 1200,
    indicatorHigh: 50,
    startDate: "2024-01-05",
    endDate: "2024-01-12",
    strength: 60,
  },
];

describe("divergenceCache", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-01-17T10:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ===========================================
  // getCachedDivergence
  // ===========================================
  describe("getCachedDivergence", () => {
    describe("Cache hit", () => {
      it("returns cached data when file exists and TTL is valid", () => {
        const cachedEntry = {
          data: sampleDivergenceData,
          cachedAt: Date.now() - 1000 * 60 * 60, // 1 hour ago
        };

        vi.mocked(fs.existsSync).mockReturnValue(true);
        vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(cachedEntry));

        const result = getCachedDivergence("7203.T");

        expect(result).toEqual(sampleDivergenceData);
        expect(fs.existsSync).toHaveBeenCalled(); // cacheFile check (ensureDir is now mocked)
        expect(fs.readFileSync).toHaveBeenCalled();
      });

      it("returns cached data when cache is almost expired (23h59m)", () => {
        const cachedEntry = {
          data: sampleDivergenceData,
          cachedAt: Date.now() - 1000 * 60 * 60 * 24 + 60000, // 23h59m ago
        };

        vi.mocked(fs.existsSync).mockReturnValue(true);
        vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(cachedEntry));

        const result = getCachedDivergence("7203.T");

        expect(result).toEqual(sampleDivergenceData);
      });

      it("handles symbols with dots correctly", () => {
        const cachedEntry = {
          data: sampleDivergenceData,
          cachedAt: Date.now() - 1000 * 60,
        };

        vi.mocked(fs.existsSync).mockReturnValue(true);
        vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(cachedEntry));

        getCachedDivergence("7203.T");

        // Verify that the file path uses underscore instead of dot
        const readFileCalls = vi.mocked(fs.readFileSync).mock.calls;
        expect(readFileCalls[0][0]).toContain("7203_T.json");
      });

      it("returns empty array when cached data is empty", () => {
        const cachedEntry = {
          data: [],
          cachedAt: Date.now() - 1000 * 60,
        };

        vi.mocked(fs.existsSync).mockReturnValue(true);
        vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(cachedEntry));

        const result = getCachedDivergence("7203.T");

        expect(result).toEqual([]);
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

        const result = getCachedDivergence("7203.T");

        expect(result).toBeNull();
      });

      it("returns null when cache has expired (> 24h)", () => {
        const cachedEntry = {
          data: sampleDivergenceData,
          cachedAt: Date.now() - 1000 * 60 * 60 * 25, // 25 hours ago
        };

        vi.mocked(fs.existsSync).mockReturnValue(true);
        vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(cachedEntry));

        const result = getCachedDivergence("7203.T");

        expect(result).toBeNull();
      });

      it("returns null when cache has exactly expired (24h)", () => {
        const cachedEntry = {
          data: sampleDivergenceData,
          cachedAt: Date.now() - 1000 * 60 * 60 * 24 - 1, // 24h + 1ms ago
        };

        vi.mocked(fs.existsSync).mockReturnValue(true);
        vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(cachedEntry));

        const result = getCachedDivergence("7203.T");

        expect(result).toBeNull();
      });
    });

    describe("Error handling", () => {
      it("returns null when readFileSync throws an error", () => {
        vi.mocked(fs.existsSync).mockReturnValue(true);
        vi.mocked(fs.readFileSync).mockImplementation(() => {
          throw new Error("File read error");
        });

        const result = getCachedDivergence("7203.T");

        expect(result).toBeNull();
      });

      it("returns null when JSON parsing fails", () => {
        vi.mocked(fs.existsSync).mockReturnValue(true);
        vi.mocked(fs.readFileSync).mockReturnValue("invalid json");

        const result = getCachedDivergence("7203.T");

        expect(result).toBeNull();
      });

      it("returns undefined data when JSON is missing required fields", () => {
        vi.mocked(fs.existsSync).mockReturnValue(true);
        vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({ invalid: "data" }));

        const result = getCachedDivergence("7203.T");

        // Since cachedAt is undefined, Date.now() - undefined = NaN, > TTL is false
        // So it returns the (undefined) data field from the parsed JSON
        expect(result).toBeUndefined();
      });

      it("calls ensureCacheDir with correct subdir", async () => {
        const { ensureCacheDir } = await import("../cacheUtils");
        vi.mocked(fs.existsSync).mockReturnValue(false);

        getCachedDivergence("7203.T");

        expect(ensureCacheDir).toHaveBeenCalledWith("divergence");
      });
    });
  });

  // ===========================================
  // setCachedDivergence
  // ===========================================
  describe("setCachedDivergence", () => {
    describe("Cache write", () => {
      it("writes divergence data to cache file correctly", () => {
        vi.mocked(fs.existsSync).mockReturnValue(true);

        setCachedDivergence("7203.T", sampleDivergenceData);

        expect(fs.writeFileSync).toHaveBeenCalledTimes(1);

        const writeCall = vi.mocked(fs.writeFileSync).mock.calls[0];
        expect(writeCall[0]).toContain("7203_T.json");

        const writtenData = JSON.parse(writeCall[1] as string);
        expect(writtenData.data).toEqual(sampleDivergenceData);
        expect(writtenData.cachedAt).toBe(Date.now());
      });

      it("calls ensureCacheDir with correct subdir", async () => {
        const { ensureCacheDir } = await import("../cacheUtils");
        vi.mocked(fs.existsSync).mockReturnValue(false);

        setCachedDivergence("7203.T", sampleDivergenceData);

        expect(ensureCacheDir).toHaveBeenCalledWith("divergence");
      });

      it("handles empty data array", () => {
        vi.mocked(fs.existsSync).mockReturnValue(true);

        setCachedDivergence("7203.T", []);

        const writeCall = vi.mocked(fs.writeFileSync).mock.calls[0];
        const writtenData = JSON.parse(writeCall[1] as string);
        expect(writtenData.data).toEqual([]);
      });

      it("stores cachedAt timestamp with current time", () => {
        vi.mocked(fs.existsSync).mockReturnValue(true);
        const currentTime = Date.now();

        setCachedDivergence("7203.T", sampleDivergenceData);

        const writeCall = vi.mocked(fs.writeFileSync).mock.calls[0];
        const writtenData = JSON.parse(writeCall[1] as string);
        expect(writtenData.cachedAt).toBe(currentTime);
      });

      it("handles symbols without dots", () => {
        vi.mocked(fs.existsSync).mockReturnValue(true);

        setCachedDivergence("AAPL", sampleDivergenceData);

        const writeCall = vi.mocked(fs.writeFileSync).mock.calls[0];
        expect(writeCall[0]).toContain("AAPL.json");
      });

      it("handles all divergence indicators", () => {
        vi.mocked(fs.existsSync).mockReturnValue(true);

        const diverseData: DivergenceData[] = [
          { ...sampleDivergenceData[0], indicator: "RSI" },
          { ...sampleDivergenceData[0], indicator: "MACD" },
          { ...sampleDivergenceData[0], indicator: "OBV" },
        ];

        setCachedDivergence("7203.T", diverseData);

        const writeCall = vi.mocked(fs.writeFileSync).mock.calls[0];
        const writtenData = JSON.parse(writeCall[1] as string);
        expect(writtenData.data).toHaveLength(3);
        expect(writtenData.data.map((d: DivergenceData) => d.indicator)).toEqual([
          "RSI",
          "MACD",
          "OBV",
        ]);
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
          setCachedDivergence("7203.T", sampleDivergenceData);
        }).not.toThrow();
      });

      // Note: mkdirSync error handling is now tested in cacheUtils.test.ts
      // since ensureCacheDir handles directory creation
    });
  });

  // ===========================================
  // invalidateDivergenceCache
  // ===========================================
  describe("invalidateDivergenceCache", () => {
    it("deletes cache file when it exists", () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.unlinkSync).mockImplementation(() => {});

      const result = invalidateDivergenceCache("7203.T");

      expect(result).toBe(true);
      expect(fs.unlinkSync).toHaveBeenCalled();
      expect(fs.unlinkSync).toHaveBeenCalledWith(expect.stringContaining("7203_T.json"));
    });

    it("returns false when cache file does not exist", () => {
      vi.mocked(fs.existsSync).mockImplementation((path) => {
        if (typeof path === "string" && path.endsWith(".json")) {
          return false;
        }
        return true; // directory exists
      });

      const result = invalidateDivergenceCache("7203.T");

      expect(result).toBe(false);
      expect(fs.unlinkSync).not.toHaveBeenCalled();
    });

    it("returns false when unlink throws an error", () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.unlinkSync).mockImplementation(() => {
        throw new Error("Permission denied");
      });

      const result = invalidateDivergenceCache("7203.T");

      expect(result).toBe(false);
    });

    it("calls ensureCacheDir before checking file", async () => {
      const { ensureCacheDir } = await import("../cacheUtils");
      vi.mocked(fs.existsSync).mockReturnValue(false);

      invalidateDivergenceCache("7203.T");

      expect(ensureCacheDir).toHaveBeenCalledWith("divergence");
    });
  });

  // ===========================================
  // Cache expiration tests
  // ===========================================
  describe("Cache expiration", () => {
    it("TTL is exactly 24 hours", () => {
      // Cache from 23h59m59s ago should be valid
      const validCache = {
        data: sampleDivergenceData,
        cachedAt: Date.now() - (24 * 60 * 60 * 1000 - 1000), // 23h59m59s ago
      };

      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(validCache));

      const result = getCachedDivergence("7203.T");
      expect(result).toEqual(sampleDivergenceData);
    });

    it("cache expires after exactly 24 hours", () => {
      // Cache from exactly 24h ago should be expired
      const expiredCache = {
        data: sampleDivergenceData,
        cachedAt: Date.now() - 24 * 60 * 60 * 1000 - 1, // 24h + 1ms ago
      };

      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(expiredCache));

      const result = getCachedDivergence("7203.T");
      expect(result).toBeNull();
    });

    it("time advances and cache expires", () => {
      const cachedEntry = {
        data: sampleDivergenceData,
        cachedAt: Date.now(),
      };

      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(cachedEntry));

      // First read - should be valid
      let result = getCachedDivergence("7203.T");
      expect(result).toEqual(sampleDivergenceData);

      // Advance time by 25 hours
      vi.advanceTimersByTime(25 * 60 * 60 * 1000);

      // Second read - should be expired
      result = getCachedDivergence("7203.T");
      expect(result).toBeNull();
    });
  });

  // ===========================================
  // Integration scenarios
  // ===========================================
  describe("Integration scenarios", () => {
    it("can write and read back divergence data", () => {
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
      setCachedDivergence("7203.T", sampleDivergenceData);

      // Read
      const result = getCachedDivergence("7203.T");

      expect(result).toEqual(sampleDivergenceData);
    });

    it("handles large divergence data arrays", () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);

      const largeDivergenceData: DivergenceData[] = Array.from({ length: 100 }, (_, i) => ({
        symbol: "7203.T",
        type: i % 2 === 0 ? "bullish" : "bearish" as const,
        indicator: (["RSI", "MACD", "OBV"] as const)[i % 3],
        priceLow: 1000 + i,
        indicatorLow: 30 + (i % 40),
        startDate: `2024-01-${String((i % 28) + 1).padStart(2, "0")}`,
        endDate: `2024-01-${String(((i + 5) % 28) + 1).padStart(2, "0")}`,
        strength: 50 + (i % 50),
      }));

      setCachedDivergence("7203.T", largeDivergenceData);

      const writeCall = vi.mocked(fs.writeFileSync).mock.calls[0];
      const writtenData = JSON.parse(writeCall[1] as string);
      expect(writtenData.data).toHaveLength(100);
    });

    it("invalidate clears cache and subsequent read returns null", () => {
      let storedData: string | null = null;
      let fileExists = true;

      vi.mocked(fs.existsSync).mockImplementation((path) => {
        if (typeof path === "string" && path.endsWith(".json")) {
          return fileExists;
        }
        return true;
      });
      vi.mocked(fs.writeFileSync).mockImplementation((_, data) => {
        storedData = data as string;
        fileExists = true;
      });
      vi.mocked(fs.readFileSync).mockImplementation(() => {
        if (!storedData) throw new Error("No data");
        return storedData;
      });
      vi.mocked(fs.unlinkSync).mockImplementation(() => {
        storedData = null;
        fileExists = false;
      });

      // Write
      setCachedDivergence("7203.T", sampleDivergenceData);

      // Read - should return data
      let result = getCachedDivergence("7203.T");
      expect(result).toEqual(sampleDivergenceData);

      // Invalidate
      const invalidated = invalidateDivergenceCache("7203.T");
      expect(invalidated).toBe(true);

      // Read again - should return null
      result = getCachedDivergence("7203.T");
      expect(result).toBeNull();
    });

    it("handles different symbols independently", () => {
      const storage: Record<string, string> = {};

      vi.mocked(fs.existsSync).mockImplementation((path) => {
        if (typeof path === "string" && path.endsWith(".json")) {
          const key = path.toString();
          return key in storage;
        }
        return true;
      });
      vi.mocked(fs.writeFileSync).mockImplementation((path, data) => {
        storage[path.toString()] = data as string;
      });
      vi.mocked(fs.readFileSync).mockImplementation((path) => {
        const key = path.toString();
        if (!(key in storage)) throw new Error("No data");
        return storage[key];
      });

      // Write to different symbols
      const data1: DivergenceData[] = [{ ...sampleDivergenceData[0], symbol: "7203.T" }];
      const data2: DivergenceData[] = [{ ...sampleDivergenceData[0], symbol: "9984.T" }];

      setCachedDivergence("7203.T", data1);
      setCachedDivergence("9984.T", data2);

      // Read each symbol
      const result1 = getCachedDivergence("7203.T");
      const result2 = getCachedDivergence("9984.T");

      expect(result1).toEqual(data1);
      expect(result2).toEqual(data2);
    });
  });
});
