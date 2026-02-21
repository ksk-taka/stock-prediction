/**
 * Supabase認証ユーティリティのテスト
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// モック対象
vi.mock("../server", () => ({
  createServerSupabaseClient: vi.fn(),
}));

import { createServerSupabaseClient } from "../server";
import { getAuthUserId, requireAllowedUser } from "../auth";

const mockCreateServerSupabaseClient = vi.mocked(createServerSupabaseClient);

describe("auth", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetAllMocks();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  // ============================================================
  // getAuthUserId
  // ============================================================

  describe("getAuthUserId", () => {
    it("認証済みユーザーのIDを返す", async () => {
      const mockUser = { id: "user-123", email: "test@example.com" };
      mockCreateServerSupabaseClient.mockResolvedValue({
        auth: {
          getUser: vi.fn().mockResolvedValue({
            data: { user: mockUser },
            error: null,
          }),
        },
      } as ReturnType<typeof createServerSupabaseClient>);

      const userId = await getAuthUserId();
      expect(userId).toBe("user-123");
    });

    it("未認証の場合Unauthorizedエラーをスロー", async () => {
      mockCreateServerSupabaseClient.mockResolvedValue({
        auth: {
          getUser: vi.fn().mockResolvedValue({
            data: { user: null },
            error: null,
          }),
        },
      } as ReturnType<typeof createServerSupabaseClient>);

      await expect(getAuthUserId()).rejects.toThrow("Unauthorized");
    });

    it("エラーがある場合Unauthorizedエラーをスロー", async () => {
      mockCreateServerSupabaseClient.mockResolvedValue({
        auth: {
          getUser: vi.fn().mockResolvedValue({
            data: { user: null },
            error: new Error("Session expired"),
          }),
        },
      } as ReturnType<typeof createServerSupabaseClient>);

      await expect(getAuthUserId()).rejects.toThrow("Unauthorized");
    });
  });

  // ============================================================
  // requireAllowedUser
  // ============================================================

  describe("requireAllowedUser", () => {
    const mockAuthenticatedUser = (userId: string) => {
      mockCreateServerSupabaseClient.mockResolvedValue({
        auth: {
          getUser: vi.fn().mockResolvedValue({
            data: { user: { id: userId } },
            error: null,
          }),
        },
      } as ReturnType<typeof createServerSupabaseClient>);
    };

    it("ALLOWED_USER_IDSに含まれるユーザーは許可", async () => {
      process.env.ALLOWED_USER_IDS = "user-123,user-456";
      mockAuthenticatedUser("user-123");

      const userId = await requireAllowedUser();
      expect(userId).toBe("user-123");
    });

    it("ALLOWED_USER_IDSに含まれないユーザーはForbiddenエラー", async () => {
      process.env.ALLOWED_USER_IDS = "user-123,user-456";
      mockAuthenticatedUser("user-789");

      await expect(requireAllowedUser()).rejects.toThrow("Forbidden");
    });

    it("ALLOWED_USER_IDS未設定 + 開発環境 = 許可", async () => {
      delete process.env.ALLOWED_USER_IDS;
      process.env.NODE_ENV = "development";
      mockAuthenticatedUser("any-user");

      const userId = await requireAllowedUser();
      expect(userId).toBe("any-user");
    });

    it("ALLOWED_USER_IDS未設定 + 本番環境 = Forbiddenエラー", async () => {
      delete process.env.ALLOWED_USER_IDS;
      process.env.NODE_ENV = "production";
      mockAuthenticatedUser("any-user");

      await expect(requireAllowedUser()).rejects.toThrow(
        "Forbidden: ALLOWED_USER_IDS not configured"
      );
    });

    it("ALLOWED_USER_IDSの空白はトリムされる", async () => {
      process.env.ALLOWED_USER_IDS = " user-123 , user-456 ";
      mockAuthenticatedUser("user-456");

      const userId = await requireAllowedUser();
      expect(userId).toBe("user-456");
    });

    it("未認証ユーザーはUnauthorizedエラー", async () => {
      process.env.ALLOWED_USER_IDS = "user-123";
      mockCreateServerSupabaseClient.mockResolvedValue({
        auth: {
          getUser: vi.fn().mockResolvedValue({
            data: { user: null },
            error: null,
          }),
        },
      } as ReturnType<typeof createServerSupabaseClient>);

      await expect(requireAllowedUser()).rejects.toThrow("Unauthorized");
    });
  });
});
