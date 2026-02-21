import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import path from "path";

describe("cacheDir", () => {
  const originalEnv = process.env;
  const originalCwd = process.cwd;

  beforeEach(() => {
    vi.resetModules();
    // Create a fresh copy of process.env for each test
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    // Restore original environment
    process.env = originalEnv;
    process.cwd = originalCwd;
  });

  describe("getCacheBaseDir", () => {
    describe("returns /tmp/.cache on Vercel", () => {
      it("returns /tmp/.cache when VERCEL env is set to '1'", async () => {
        process.env.VERCEL = "1";

        const { getCacheBaseDir } = await import("../cacheDir");
        const result = getCacheBaseDir();

        expect(result).toBe(path.join("/tmp", ".cache"));
      });

      it("returns /tmp/.cache when VERCEL env is set to any truthy string", async () => {
        process.env.VERCEL = "true";

        const { getCacheBaseDir } = await import("../cacheDir");
        const result = getCacheBaseDir();

        expect(result).toBe(path.join("/tmp", ".cache"));
      });
    });

    describe("returns .cache in project root when not on Vercel", () => {
      it("returns cwd/.cache when VERCEL env is not set", async () => {
        delete process.env.VERCEL;

        const { getCacheBaseDir } = await import("../cacheDir");
        const result = getCacheBaseDir();

        expect(result).toBe(path.join(process.cwd(), ".cache"));
      });

      it("returns cwd/.cache when VERCEL env is empty string", async () => {
        process.env.VERCEL = "";

        const { getCacheBaseDir } = await import("../cacheDir");
        const result = getCacheBaseDir();

        // Empty string is falsy, so should use local path
        expect(result).toBe(path.join(process.cwd(), ".cache"));
      });
    });

    describe("path format consistency", () => {
      it("returns path with correct separator for the platform", async () => {
        delete process.env.VERCEL;

        const { getCacheBaseDir } = await import("../cacheDir");
        const result = getCacheBaseDir();

        // Path should contain .cache directory
        expect(result).toContain(".cache");
        // Path should be absolute (starts with / on Unix or drive letter on Windows)
        expect(path.isAbsolute(result)).toBe(true);
      });

      it("returns normalized path without trailing slash", async () => {
        delete process.env.VERCEL;

        const { getCacheBaseDir } = await import("../cacheDir");
        const result = getCacheBaseDir();

        expect(result.endsWith("/")).toBe(false);
        expect(result.endsWith("\\")).toBe(false);
      });
    });

    describe("edge cases", () => {
      it("handles undefined VERCEL env (same as not set)", async () => {
        process.env.VERCEL = undefined;

        const { getCacheBaseDir } = await import("../cacheDir");
        const result = getCacheBaseDir();

        expect(result).toBe(path.join(process.cwd(), ".cache"));
      });

      it("function can be called multiple times with same result", async () => {
        delete process.env.VERCEL;

        const { getCacheBaseDir } = await import("../cacheDir");
        const result1 = getCacheBaseDir();
        const result2 = getCacheBaseDir();
        const result3 = getCacheBaseDir();

        expect(result1).toBe(result2);
        expect(result2).toBe(result3);
      });

      it("result changes when cwd changes (for local environment)", async () => {
        delete process.env.VERCEL;

        const mockCwd1 = "/project/a";
        const mockCwd2 = "/project/b";

        // First call with mocked cwd
        process.cwd = vi.fn().mockReturnValue(mockCwd1);
        vi.resetModules();
        const mod1 = await import("../cacheDir");
        const result1 = mod1.getCacheBaseDir();

        // Second call with different mocked cwd
        process.cwd = vi.fn().mockReturnValue(mockCwd2);
        const result2 = mod1.getCacheBaseDir();

        expect(result1).toBe(path.join(mockCwd1, ".cache"));
        expect(result2).toBe(path.join(mockCwd2, ".cache"));
        expect(result1).not.toBe(result2);
      });
    });
  });
});
