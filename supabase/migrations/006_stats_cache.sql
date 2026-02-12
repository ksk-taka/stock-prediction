-- 統計データのキャッシュテーブル
-- ファイルキャッシュ（/tmp）のフォールバックとして使用
-- デプロイやコールドスタートでファイルキャッシュが消えてもSupabaseから復元可能

CREATE TABLE IF NOT EXISTS stats_cache (
  symbol TEXT PRIMARY KEY,

  -- NC率 (7日TTL)
  nc_ratio NUMERIC(6,2),
  nc_cached_at TIMESTAMPTZ,

  -- ROE (30日TTL)
  roe NUMERIC(8,4),
  roe_cached_at TIMESTAMPTZ,

  -- 配当サマリー (30日TTL)
  dividend_summary JSONB,
  dividend_cached_at TIMESTAMPTZ,

  -- レンジデータ (価格履歴から計算、24時間TTL)
  week_high NUMERIC(12,2),
  week_low NUMERIC(12,2),
  month_high NUMERIC(12,2),
  month_low NUMERIC(12,2),
  range_cached_at TIMESTAMPTZ,

  -- シャープレシオ (24時間TTL)
  sharpe_1y NUMERIC(6,3),
  sharpe_cached_at TIMESTAMPTZ,

  -- メタ
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- インデックス: キャッシュの有効期限チェック用
CREATE INDEX IF NOT EXISTS idx_stats_cache_nc_cached_at ON stats_cache(nc_cached_at);
CREATE INDEX IF NOT EXISTS idx_stats_cache_roe_cached_at ON stats_cache(roe_cached_at);
CREATE INDEX IF NOT EXISTS idx_stats_cache_dividend_cached_at ON stats_cache(dividend_cached_at);

-- トリガー: updated_at を自動更新
CREATE OR REPLACE FUNCTION update_stats_cache_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS stats_cache_updated_at_trigger ON stats_cache;
CREATE TRIGGER stats_cache_updated_at_trigger
  BEFORE UPDATE ON stats_cache
  FOR EACH ROW
  EXECUTE FUNCTION update_stats_cache_updated_at();

-- コメント
COMMENT ON TABLE stats_cache IS '統計データキャッシュ（ファイルキャッシュのSupabaseフォールバック）';
COMMENT ON COLUMN stats_cache.nc_ratio IS 'NC率（純資産キャッシュ比率）';
COMMENT ON COLUMN stats_cache.roe IS '自己資本利益率';
COMMENT ON COLUMN stats_cache.dividend_summary IS '配当サマリーJSON';
COMMENT ON COLUMN stats_cache.sharpe_1y IS '1年シャープレシオ';
