import path from "path";

/**
 * キャッシュベースディレクトリを取得
 * Vercel: /tmp/.cache（読み取り専用ファイルシステムのため）
 * ローカル: .cache/ (プロジェクトルート)
 */
export function getCacheBaseDir(): string {
  if (process.env.VERCEL) {
    return path.join("/tmp", ".cache");
  }
  return path.join(process.cwd(), ".cache");
}
