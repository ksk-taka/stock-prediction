-- 新高値スキャンの進捗追跡用カラム追加
ALTER TABLE new_highs_scans
ADD COLUMN progress JSONB DEFAULT NULL;

-- progress の例:
-- { "stage": "kabutan", "current": 30, "total": 130, "message": "Kabutan: 30/130ページ" }
-- { "stage": "yf_check", "current": 500, "total": 1000, "message": "52週高値チェック: 500/1000銘柄" }
-- { "stage": "consolidation", "current": 10, "total": 30, "message": "もみ合い分析: 10/30銘柄" }
-- { "stage": "uploading", "current": 0, "total": 0, "message": "結果アップロード中..." }
