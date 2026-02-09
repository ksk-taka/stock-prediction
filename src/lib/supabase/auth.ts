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
