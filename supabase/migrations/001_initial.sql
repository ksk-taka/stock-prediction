-- =============================================
-- Watchlist stocks table
-- Replaces: data/watchlist.json -> stocks[]
-- =============================================
CREATE TABLE stocks (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  symbol TEXT NOT NULL,
  name TEXT NOT NULL,
  market TEXT NOT NULL CHECK (market IN ('JP', 'US')),
  market_segment TEXT,
  sectors TEXT[] DEFAULT '{}',
  favorite BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, symbol)
);

-- =============================================
-- Fundamental judgments table
-- Replaces: stock.fundamental in watchlist.json
-- =============================================
CREATE TABLE fundamental_judgments (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  symbol TEXT NOT NULL,
  judgment TEXT NOT NULL CHECK (judgment IN ('bullish', 'neutral', 'bearish')),
  memo TEXT,
  analyzed_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, symbol)
);

-- =============================================
-- Signal validations table (Go/NoGo)
-- =============================================
CREATE TABLE signal_validations (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  symbol TEXT NOT NULL,
  strategy_id TEXT NOT NULL,
  decision TEXT NOT NULL CHECK (decision IN ('entry', 'wait', 'avoid')),
  signal_evaluation TEXT,
  risk_factor TEXT,
  catalyst TEXT,
  summary TEXT,
  validated_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, symbol, strategy_id)
);

-- =============================================
-- Watchlist metadata
-- =============================================
CREATE TABLE watchlist_meta (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- =============================================
-- Indexes
-- =============================================
CREATE INDEX idx_stocks_user_id ON stocks(user_id);
CREATE INDEX idx_stocks_favorite ON stocks(user_id, favorite) WHERE favorite = TRUE;
CREATE INDEX idx_fundamental_judgments_user ON fundamental_judgments(user_id, symbol);
CREATE INDEX idx_signal_validations_user ON signal_validations(user_id, symbol);

-- =============================================
-- Row Level Security
-- =============================================
ALTER TABLE stocks ENABLE ROW LEVEL SECURITY;
ALTER TABLE fundamental_judgments ENABLE ROW LEVEL SECURITY;
ALTER TABLE signal_validations ENABLE ROW LEVEL SECURITY;
ALTER TABLE watchlist_meta ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users_own_stocks" ON stocks FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "users_own_judgments" ON fundamental_judgments FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "users_own_validations" ON signal_validations FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "users_own_meta" ON watchlist_meta FOR ALL USING (auth.uid() = user_id);
