# Stock Prediction App

日本株（東証上場銘柄）のテクニカルシグナル検出・バックテスト・Slack通知アプリ。

## 技術スタック

- Next.js 16 (App Router) + TypeScript + Tailwind CSS v4 + Recharts
- Yahoo Finance API (yahoo-finance2)
- Gemini API (Grounding with Google Search)
- Slack Bot (Socket Mode, @slack/bolt)

## セットアップ

```bash
npm install
cp .env.local.example .env.local  # 環境変数を設定
```

### 環境変数 (`.env.local`)

| 変数 | 必須 | 説明 |
|---|---|---|
| `GEMINI_API_KEY` | Yes | Gemini API キー（Web Research / LLM分析） |
| `SLACK_WEBHOOK_URL` | - | Slack Incoming Webhook URL（一方通行通知） |
| `SLACK_BOT_TOKEN` | - | Slack Bot User OAuth Token (`xoxb-...`) |
| `SLACK_APP_TOKEN` | - | Slack App-Level Token (`xapp-...`, Socket Mode用) |
| `SLACK_CHANNEL_ID` | - | 通知先チャンネルID (`C0XXXXXXX`) |
| `LLM_PROVIDER` | - | LLMプロバイダ: `gemini` / `groq` / `ollama` |
| `GROQ_API_KEY` | - | Groq API キー（LLMフォールバック用） |
| `OLLAMA_BASE_URL` | - | Ollama URL（デフォルト: `http://localhost:11434`） |

## Web UI

```bash
npm run dev          # 開発サーバー起動 (http://localhost:3000)
npm run build        # 本番ビルド
npm run start        # 本番サーバー起動
```

## Slack通知

### 概要

シグナルモニターがお気に入り銘柄のシグナルを検出し、Slackに通知を送信する。
Bot Token設定時は「購入実行」「スキップ」ボタンが付き、ボタン押下結果は `data/order-history.json` にローカル保存される。

### Webhook のみ（一方通行）

`SLACK_WEBHOOK_URL` だけ設定すればシグナル通知は送れる。ボタンは付かない。

### Bot Token + Socket Mode（双方向・ボタン付き）

#### 1. Slack App 作成

1. https://api.slack.com/apps で **Create New App** → **From scratch**
2. **Socket Mode** を有効化 → App-Level Token (`xapp-...`) を発行
3. **Interactivity & Shortcuts** → Interactivity を ON（Request URLは空欄でOK）
4. **OAuth & Permissions** → Bot Token Scopes に追加:
   - `chat:write`
   - `chat:write.customize`
5. **Install App** でワークスペースにインストール → Bot Token (`xoxb-...`) を取得
6. 通知先チャンネルで `/invite @AppName` でBotを招待
7. チャンネル詳細からチャンネルID (`C0XXXXXXX`) を確認

#### 2. 環境変数を設定

```
SLACK_BOT_TOKEN=xoxb-...
SLACK_APP_TOKEN=xapp-...
SLACK_CHANNEL_ID=C0XXXXXXX
```

#### 3. 実行

```bash
# Bot常駐起動（ボタン押下の待ち受け）
npm run slack:bot

# シグナル検出 → 分析 → Slack通知
npm run monitor:signals

# 分析なし高速モード
npm run monitor:signals:fast

# dry-run（Slack送信なし）
npm run monitor:signals:dry

# Slack接続テスト
npm run test:slack
```

`slack:bot` と `monitor:signals` は**2プロセス並行**で運用する。
`slack:bot` はボタン押下の常駐待ち受け、`monitor:signals` はシグナル検出＋通知送信（1回実行で終了）。

### 通知対象の設定

`src/lib/config/notificationConfig.ts` にデフォルト設定あり。
`data/notification-config.json` を作成するとデフォルトを上書きできる。

- お気に入り銘柄のみ（`favoritesOnly: true`）
- 有効戦略: RSI逆張り, MACDトレーリング, 急落買い, 田端式CWH
- 直近7日間のシグナルが対象

## バックテスト

```bash
# 単発バックテスト
npx tsx scripts/run-backtest.ts

# 全銘柄バックテスト（CSV出力）
npm run backtest:all

# 10年データ取得 + マルチウィンドウBT
npm run fetch:10yr
npm run backtest:10yr

# ウォークフォワード分析
npm run walkforward
```

## Gemini用プロンプト生成

銘柄コードを指定すると、Yahoo Financeから定量データ＋6ヶ月分の日足OHLCVを取得し、Geminiに貼り付けるためのMarkdownプロンプトを自動生成する。

```bash
# 標準出力に表示
npm run prompt:gemini 6503.T
npm run prompt:gemini 6503        # .T は省略可

# クリップボードにコピー（そのままGeminiに貼り付け）
npm run prompt:gemini:clip 6503
```

### 含まれる情報

- 銘柄情報（業種・時価総額・事業概要）
- 株価情報（現在値・52週高安・移動平均）
- バリュエーション（PER/PBR/EPS/配当利回り/Beta）
- 財務指標（ROE/ROA/利益率/成長率/D&E/FCF）
- アナリストコンセンサス（目標株価・レーティング）
- 決算発表日（残日数を自動計算）
- 6ヶ月分の日足OHLCVテーブル（約120行）
- チャート注目ポイント自動検出（トレンド・出来高スパイク・MA乖離・52週高値圏・PER乖離）

### 使い方

1. `npm run prompt:gemini:clip 6503` でプロンプトをクリップボードにコピー
2. Geminiを開いてプロンプトをペースト
3. 決算資料PDFがあれば一緒に添付
4. Go / No Go / 様子見 の投資判断を取得

決算資料のダウンロードは `npm run fetch:earnings -- --symbol 6503.T` で可能。

## 決算資料

```bash
# 決算資料ダウンロード（Kabutan決算短信 + TDnet説明資料 + EDINET有報）
npm run fetch:earnings -- --symbol 7203.T
npm run fetch:earnings              # お気に入り全銘柄

# 決算資料LLM分析（ローカルPDF → Go/NoGo判定）
npm run analyze:earnings 7203.T
npm run analyze:earnings:all        # 全銘柄
npm run analyze:earnings:list       # 利用可能な銘柄一覧
```

## その他のスクリプト

```bash
npm run fetch:stocks        # JPX公開Excel→全東証銘柄登録
npm run scan:highs          # 新高値スキャナー（Kabutan）
npm run scan:highs:csv      # 新高値スキャナー（CSV出力）
npm run scan:signals        # 全銘柄シグナルスキャン
npm run scan:signals:quick  # クイックスキャン
```
