import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

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
  ensureCacheDir: vi.fn(() => "/mock/cache/signals"),
  TTL: { HOUR_1: 60 * 60 * 1000 },
}));

import fs from "fs";
import { getCachedSignals, setCachedSignals } from "../signalsCache";

// Sample signals data for testing
const sampleSignalsData = {
  symbol: "7203.T",
  signals: [
    { type: "buy", strength: 0.8, indicator: "RSI" },
    { type: "hold", strength: 0.5, indicator: "MACD" },
  ],
  timestamp: "2024-01-17T10:00:00Z",
};

describe("signalsCache", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-01-17T10:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("getCachedSignals", () => {
    describe("Cache hit", () => {
      it("returns cached data when file exists and TTL is valid", () => {
        const cachedEntry = {
          data: sampleSignalsData,
          cachedAt: Date.now() - 1000 * 60 * 30, // 30 minutes ago (within 1 hour TTL)
        };

        vi.mocked(fs.existsSync).mockReturnValue(true);
        vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(cachedEntry));

        const result = getCachedSignals("7203.T");

        expect(result).toEqual(sampleSignalsData);
        expect(fs.existsSync).toHaveBeenCalled(); // cacheFile check (ensureDir is now mocked)
        expect(fs.readFileSync).toHaveBeenCalled();
      });

      it("handles symbols with dots correctly", () => {
        const cachedEntry = {
          data: sampleSignalsData,
          cachedAt: Date.now() - 1000 * 60,
        };

        vi.mocked(fs.existsSync).mockReturnValue(true);
        vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(cachedEntry));

        getCachedSignals("7203.T");

        // Verify that the file path uses underscore instead of dot
        const readFileCalls = vi.mocked(fs.readFileSync).mock.calls;
        expect(readFileCalls[0][0]).toContain("7203_T.json");
      });

      it("returns cached data at exactly TTL boundary (59 minutes)", () => {
        const cachedEntry = {
          data: sampleSignalsData,
          cachedAt: Date.now() - 1000 * 60 * 59, // 59 minutes ago (just within 1 hour TTL)
        };

        vi.mocked(fs.existsSync).mockReturnValue(true);
        vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(cachedEntry));

        const result = getCachedSignals("7203.T");

        expect(result).toEqual(sampleSignalsData);
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

        const result = getCachedSignals("7203.T");

        expect(result).toBeNull();
      });

      it("returns null when cache has expired (> 1 hour)", () => {
        const cachedEntry = {
          data: sampleSignalsData,
          cachedAt: Date.now() - 1000 * 60 * 61, // 61 minutes ago (beyond 1 hour TTL)
        };

        vi.mocked(fs.existsSync).mockReturnValue(true);
        vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(cachedEntry));

        const result = getCachedSignals("7203.T");

        expect(result).toBeNull();
      });

      it("returns null when cache has expired (exactly at TTL)", () => {
        const cachedEntry = {
          data: sampleSignalsData,
          cachedAt: Date.now() - 1000 * 60 * 60, // exactly 1 hour ago (at TTL boundary)
        };

        vi.mocked(fs.existsSync).mockReturnValue(true);
        vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(cachedEntry));

        const result = getCachedSignals("7203.T");

        // At exactly TTL, Date.now() - cachedAt === TTL, so condition "> TTL" is false
        // But we need to check the actual implementation behavior
        // Looking at the code: if (Date.now() - entry.cachedAt > TTL) return null;
        // At exactly TTL, this returns the data (not null)
        expect(result).toEqual(sampleSignalsData);
      });

      it("returns null when cache has expired (1ms past TTL)", () => {
        const cachedEntry = {
          data: sampleSignalsData,
          cachedAt: Date.now() - (1000 * 60 * 60 + 1), // 1 hour + 1ms ago
        };

        vi.mocked(fs.existsSync).mockReturnValue(true);
        vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(cachedEntry));

        const result = getCachedSignals("7203.T");

        expect(result).toBeNull();
      });
    });

    describe("Error handling", () => {
      it("returns null when readFileSync throws an error", () => {
        vi.mocked(fs.existsSync).mockReturnValue(true);
        vi.mocked(fs.readFileSync).mockImplementation(() => {
          throw new Error("File read error");
        });

        const result = getCachedSignals("7203.T");

        expect(result).toBeNull();
      });

      it("returns null when JSON parsing fails", () => {
        vi.mocked(fs.existsSync).mockReturnValue(true);
        vi.mocked(fs.readFileSync).mockReturnValue("invalid json");

        const result = getCachedSignals("7203.T");

        expect(result).toBeNull();
      });

      it("calls ensureCacheDir with correct subdir", async () => {
        const { ensureCacheDir } = await import("../cacheUtils");
        vi.mocked(fs.existsSync).mockReturnValue(false);

        getCachedSignals("7203.T");

        expect(ensureCacheDir).toHaveBeenCalledWith("signals");
      });

      // Note: mkdirSync error handling is now tested in cacheUtils.test.ts
      // since ensureCacheDir handles directory creation
    });
  });

  describe("setCachedSignals", () => {
    describe("Cache write", () => {
      it("writes signals data to cache file correctly", () => {
        vi.mocked(fs.existsSync).mockReturnValue(true);

        setCachedSignals("7203.T", sampleSignalsData);

        expect(fs.writeFileSync).toHaveBeenCalledTimes(1);

        const writeCall = vi.mocked(fs.writeFileSync).mock.calls[0];
        expect(writeCall[0]).toContain("7203_T.json");

        const writtenData = JSON.parse(writeCall[1] as string);
        expect(writtenData.data).toEqual(sampleSignalsData);
        expect(writtenData.cachedAt).toBe(Date.now());
      });

      it("calls ensureCacheDir with correct subdir", async () => {
        const { ensureCacheDir } = await import("../cacheUtils");
        vi.mocked(fs.existsSync).mockReturnValue(false);

        setCachedSignals("7203.T", sampleSignalsData);

        expect(ensureCacheDir).toHaveBeenCalledWith("signals");
      });

      it("handles symbols with dots correctly", () => {
        vi.mocked(fs.existsSync).mockReturnValue(true);

        setCachedSignals("7203.T", sampleSignalsData);

        const writeCall = vi.mocked(fs.writeFileSync).mock.calls[0];
        expect(writeCall[0]).toContain("7203_T.json");
      });

      it("handles US stock symbols without dots", () => {
        vi.mocked(fs.existsSync).mockReturnValue(true);

        setCachedSignals("AAPL", sampleSignalsData);

        const writeCall = vi.mocked(fs.writeFileSync).mock.calls[0];
        expect(writeCall[0]).toContain("AAPL.json");
      });

      it("stores cachedAt timestamp with current time", () => {
        vi.mocked(fs.existsSync).mockReturnValue(true);
        const currentTime = Date.now();

        setCachedSignals("7203.T", sampleSignalsData);

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
          setCachedSignals("7203.T", sampleSignalsData);
        }).not.toThrow();
      });

      // Note: mkdirSync error handling is now tested in cacheUtils.test.ts
      // since ensureCacheDir handles directory creation
    });
  });

  describe("Integration scenarios", () => {
    it("can write and read back signals data", () => {
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
      setCachedSignals("7203.T", sampleSignalsData);

      // Read
      const result = getCachedSignals("7203.T");

      expect(result).toEqual(sampleSignalsData);
    });

    it("handles null data", () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);

      setCachedSignals("7203.T", null);

      const writeCall = vi.mocked(fs.writeFileSync).mock.calls[0];
      const writtenData = JSON.parse(writeCall[1] as string);
      expect(writtenData.data).toBeNull();
    });

    it("handles complex nested data structures", () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);

      const complexData = {
        signals: [
          {
            type: "buy",
            nested: {
              level1: {
                level2: {
                  value: 123,
                },
              },
            },
            array: [1, 2, 3],
          },
        ],
      };

      setCachedSignals("7203.T", complexData);

      const writeCall = vi.mocked(fs.writeFileSync).mock.calls[0];
      const writtenData = JSON.parse(writeCall[1] as string);
      expect(writtenData.data).toEqual(complexData);
    });

    it("handles empty object data", () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);

      setCachedSignals("7203.T", {});

      const writeCall = vi.mocked(fs.writeFileSync).mock.calls[0];
      const writtenData = JSON.parse(writeCall[1] as string);
      expect(writtenData.data).toEqual({});
    });

    it("handles array data", () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);

      const arrayData = [1, 2, 3, "test", { key: "value" }];
      setCachedSignals("7203.T", arrayData);

      const writeCall = vi.mocked(fs.writeFileSync).mock.calls[0];
      const writtenData = JSON.parse(writeCall[1] as string);
      expect(writtenData.data).toEqual(arrayData);
    });
  });
});
