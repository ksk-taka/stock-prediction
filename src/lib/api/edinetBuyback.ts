/**
 * EDINET 自社株買い銘柄抽出
 * ==========================
 * EDINET API v2 から直近90日の提出書類を検索し、
 * 自己株券買付状況報告書 / 自己株式の取得 に該当する銘柄コードを抽出する。
 */

import type { BuybackDocEntry } from "@/types/buyback";

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

/** 自己株券買付状況報告書かどうか */
function isBuybackStatusReport(doc: Record<string, string | null>): boolean {
  const text = `${doc.docDescription ?? ""} ${doc.title ?? ""}`;
  return text.includes("自己株券買付状況報告書");
}

/** 自社株買い関連の文書かどうか（状況報告書 + 臨時報告書含む） */
function isBuybackDoc(doc: Record<string, string | null>): boolean {
  const text = `${doc.docDescription ?? ""} ${doc.title ?? ""}`;
  return text.includes("自己株券買付状況報告書") || text.includes("自己株式の取得");
}

// ── 日付スキャン共通処理 ──

interface ScanCallbacks {
  onDoc: (doc: Record<string, string | null>, dateStr: string) => void;
  onProgress?: (done: number, total: number, count: number) => void;
}

async function scanEdinetDates(
  apiKey: string,
  scanDays: number,
  callbacks: ScanCallbacks,
): Promise<void> {
  const dates: string[] = [];
  const today = new Date();
  for (let i = 1; i <= scanDays; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() - i);
    dates.push(formatDate(d));
  }

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
          callbacks.onDoc(doc, dateStr);
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

    if ((i + 1) % 10 === 0) {
      callbacks.onProgress?.(i + 1, dates.length, 0);
    }

    await sleep(REQUEST_DELAY_MS);
  }
}

// ── メイン関数 ──

/**
 * 直近90日間で自社株買いを実施・発表した企業の銘柄コード(4桁)リストを返す。
 * @returns ユニークな4桁銘柄コードの配列 (例: ["7203", "8058", "9432"])
 */
export async function fetchBuybackStockCodes(): Promise<string[]> {
  const apiKey = process.env.EDINET_API_KEY;
  if (!apiKey) throw new Error("EDINET_API_KEY が設定されていません");

  const codesSet = new Set<string>();

  await scanEdinetDates(apiKey, SCAN_DAYS, {
    onDoc: (doc) => {
      if (doc.secCode && isBuybackDoc(doc)) {
        codesSet.add(toStockCode(doc.secCode));
      }
    },
    onProgress: (done, total) => {
      console.log(`[EDINET] ${done}/${total} 日処理済み (${codesSet.size} 銘柄検出)`);
    },
  });

  const result = [...codesSet].sort();
  console.log(`[EDINET] 自社株買い銘柄: ${result.length} 件`);
  return result;
}

/**
 * 直近の自己株券買付状況報告書のメタデータを取得する。
 * @param targetCodes 対象銘柄コード(4桁)のSet。省略時は全銘柄。
 * @param scanDays スキャン日数 (デフォルト90)
 * @returns 銘柄コード → 文書メタデータ配列 (提出日降順)
 */
export async function fetchBuybackDocuments(
  targetCodes?: Set<string>,
  scanDays = SCAN_DAYS,
): Promise<Map<string, BuybackDocEntry[]>> {
  const apiKey = process.env.EDINET_API_KEY;
  if (!apiKey) throw new Error("EDINET_API_KEY が設定されていません");

  const docsMap = new Map<string, BuybackDocEntry[]>();

  await scanEdinetDates(apiKey, scanDays, {
    onDoc: (doc, dateStr) => {
      if (!doc.secCode || !doc.docID) return;
      if (!isBuybackStatusReport(doc)) return;

      const stockCode = toStockCode(doc.secCode);
      if (targetCodes && !targetCodes.has(stockCode)) return;

      const entry: BuybackDocEntry = {
        docId: doc.docID,
        secCode: doc.secCode,
        stockCode,
        filerName: doc.filerName ?? "",
        docDescription: doc.docDescription ?? "",
        filingDate: dateStr,
      };

      const arr = docsMap.get(stockCode) ?? [];
      arr.push(entry);
      docsMap.set(stockCode, arr);
    },
    onProgress: (done, total) => {
      console.log(`[EDINET] ${done}/${total} 日処理済み (${docsMap.size} 銘柄のdoc検出)`);
    },
  });

  // 各銘柄のdocsを提出日降順にソート
  for (const [, docs] of docsMap) {
    docs.sort((a, b) => b.filingDate.localeCompare(a.filingDate));
  }

  console.log(`[EDINET] 自社株買い文書: ${docsMap.size} 銘柄`);
  return docsMap;
}
