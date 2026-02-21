-- 浮動株比率カラムを stats_cache に追加
-- EDINET有報XBRLから推計した浮動株比率を保存
ALTER TABLE stats_cache
  ADD COLUMN IF NOT EXISTS floating_ratio NUMERIC(6,4),
  ADD COLUMN IF NOT EXISTS floating_ratio_cached_at TIMESTAMPTZ;

COMMENT ON COLUMN stats_cache.floating_ratio IS '推計浮動株比率 (0.0〜1.0)';
