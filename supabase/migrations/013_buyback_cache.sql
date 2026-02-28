-- 自社株買いキャッシュ（全銘柄の4桁コード配列を単一行で保持）
CREATE TABLE IF NOT EXISTS buyback_cache (
  id INTEGER PRIMARY KEY DEFAULT 1,
  codes JSONB NOT NULL DEFAULT '[]'::JSONB,
  scanned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (id = 1)
);

-- RLS
ALTER TABLE buyback_cache ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow service role full access on buyback_cache"
  ON buyback_cache
  FOR ALL
  USING (true)
  WITH CHECK (true);
