-- 株主優待キャッシュテーブル
-- ファイルキャッシュのSupabaseフォールバック（Vercel対応）
-- 半期に1回程度の更新頻度

CREATE TABLE IF NOT EXISTS yutai_cache (
  symbol TEXT PRIMARY KEY,
  data JSONB NOT NULL,         -- YutaiInfo JSON
  cached_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- トリガー: updated_at を自動更新
CREATE OR REPLACE FUNCTION update_yutai_cache_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS yutai_cache_updated_at_trigger ON yutai_cache;
CREATE TRIGGER yutai_cache_updated_at_trigger
  BEFORE UPDATE ON yutai_cache
  FOR EACH ROW
  EXECUTE FUNCTION update_yutai_cache_updated_at();

COMMENT ON TABLE yutai_cache IS '株主優待キャッシュ（Kabutan優待ページデータ、180日TTL）';
COMMENT ON COLUMN yutai_cache.data IS 'YutaiInfo JSON (hasYutai, content, recordMonth, recordDate等)';
