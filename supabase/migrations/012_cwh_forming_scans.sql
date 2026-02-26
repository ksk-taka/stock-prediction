-- CWH形成中スキャン結果テーブル
CREATE TABLE cwh_forming_scans (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'running'
    CHECK (status IN ('running', 'completed', 'failed')),
  stocks JSONB DEFAULT '[]'::jsonb,
  stock_count INT DEFAULT 0,
  ready_count INT DEFAULT 0,
  progress JSONB,
  error_message TEXT,
  started_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_cwh_forming_scans_completed
  ON cwh_forming_scans(created_at DESC)
  WHERE status = 'completed';
