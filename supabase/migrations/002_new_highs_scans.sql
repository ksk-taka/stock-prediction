-- =============================================
-- 52週高値ブレイクアウト スキャン結果テーブル
-- GitHub Actions でスキャン → Supabase に保存
-- =============================================
CREATE TABLE new_highs_scans (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'running'
    CHECK (status IN ('running', 'completed', 'failed')),
  stocks JSONB DEFAULT '[]'::jsonb,
  stock_count INT DEFAULT 0,
  breakout_count INT DEFAULT 0,
  error_message TEXT,
  started_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 最新の完了済みスキャンを高速取得
CREATE INDEX idx_new_highs_scans_completed
  ON new_highs_scans(created_at DESC)
  WHERE status = 'completed';

-- RLS 不要: 市場データ（ユーザー固有でない）
-- 書き込みは service role key のみ
