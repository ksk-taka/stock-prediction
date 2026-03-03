-- 事前計算済み株式テーブルデータ (GHA daily job → Supabase → クライアント高速ロード)
CREATE TABLE IF NOT EXISTS stock_table_precomputed (
  symbol TEXT PRIMARY KEY,
  row_data JSONB NOT NULL,
  computed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
