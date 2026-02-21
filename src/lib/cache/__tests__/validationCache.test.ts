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
  ensureCacheDir: vi.fn(() => "/mock/cache/validation"),
  TTL: { HOURS_24: 24 * 60 * 60 * 1000 },
}));

import fs from "fs";
import {
  getCachedValidation,
  setCachedValidation,
  invalidateValidationCache,
  type ValidationResult,
} from "../validationCache";

// Helper to create mock ValidationResult
function createMockValidationResult(overrides?: Partial<ValidationResult>): ValidationResult {
  return {
    isValid: true,
    errors: [],
    warnings: [],
    validatedAt: "2024-01-15T10:00:00Z",
    ...overrides,
  };
}

describe("validationCache", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("getCachedValidation", () => {
    describe("returns cached data when cache exists and is valid", () => {
      it("returns validation result when cache file exists and is not expired", () => {
        const mockResult = createMockValidationResult();
        const cachedAt = Date.now() - 1000; // 1 second ago

        const cacheEntry = {
          result: mockResult,
          cachedAt,
        };

        vi.mocked(fs.existsSync).mockReturnValue(true);
        vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(cacheEntry));

        const result = getCachedValidation("test-key");

        expect(result).not.toBeNull();
        expect(result).toEqual(mockResult);
      });

      it("returns validation result with errors and warnings", () => {
        const mockResult = createMockValidationResult({
          isValid: false,
          errors: ["Error 1", "Error 2"],
          warnings: ["Warning 1"],
        });
        const cachedAt = Date.now() - 1000;

        const cacheEntry = {
          result: mockResult,
          cachedAt,
        };

        vi.mocked(fs.existsSync).mockReturnValue(true);
        vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(cacheEntry));

        const result = getCachedValidation("test-key");

        expect(result).not.toBeNull();
        expect(result?.isValid).toBe(false);
        expect(result?.errors).toEqual(["Error 1", "Error 2"]);
        expect(result?.warnings).toEqual(["Warning 1"]);
      });

      it("calls ensureCacheDir with correct subdir", async () => {
        const { ensureCacheDir } = await import("../cacheUtils");
        vi.mocked(fs.existsSync).mockReturnValue(false);

        getCachedValidation("test-key");

        expect(ensureCacheDir).toHaveBeenCalledWith("validation");
      });

      it("handles key with special characters correctly (replaces with _)", () => {
        vi.mocked(fs.existsSync).mockReturnValue(false);

        getCachedValidation("7203.T");

        expect(fs.existsSync).toHaveBeenCalledWith(
          expect.stringContaining("7203_T.json")
        );
      });

      it("handles key with multiple special characters", () => {
        vi.mocked(fs.existsSync).mockReturnValue(false);

        getCachedValidation("key/with:special*chars");

        expect(fs.existsSync).toHaveBeenCalledWith(
          expect.stringContaining("key_with_special_chars.json")
        );
      });
    });

    describe("returns null when cache is expired", () => {
      it("returns null when cache is older than 24 hours", () => {
        const mockResult = createMockValidationResult();
        // Cache from 25 hours ago (expired)
        const cachedAt = Date.now() - 25 * 60 * 60 * 1000;

        const cacheEntry = {
          result: mockResult,
          cachedAt,
        };

        vi.mocked(fs.existsSync).mockReturnValue(true);
        vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(cacheEntry));

        const result = getCachedValidation("test-key");

        expect(result).toBeNull();
      });

      it("returns data when cache is exactly at TTL boundary", () => {
        const mockResult = createMockValidationResult();
        const now = Date.now();
        vi.useFakeTimers();
        vi.setSystemTime(now);

        // Cache from exactly 24 hours ago (at boundary)
        const cachedAt = now - 24 * 60 * 60 * 1000;

        const cacheEntry = {
          result: mockResult,
          cachedAt,
        };

        vi.mocked(fs.existsSync).mockReturnValue(true);
        vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(cacheEntry));

        const result = getCachedValidation("test-key");

        // At exactly TTL, Date.now() - cachedAt === TTL, which is NOT > TTL
        expect(result).not.toBeNull();
      });

      it("returns null when cache is 1ms past TTL", () => {
        const mockResult = createMockValidationResult();
        const now = Date.now();
        vi.useFakeTimers();
        vi.setSystemTime(now);

        // Cache from 24 hours + 1ms ago (just expired)
        const cachedAt = now - (24 * 60 * 60 * 1000 + 1);

        const cacheEntry = {
          result: mockResult,
          cachedAt,
        };

        vi.mocked(fs.existsSync).mockReturnValue(true);
        vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(cacheEntry));

        const result = getCachedValidation("test-key");

        expect(result).toBeNull();
      });

      it("returns null when cache is 1 hour past TTL", () => {
        const mockResult = createMockValidationResult();
        const now = Date.now();
        vi.useFakeTimers();
        vi.setSystemTime(now);

        // Cache from 25 hours ago
        const cachedAt = now - 25 * 60 * 60 * 1000;

        const cacheEntry = {
          result: mockResult,
          cachedAt,
        };

        vi.mocked(fs.existsSync).mockReturnValue(true);
        vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(cacheEntry));

        const result = getCachedValidation("test-key");

        expect(result).toBeNull();
      });
    });

    describe("returns null when cache file does not exist", () => {
      it("returns null when file does not exist", () => {
        vi.mocked(fs.existsSync)
          .mockReturnValueOnce(true) // directory exists
          .mockReturnValueOnce(false); // file does not exist

        const result = getCachedValidation("test-key");

        expect(result).toBeNull();
      });
    });

    describe("error handling", () => {
      it("returns null when readFileSync throws an error", () => {
        vi.mocked(fs.existsSync).mockReturnValue(true);
        vi.mocked(fs.readFileSync).mockImplementation(() => {
          throw new Error("EACCES: permission denied");
        });

        const result = getCachedValidation("test-key");

        expect(result).toBeNull();
      });

      it("returns null when JSON.parse fails (corrupted cache)", () => {
        vi.mocked(fs.existsSync).mockReturnValue(true);
        vi.mocked(fs.readFileSync).mockReturnValue("invalid json {{{");

        const result = getCachedValidation("test-key");

        expect(result).toBeNull();
      });

      // Note: mkdirSync error handling is now tested in cacheUtils.test.ts
      // since ensureCacheDir handles directory creation

      it("returns undefined when cache file contains invalid structure", () => {
        vi.mocked(fs.existsSync).mockReturnValue(true);
        vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify({ invalid: "structure" }));

        const result = getCachedValidation("test-key");

        // When cachedAt is undefined, Date.now() - undefined = NaN
        // NaN > TTL is false, so the code returns entry.result (which is undefined)
        expect(result).toBeUndefined();
      });
    });
  });

  describe("setCachedValidation", () => {
    describe("writes data correctly", () => {
      it("writes validation data to the correct file path", () => {
        const mockResult = createMockValidationResult();

        vi.mocked(fs.existsSync).mockReturnValue(true);

        setCachedValidation("test-key", mockResult);

        expect(fs.writeFileSync).toHaveBeenCalledTimes(1);
        expect(fs.writeFileSync).toHaveBeenCalledWith(
          expect.stringContaining("test-key.json"),
          expect.any(String),
          "utf-8"
        );
      });

      it("writes correct JSON structure with cachedAt timestamp", () => {
        const mockResult = createMockValidationResult();

        const now = 1705312800000; // Fixed timestamp
        vi.useFakeTimers();
        vi.setSystemTime(now);

        vi.mocked(fs.existsSync).mockReturnValue(true);

        setCachedValidation("test-key", mockResult);

        const writtenData = vi.mocked(fs.writeFileSync).mock.calls[0][1];
        const parsedData = JSON.parse(writtenData as string);

        expect(parsedData.result).toEqual(mockResult);
        expect(parsedData.cachedAt).toBe(now);
      });

      it("calls ensureCacheDir with correct subdir", async () => {
        const { ensureCacheDir } = await import("../cacheUtils");
        const mockResult = createMockValidationResult();

        vi.mocked(fs.existsSync).mockReturnValue(false);

        setCachedValidation("test-key", mockResult);

        expect(ensureCacheDir).toHaveBeenCalledWith("validation");
      });

      it("handles key with special characters correctly", () => {
        const mockResult = createMockValidationResult();

        vi.mocked(fs.existsSync).mockReturnValue(true);

        setCachedValidation("7203.T", mockResult);

        expect(fs.writeFileSync).toHaveBeenCalledWith(
          expect.stringContaining("7203_T.json"),
          expect.any(String),
          "utf-8"
        );
      });

      it("preserves all validation result fields", () => {
        const mockResult = createMockValidationResult({
          isValid: false,
          errors: ["Error 1", "Error 2"],
          warnings: ["Warning 1", "Warning 2", "Warning 3"],
          validatedAt: "2024-06-15T15:30:00Z",
        });

        vi.mocked(fs.existsSync).mockReturnValue(true);

        setCachedValidation("test-key", mockResult);

        const writtenData = vi.mocked(fs.writeFileSync).mock.calls[0][1];
        const parsedData = JSON.parse(writtenData as string);

        expect(parsedData.result.isValid).toBe(false);
        expect(parsedData.result.errors).toEqual(["Error 1", "Error 2"]);
        expect(parsedData.result.warnings).toEqual(["Warning 1", "Warning 2", "Warning 3"]);
        expect(parsedData.result.validatedAt).toBe("2024-06-15T15:30:00Z");
      });
    });

    describe("error handling", () => {
      it("silently ignores writeFileSync errors", () => {
        const mockResult = createMockValidationResult();

        vi.mocked(fs.existsSync).mockReturnValue(true);
        vi.mocked(fs.writeFileSync).mockImplementation(() => {
          throw new Error("EACCES: permission denied");
        });

        // Should not throw
        expect(() => {
          setCachedValidation("test-key", mockResult);
        }).not.toThrow();
      });

      // Note: mkdirSync error handling is now tested in cacheUtils.test.ts
      // since ensureCacheDir handles directory creation

      it("silently ignores ENOENT errors", () => {
        const mockResult = createMockValidationResult();

        vi.mocked(fs.existsSync).mockReturnValue(true);
        vi.mocked(fs.writeFileSync).mockImplementation(() => {
          throw new Error("ENOENT: no such file or directory");
        });

        expect(() => {
          setCachedValidation("test-key", mockResult);
        }).not.toThrow();
      });
    });
  });

  describe("invalidateValidationCache", () => {
    describe("deletes cache file successfully", () => {
      it("returns true when cache file exists and is deleted", () => {
        vi.mocked(fs.existsSync).mockReturnValue(true);
        vi.mocked(fs.unlinkSync).mockReturnValue(undefined);

        const result = invalidateValidationCache("test-key");

        expect(result).toBe(true);
        expect(fs.unlinkSync).toHaveBeenCalledWith(
          expect.stringContaining("test-key.json")
        );
      });

      it("handles key with special characters correctly", () => {
        vi.mocked(fs.existsSync).mockReturnValue(true);
        vi.mocked(fs.unlinkSync).mockReturnValue(undefined);

        const result = invalidateValidationCache("7203.T");

        expect(result).toBe(true);
        expect(fs.unlinkSync).toHaveBeenCalledWith(
          expect.stringContaining("7203_T.json")
        );
      });
    });

    describe("returns false when cache file does not exist", () => {
      it("returns false when file does not exist", () => {
        // ensureCacheDir is mocked, so only file existence check matters
        vi.mocked(fs.existsSync).mockReturnValue(false); // file does not exist

        const result = invalidateValidationCache("test-key");

        expect(result).toBe(false);
        expect(fs.unlinkSync).not.toHaveBeenCalled();
      });
    });

    describe("error handling", () => {
      it("returns false when unlinkSync throws an error", () => {
        vi.mocked(fs.existsSync).mockReturnValue(true);
        vi.mocked(fs.unlinkSync).mockImplementation(() => {
          throw new Error("EACCES: permission denied");
        });

        const result = invalidateValidationCache("test-key");

        expect(result).toBe(false);
      });

      // Note: mkdirSync error handling is now tested in cacheUtils.test.ts
      // since ensureCacheDir handles directory creation

      it("returns false when existsSync throws an error", () => {
        vi.mocked(fs.existsSync).mockImplementation(() => {
          throw new Error("Unexpected error");
        });

        const result = invalidateValidationCache("test-key");

        expect(result).toBe(false);
      });
    });
  });

  describe("integration scenarios", () => {
    it("set then get returns the same data", () => {
      const mockResult = createMockValidationResult();

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
      setCachedValidation("test-key", mockResult);

      // Get
      const result = getCachedValidation("test-key");

      expect(result).not.toBeNull();
      expect(result).toEqual(mockResult);
    });

    it("different keys use different cache files", () => {
      const mockResult = createMockValidationResult();

      vi.mocked(fs.existsSync).mockReturnValue(true);

      setCachedValidation("key1", mockResult);
      setCachedValidation("key2", mockResult);

      const calls = vi.mocked(fs.writeFileSync).mock.calls;
      expect(calls[0][0]).toContain("key1.json");
      expect(calls[1][0]).toContain("key2.json");
    });

    it("invalidate then get returns null", () => {
      const mockResult = createMockValidationResult();
      const now = Date.now();

      let storedData: string | null = JSON.stringify({
        result: mockResult,
        cachedAt: now,
      });

      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockImplementation(() => {
        if (storedData === null) throw new Error("File not found");
        return storedData;
      });
      vi.mocked(fs.unlinkSync).mockImplementation(() => {
        storedData = null;
      });

      // Verify data exists before invalidation
      const beforeResult = getCachedValidation("test-key");
      expect(beforeResult).not.toBeNull();

      // Invalidate
      const invalidated = invalidateValidationCache("test-key");
      expect(invalidated).toBe(true);

      // Get after invalidation - should return null
      // Since storedData is now null, readFileSync will throw
      const afterResult = getCachedValidation("test-key");
      expect(afterResult).toBeNull();
    });

    it("cache expires after TTL", () => {
      const mockResult = createMockValidationResult();

      vi.useFakeTimers();
      const initialTime = 1705312800000;
      vi.setSystemTime(initialTime);

      let storedData: string | null = null;

      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.writeFileSync).mockImplementation((_, data) => {
        storedData = data as string;
      });
      vi.mocked(fs.readFileSync).mockImplementation(() => {
        if (storedData === null) throw new Error("File not found");
        return storedData;
      });

      // Set at initial time
      setCachedValidation("test-key", mockResult);

      // Get immediately - should return data
      const immediateResult = getCachedValidation("test-key");
      expect(immediateResult).not.toBeNull();

      // Advance time by 23 hours - should still return data
      vi.setSystemTime(initialTime + 23 * 60 * 60 * 1000);
      const before24hResult = getCachedValidation("test-key");
      expect(before24hResult).not.toBeNull();

      // Advance time by 25 hours total - should return null (expired)
      vi.setSystemTime(initialTime + 25 * 60 * 60 * 1000);
      const after24hResult = getCachedValidation("test-key");
      expect(after24hResult).toBeNull();
    });
  });
});
