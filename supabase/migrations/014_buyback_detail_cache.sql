-- 自社株買い詳細キャッシュ（銘柄別、EDINET XBRL抽出結果）
CREATE TABLE IF NOT EXISTS buyback_detail_cache (
  symbol TEXT PRIMARY KEY,
  data JSONB NOT NULL,
  cached_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- RLS
ALTER TABLE buyback_detail_cache ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow service role full access on buyback_detail_cache"
  ON buyback_detail_cache
  FOR ALL
  USING (true)
  WITH CHECK (true);
