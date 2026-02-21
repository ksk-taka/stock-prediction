import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { PriceData } from "@/types";
import type { JQuantsMasterItem } from "@/types/jquants";

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
  ensureCacheDir: vi.fn((subdir: string) => `/mock/cache/${subdir}`),
  TTL: { DAYS_7: 7 * 24 * 60 * 60 * 1000, DAYS_30: 30 * 24 * 60 * 60 * 1000 },
}));

import fs from "fs";
import {
  getCachedMaster,
  setCachedMaster,
  getCachedBars,
  setCachedBars,
} from "../jquantsCache";

// Sample master data for testing
const sampleMasterData: JQuantsMasterItem[] = [
  {
    Date: "2024-01-15",
    Code: "72030",
    CoName: "トヨタ自動車",
    CoNameEn: "Toyota Motor Corporation",
    S17: "2",
    S17Nm: "自動車・輸送機",
    S33: "15",
    S33Nm: "輸送用機器",
    ScaleCat: "TOPIX Core30",
    Mkt: "1",
    MktNm: "プライム",
  },
  {
    Date: "2024-01-15",
    Code: "99840",
    CoName: "ソフトバンクグループ",
    CoNameEn: "SoftBank Group Corp.",
    S17: "11",
    S17Nm: "情報通信・サービスその他",
    S33: "26",
    S33Nm: "情報・通信業",
    ScaleCat: "TOPIX Large70",
    Mkt: "1",
    MktNm: "プライム",
  },
];

// Sample price data for testing
const samplePriceData: PriceData[] = [
  {
    date: "2024-01-15",
    open: 2500,
    high: 2550,
    low: 2480,
    close: 2530,
    volume: 5000000,
  },
  {
    date: "2024-01-16",
    open: 2530,
    high: 2600,
    low: 2520,
    close: 2580,
    volume: 6000000,
  },
];

describe("jquantsCache", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-01-17T10:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // ============================================================
  // Master Cache Tests
  // ============================================================
  describe("Master Cache", () => {
    describe("getCachedMaster", () => {
      describe("Cache hit", () => {
        it("returns cached data when file exists and TTL is valid", () => {
          const cachedEntry = {
            data: sampleMasterData,
            cachedAt: Date.now() - 1000 * 60 * 60 * 24, // 1 day ago (within 7 day TTL)
          };

          vi.mocked(fs.existsSync).mockReturnValue(true);
          vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(cachedEntry));

          const result = getCachedMaster("all");

          expect(result).toEqual(sampleMasterData);
          expect(fs.existsSync).toHaveBeenCalled(); // cacheFile check (ensureDir is now mocked)
          expect(fs.readFileSync).toHaveBeenCalled();
        });

        it("returns cached data when cache is 6 days old (within TTL)", () => {
          const cachedEntry = {
            data: sampleMasterData,
            cachedAt: Date.now() - 6 * 24 * 60 * 60 * 1000, // 6 days ago
          };

          vi.mocked(fs.existsSync).mockReturnValue(true);
          vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(cachedEntry));

          const result = getCachedMaster("all");

          expect(result).toEqual(sampleMasterData);
        });

        it("uses correct cache file path for different keys", () => {
          const cachedEntry = {
            data: sampleMasterData,
            cachedAt: Date.now() - 1000 * 60 * 60,
          };

          vi.mocked(fs.existsSync).mockReturnValue(true);
          vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(cachedEntry));

          getCachedMaster("prime");

          const readFileCalls = vi.mocked(fs.readFileSync).mock.calls;
          expect(readFileCalls[0][0]).toContain("prime.json");
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

          const result = getCachedMaster("all");

          expect(result).toBeNull();
        });

        it("returns null when cache has expired (> 7 days)", () => {
          const cachedEntry = {
            data: sampleMasterData,
            cachedAt: Date.now() - 8 * 24 * 60 * 60 * 1000, // 8 days ago
          };

          vi.mocked(fs.existsSync).mockReturnValue(true);
          vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(cachedEntry));

          const result = getCachedMaster("all");

          expect(result).toBeNull();
        });

        it("returns null when cache is exactly at TTL boundary (7 days + 1ms)", () => {
          const MASTER_TTL = 7 * 24 * 60 * 60 * 1000;
          const cachedEntry = {
            data: sampleMasterData,
            cachedAt: Date.now() - MASTER_TTL - 1, // Just past TTL
          };

          vi.mocked(fs.existsSync).mockReturnValue(true);
          vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(cachedEntry));

          const result = getCachedMaster("all");

          expect(result).toBeNull();
        });
      });

      describe("Error handling", () => {
        it("returns null when readFileSync throws an error", () => {
          vi.mocked(fs.existsSync).mockReturnValue(true);
          vi.mocked(fs.readFileSync).mockImplementation(() => {
            throw new Error("File read error");
          });

          const result = getCachedMaster("all");

          expect(result).toBeNull();
        });

        it("returns null when JSON parsing fails", () => {
          vi.mocked(fs.existsSync).mockReturnValue(true);
          vi.mocked(fs.readFileSync).mockReturnValue("invalid json {{{");

          const result = getCachedMaster("all");

          expect(result).toBeNull();
        });

        it("calls ensureCacheDir with correct subdir", async () => {
          const { ensureCacheDir } = await import("../cacheUtils");
          vi.mocked(fs.existsSync).mockReturnValue(false);

          getCachedMaster("all");

          expect(ensureCacheDir).toHaveBeenCalledWith("jquants-master");
        });
      });
    });

    describe("setCachedMaster", () => {
      describe("Cache write", () => {
        it("writes master data to cache file correctly", () => {
          vi.mocked(fs.existsSync).mockReturnValue(true);

          setCachedMaster("all", sampleMasterData);

          expect(fs.writeFileSync).toHaveBeenCalledTimes(1);

          const writeCall = vi.mocked(fs.writeFileSync).mock.calls[0];
          expect(writeCall[0]).toContain("all.json");

          const writtenData = JSON.parse(writeCall[1] as string);
          expect(writtenData.data).toEqual(sampleMasterData);
          expect(writtenData.cachedAt).toBe(Date.now());
        });

        it("calls ensureCacheDir with correct subdir", async () => {
          const { ensureCacheDir } = await import("../cacheUtils");
          vi.mocked(fs.existsSync).mockReturnValue(false);

          setCachedMaster("all", sampleMasterData);

          expect(ensureCacheDir).toHaveBeenCalledWith("jquants-master");
        });

        it("handles different key values", () => {
          vi.mocked(fs.existsSync).mockReturnValue(true);

          setCachedMaster("growth", sampleMasterData);

          const writeCall = vi.mocked(fs.writeFileSync).mock.calls[0];
          expect(writeCall[0]).toContain("growth.json");
        });

        it("stores cachedAt timestamp with current time", () => {
          vi.mocked(fs.existsSync).mockReturnValue(true);
          const currentTime = Date.now();

          setCachedMaster("all", sampleMasterData);

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
            setCachedMaster("all", sampleMasterData);
          }).not.toThrow();
        });

        // Note: mkdirSync error handling is now tested in cacheUtils.test.ts
        // since ensureCacheDir handles directory creation
      });
    });
  });

  // ============================================================
  // Bars Cache Tests
  // ============================================================
  describe("Bars Cache", () => {
    describe("getCachedBars", () => {
      describe("Cache hit", () => {
        it("returns cached data when file exists and TTL is valid", () => {
          const cachedEntry = {
            data: samplePriceData,
            cachedAt: Date.now() - 1000 * 60 * 60 * 24, // 1 day ago (within 30 day TTL)
          };

          vi.mocked(fs.existsSync).mockReturnValue(true);
          vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(cachedEntry));

          const result = getCachedBars("7203.T");

          expect(result).toEqual(samplePriceData);
          expect(fs.existsSync).toHaveBeenCalled(); // cacheFile check (ensureDir is now mocked)
          expect(fs.readFileSync).toHaveBeenCalled();
        });

        it("returns cached data when cache is 29 days old (within TTL)", () => {
          const cachedEntry = {
            data: samplePriceData,
            cachedAt: Date.now() - 29 * 24 * 60 * 60 * 1000, // 29 days ago
          };

          vi.mocked(fs.existsSync).mockReturnValue(true);
          vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(cachedEntry));

          const result = getCachedBars("7203.T");

          expect(result).toEqual(samplePriceData);
        });

        it("handles symbols with dots correctly (converts to underscore)", () => {
          const cachedEntry = {
            data: samplePriceData,
            cachedAt: Date.now() - 1000 * 60,
          };

          vi.mocked(fs.existsSync).mockReturnValue(true);
          vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(cachedEntry));

          getCachedBars("7203.T");

          // Verify that the file path uses underscore instead of dot
          const readFileCalls = vi.mocked(fs.readFileSync).mock.calls;
          expect(readFileCalls[0][0]).toContain("7203_T.json");
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

          const result = getCachedBars("7203.T");

          expect(result).toBeNull();
        });

        it("returns null when cache has expired (> 30 days)", () => {
          const cachedEntry = {
            data: samplePriceData,
            cachedAt: Date.now() - 31 * 24 * 60 * 60 * 1000, // 31 days ago
          };

          vi.mocked(fs.existsSync).mockReturnValue(true);
          vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(cachedEntry));

          const result = getCachedBars("7203.T");

          expect(result).toBeNull();
        });

        it("returns null when cache is exactly at TTL boundary (30 days + 1ms)", () => {
          const BARS_TTL = 30 * 24 * 60 * 60 * 1000;
          const cachedEntry = {
            data: samplePriceData,
            cachedAt: Date.now() - BARS_TTL - 1, // Just past TTL
          };

          vi.mocked(fs.existsSync).mockReturnValue(true);
          vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(cachedEntry));

          const result = getCachedBars("7203.T");

          expect(result).toBeNull();
        });
      });

      describe("Error handling", () => {
        it("returns null when readFileSync throws an error", () => {
          vi.mocked(fs.existsSync).mockReturnValue(true);
          vi.mocked(fs.readFileSync).mockImplementation(() => {
            throw new Error("File read error");
          });

          const result = getCachedBars("7203.T");

          expect(result).toBeNull();
        });

        it("returns null when JSON parsing fails", () => {
          vi.mocked(fs.existsSync).mockReturnValue(true);
          vi.mocked(fs.readFileSync).mockReturnValue("invalid json {{{");

          const result = getCachedBars("7203.T");

          expect(result).toBeNull();
        });

        it("calls ensureCacheDir with correct subdir", async () => {
          const { ensureCacheDir } = await import("../cacheUtils");
          vi.mocked(fs.existsSync).mockReturnValue(false);

          getCachedBars("7203.T");

          expect(ensureCacheDir).toHaveBeenCalledWith("jquants-bars");
        });
      });
    });

    describe("setCachedBars", () => {
      describe("Cache write", () => {
        it("writes price data to cache file correctly", () => {
          vi.mocked(fs.existsSync).mockReturnValue(true);

          setCachedBars("7203.T", samplePriceData);

          expect(fs.writeFileSync).toHaveBeenCalledTimes(1);

          const writeCall = vi.mocked(fs.writeFileSync).mock.calls[0];
          expect(writeCall[0]).toContain("7203_T.json");

          const writtenData = JSON.parse(writeCall[1] as string);
          expect(writtenData.data).toEqual(samplePriceData);
          expect(writtenData.cachedAt).toBe(Date.now());
        });

        it("calls ensureCacheDir with correct subdir", async () => {
          const { ensureCacheDir } = await import("../cacheUtils");
          vi.mocked(fs.existsSync).mockReturnValue(false);

          setCachedBars("7203.T", samplePriceData);

          expect(ensureCacheDir).toHaveBeenCalledWith("jquants-bars");
        });

        it("handles symbols with dots correctly (converts to underscore)", () => {
          vi.mocked(fs.existsSync).mockReturnValue(true);

          setCachedBars("9984.T", samplePriceData);

          const writeCall = vi.mocked(fs.writeFileSync).mock.calls[0];
          expect(writeCall[0]).toContain("9984_T.json");
        });

        it("stores cachedAt timestamp with current time", () => {
          vi.mocked(fs.existsSync).mockReturnValue(true);
          const currentTime = Date.now();

          setCachedBars("7203.T", samplePriceData);

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
            setCachedBars("7203.T", samplePriceData);
          }).not.toThrow();
        });

        // Note: mkdirSync error handling is now tested in cacheUtils.test.ts
        // since ensureCacheDir handles directory creation
      });
    });
  });

  // ============================================================
  // Integration Scenarios
  // ============================================================
  describe("Integration scenarios", () => {
    describe("Master cache", () => {
      it("can write and read back master data", () => {
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
        setCachedMaster("all", sampleMasterData);

        // Read
        const result = getCachedMaster("all");

        expect(result).toEqual(sampleMasterData);
      });

      it("handles empty master data array", () => {
        vi.mocked(fs.existsSync).mockReturnValue(true);

        const emptyData: JQuantsMasterItem[] = [];
        setCachedMaster("all", emptyData);

        const writeCall = vi.mocked(fs.writeFileSync).mock.calls[0];
        const writtenData = JSON.parse(writeCall[1] as string);
        expect(writtenData.data).toEqual([]);
      });

      it("handles large master data arrays", () => {
        vi.mocked(fs.existsSync).mockReturnValue(true);

        const largeMasterData: JQuantsMasterItem[] = Array.from(
          { length: 4000 },
          (_, i) => ({
            Date: "2024-01-15",
            Code: String(10000 + i),
            CoName: `会社${i}`,
            CoNameEn: `Company ${i}`,
            S17: "1",
            S17Nm: "食品",
            S33: "1",
            S33Nm: "水産・農林業",
            ScaleCat: "TOPIX Small",
            Mkt: "2",
            MktNm: "スタンダード",
          })
        );

        setCachedMaster("all", largeMasterData);

        const writeCall = vi.mocked(fs.writeFileSync).mock.calls[0];
        const writtenData = JSON.parse(writeCall[1] as string);
        expect(writtenData.data).toHaveLength(4000);
      });
    });

    describe("Bars cache", () => {
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

        // Write
        setCachedBars("7203.T", samplePriceData);

        // Read
        const result = getCachedBars("7203.T");

        expect(result).toEqual(samplePriceData);
      });

      it("handles empty price data array", () => {
        vi.mocked(fs.existsSync).mockReturnValue(true);

        const emptyData: PriceData[] = [];
        setCachedBars("7203.T", emptyData);

        const writeCall = vi.mocked(fs.writeFileSync).mock.calls[0];
        const writtenData = JSON.parse(writeCall[1] as string);
        expect(writtenData.data).toEqual([]);
      });

      it("handles large price data arrays (5 years of daily data)", () => {
        vi.mocked(fs.existsSync).mockReturnValue(true);

        const largePriceData: PriceData[] = Array.from(
          { length: 1250 },
          (_, i) => ({
            date: `2024-01-${String((i % 28) + 1).padStart(2, "0")}`,
            open: 2500 + i,
            high: 2550 + i,
            low: 2480 + i,
            close: 2530 + i,
            volume: 5000000 + i * 1000,
          })
        );

        setCachedBars("7203.T", largePriceData);

        const writeCall = vi.mocked(fs.writeFileSync).mock.calls[0];
        const writtenData = JSON.parse(writeCall[1] as string);
        expect(writtenData.data).toHaveLength(1250);
      });
    });

    describe("TTL boundary tests", () => {
      it("master cache is valid at exactly 7 days minus 1ms", () => {
        const MASTER_TTL = 7 * 24 * 60 * 60 * 1000;
        const cachedEntry = {
          data: sampleMasterData,
          cachedAt: Date.now() - MASTER_TTL + 1, // Just within TTL
        };

        vi.mocked(fs.existsSync).mockReturnValue(true);
        vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(cachedEntry));

        const result = getCachedMaster("all");

        expect(result).toEqual(sampleMasterData);
      });

      it("bars cache is valid at exactly 30 days minus 1ms", () => {
        const BARS_TTL = 30 * 24 * 60 * 60 * 1000;
        const cachedEntry = {
          data: samplePriceData,
          cachedAt: Date.now() - BARS_TTL + 1, // Just within TTL
        };

        vi.mocked(fs.existsSync).mockReturnValue(true);
        vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(cachedEntry));

        const result = getCachedBars("7203.T");

        expect(result).toEqual(samplePriceData);
      });
    });
  });
});
