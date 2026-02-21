import { describe, it, expect, vi, beforeEach } from "vitest";

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

// Mock cacheDir module
vi.mock("../cacheDir", () => ({
  getCacheBaseDir: vi.fn(() => "/mock/cache"),
}));

import fs from "fs";
import {
  ensureCacheDir,
  getCacheFilePath,
  readCache,
  writeCache,
  invalidateCache,
  readCacheBatch,
  TTL,
  _resetCacheState,
} from "../cacheUtils";

describe("cacheUtils", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-01-15T10:00:00Z"));
    _resetCacheState(); // Reset cached directory state between tests
  });

  describe("ensureCacheDir", () => {
    it("creates directory if it does not exist", () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);

      const result = ensureCacheDir("prices");

      expect(result).toContain("prices");
      expect(fs.mkdirSync).toHaveBeenCalledWith(expect.stringContaining("prices"), { recursive: true });
    });

    it("does not create directory if it already exists", () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);

      const result = ensureCacheDir("stats");

      expect(result).toContain("stats");
      expect(fs.mkdirSync).not.toHaveBeenCalled();
    });

    it("caches directory creation (only checks once per subdir)", () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);

      // First call - should check and create
      ensureCacheDir("news");
      expect(fs.existsSync).toHaveBeenCalledTimes(1);
      expect(fs.mkdirSync).toHaveBeenCalledTimes(1);

      // Second call - should use cached result
      ensureCacheDir("news");
      expect(fs.existsSync).toHaveBeenCalledTimes(1); // Still 1
      expect(fs.mkdirSync).toHaveBeenCalledTimes(1); // Still 1
    });
  });

  describe("getCacheFilePath", () => {
    it("generates correct path with default suffix", () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);

      const result = getCacheFilePath("prices", "7203.T");

      expect(result).toContain("prices");
      expect(result).toContain("7203_T.json");
    });

    it("generates correct path with custom suffix", () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);

      const result = getCacheFilePath("prices", "7203.T", "_daily");

      expect(result).toContain("prices");
      expect(result).toContain("7203_T_daily.json");
    });

    it("replaces dots in key with underscores", () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);

      const result = getCacheFilePath("stats", "BRK.A.US");

      expect(result).toContain("stats");
      expect(result).toContain("BRK_A_US.json");
    });
  });

  describe("readCache", () => {
    it("returns cached data when valid", () => {
      const cachedAt = Date.now() - 1000; // 1 second ago
      const cacheEntry = {
        data: { price: 1000, volume: 5000 },
        cachedAt,
      };

      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(cacheEntry));

      const result = readCache<{ price: number; volume: number }>("prices", "7203.T");

      expect(result).not.toBeNull();
      expect(result!.data.price).toBe(1000);
      expect(result!.cachedAt).toBe(cachedAt);
    });

    it("returns null when file does not exist", () => {
      vi.mocked(fs.existsSync).mockImplementation((p) => {
        if (String(p).includes("7203")) return false;
        return true;
      });

      const result = readCache("prices", "7203.T");

      expect(result).toBeNull();
    });

    it("returns null when cache is expired (TTL check)", () => {
      const cachedAt = Date.now() - TTL.HOURS_24 - 1000; // 24h + 1s ago
      const cacheEntry = {
        data: { value: 100 },
        cachedAt,
      };

      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(cacheEntry));

      const result = readCache("stats", "7203.T", "", TTL.HOURS_24);

      expect(result).toBeNull();
    });

    it("returns data when within TTL", () => {
      const cachedAt = Date.now() - TTL.HOURS_24 + 1000; // 24h - 1s ago
      const cacheEntry = {
        data: { value: 100 },
        cachedAt,
      };

      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(cacheEntry));

      const result = readCache("stats", "7203.T", "", TTL.HOURS_24);

      expect(result).not.toBeNull();
      expect(result!.data).toEqual({ value: 100 });
    });

    it("returns null on JSON parse error", () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue("invalid json");

      const result = readCache("prices", "7203.T");

      expect(result).toBeNull();
    });

    it("returns null on read error", () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockImplementation(() => {
        throw new Error("EACCES");
      });

      const result = readCache("prices", "7203.T");

      expect(result).toBeNull();
    });
  });

  describe("writeCache", () => {
    it("writes data to cache file", () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);

      const data = { price: 1500, name: "Toyota" };
      writeCache("prices", "7203.T", data);

      expect(fs.writeFileSync).toHaveBeenCalledWith(
        expect.stringContaining("7203_T.json"),
        expect.any(String),
        "utf-8"
      );

      const written = JSON.parse(vi.mocked(fs.writeFileSync).mock.calls[0][1] as string);
      expect(written.data).toEqual(data);
      expect(written.cachedAt).toBe(Date.now());
    });

    it("writes pretty JSON when requested", () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);

      writeCache("stats", "7203.T", { value: 1 }, "", true);

      const written = vi.mocked(fs.writeFileSync).mock.calls[0][1] as string;
      expect(written).toContain("\n"); // Pretty printed
    });

    it("silently ignores write errors", () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.writeFileSync).mockImplementation(() => {
        throw new Error("ENOSPC");
      });

      // Should not throw
      expect(() => writeCache("prices", "7203.T", { test: 1 })).not.toThrow();
    });
  });

  describe("invalidateCache", () => {
    it("returns true when file is deleted", () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);

      const result = invalidateCache("prices", "7203.T");

      expect(result).toBe(true);
      expect(fs.unlinkSync).toHaveBeenCalled();
    });

    it("returns false when file does not exist", () => {
      vi.mocked(fs.existsSync).mockImplementation((p) => {
        if (String(p).includes("7203")) return false;
        return true;
      });

      const result = invalidateCache("prices", "7203.T");

      expect(result).toBe(false);
      expect(fs.unlinkSync).not.toHaveBeenCalled();
    });

    it("returns false on error", () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.unlinkSync).mockImplementation(() => {
        throw new Error("EACCES");
      });

      const result = invalidateCache("prices", "7203.T");

      expect(result).toBe(false);
    });
  });

  describe("readCacheBatch", () => {
    it("returns map of cached data for multiple keys", () => {
      const cachedAt = Date.now() - 1000;

      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockImplementation((p) => {
        const path = String(p);
        if (path.includes("7203")) {
          return JSON.stringify({ data: { price: 1000 }, cachedAt });
        }
        if (path.includes("6758")) {
          return JSON.stringify({ data: { price: 2000 }, cachedAt });
        }
        throw new Error("Not found");
      });

      const result = readCacheBatch<{ price: number }>("prices", ["7203.T", "6758.T"]);

      expect(result.size).toBe(2);
      expect(result.get("7203.T")?.price).toBe(1000);
      expect(result.get("6758.T")?.price).toBe(2000);
    });

    it("skips keys with no cache", () => {
      const cachedAt = Date.now() - 1000;

      vi.mocked(fs.existsSync).mockImplementation((p) => {
        return String(p).includes("7203");
      });
      vi.mocked(fs.readFileSync).mockReturnValue(
        JSON.stringify({ data: { price: 1000 }, cachedAt })
      );

      const result = readCacheBatch<{ price: number }>("prices", ["7203.T", "9999.T"]);

      expect(result.size).toBe(1);
      expect(result.has("7203.T")).toBe(true);
      expect(result.has("9999.T")).toBe(false);
    });

    it("returns empty map for empty input", () => {
      const result = readCacheBatch("prices", []);

      expect(result.size).toBe(0);
    });
  });

  describe("TTL constants", () => {
    it("has correct values", () => {
      expect(TTL.MINUTES_5).toBe(5 * 60 * 1000);
      expect(TTL.HOUR_1).toBe(60 * 60 * 1000);
      expect(TTL.HOURS_6).toBe(6 * 60 * 60 * 1000);
      expect(TTL.HOURS_12).toBe(12 * 60 * 60 * 1000);
      expect(TTL.HOURS_24).toBe(24 * 60 * 60 * 1000);
      expect(TTL.DAYS_7).toBe(7 * 24 * 60 * 60 * 1000);
      expect(TTL.DAYS_30).toBe(30 * 24 * 60 * 60 * 1000);
      expect(TTL.DAYS_90).toBe(90 * 24 * 60 * 60 * 1000);
      expect(TTL.DAYS_180).toBe(180 * 24 * 60 * 60 * 1000);
    });
  });
});
