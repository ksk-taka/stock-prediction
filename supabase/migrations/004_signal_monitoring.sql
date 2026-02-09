-- =============================================
-- シグナル監視基盤テーブル
-- 1. price_history: 全銘柄の日足/週足OHLCV (JSONB)
-- 2. signal_scans: スキャン実行管理 (進捗追跡)
-- 3. detected_signals: 検出されたシグナル + 手動分析結果
-- =============================================

-- 1. 価格履歴（銘柄×タイムフレームごとにPriceData[]をJSONB保存）
CREATE TABLE price_history (
  symbol TEXT NOT NULL,
  timeframe TEXT NOT NULL CHECK (timeframe IN ('daily', 'weekly')),
  prices JSONB NOT NULL DEFAULT '[]'::jsonb,
  last_date DATE,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (symbol, timeframe)
);

-- 2. シグナルスキャン管理（scan-new-highs と同パターン）
CREATE TABLE signal_scans (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  status TEXT NOT NULL DEFAULT 'running'
    CHECK (status IN ('running', 'completed', 'failed')),
  progress JSONB,
  total_stocks INT DEFAULT 0,
  processed_stocks INT DEFAULT 0,
  new_signals_count INT DEFAULT 0,
  scan_date DATE,
  started_at TIMESTAMPTZ DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  error_message TEXT
);

CREATE INDEX idx_signal_scans_completed
  ON signal_scans(started_at DESC)
  WHERE status = 'completed';

-- 3. 検出シグナル（個別シグナル + 手動分析結果）
CREATE TABLE detected_signals (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  scan_id BIGINT REFERENCES signal_scans(id) ON DELETE CASCADE,
  symbol TEXT NOT NULL,
  stock_name TEXT,
  sectors TEXT[],
  market_segment TEXT,
  strategy_id TEXT NOT NULL,
  strategy_name TEXT,
  timeframe TEXT NOT NULL,
  signal_date DATE NOT NULL,
  buy_price NUMERIC(12,2),
  current_price NUMERIC(12,2),
  exit_levels JSONB,
  -- 手動分析結果（UIから実行後に格納）
  analysis JSONB,
  analyzed_at TIMESTAMPTZ,
  slack_notified BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(symbol, strategy_id, timeframe, signal_date)
);

CREATE INDEX idx_detected_signals_date ON detected_signals(signal_date DESC);
CREATE INDEX idx_detected_signals_scan ON detected_signals(scan_id);

-- RLS 不要: 市場データ（ユーザー固有でない）
-- 書き込みは service role key のみ
