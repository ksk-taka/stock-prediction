-- ============================================
-- シグナルインデックス高速化
-- 1. RPC関数: 57クエリ→1クエリに集約
-- 2. キャッシュテーブル: 結果を永続化
-- ============================================

-- キャッシュテーブル
CREATE TABLE IF NOT EXISTS signal_index_cache (
  scan_id INT PRIMARY KEY REFERENCES signal_scans(id) ON DELETE CASCADE,
  data JSONB NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- インデックス
CREATE INDEX IF NOT EXISTS idx_signal_index_cache_created
  ON signal_index_cache(created_at DESC);

-- RPC関数: 全シグナルを1クエリで取得し、銘柄ごとに集約
CREATE OR REPLACE FUNCTION get_signals_grouped(p_scan_id INT DEFAULT NULL)
RETURNS JSONB AS $$
DECLARE
  v_scan_id INT;
  v_cached JSONB;
  v_result JSONB;
BEGIN
  -- 対象scan_id決定
  IF p_scan_id IS NULL THEN
    SELECT id INTO v_scan_id
    FROM signal_scans
    WHERE status = 'completed'
    ORDER BY completed_at DESC
    LIMIT 1;
  ELSE
    v_scan_id := p_scan_id;
  END IF;

  IF v_scan_id IS NULL THEN
    RETURN jsonb_build_object('signals', '{}'::JSONB, 'strategyNames', '{}'::JSONB, 'scan', NULL);
  END IF;

  -- キャッシュチェック
  SELECT data INTO v_cached
  FROM signal_index_cache
  WHERE scan_id = v_scan_id;

  IF v_cached IS NOT NULL THEN
    RETURN v_cached;
  END IF;

  -- キャッシュミス: 集約クエリ実行
  WITH deduped AS (
    -- 銘柄×戦略×タイムフレームで重複排除（最新のみ）
    SELECT DISTINCT ON (symbol, strategy_id, timeframe)
      symbol,
      strategy_id,
      strategy_name,
      timeframe,
      signal_date,
      buy_price,
      current_price
    FROM detected_signals
    WHERE scan_id = v_scan_id
    ORDER BY symbol, strategy_id, timeframe, signal_date DESC
  ),
  grouped AS (
    -- 銘柄ごとにシグナル配列を構築
    SELECT
      symbol,
      jsonb_agg(
        jsonb_build_object(
          's', strategy_id,
          't', CASE WHEN timeframe = 'daily' THEN 'd' ELSE 'w' END,
          'd', signal_date,
          'bp', buy_price,
          'cp', current_price
        )
      ) AS sigs
    FROM deduped
    GROUP BY symbol
  ),
  strategy_names AS (
    -- 戦略ID→名前マッピング
    SELECT jsonb_object_agg(strategy_id, strategy_name) AS names
    FROM (
      SELECT DISTINCT strategy_id, strategy_name
      FROM deduped
    ) t
  ),
  scan_info AS (
    SELECT jsonb_build_object(
      'id', id,
      'status', status,
      'total_stocks', total_stocks,
      'completed_at', completed_at
    ) AS info
    FROM signal_scans
    WHERE id = v_scan_id
  )
  SELECT jsonb_build_object(
    'signals', COALESCE((SELECT jsonb_object_agg(symbol, sigs) FROM grouped), '{}'::JSONB),
    'strategyNames', COALESCE((SELECT names FROM strategy_names), '{}'::JSONB),
    'totalStocks', (SELECT COUNT(*) FROM grouped),
    'scan', (SELECT info FROM scan_info)
  ) INTO v_result;

  -- キャッシュに保存
  INSERT INTO signal_index_cache (scan_id, data)
  VALUES (v_scan_id, v_result)
  ON CONFLICT (scan_id) DO UPDATE SET data = EXCLUDED.data, created_at = NOW();

  RETURN v_result;
END;
$$ LANGUAGE plpgsql;

-- 古いキャッシュを削除するクリーンアップ関数（オプション）
CREATE OR REPLACE FUNCTION cleanup_signal_index_cache(keep_count INT DEFAULT 5)
RETURNS INT AS $$
DECLARE
  deleted_count INT;
BEGIN
  WITH old_caches AS (
    SELECT scan_id
    FROM signal_index_cache
    ORDER BY created_at DESC
    OFFSET keep_count
  )
  DELETE FROM signal_index_cache
  WHERE scan_id IN (SELECT scan_id FROM old_caches);

  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$ LANGUAGE plpgsql;
