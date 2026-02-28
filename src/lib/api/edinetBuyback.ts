/**
 * EDINET 自社株買い銘柄抽出
 * ==========================
 * EDINET API v2 から直近90日の提出書類を検索し、
 * 自己株券買付状況報告書 / 自己株式の取得 に該当する銘柄コードを抽出する。
 */

const EDINET_API_BASE = "https://api.edinet-fsa.go.jp/api/v2";
const SCAN_DAYS = 90;
const REQUEST_DELAY_MS = 1000;
const MAX_RETRIES = 3;
const INITIAL_BACKOFF_MS = 2000;

// ── ユーティリティ ──

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function formatDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** "72030" → "7203" (5桁secCode → 4桁銘柄コード) */
function toStockCode(secCode: string): string {
  return secCode.slice(0, 4);
}

/** docDescription / title に自社株買い関連キーワードが含まれるか */
function isBuybackDoc(doc: Record<string, string | null>): boolean {
  const text = `${doc.docDescription ?? ""} ${doc.title ?? ""}`;
  return text.includes("自己株券買付状況報告書") || text.includes("自己株式の取得");
}

// ── メイン関数 ──

/**
 * 直近90日間で自社株買いを実施・発表した企業の銘柄コード(4桁)リストを返す。
 * @returns ユニークな4桁銘柄コードの配列 (例: ["7203", "8058", "9432"])
 */
export async function fetchBuybackStockCodes(): Promise<string[]> {
  const apiKey = process.env.EDINET_API_KEY;
  if (!apiKey) {
    throw new Error("EDINET_API_KEY が設定されていません");
  }

  // 前日から90日分の日付リストを生成
  const dates: string[] = [];
  const today = new Date();
  for (let i = 1; i <= SCAN_DAYS; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    dates.push(formatDate(d));
  }

  const codesSet = new Set<string>();

  for (let i = 0; i < dates.length; i++) {
    const dateStr = dates[i];
    let success = false;

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        const url = `${EDINET_API_BASE}/documents.json?date=${dateStr}&type=2&Subscription-Key=${apiKey}`;
        const res = await fetch(url);

        if (res.status === 429 || res.status >= 500) {
          const backoff = INITIAL_BACKOFF_MS * Math.pow(2, attempt);
          console.warn(`[EDINET] ${dateStr} HTTP ${res.status}, retry ${attempt + 1}/${MAX_RETRIES} (${backoff}ms)`);
          await sleep(backoff);
          continue;
        }

        if (!res.ok) {
          console.warn(`[EDINET] ${dateStr} HTTP ${res.status} - スキップ`);
          success = true;
          break;
        }

        const json = await res.json();
        const results = (json.results ?? []) as Array<Record<string, string | null>>;

        for (const doc of results) {
          if (doc.secCode && isBuybackDoc(doc)) {
            codesSet.add(toStockCode(doc.secCode));
          }
        }

        success = true;
        break;
      } catch (err) {
        const backoff = INITIAL_BACKOFF_MS * Math.pow(2, attempt);
        console.warn(`[EDINET] ${dateStr} エラー: ${err instanceof Error ? err.message : err}, retry ${attempt + 1}/${MAX_RETRIES} (${backoff}ms)`);
        await sleep(backoff);
      }
    }

    if (!success) {
      console.warn(`[EDINET] ${dateStr} 全リトライ失敗 - スキップ`);
    }

    // 進捗ログ (10日ごと)
    if ((i + 1) % 10 === 0) {
      console.log(`[EDINET] ${i + 1}/${dates.length} 日処理済み (${codesSet.size} 銘柄検出)`);
    }

    // リクエスト間に1秒スリープ
    await sleep(REQUEST_DELAY_MS);
  }

  const result = [...codesSet].sort();
  console.log(`[EDINET] 自社株買い銘柄: ${result.length} 件`);
  return result;
}
