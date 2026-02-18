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
 * 未設定の場合は全認証ユーザーを許可（ローカル開発用）。
 */
export async function requireAllowedUser(): Promise<string> {
  const userId = await getAuthUserId();

  const allowList = process.env.ALLOWED_USER_IDS;
  if (allowList) {
    const allowed = allowList.split(",").map((id) => id.trim());
    if (!allowed.includes(userId)) {
      throw new Error("Forbidden");
    }
  }

  return userId;
}
