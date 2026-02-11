-- =============================================
-- Watchlist Groups (名前付きお気に入りグループ)
-- =============================================

-- グループ定義
CREATE TABLE watchlist_groups (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  color TEXT DEFAULT '#fbbf24',
  sort_order INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, name)
);

-- 銘柄×グループ 多対多
CREATE TABLE stock_group_memberships (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  symbol TEXT NOT NULL,
  group_id BIGINT NOT NULL REFERENCES watchlist_groups(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, symbol, group_id)
);

-- =============================================
-- Indexes
-- =============================================
CREATE INDEX idx_wg_user ON watchlist_groups(user_id);
CREATE INDEX idx_sgm_user_symbol ON stock_group_memberships(user_id, symbol);
CREATE INDEX idx_sgm_group ON stock_group_memberships(group_id);

-- =============================================
-- Row Level Security
-- =============================================
ALTER TABLE watchlist_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE stock_group_memberships ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users_own_groups" ON watchlist_groups FOR ALL USING (auth.uid() = user_id);
CREATE POLICY "users_own_memberships" ON stock_group_memberships FOR ALL USING (auth.uid() = user_id);

-- =============================================
-- Data Migration: 既存お気に入り → デフォルトグループ
-- =============================================

-- 既存favorite=trueのユーザーにデフォルト「お気に入り」グループ作成
INSERT INTO watchlist_groups (user_id, name, color, sort_order)
SELECT DISTINCT user_id, 'お気に入り', '#fbbf24', 0
FROM stocks
WHERE favorite = TRUE;

-- 既存お気に入りをメンバーシップに移行
INSERT INTO stock_group_memberships (user_id, symbol, group_id)
SELECT s.user_id, s.symbol, wg.id
FROM stocks s
JOIN watchlist_groups wg ON wg.user_id = s.user_id AND wg.name = 'お気に入り'
WHERE s.favorite = TRUE;
