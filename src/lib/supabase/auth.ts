import { createServerSupabaseClient } from "./server";

/**
 * API Route で認証済みユーザーIDを取得
 * 未認証の場合はエラーをスロー
 */
export async function getAuthUserId(): Promise<string> {
  const supabase = await createServerSupabaseClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();

  if (error || !user) {
    throw new Error("Unauthorized");
  }

  return user.id;
}

/**
 * 許可ユーザーかチェック
 * 環境変数 ALLOWED_USER_IDS (カンマ区切り) に含まれるユーザーのみ許可。
 * 未設定の場合: ローカル(NODE_ENV=development)は許可、本番は全拒否。
 */
export async function requireAllowedUser(): Promise<string> {
  const userId = await getAuthUserId();

  const allowList = process.env.ALLOWED_USER_IDS;
  if (!allowList) {
    // 未設定: ローカル開発のみ許可、本番は拒否
    if (process.env.NODE_ENV === "production") {
      console.warn(`[auth] ALLOWED_USER_IDS未設定のため全拒否 (userId=${userId})`);
      throw new Error("Forbidden: ALLOWED_USER_IDS not configured");
    }
    return userId;
  }

  const allowed = allowList.split(",").map((id) => id.trim());
  if (!allowed.includes(userId)) {
    console.warn(`[auth] 許可されていないユーザー: ${userId}`);
    throw new Error("Forbidden");
  }

  return userId;
}
