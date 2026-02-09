import { createClient } from "@supabase/supabase-js";

/**
 * Service Role クライアント（RLS バイパス）
 * PC側スクリプト・移行用
 */
export function createServiceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}
