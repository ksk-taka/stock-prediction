# キャッシュアーキテクチャ

本プロジェクトで使用している全キャッシュの一覧と動作仕様。

## ディレクトリ構造

```
.cache/                          # gitignore対象、Vercelでは /tmp/.cache に自動切替
├── prices/                      # Yahoo Finance 株価データ
├── news/                        # ニュース・センチメント
├── signals/                     # テクニカルシグナル検出結果
├── stats/                       # 財務指標 (PER, PBR等)
├── fundamental/                 # ファンダメンタル分析
│   ├── {symbol}_research.json
│   ├── {symbol}_analysis.json
│   ├── {symbol}_history.json
│   └── {symbol}_validation_{strategy}_{timeframe}_{date}.json
├── market-intelligence/         # マーケット全体分析
├── analysis/                    # LLM分析 + センチメント
├── jquants-master/              # J-Quants 銘柄マスタ
├── jquants-bars/                # J-Quants 株価四本値
└── backtest-10yr/               # 10年バックテスト用データ

data/                            # 永続データ (gitで管理可能なもの)
├── watchlist.json               # ウォッチリスト設定
├── notified-signals.json        # 通知済みシグナル履歴
├── batch-progress.json          # バッチ処理進捗
├── backtest-results-*.csv       # バックテスト結果 (出力のみ)
├── walkforward-*.csv            # ウォークフォワード結果
└── new-highs-*.csv              # 新高値スキャン結果
```

---

## 1. 株価データキャッシュ (Price Cache)

| 項目 | 内容 |
|------|------|
| **モジュール** | `src/lib/cache/priceCache.ts` |
| **保存先** | `.cache/prices/{symbol}.json` (例: `7203_T_daily.json`) |
| **データ** | OHLCV (始値, 高値, 安値, 終値, 出来高, 調整後終値) |
| **TTL** | 市場オープン中: **5分** / 市場クローズ中: **24時間** |
| **書込みタイミング** | Yahoo Finance APIからデータ取得後に `setCachedPrices()` |
| **読出しタイミング** | APIルート・バックテストで `getCachedPrices()` → ヒットすればAPI呼出しスキップ |
| **強制更新** | なし (TTL経過で自動更新) |

- 市場オープン判定は日米両市場の営業時間で自動切替

---

## 2. ニュース・センチメントキャッシュ (News Cache)

| 項目 | 内容 |
|------|------|
| **モジュール** | `src/lib/cache/newsCache.ts` |
| **保存先** | `.cache/news/{symbol}.json` (例: `7203_T.json`) |
| **データ** | ニュース記事一覧, SNS概況, アナリスト評価 |
| **TTL** | **6時間** |
| **書込みタイミング** | `/api/news` ルートで `fetchNewsAndSentiment()` (Gemini Grounding) 呼出し後 |
| **読出しタイミング** | `GET /api/news?symbol=7203.T` でキャッシュ優先チェック |
| **強制更新** | `?refresh=true` クエリパラメータ |

---

## 3. シグナルキャッシュ (Signals Cache)

| 項目 | 内容 |
|------|------|
| **モジュール** | `src/lib/cache/signalsCache.ts` |
| **保存先** | `.cache/signals/{symbol}.json` (例: `7203_T.json`) |
| **データ** | 全戦略のシグナル検出結果 (BB逆張り, 下放れ, CWH等) + アクティブポジション |
| **TTL** | **1時間** |
| **書込みタイミング** | `computeAndCacheSignals()` でシグナル計算完了後 |
| **読出しタイミング** | `/api/signals` ルートでキャッシュ優先チェック |
| **強制更新** | なし (TTL経過で自動再計算) |

---

## 4. 財務指標キャッシュ (Stats Cache)

| 項目 | 内容 |
|------|------|
| **モジュール** | `src/lib/cache/statsCache.ts` |
| **保存先** | `.cache/stats/{symbol}.json` (例: `7203_T.json`) |
| **データ** | PER, 予想PER, PBR, EPS, ROE, 配当利回り |
| **TTL** | **6時間** |
| **書込みタイミング** | Yahoo Finance `getFinancialData()` 呼出し後 |
| **読出しタイミング** | ファンダメンタル分析APIで使用 |
| **強制更新** | なし |

---

## 5. ファンダメンタル分析キャッシュ (Fundamental Cache)

| 項目 | 内容 |
|------|------|
| **モジュール** | `src/lib/cache/fundamentalCache.ts` |
| **保存先** | `.cache/fundamental/` 配下 (複数ファイル種別) |

### サブタイプ別

| サブタイプ | ファイル名 | TTL | 内容 |
|-----------|-----------|-----|------|
| **Research** | `{symbol}_research.json` | **12時間** | PBR/PER分析, 割安/割高理由, 資本政策 |
| **Analysis** | `{symbol}_analysis.json` | **24時間** | LLMによる総合ファンダメンタル分析 |
| **History** | `{symbol}_history.json` | なし (累積) | 分析履歴の時系列 (最大100件ローリング) |
| **Validation** | `{symbol}_validation_{strategy}_{tf}_{date}.json` | **7日** | 戦略別Go/NoGo判定結果 |

- **書込み**: `/api/fundamental` ルートでGemini API呼出し後。History は分析実行のたびに自動追記
- **読出し**: `GET /api/fundamental?symbol=...&step=research|analysis|history|validations`
- **強制更新**: `?refresh=true`

---

## 6. マーケットインテリジェンスキャッシュ (Market Intelligence Cache)

| 項目 | 内容 |
|------|------|
| **モジュール** | `src/lib/cache/marketIntelligenceCache.ts` |
| **保存先** | `.cache/market-intelligence/latest.json` (全体で1ファイル) |
| **データ** | セクターハイライト, マクロ要因, リスク, 投資機会 |
| **TTL** | **6時間** |
| **書込みタイミング** | `fetchMarketIntelligence()` (Gemini Grounding) 呼出し後 |
| **読出しタイミング** | マーケット概況ダッシュボード, シグナル監視スクリプト |
| **強制更新** | なし |

---

## 7. LLM分析キャッシュ (Analysis Cache)

| 項目 | 内容 |
|------|------|
| **モジュール** | `src/lib/cache/analysisCache.ts` |
| **保存先** | `.cache/analysis/{symbol}.json` (例: `7203_T.json`) |
| **データ** | LLM分析結果 + センチメントデータ (ニュース要約, 投資判断) |
| **TTL** | **24時間** |
| **書込みタイミング** | `setCachedAnalysis()` — LLM分析完了後 |
| **読出しタイミング** | センチメント分析・AIシグナルフィルタリングで使用 |
| **強制更新** | なし |

---

## 8. J-Quants データキャッシュ

| 項目 | 内容 |
|------|------|
| **モジュール** | `src/lib/cache/jquantsCache.ts` |

### サブタイプ別

| サブタイプ | 保存先 | TTL | 内容 |
|-----------|--------|-----|------|
| **Master** | `.cache/jquants-master/all.json` | **7日** | 上場銘柄マスタ (全銘柄1ファイル) |
| **Bars** | `.cache/jquants-bars/{symbol}.json` | **30日** | 日足OHLCV (銘柄別) |

- **書込み**: `npm run jquants:master` / `npm run jquants:bars` スクリプト実行時
- **読出し**: `getCachedMaster()` / `getCachedBars()` でキャッシュ優先チェック
- **強制更新**: `--force` フラグ
- **備考**: J-Quants Freeプランはデータが12週遅延のため長めのTTL設定

---

## 9. シグナル通知キャッシュ (Signal Notification Cache)

| 項目 | 内容 |
|------|------|
| **モジュール** | `src/lib/cache/signalNotificationCache.ts` |
| **保存先** | `data/notified-signals.json` (`.cache/` ではなく `data/`) |
| **データ** | Slack通知済みシグナルの履歴 |
| **TTL** | **90日** (保持期間。期限切れエントリは自動削除) |
| **書込みタイミング** | `markAsNotified()` — Slack通知送信成功後 |
| **読出しタイミング** | `hasBeenNotified()` — シグナル検出時に重複チェック |
| **キー構造** | `{symbol}:{strategyId}:{timeframe}:{signalDate}` |
| **クリーンアップ** | `cleanupOldNotifications()` で90日超のエントリを削除 |

- 同一シグナルの二重通知を防ぐためのキャッシュ

---

## 10. バッチ処理進捗 (Batch Progress)

| 項目 | 内容 |
|------|------|
| **保存先** | `data/batch-progress.json` |
| **データ** | バッチ処理の銘柄別完了状況 (news/analyze/fundamental) |
| **書込みタイミング** | シグナル監視バッチで各ステップ完了時 |
| **読出しタイミング** | バッチ処理の再開時に完了済み銘柄をスキップ |

---

## TTL 一覧表

| キャッシュ | TTL | 理由 |
|-----------|-----|------|
| 株価 (市場中) | 5分 | リアルタイム性重視 |
| 株価 (市場外) | 24時間 | データ変動なし |
| シグナル | 1時間 | 日中の株価変動を反映 |
| ニュース | 6時間 | ニュース更新頻度に合わせて |
| 財務指標 | 6時間 | 四半期決算以外は低頻度変動 |
| マーケットインテリジェンス | 6時間 | 市場全体の動向サマリ |
| ファンダ Research | 12時間 | 企業の基本情報は半日で十分 |
| ファンダ Analysis | 24時間 | LLM分析は1日1回で十分 |
| LLM分析 | 24時間 | 同上 |
| ファンダ Validation | 7日 | シグナルのGo/NoGo判定は週単位 |
| J-Quants マスタ | 7日 | 銘柄情報は低頻度変動 |
| J-Quants 株価 | 30日 | 12週遅延データのため |
| 通知履歴 | 90日 | 重複防止の十分な期間 |

---

## 共通仕様

### Vercel対応
すべてのファイルキャッシュは環境を自動判定:
- **ローカル**: `.cache/` (プロジェクトルート)
- **Vercel**: `/tmp/.cache/` (読み書き可能な一時領域)

### エラーハンドリング
- キャッシュ書込み失敗は **サイレント無視** (例外を投げない)
- キャッシュ読出し失敗は **キャッシュミス扱い** → APIから再取得

### ファイル命名規則
- シンボルの `.` を `_` に置換: `7203.T` → `7203_T`
- 例: `.cache/prices/7203_T_daily.json`

### キャッシュ判定フロー (共通パターン)
```
リクエスト受信
  → キャッシュファイル存在チェック
    → 存在しない: APIから取得 → キャッシュ保存 → レスポンス
    → 存在する: TTL経過チェック
      → 期限内: キャッシュから読出し → レスポンス
      → 期限切れ: APIから取得 → キャッシュ上書き → レスポンス
```

### リクエスト並列制御 (キャッシュではないが関連)
- `src/lib/utils/requestQueue.ts`
  - `yfQueue`: Yahoo Finance API — 同時 **10リクエスト**
  - `jqQueue`: J-Quants API — 同時 **5リクエスト**
