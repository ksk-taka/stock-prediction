/**
 * EDINET 自社株買い詳細データ抽出
 * ==================================
 * 自己株券買付状況報告書の XBRL TextBlock から
 * HTMLテーブルをパースして買付詳細データを抽出する。
 *
 * XBRLタグ構造:
 *   - jpcrp-sbr_cor:AcquisitionsByResolutionOfBoardOfDirectorsMeetingTextBlock
 *     → 取締役会決議による取得テーブル（上限・累計・進捗）
 *   - header table の【報告期間】行から報告対象期間
 */

import * as cheerio from "cheerio";
import { downloadXbrlZip, findXbrlFiles } from "./edinetXbrl";
import { fetchBuybackDocuments } from "./edinetBuyback";
import type { BuybackReport, BuybackDetail, BuybackDocEntry } from "@/types/buyback";

const REQUEST_DELAY_MS = 1500;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── テキストから数値を抽出 ──

function parseNum(text: string): number | null {
  if (!text) return null;
  let s = text.replace(/[０-９]/g, (ch) =>
    String.fromCharCode(ch.charCodeAt(0) - 0xfee0),
  );
  s = s.replace(/[．]/g, ".").replace(/[,\s\u3000]/g, "").replace(/[△▲]/g, "-");
  // "（上限）" 等のサフィックスを除去
  s = s.replace(/[（(].*?[）)]/g, "");
  const m = s.match(/-?[\d]+\.?[\d]*/);
  return m ? parseFloat(m[0]) : null;
}

/** 日本語日付テキストから YYYY-MM-DD を抽出 */
function parseJpDate(text: string): string | null {
  // "2025年８月28日" or "2025年8月28日"
  const s = text.replace(/[０-９]/g, (ch) =>
    String.fromCharCode(ch.charCodeAt(0) - 0xfee0),
  );
  const m = s.match(/(\d{4})年(\d{1,2})月(\d{1,2})日/);
  if (!m) return null;
  return `${m[1]}-${String(Number(m[2])).padStart(2, "0")}-${String(Number(m[3])).padStart(2, "0")}`;
}

// ── XBRL TextBlock からHTMLテーブルを抽出してパース ──

interface ParsedBuybackTable {
  resolutionDate: string | null;
  acquisitionPeriodFrom: string | null;
  acquisitionPeriodTo: string | null;
  maxShares: number | null;
  maxAmount: number | null;
  sharesAcquired: number | null;
  amountSpent: number | null;
  cumulativeShares: number | null;
  cumulativeAmount: number | null;
  progressSharesPct: number | null;
  progressAmountPct: number | null;
}

function parseBuybackTable(html: string): ParsedBuybackTable {
  const result: ParsedBuybackTable = {
    resolutionDate: null,
    acquisitionPeriodFrom: null,
    acquisitionPeriodTo: null,
    maxShares: null,
    maxAmount: null,
    sharesAcquired: null,
    amountSpent: null,
    cumulativeShares: null,
    cumulativeAmount: null,
    progressSharesPct: null,
    progressAmountPct: null,
  };

  const $ = cheerio.load(html);
  const tables = $("table").toArray();
  if (tables.length === 0) return result;

  // 最も行数が多いテーブルを選択（メインの買付テーブル）
  let mainTable = tables[0];
  let maxRows = 0;
  for (const t of tables) {
    const rowCount = $(t).find("tr").length;
    if (rowCount > maxRows) {
      maxRows = rowCount;
      mainTable = t;
    }
  }

  const rows = $(mainTable).find("tr").toArray();

  for (const row of rows) {
    const cells = $(row).find("td, th").toArray();
    const cellTexts = cells.map((c) => $(c).text().trim().replace(/\s+/g, " "));
    const firstCell = cellTexts[0] ?? "";

    // 取締役会決議行: "取締役会(2025年６月３日)での決議状況..." or "取締役会(日付および日付)"
    if (firstCell.includes("取締役会") && firstCell.includes("決議")) {
      // 決議日を抽出 (最初の日付)
      const dateMatch = firstCell.match(/取締役会[（(]([^）)]+)[）)]/);
      if (dateMatch) {
        result.resolutionDate = dateMatch[1]
          .replace(/[０-９]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0));
      }

      // 取得期間を抽出
      const periodMatch = firstCell.match(/取得期間[（(]?([^）)]*?)[）)]?\s*$/);
      if (periodMatch) {
        const periodText = periodMatch[1];
        // "2025年８月28日～2026年３月19日" パターン
        const dates = periodText.split(/[～〜~]/);
        if (dates.length === 2) {
          result.acquisitionPeriodFrom = parseJpDate(dates[0]);
          result.acquisitionPeriodTo = parseJpDate(dates[1]);
        }
      }
      // 取得期間が行テキスト内に含まれる別パターン
      if (!result.acquisitionPeriodFrom) {
        const periodAlt = firstCell.match(/取得期間[（(]?(\d{4}年[^～〜~]+[～〜~][^）)]+)/);
        if (periodAlt) {
          const dates = periodAlt[1].split(/[～〜~]/);
          if (dates.length === 2) {
            result.acquisitionPeriodFrom = parseJpDate(dates[0]);
            result.acquisitionPeriodTo = parseJpDate(dates[1]);
          }
        }
      }

      // 上限株数・上限金額 (後続セル)
      if (cellTexts.length >= 3) {
        result.maxShares = parseNum(cellTexts[cellTexts.length - 2]);
        result.maxAmount = parseNum(cellTexts[cellTexts.length - 1]);
      } else if (cellTexts.length === 2) {
        // 株数と金額が1セルにまとまっている場合
        result.maxShares = parseNum(cellTexts[1]);
      }
    }

    // 当月の取得計 ("計" が先頭)
    if (firstCell === "計" || firstCell.startsWith("計")) {
      if (cellTexts.length >= 3) {
        result.sharesAcquired = parseNum(cellTexts[cellTexts.length - 2]);
        result.amountSpent = parseNum(cellTexts[cellTexts.length - 1]);
      }
    }

    // 累計取得
    if (firstCell.includes("累計")) {
      if (cellTexts.length >= 3) {
        result.cumulativeShares = parseNum(cellTexts[cellTexts.length - 2]);
        result.cumulativeAmount = parseNum(cellTexts[cellTexts.length - 1]);
      } else if (cellTexts.length === 2) {
        // セル結合パターン
        result.cumulativeShares = parseNum(cellTexts[1]);
      }
    }

    // 進捗状況
    if (firstCell.includes("進捗状況") || firstCell.includes("進捗")) {
      if (cellTexts.length >= 3) {
        result.progressSharesPct = parseNum(cellTexts[cellTexts.length - 2]);
        result.progressAmountPct = parseNum(cellTexts[cellTexts.length - 1]);
      }
    }
  }

  return result;
}

/** ヘッダーHTMLから報告期間を抽出 */
function parseReportPeriod(
  xbrlFiles: { name: string; content: string }[],
): { from: string | null; to: string | null } {
  for (const file of xbrlFiles) {
    if (!file.name.toLowerCase().includes("header")) continue;
    const $ = cheerio.load(file.content);
    const rows = $("tr").toArray();
    for (const row of rows) {
      const cells = $(row).find("td, th").toArray();
      const texts = cells.map((c) => $(c).text().trim());
      if (texts.some((t) => t.includes("報告期間"))) {
        const periodText = texts.find((t) => t.includes("自") && t.includes("至"));
        if (periodText) {
          const fromMatch = periodText.match(/自\s*(.+?)\s*至/);
          const toMatch = periodText.match(/至\s*(.+?)$/);
          return {
            from: fromMatch ? parseJpDate(fromMatch[1]) : null,
            to: toMatch ? parseJpDate(toMatch[1]) : null,
          };
        }
      }
    }
  }
  return { from: null, to: null };
}

// ── メインの抽出関数 ──

/**
 * XBRL ファイル群から自社株買いレポートデータを抽出する。
 */
export function extractBuybackReport(
  xbrlFiles: { name: string; content: string }[],
  docId: string,
  filingDate: string,
): BuybackReport {
  // TextBlockの内容を取得 (.xbrl ファイルから)
  let acquisitionHtml = "";

  for (const file of xbrlFiles) {
    if (!file.name.endsWith(".xbrl")) continue;
    const $ = cheerio.load(file.content, { xmlMode: true });

    // AcquisitionsByResolutionOfBoardOfDirectorsMeetingTextBlock を探す
    for (const el of $("*").toArray()) {
      const tagName = ((el as unknown as { tagName?: string }).tagName ?? "").toLowerCase();
      if (tagName.includes("acquisitionsbyresolutionofboardofdirectorsmeetingtextblock")) {
        acquisitionHtml = $(el).text();
        break;
      }
    }
    if (acquisitionHtml) break;
  }

  // inline XBRL (.htm) からも探す
  if (!acquisitionHtml) {
    for (const file of xbrlFiles) {
      if (!file.name.endsWith(".htm") && !file.name.endsWith(".html")) continue;
      if (file.name.toLowerCase().includes("header")) continue;
      const $ = cheerio.load(file.content);

      // ix:nonNumeric 内の name 属性でマッチ
      for (const el of $("*").toArray()) {
        const name = $(el).attr("name") ?? "";
        if (name.toLowerCase().includes("acquisitionsbyresolutionofboardofdirectorsmeetingtextblock")) {
          // この要素の子HTMLを取得
          acquisitionHtml = $(el).html() ?? "";
          break;
        }
      }
      if (acquisitionHtml) break;

      // フォールバック: HTMLテーブルで「取締役会」と「決議」を含むテーブルを探す
      const tables = $("table").toArray();
      for (const table of tables) {
        const text = $(table).text();
        if (text.includes("取締役会") && text.includes("決議") && text.includes("累計")) {
          acquisitionHtml = $.html(table);
          break;
        }
      }
      if (acquisitionHtml) break;
    }
  }

  const parsed = acquisitionHtml ? parseBuybackTable(acquisitionHtml) : {
    resolutionDate: null, acquisitionPeriodFrom: null, acquisitionPeriodTo: null,
    maxShares: null, maxAmount: null, sharesAcquired: null, amountSpent: null,
    cumulativeShares: null, cumulativeAmount: null, progressSharesPct: null, progressAmountPct: null,
  };

  const period = parseReportPeriod(xbrlFiles);

  return {
    reportPeriodFrom: period.from,
    reportPeriodTo: period.to,
    resolutionDate: parsed.resolutionDate,
    acquisitionPeriodFrom: parsed.acquisitionPeriodFrom,
    acquisitionPeriodTo: parsed.acquisitionPeriodTo,
    maxShares: parsed.maxShares,
    maxAmount: parsed.maxAmount,
    sharesAcquired: parsed.sharesAcquired,
    amountSpent: parsed.amountSpent,
    cumulativeShares: parsed.cumulativeShares,
    cumulativeAmount: parsed.cumulativeAmount,
    progressSharesPct: parsed.progressSharesPct,
    progressAmountPct: parsed.progressAmountPct,
    docId,
    filingDate,
  };
}

// ── 単一銘柄の詳細取得 ──

/**
 * 特定銘柄の自社株買い詳細情報を取得する。
 */
export async function fetchBuybackDetail(
  symbol: string,
  opts?: { scanDays?: number; existingDocs?: BuybackDocEntry[] },
): Promise<BuybackDetail | null> {
  const apiKey = process.env.EDINET_API_KEY;
  if (!apiKey) throw new Error("EDINET_API_KEY が設定されていません");

  const stockCode = symbol.replace(".T", "");

  // 文書メタデータの取得
  let docs = opts?.existingDocs;
  if (!docs) {
    const docsMap = await fetchBuybackDocuments(
      new Set([stockCode]),
      opts?.scanDays,
    );
    docs = docsMap.get(stockCode);
  }

  if (!docs || docs.length === 0) return null;

  // 全文書のXBRLを取得してパース
  const reports: BuybackReport[] = [];
  for (const doc of docs) {
    const zip = await downloadXbrlZip(doc.docId, apiKey);
    if (!zip) {
      await sleep(REQUEST_DELAY_MS);
      continue;
    }

    const files = findXbrlFiles(zip);
    const report = extractBuybackReport(files, doc.docId, doc.filingDate);
    reports.push(report);

    await sleep(REQUEST_DELAY_MS);
  }

  if (reports.length === 0) return null;

  const latest = reports[0];
  const today = new Date().toISOString().slice(0, 10);

  // 進捗率: レポートに記載があればそれを使用、なければ計算
  let progressShares = latest.progressSharesPct;
  let progressAmount = latest.progressAmountPct;

  if (progressShares == null && latest.cumulativeShares != null && latest.maxShares != null && latest.maxShares > 0) {
    progressShares = (latest.cumulativeShares / latest.maxShares) * 100;
  }
  if (progressAmount == null && latest.cumulativeAmount != null && latest.maxAmount != null && latest.maxAmount > 0) {
    progressAmount = (latest.cumulativeAmount / latest.maxAmount) * 100;
  }

  // isActive: 取得期間内かどうか
  let isActive = true;
  if (latest.acquisitionPeriodTo) {
    isActive = today <= latest.acquisitionPeriodTo;
  }
  // 進捗100%なら完了
  if (progressShares != null && progressShares >= 100) isActive = false;
  if (progressAmount != null && progressAmount >= 100) isActive = false;

  return {
    stockCode,
    filerName: docs[0].filerName,
    latestReport: latest,
    allReports: reports,
    progressShares: progressShares != null ? Math.round(progressShares * 10) / 10 : null,
    progressAmount: progressAmount != null ? Math.round(progressAmount * 10) / 10 : null,
    isActive,
    scannedAt: new Date().toISOString(),
  };
}

// ── バッチ取得 ──

/**
 * 複数銘柄の自社株買い詳細情報をバッチ取得する。
 * documents.json のスキャンは1回で共有。
 */
export async function fetchBuybackDetailBatch(
  symbols: string[],
  opts?: { scanDays?: number; onProgress?: (done: number, total: number, symbol: string) => void },
): Promise<Map<string, BuybackDetail>> {
  const apiKey = process.env.EDINET_API_KEY;
  if (!apiKey) throw new Error("EDINET_API_KEY が設定されていません");

  const stockCodes = symbols.map((s) => s.replace(".T", ""));
  const targetSet = new Set(stockCodes);

  // 全対象銘柄の文書を1回のスキャンで取得
  console.log(`[BuybackDetail] ${targetSet.size} 銘柄の文書を検索中...`);
  const docsMap = await fetchBuybackDocuments(targetSet, opts?.scanDays);

  const results = new Map<string, BuybackDetail>();
  const codes = [...docsMap.keys()];

  for (let i = 0; i < codes.length; i++) {
    const code = codes[i];
    const docs = docsMap.get(code)!;
    opts?.onProgress?.(i + 1, codes.length, code);

    const detail = await fetchBuybackDetail(`${code}.T`, { existingDocs: docs });
    if (detail) {
      results.set(code, detail);
    }
  }

  return results;
}
