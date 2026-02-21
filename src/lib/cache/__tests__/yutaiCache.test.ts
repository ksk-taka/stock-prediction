import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { YutaiInfo } from "@/types/yutai";

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
  ensureCacheDir: vi.fn(() => "/mock/cache/yutai"),
  TTL: { DAYS_180: 180 * 24 * 60 * 60 * 1000 },
}));

import fs from "fs";
import { getCachedYutai, setCachedYutai, getCachedYutaiBatch } from "../yutaiCache";

// Sample yutai data for testing
const sampleYutaiData: YutaiInfo = {
  hasYutai: true,
  content: "QUOカード1000円分",
  recordMonth: "3月、9月",
  minimumShares: "100株",
  recordDate: "2026/03/27",
  longTermBenefit: "あり",
  yutaiYield: "1.5%",
};

const sampleYutaiDataNoYutai: YutaiInfo = {
  hasYutai: false,
  content: null,
  recordMonth: null,
  minimumShares: null,
  recordDate: null,
  longTermBenefit: null,
  yutaiYield: null,
};

describe("yutaiCache", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-06-15T10:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("getCachedYutai", () => {
    describe("Cache hit", () => {
      it("returns cached data when file exists and TTL is valid", () => {
        const cachedEntry = {
          data: sampleYutaiData,
          cachedAt: Date.now() - 1000 * 60 * 60 * 24, // 1 day ago
        };

        vi.mocked(fs.existsSync).mockReturnValue(true);
        vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(cachedEntry));

        const result = getCachedYutai("7203.T");

        expect(result).toEqual(sampleYutaiData);
        expect(result?.hasYutai).toBe(true);
        expect(result?.content).toBe("QUOカード1000円分");
        expect(fs.existsSync).toHaveBeenCalled(); // cacheFile check (ensureDir is now mocked)
        expect(fs.readFileSync).toHaveBeenCalled();
      });

      it("returns cached data when cache is just under TTL (180 days)", () => {
        const ttlMs = 180 * 24 * 60 * 60 * 1000;
        const cachedEntry = {
          data: sampleYutaiData,
          cachedAt: Date.now() - ttlMs + 1000, // Just under 180 days
        };

        vi.mocked(fs.existsSync).mockReturnValue(true);
        vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(cachedEntry));

        const result = getCachedYutai("7203.T");

        expect(result).toEqual(sampleYutaiData);
      });

      it("handles symbols with dots correctly", () => {
        const cachedEntry = {
          data: sampleYutaiData,
          cachedAt: Date.now() - 1000 * 60,
        };

        vi.mocked(fs.existsSync).mockReturnValue(true);
        vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(cachedEntry));

        getCachedYutai("7203.T");

        // Verify that the file path uses underscore instead of dot
        const readFileCalls = vi.mocked(fs.readFileSync).mock.calls;
        expect(readFileCalls[0][0]).toContain("7203_T.json");
      });

      it("returns data for stocks without yutai", () => {
        const cachedEntry = {
          data: sampleYutaiDataNoYutai,
          cachedAt: Date.now() - 1000 * 60,
        };

        vi.mocked(fs.existsSync).mockReturnValue(true);
        vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(cachedEntry));

        const result = getCachedYutai("9999.T");

        expect(result?.hasYutai).toBe(false);
        expect(result?.content).toBeNull();
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

        const result = getCachedYutai("7203.T");

        expect(result).toBeNull();
      });

      it("returns null when cache has expired (> 180 days)", () => {
        const cachedEntry = {
          data: sampleYutaiData,
          cachedAt: Date.now() - 181 * 24 * 60 * 60 * 1000, // 181 days ago
        };

        vi.mocked(fs.existsSync).mockReturnValue(true);
        vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(cachedEntry));

        const result = getCachedYutai("7203.T");

        expect(result).toBeNull();
      });

      it("returns null when cache is exactly at expiration", () => {
        const ttlMs = 180 * 24 * 60 * 60 * 1000;
        const cachedEntry = {
          data: sampleYutaiData,
          cachedAt: Date.now() - ttlMs - 1, // Just over 180 days
        };

        vi.mocked(fs.existsSync).mockReturnValue(true);
        vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(cachedEntry));

        const result = getCachedYutai("7203.T");

        expect(result).toBeNull();
      });
    });

    describe("Error handling", () => {
      it("returns null when readFileSync throws an error", () => {
        vi.mocked(fs.existsSync).mockReturnValue(true);
        vi.mocked(fs.readFileSync).mockImplementation(() => {
          throw new Error("File read error");
        });

        const result = getCachedYutai("7203.T");

        expect(result).toBeNull();
      });

      it("returns null when JSON parsing fails", () => {
        vi.mocked(fs.existsSync).mockReturnValue(true);
        vi.mocked(fs.readFileSync).mockReturnValue("invalid json");

        const result = getCachedYutai("7203.T");

        expect(result).toBeNull();
      });

      it("calls ensureCacheDir with correct subdir", async () => {
        const { ensureCacheDir } = await import("../cacheUtils");
        vi.mocked(fs.existsSync).mockReturnValue(false);

        getCachedYutai("7203.T");

        expect(ensureCacheDir).toHaveBeenCalledWith("yutai");
      });
    });
  });

  describe("setCachedYutai", () => {
    describe("Cache write", () => {
      it("writes yutai data to cache file correctly", () => {
        vi.mocked(fs.existsSync).mockReturnValue(true);

        setCachedYutai("7203.T", sampleYutaiData);

        expect(fs.writeFileSync).toHaveBeenCalledTimes(1);

        const writeCall = vi.mocked(fs.writeFileSync).mock.calls[0];
        expect(writeCall[0]).toContain("7203_T.json");

        const writtenData = JSON.parse(writeCall[1] as string);
        expect(writtenData.data).toEqual(sampleYutaiData);
        expect(writtenData.cachedAt).toBe(Date.now());
      });

      it("calls ensureCacheDir with correct subdir", async () => {
        const { ensureCacheDir } = await import("../cacheUtils");
        vi.mocked(fs.existsSync).mockReturnValue(false);

        setCachedYutai("7203.T", sampleYutaiData);

        expect(ensureCacheDir).toHaveBeenCalledWith("yutai");
      });

      it("handles symbols with multiple dots", () => {
        vi.mocked(fs.existsSync).mockReturnValue(true);

        setCachedYutai("8306.T", sampleYutaiData);

        const writeCall = vi.mocked(fs.writeFileSync).mock.calls[0];
        expect(writeCall[0]).toContain("8306_T.json");
      });

      it("stores cachedAt timestamp with current time", () => {
        vi.mocked(fs.existsSync).mockReturnValue(true);
        const currentTime = Date.now();

        setCachedYutai("7203.T", sampleYutaiData);

        const writeCall = vi.mocked(fs.writeFileSync).mock.calls[0];
        const writtenData = JSON.parse(writeCall[1] as string);
        expect(writtenData.cachedAt).toBe(currentTime);
      });

      it("stores data for stocks without yutai", () => {
        vi.mocked(fs.existsSync).mockReturnValue(true);

        setCachedYutai("9999.T", sampleYutaiDataNoYutai);

        const writeCall = vi.mocked(fs.writeFileSync).mock.calls[0];
        const writtenData = JSON.parse(writeCall[1] as string);
        expect(writtenData.data.hasYutai).toBe(false);
        expect(writtenData.data.content).toBeNull();
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
          setCachedYutai("7203.T", sampleYutaiData);
        }).not.toThrow();
      });

      // Note: mkdirSync error handling is now tested in cacheUtils.test.ts
      // since ensureCacheDir handles directory creation
    });
  });

  describe("getCachedYutaiBatch", () => {
    it("returns cached data for all symbols with cache hits", () => {
      const cachedEntry = {
        data: sampleYutaiData,
        cachedAt: Date.now() - 1000 * 60,
      };

      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(cachedEntry));

      const result = getCachedYutaiBatch(["7203.T", "9984.T", "6758.T"]);

      expect(result.size).toBe(3);
      expect(result.get("7203.T")).toEqual(sampleYutaiData);
      expect(result.get("9984.T")).toEqual(sampleYutaiData);
      expect(result.get("6758.T")).toEqual(sampleYutaiData);
    });

    it("returns empty map when all symbols have cache miss", () => {
      vi.mocked(fs.existsSync).mockImplementation((path) => {
        if (typeof path === "string" && path.endsWith(".json")) {
          return false;
        }
        return true;
      });

      const result = getCachedYutaiBatch(["7203.T", "9984.T"]);

      expect(result.size).toBe(0);
    });

    it("returns partial results for mixed cache hits/misses", () => {
      const cachedEntry = {
        data: sampleYutaiData,
        cachedAt: Date.now() - 1000 * 60,
      };

      let callCount = 0;
      vi.mocked(fs.existsSync).mockImplementation((path) => {
        if (typeof path === "string" && path.endsWith(".json")) {
          callCount++;
          // Return true for first file, false for second
          return callCount === 1;
        }
        return true;
      });
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(cachedEntry));

      const result = getCachedYutaiBatch(["7203.T", "9984.T"]);

      expect(result.size).toBe(1);
      expect(result.has("7203.T")).toBe(true);
    });

    it("returns empty map for empty input array", () => {
      const result = getCachedYutaiBatch([]);

      expect(result.size).toBe(0);
    });

    it("handles expired cache entries correctly", () => {
      const expiredEntry = {
        data: sampleYutaiData,
        cachedAt: Date.now() - 181 * 24 * 60 * 60 * 1000, // 181 days ago
      };

      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(expiredEntry));

      const result = getCachedYutaiBatch(["7203.T", "9984.T"]);

      expect(result.size).toBe(0);
    });
  });

  describe("Integration scenarios", () => {
    it("can write and read back yutai data", () => {
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
      setCachedYutai("7203.T", sampleYutaiData);

      // Read
      const result = getCachedYutai("7203.T");

      expect(result).toEqual(sampleYutaiData);
      expect(result?.content).toBe("QUOカード1000円分");
    });

    it("handles yutai data with all fields populated", () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);

      const fullYutaiData: YutaiInfo = {
        hasYutai: true,
        content: "自社商品詰め合わせ3000円相当",
        recordMonth: "6月、12月",
        minimumShares: "500株",
        recordDate: "2026/06/27",
        longTermBenefit: "あり",
        yutaiYield: "2.5%",
      };

      setCachedYutai("2914.T", fullYutaiData);

      const writeCall = vi.mocked(fs.writeFileSync).mock.calls[0];
      const writtenData = JSON.parse(writeCall[1] as string);
      expect(writtenData.data).toEqual(fullYutaiData);
    });

    it("handles yutai data with null fields", () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);

      const partialYutaiData: YutaiInfo = {
        hasYutai: true,
        content: "割引券",
        recordMonth: "3月",
        minimumShares: null,
        recordDate: null,
        longTermBenefit: null,
        yutaiYield: null,
      };

      setCachedYutai("8267.T", partialYutaiData);

      const writeCall = vi.mocked(fs.writeFileSync).mock.calls[0];
      const writtenData = JSON.parse(writeCall[1] as string);
      expect(writtenData.data.minimumShares).toBeNull();
      expect(writtenData.data.recordDate).toBeNull();
    });

    it("handles Unicode content in yutai data", () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);

      const unicodeYutaiData: YutaiInfo = {
        hasYutai: true,
        content: "自社製品詰め合わせセット（カレー、レトルト食品等）",
        recordMonth: "3月末日",
        minimumShares: "1,000株以上",
        recordDate: "2026/03/27",
        longTermBenefit: "3年以上保有で2倍",
        yutaiYield: "0.8%",
      };

      setCachedYutai("2801.T", unicodeYutaiData);

      const writeCall = vi.mocked(fs.writeFileSync).mock.calls[0];
      const writtenData = JSON.parse(writeCall[1] as string);
      expect(writtenData.data.content).toBe("自社製品詰め合わせセット（カレー、レトルト食品等）");
    });
  });
});
