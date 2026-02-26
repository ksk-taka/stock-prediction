# コマンドリファレンス

stock-prediction プロジェクトで利用可能な全コマンド一覧。
すべて `npm run <command>` で実行可能。

---

## 開発・ビルド

| コマンド | 説明 |
|---------|------|
| `dev` | 開発サーバー起動 (Next.js + webpack) |
| `build` | 本番ビルド |
| `start` | 本番サーバー起動 |
| `lint` | ESLint 実行 |

## テスト

| コマンド | 説明 |
|---------|------|
| `test` | vitest ウォッチモード |
| `test:run` | vitest 単発実行 |
| `test:ui` | vitest UI モード (ブラウザ) |
| `test:coverage` | カバレッジ付きテスト |

## シグナル監視・通知

| コマンド | 説明 |
|---------|------|
| `monitor:signals` | シグナル検出 → 分析 → Slack通知 (本番) |
| `monitor:signals:dry` | dry-run (通知なし) |
| `monitor:signals:fast` | 分析スキップの高速モード (`--skip-analysis`) |
| `monitor:signals:earnings` | 決算資料を含む分析パイプライン (`--with-earnings`) |

## デイリーシグナルスキャン (Supabase連携)

| コマンド | 説明 |
|---------|------|
| `scan:daily` | 全銘柄スキャン (ローカルのみ、DB保存なし) |
| `scan:daily:supabase` | 全銘柄スキャン + Supabase保存 |
| `scan:daily:favorites` | お気に入り銘柄のみ + Supabase保存 |
| `scan:daily:dry` | dry-run |

GHA cron (16:30 JST) でも `scan:daily:supabase` が自動実行される。

## 全銘柄シグナルスキャン (ファイルキャッシュ)

| コマンド | 説明 |
|---------|------|
| `scan:signals` | 全銘柄の売買シグナルスキャン (ファイルキャッシュ保存) |
| `scan:signals:quick` | 高速モード (戦略数制限) |

## バックテスト

| コマンド | 説明 | オプション例 |
|---------|------|-------------|
| `backtest:all` | 全お気に入り銘柄バックテスト (13戦略) | `--all` で全銘柄 |
| `backtest:all:daily` | daily のみ | |
| `backtest:10yr` | 10年データでマルチウィンドウBT | |
| `backtest:10yr:all` | 全銘柄10年BT | |
| `walkforward` | ウォークフォワード分析 (訓練3年→検証1年 × 7窓) | |
| `walkforward:all` | 全戦略WF分析 | |

## スキャナー

### 新高値スキャナー
| コマンド | 説明 |
|---------|------|
| `scan:highs` | Kabutan年初来高値 + 52週ブレイクアウト検出 (PER 10-30) |
| `scan:highs:csv` | CSV出力あり |

オプション: `--per 15,25` `--market prime` `--all-ytd` `--pages N` `--debug`

### CWH形成中スキャナー
| コマンド | 説明 |
|---------|------|
| `scan:cwh` | お気に入り銘柄のCWH形成状況 |
| `scan:cwh:all` | 全銘柄スキャン |
| `scan:cwh:csv` | 全銘柄 + CSV出力 |
| `scan:cwh:ready` | ブレイクアウト間近の銘柄のみ |

### ネットキャッシュスキャナー
| コマンド | 説明 |
|---------|------|
| `scan:netcash` | ネットキャッシュ比率スキャン |
| `scan:netcash:csv` | CSV出力あり |
| `scan:netcash:favorites` | お気に入りのみ + CSV |

## データ取得

### 銘柄マスタ
| コマンド | 説明 |
|---------|------|
| `fetch:stocks` | JPX公開Excel → 全東証銘柄登録 (~3,776銘柄) |

### 株価データ
| コマンド | 説明 |
|---------|------|
| `fetch:10yr` | お気に入り銘柄の10年データ取得+キャッシュ |
| `fetch:10yr:all` | 全銘柄10年データ |

### J-Quants API
| コマンド | 説明 |
|---------|------|
| `jquants:master` | J-Quantsマスタ取得 + ウォッチリストセクター更新 |
| `jquants:master:dump` | 全マスタCSV出力 |
| `jquants:bars` | お気に入り銘柄の株価四本値取得 |
| `jquants:bars:all` | 全銘柄株価取得 |

### 株主優待
| コマンド | 説明 |
|---------|------|
| `fetch:yutai` | お気に入り銘柄の優待データ取得 |
| `fetch:yutai:all` | 全銘柄 |
| `fetch:yutai:dry` | dry-run |

### 決算資料
| コマンド | 説明 |
|---------|------|
| `fetch:earnings` | 決算資料DL (Kabutan + TDnet + EDINET) |
| `fetch:earnings:dry` | dry-run |
| `fetch:earnings:kabutan` | 決算短信のみ |
| `fetch:earnings:tdnet` | 説明資料のみ |
| `fetch:earnings:edinet` | 有価証券報告書のみ |

オプション: `--symbol 7203.T` `--count 4` `--days 365` `--tdnet-days 60`

### EDINET財務データ
| コマンド | 説明 |
|---------|------|
| `edinet:financials` | EDINET XBRLから財務データ抽出 |
| `edinet:financials:all` | 全銘柄 |
| `edinet:financials:csv` | CSV出力 |

### 浮動株時価総額
| コマンド | 説明 |
|---------|------|
| `calc:floating` | 浮動株時価総額計算 |
| `calc:floating:all` | 全銘柄 |
| `calc:floating:csv` | CSV出力 |

## 分析

### 決算分析 (LLM)
| コマンド | 説明 |
|---------|------|
| `analyze:earnings` | 決算資料のLLM分析 (引数に銘柄コード) |
| `analyze:earnings:list` | 分析可能な銘柄一覧 |
| `analyze:earnings:all` | 全銘柄分析 |

オプション: `--skip-web` `--slack`

### フル分析 (Gemini)
| コマンド | 説明 |
|---------|------|
| `analyze:full` | Gemini Flash による総合分析 |
| `analyze:full:pro` | Gemini Pro モデル使用 |
| `analyze:full:list` | 分析対象一覧 |

### 分析レビュー
| コマンド | 説明 |
|---------|------|
| `review:analysis` | 過去の分析結果をレビュー |
| `review:analysis:dry` | dry-run |
| `review:analysis:backfill` | 過去分を一括レビュー |

### 四季報パフォーマンス検証
| コマンド | 説明 |
|---------|------|
| `shikiho:perf` | 四季報推奨銘柄のパフォーマンス検証 |
| `shikiho:perf:csv` | CSV出力 |
| `shikiho:perf:notion` | Notion連携 |
| `shikiho:perf:dry` | dry-run |

## Geminiプロンプト生成
| コマンド | 説明 |
|---------|------|
| `prompt:gemini` | Gemini用分析プロンプト生成 |
| `prompt:gemini:clip` | クリップボードにコピー |

## Slack連携

| コマンド | 説明 |
|---------|------|
| `slack:bot` | Socket Mode常駐ボット (購入/スキップボタン処理) |
| `test:slack` | Slack接続テスト |

## ウォッチリスト同期

| コマンド | 説明 |
|---------|------|
| `sync:pull` | Supabase → ローカル watchlist.json 同期 |
| `sync:push` | ローカル → Supabase 同期 |
| `migrate:supabase` | watchlist.json を Supabase にマイグレーション |

---

## 環境変数

主要な環境変数 (`.env.local` に設定):

| 変数 | 用途 |
|------|------|
| `GEMINI_API_KEY` | Gemini API (Grounding + 分析) |
| `GROQ_API_KEY` | Groq API (LLM フォールバック) |
| `LLM_PROVIDER` | LLMプロバイダ指定 (gemini/groq/ollama) |
| `KABU_MODE` | kabuステーション接続モード (mock/demo/production) |
| `SLACK_BOT_TOKEN` | Slack Bot Token |
| `SLACK_WEBHOOK_URL` | Slack Webhook URL |
| `SLACK_APP_TOKEN` | Slack Socket Mode用 |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase Anon Key |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase Service Role Key |
| `JQUANTS_EMAIL` | J-Quants ログインメール |
| `JQUANTS_PASSWORD` | J-Quants ログインパスワード |
| `EDINET_API_KEY` | EDINET API キー |
| `NOTION_API_KEY` | Notion API キー |
