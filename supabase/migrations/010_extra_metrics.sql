-- 追加指標カラムを stats_cache に追加
-- Vercelコールドスタート時にYF再取得を回避するためのSupabaseキャッシュ

ALTER TABLE stats_cache
  ADD COLUMN IF NOT EXISTS current_ratio NUMERIC(8,2),
  ADD COLUMN IF NOT EXISTS peg_ratio NUMERIC(8,2),
  ADD COLUMN IF NOT EXISTS equity_ratio NUMERIC(6,2),
  ADD COLUMN IF NOT EXISTS total_debt NUMERIC(18,0),
  ADD COLUMN IF NOT EXISTS profit_growth_rate NUMERIC(8,1),
  ADD COLUMN IF NOT EXISTS extra_metrics_cached_at TIMESTAMPTZ;

COMMENT ON COLUMN stats_cache.current_ratio IS '流動比率';
COMMENT ON COLUMN stats_cache.peg_ratio IS 'PEGレシオ';
COMMENT ON COLUMN stats_cache.equity_ratio IS '自己資本比率 (%)';
COMMENT ON COLUMN stats_cache.total_debt IS '有利子負債 (円)';
COMMENT ON COLUMN stats_cache.profit_growth_rate IS '増益率 (%, YoY EBIT)';
