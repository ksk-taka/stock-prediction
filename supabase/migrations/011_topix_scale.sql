-- TOPIX規模区分をstats_cacheに追加
-- J-Quantsマスタデータから取得し、Vercelフォールバック用に保存
ALTER TABLE stats_cache
  ADD COLUMN IF NOT EXISTS topix_scale TEXT;

COMMENT ON COLUMN stats_cache.topix_scale IS 'TOPIX規模区分 (TOPIX Core30/Large70/Mid400/Small 1/Small 2)';
