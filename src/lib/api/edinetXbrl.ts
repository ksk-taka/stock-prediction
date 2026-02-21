/**
 * EDINET XBRL パーサー
 * ==================
 * EDINET API v2 から有価証券報告書の XBRL を取得し、
 * 大株主・自己株式データをパースして浮動株比率を推計する。
 */

import AdmZip from "adm-zip";
import * as cheerio from "cheerio";

// ── 定数 ──

const EDINET_API_BASE = "https://api.edinet-fsa.go.jp/api/v2";
const REQUEST_DELAY_MS = 500;
const DOC_TYPE_ANNUAL = "120"; // 有価証券報告書
const DOC_TYPE_CORRECTED = "130"; // 訂正有価証券報告書
const SEARCH_DAYS_DEFAULT = 400;

// ── 型定義 ──

export interface ShareholderEntry {
  name: string;
  shares: number;
  ratioPct: number; // %
}

export interface FloatingRatioResult {
  floatingRatio: number;
  majorShareholders: ShareholderEntry[];
  majorShareholderShares: number;
  treasuryShares: number;
  fixedShares: number;
  totalShares: number | null; // XBRL から取得できた場合
  docId: string;
  filerName: string;
  filingDate: string;
}

export interface EDINETDocResult {
  docId: string;
  secCode: string;
  filerName: string;
  docDescription: string;
  docTypeCode: string;
  filingDate: string;
}

// ── ユーティリティ ──

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** "7203.T" → "72030" */
function toSecCode(symbol: string): string {
  return symbol.replace(".T", "") + "0";
}

function formatDate(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// ── EDINET API ──

/**
 * EDINET API で対象銘柄の最新の有価証券報告書を検索する。
 */
export async function searchAnnualReport(
  symbol: string,
  apiKey: string,
  searchDays = SEARCH_DAYS_DEFAULT,
): Promise<EDINETDocResult | null> {
  const secCode = toSecCode(symbol);
  const today = new Date();

  // 営業日リストを生成
  const datesToScan: string[] = [];
  for (let d = 0; d < searchDays * 1.5 && datesToScan.length < searchDays; d++) {
    const date = new Date(today);
    date.setDate(today.getDate() - d);
    const dow = date.getDay();
    if (dow === 0 || dow === 6) continue;
    datesToScan.push(formatDate(date));
  }

  // 5並列でバッチ検索 (既存パターン踏襲)
  const CONCURRENCY = 5;
  for (let i = 0; i < datesToScan.length; i += CONCURRENCY) {
    const chunk = datesToScan.slice(i, i + CONCURRENCY);
    const chunkResults = await Promise.all(
      chunk.map(async (dateStr) => {
        const url = `${EDINET_API_BASE}/documents.json?date=${dateStr}&type=2&Subscription-Key=${apiKey}`;
        try {
          const res = await fetch(url);
          if (!res.ok) return [];
          const json = await res.json();
          return (json.results ?? []) as Array<Record<string, string>>;
        } catch {
          return [];
        }
      }),
    );

    for (let j = 0; j < chunkResults.length; j++) {
      for (const doc of chunkResults[j]) {
        if (
          doc.secCode === secCode &&
          (doc.docTypeCode === DOC_TYPE_ANNUAL || doc.docTypeCode === DOC_TYPE_CORRECTED)
        ) {
          return {
            docId: doc.docID,
            secCode: doc.secCode,
            filerName: doc.filerName ?? "",
            docDescription: doc.docDescription ?? "",
            docTypeCode: doc.docTypeCode,
            filingDate: chunk[j],
          };
        }
      }
    }

    await sleep(REQUEST_DELAY_MS);
  }

  return null;
}

/**
 * 複数銘柄の有価証券報告書を一括検索する (バッチ版)。
 * 日付走査を1回だけ行い、全銘柄のdocIDを同時に収集する。
 *
 * @returns symbol → EDINETDocResult のMap
 */
export async function searchAnnualReportBatch(
  symbols: string[],
  apiKey: string,
  searchDays = SEARCH_DAYS_DEFAULT,
  onProgress?: (searched: number, total: number, found: number) => void,
): Promise<Map<string, EDINETDocResult>> {
  const secCodeToSymbol = new Map<string, string>();
  for (const sym of symbols) {
    secCodeToSymbol.set(toSecCode(sym), sym);
  }
  const targetSecCodes = new Set(secCodeToSymbol.keys());
  const results = new Map<string, EDINETDocResult>();

  // 営業日リストを生成
  const today = new Date();
  const datesToScan: string[] = [];
  for (let d = 0; d < searchDays * 1.5 && datesToScan.length < searchDays; d++) {
    const date = new Date(today);
    date.setDate(today.getDate() - d);
    const dow = date.getDay();
    if (dow === 0 || dow === 6) continue;
    datesToScan.push(formatDate(date));
  }

  const CONCURRENCY = 5;
  let searched = 0;

  // 全銘柄が見つかったら早期終了
  const allFound = () => results.size >= symbols.length;

  for (let i = 0; i < datesToScan.length && !allFound(); i += CONCURRENCY) {
    const chunk = datesToScan.slice(i, i + CONCURRENCY);
    const chunkResults = await Promise.all(
      chunk.map(async (dateStr) => {
        const url = `${EDINET_API_BASE}/documents.json?date=${dateStr}&type=2&Subscription-Key=${apiKey}`;
        try {
          const res = await fetch(url);
          if (!res.ok) return { dateStr, docs: [] as Array<Record<string, string>> };
          const json = await res.json();
          return { dateStr, docs: (json.results ?? []) as Array<Record<string, string>> };
        } catch {
          return { dateStr, docs: [] as Array<Record<string, string>> };
        }
      }),
    );

    for (const { dateStr, docs } of chunkResults) {
      for (const doc of docs) {
        if (!targetSecCodes.has(doc.secCode)) continue;
        if (doc.docTypeCode !== DOC_TYPE_ANNUAL && doc.docTypeCode !== DOC_TYPE_CORRECTED) continue;

        const sym = secCodeToSymbol.get(doc.secCode)!;
        // 最初に見つかったもの (最新) を採用
        if (!results.has(sym)) {
          results.set(sym, {
            docId: doc.docID,
            secCode: doc.secCode,
            filerName: doc.filerName ?? "",
            docDescription: doc.docDescription ?? "",
            docTypeCode: doc.docTypeCode,
            filingDate: dateStr,
          });
        }
      }
    }

    searched += chunk.length;
    onProgress?.(searched, datesToScan.length, results.size);
    await sleep(REQUEST_DELAY_MS);
  }

  return results;
}

/**
 * EDINET API から XBRL ZIP (type=1) をダウンロードする。
 */
export async function downloadXbrlZip(docId: string, apiKey: string): Promise<Buffer | null> {
  const url = `${EDINET_API_BASE}/documents/${docId}?type=1&Subscription-Key=${apiKey}`;
  try {
    const res = await fetch(url);
    if (!res.ok) {
      console.error(`  EDINET XBRL download error: ${res.status} for ${docId}`);
      return null;
    }
    const contentType = res.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) {
      console.error(`  EDINET returned JSON instead of ZIP for ${docId}`);
      return null;
    }
    const arrayBuffer = await res.arrayBuffer();
    return Buffer.from(arrayBuffer);
  } catch (e) {
    console.error(`  EDINET XBRL download error for ${docId}:`, e);
    return null;
  }
}

// ── XBRL パーサー ──

/**
 * ZIP から PublicDoc 内の XBRL / inline XBRL ファイルを抽出する。
 */
export function findXbrlFiles(zipBuffer: Buffer): { name: string; content: string }[] {
  const results: { name: string; content: string }[] = [];
  try {
    const zip = new AdmZip(zipBuffer);
    for (const entry of zip.getEntries()) {
      const name = entry.entryName.toLowerCase().replace(/\\/g, "/");
      if (!name.includes("publicdoc")) continue;
      if (name.endsWith(".xbrl") || name.endsWith(".htm") || name.endsWith(".html")) {
        const content = entry.getData().toString("utf-8");
        results.push({ name: entry.entryName, content });
      }
    }
  } catch (e) {
    console.error("  Invalid ZIP file:", e);
  }
  return results;
}

/**
 * テキストから数値を抽出する。カンマ・全角数字・千株単位に対応。
 */
export function parseNumber(text: string): number | null {
  if (!text) return null;
  // 全角→半角
  let s = text.replace(/[０-９]/g, (ch) =>
    String.fromCharCode(ch.charCodeAt(0) - 0xfee0),
  );
  s = s.replace(/[,\s\u3000]/g, "").replace(/[△▲]/g, "-");

  let multiplier = 1;
  if (s.includes("千株")) {
    s = s.replace("千株", "");
    multiplier = 1000;
  } else if (s.includes("百株")) {
    s = s.replace("百株", "");
    multiplier = 100;
  } else {
    s = s.replace("株", "");
  }

  const m = s.match(/-?[\d]+/);
  return m ? parseInt(m[0], 10) * multiplier : null;
}

/**
 * テキストから割合 (%) を抽出する。
 */
function parseRatio(text: string): number {
  if (!text) return 0;
  let s = text.replace(/[０-９．]/g, (ch) => {
    if (ch === "．") return ".";
    return String.fromCharCode(ch.charCodeAt(0) - 0xfee0);
  });
  s = s.replace(/[,%％\s]/g, "");
  const m = s.match(/[\d]+\.?[\d]*/);
  return m ? parseFloat(m[0]) : 0;
}

/**
 * MajorShareholdersTextBlock 内の HTML テーブルから大株主を抽出する。
 */
function parseMajorShareholderTable(html: string): ShareholderEntry[] {
  const $ = cheerio.load(html);
  const entries: ShareholderEntry[] = [];

  for (const table of $("table").toArray()) {
    const rows = $(table).find("tr").toArray();
    if (rows.length < 2) continue;

    // ヘッダ行を解析して列インデックスを推定
    // 複数行ヘッダ対応: 最初の2行からヘッダ情報を収集
    let nameIdx = -1;
    let sharesIdx = -1;
    let ratioIdx = -1;
    let sharesMultiplier = 1; // ヘッダの単位から決定

    const headerRowCount = Math.min(3, rows.length);
    const headerTexts: string[] = [];
    for (let hr = 0; hr < headerRowCount; hr++) {
      const headerCells = $(rows[hr]).find("th, td").toArray();
      const headers = headerCells.map((el) => $(el).text().replace(/[\s\u3000]/g, ""));
      headerTexts.push(...headers);

      for (let i = 0; i < headers.length; i++) {
        const h = headers[i];
        if (/氏名|名称|株主名|株主の氏名/.test(h) && nameIdx < 0) nameIdx = i;
        else if (/所有株式数|持株数|株式数/.test(h) && sharesIdx < 0) {
          sharesIdx = i;
          // ヘッダ内の単位を検出: 「所有株式数（千株）」「株式数(千株)」等
          if (/千株/.test(h)) sharesMultiplier = 1000;
          else if (/百株/.test(h)) sharesMultiplier = 100;
          else if (/百万株/.test(h)) sharesMultiplier = 1_000_000;
        }
        else if (/割合|比率|持株比率|議決権/.test(h) && ratioIdx < 0) ratioIdx = i;
      }
      // nameIdx と sharesIdx が見つかったら検索終了
      if (nameIdx >= 0 && sharesIdx >= 0) break;
    }

    // ヘッダ全体のテキストからも千株を検出 (別の行に単位記載がある場合)
    if (sharesMultiplier === 1) {
      const allHeaderText = headerTexts.join("");
      if (/千株/.test(allHeaderText)) sharesMultiplier = 1000;
      else if (/百万株/.test(allHeaderText)) sharesMultiplier = 1_000_000;
      else if (/百株/.test(allHeaderText)) sharesMultiplier = 100;
    }

    if (nameIdx < 0 || sharesIdx < 0) continue;

    // データ行をパース (ヘッダが複数行の場合を考慮)
    const dataStartRow = nameIdx >= 0 ? Math.max(1, headerRowCount > 1 && sharesMultiplier > 1 ? 2 : 1) : 1;
    for (let r = dataStartRow; r < rows.length; r++) {
      const cells = $(rows[r]).find("td, th").toArray();
      if (cells.length <= Math.max(nameIdx, sharesIdx)) continue;

      const name = $(cells[nameIdx]).text().trim();
      if (!name || /^(計|合計|―|－|─)$/.test(name)) continue;

      const rawShares = parseNumber($(cells[sharesIdx]).text());
      if (rawShares == null || rawShares <= 0) continue;

      // parseNumber が既に千株変換済みでなければヘッダの multiplier を適用
      // parseNumber はテキスト中に「千株」がある場合のみ ×1000 する。
      // ヘッダに「千株」がありセル値が数値のみの場合はここで適用。
      const cellText = $(cells[sharesIdx]).text();
      const cellHasUnit = /[千百万]株/.test(cellText);
      const shares = cellHasUnit ? rawShares : rawShares * sharesMultiplier;

      const ratio = ratioIdx >= 0 && ratioIdx < cells.length
        ? parseRatio($(cells[ratioIdx]).text())
        : 0;

      entries.push({ name, shares, ratioPct: ratio });
    }

    if (entries.length > 0) break; // 最初の有効テーブルで終了
  }

  return entries;
}

/**
 * XBRL コンテンツから大株主情報を抽出する。
 * 複数のフォールバック:
 *   1. jpcrp_cor:MajorShareholdersTextBlock タグ (XML mode)
 *   2. ix:nonNumeric (inline XBRL)
 *   3. ヒューリスティック: 「大株主」近傍テーブル検出
 *   4. xmlMode を反転してリトライ (パースモード不一致対応)
 */
export function extractMajorShareholders(xbrlContent: string): ShareholderEntry[] {
  // 最初に推定されるモードで試行
  const isXml = xbrlContent.trimStart().startsWith("<?xml");
  const result = extractMajorShareholdersWithMode(xbrlContent, isXml);
  if (result.length > 0) return result;

  // モードを反転してリトライ (iXBRL HTMLが <?xml で始まるケース等)
  return extractMajorShareholdersWithMode(xbrlContent, !isXml);
}

function extractMajorShareholdersWithMode(xbrlContent: string, xmlMode: boolean): ShareholderEntry[] {
  const $ = cheerio.load(xbrlContent, { xmlMode });

  // 方法1: MajorShareholdersTextBlock (タグ名に含まれるもの全て)
  for (const el of $("*").toArray()) {
    const tagName = (el as unknown as { tagName?: string }).tagName?.toLowerCase() ?? "";
    if (tagName.includes("majorshareholderstextblock")) {
      const inner = $(el).html() ?? "";
      const entries = parseMajorShareholderTable(inner);
      if (entries.length > 0) return entries;
    }
  }

  // 方法2: ix:nonNumeric / ix:nonnumeric with MajorShareholder name attr
  for (const el of $("*").toArray()) {
    const tagName = (el as unknown as { tagName?: string }).tagName?.toLowerCase() ?? "";
    if (tagName.includes("nonnumeric")) {
      const nameAttr = ($(el).attr("name") ?? "").toLowerCase();
      if (nameAttr.includes("majorshareholder")) {
        const inner = $(el).html() ?? "";
        const entries = parseMajorShareholderTable(inner);
        if (entries.length > 0) return entries;
      }
    }
  }

  // 方法2b: ix:continuation (TextBlock が continuation に分割されるケース)
  for (const el of $("*").toArray()) {
    const tagName = (el as unknown as { tagName?: string }).tagName?.toLowerCase() ?? "";
    if (tagName.includes("continuation")) {
      const inner = $(el).html() ?? "";
      // テーブルに大株主テーブルの特徴があるか確認
      if (inner.includes("株式") && (inner.includes("名称") || inner.includes("氏名"))) {
        const entries = parseMajorShareholderTable(inner);
        if (entries.length > 0) return entries;
      }
    }
  }

  // 方法3: ヒューリスティック — 「大株主」を含むセクション近傍のテーブル
  const bodyText = $.text();
  if (bodyText.includes("大株主")) {
    for (const table of $("table").toArray()) {
      const tableText = $(table).text();
      if (
        (tableText.includes("株式") || tableText.includes("割合") || tableText.includes("持株")) &&
        (tableText.includes("名称") || tableText.includes("氏名"))
      ) {
        const entries = parseMajorShareholderTable($(table).html() ?? "");
        if (entries.length > 0) return entries;
      }
    }
  }

  // 方法3b: 「大株主」キーワードなしでもテーブル構造で検出
  for (const table of $("table").toArray()) {
    const tableText = $(table).text();
    // 少なくとも「所有株式数」と「名称/氏名」を含むテーブルを探す
    if (
      /所有株式数/.test(tableText) &&
      (/名称|氏名/.test(tableText))
    ) {
      const entries = parseMajorShareholderTable($(table).html() ?? "");
      if (entries.length > 0) return entries;
    }
  }

  return [];
}

/**
 * inline XBRL の scale 属性を考慮して数値を取得する。
 * scale="3" → ×10^3 = ×1000, scale="6" → ×10^6, etc.
 */
function parseXbrlNumericValue($: cheerio.CheerioAPI, el: Parameters<typeof $>[0]): number | null {
  const text = $(el).text();
  const rawValue = parseNumber(text);
  if (rawValue == null) return null;

  const scaleStr = $(el).attr("scale");
  if (scaleStr) {
    const scale = parseInt(scaleStr, 10);
    if (!isNaN(scale) && scale !== 0) {
      return rawValue * Math.pow(10, scale);
    }
  }
  return rawValue;
}

/**
 * XBRL から自己株式数を抽出する。
 */
export function extractTreasuryShares(xbrlContent: string): number {
  const $ = cheerio.load(xbrlContent, { xmlMode: xbrlContent.trimStart().startsWith("<?xml") });

  const patterns = [
    "numberoftreasuryshares",
    "treasurysharesheldbycompany",
    "treasurysharesownedbycompanyanditssubsidiaries",
    "numberoftreasurystockshares",
  ];

  // 直接タグ検索
  for (const el of $("*").toArray()) {
    const tagName = ((el as unknown as { tagName?: string }).tagName ?? "").toLowerCase().replace(/[_-]/g, "");
    for (const pattern of patterns) {
      if (tagName.includes(pattern)) {
        const value = parseXbrlNumericValue($, el);
        if (value != null && value >= 0) return value;
      }
    }
  }

  // inline XBRL (ix:nonFraction)
  for (const el of $("*").toArray()) {
    const tagName = ((el as unknown as { tagName?: string }).tagName ?? "").toLowerCase();
    if (tagName.includes("nonfraction") || tagName.includes("nonnumeric")) {
      const nameAttr = ($(el).attr("name") ?? "").toLowerCase().replace(/[_-]/g, "");
      for (const pattern of patterns) {
        if (nameAttr.includes(pattern)) {
          const value = parseXbrlNumericValue($, el);
          if (value != null && value >= 0) return value;
        }
      }
    }
  }

  return 0;
}

/**
 * XBRL から発行済株式総数を抽出する (参考値)。
 */
export function extractTotalShares(xbrlContent: string): number | null {
  const $ = cheerio.load(xbrlContent, { xmlMode: xbrlContent.trimStart().startsWith("<?xml") });

  const patterns = [
    "totalnumberofissuedshares",
    "totalsharesissued",
    "issuednumberofshares",
  ];

  for (const el of $("*").toArray()) {
    const tagName = ((el as unknown as { tagName?: string }).tagName ?? "").toLowerCase().replace(/[_-]/g, "");
    for (const pattern of patterns) {
      if (tagName.includes(pattern)) {
        const value = parseXbrlNumericValue($, el);
        if (value != null && value > 0) return value;
      }
    }
  }

  // inline XBRL
  for (const el of $("*").toArray()) {
    const tagName = ((el as unknown as { tagName?: string }).tagName ?? "").toLowerCase();
    if (tagName.includes("nonfraction")) {
      const nameAttr = ($(el).attr("name") ?? "").toLowerCase().replace(/[_-]/g, "");
      for (const pattern of patterns) {
        if (nameAttr.includes(pattern)) {
          const value = parseXbrlNumericValue($, el);
          if (value != null && value > 0) return value;
        }
      }
    }
  }

  return null;
}

// ── メイン: 浮動株比率推計 ──

/**
 * 銘柄の浮動株比率を推計する。
 * EDINET から有報 XBRL を取得し、大株主 + 自己株式から固定株比率を算出する。
 *
 * @param symbol 銘柄コード (例: "7203.T")
 * @param apiKey EDINET API キー
 * @param totalSharesFromYF Yahoo Finance から取得した発行済株式数 (XBRL取得失敗時のフォールバック)
 */
export async function estimateFloatingRatio(
  symbol: string,
  apiKey: string,
  totalSharesFromYF?: number,
  searchDays = SEARCH_DAYS_DEFAULT,
): Promise<FloatingRatioResult | null> {
  // 1. 有報検索
  console.log(`  [${symbol}] EDINET 有報検索中...`);
  const doc = await searchAnnualReport(symbol, apiKey, searchDays);
  if (!doc) {
    console.log(`  [${symbol}] 有報が見つかりません`);
    return null;
  }
  console.log(`  [${symbol}] 有報発見: ${doc.docDescription} (${doc.filingDate})`);

  // 2. XBRL ZIP ダウンロード
  await sleep(REQUEST_DELAY_MS);
  console.log(`  [${symbol}] XBRL ダウンロード中... (docId=${doc.docId})`);
  const zipBuffer = await downloadXbrlZip(doc.docId, apiKey);
  if (!zipBuffer) {
    console.log(`  [${symbol}] XBRL ダウンロード失敗`);
    return null;
  }

  // 3. XBRL ファイル展開
  const xbrlFiles = findXbrlFiles(zipBuffer);
  if (xbrlFiles.length === 0) {
    console.log(`  [${symbol}] ZIP 内に XBRL ファイルなし`);
    return null;
  }
  console.log(`  [${symbol}] ${xbrlFiles.length}件の XBRL/HTM ファイルを検出`);

  // 4. パース (全ファイルから抽出)
  let majorShareholders: ShareholderEntry[] = [];
  let treasuryShares = 0;
  let totalSharesXbrl: number | null = null;

  for (const file of xbrlFiles) {
    if (majorShareholders.length === 0) {
      const sh = extractMajorShareholders(file.content);
      if (sh.length > 0) {
        majorShareholders = sh;
        console.log(`  [${symbol}] 大株主 ${sh.length}名 抽出 (from ${file.name})`);
      }
    }
    if (treasuryShares === 0) {
      const ts = extractTreasuryShares(file.content);
      if (ts > 0) {
        treasuryShares = ts;
        console.log(`  [${symbol}] 自己株式: ${ts.toLocaleString()}株`);
      }
    }
    if (totalSharesXbrl == null) {
      totalSharesXbrl = extractTotalShares(file.content);
    }
  }

  if (majorShareholders.length === 0) {
    console.log(`  [${symbol}] 大株主データ抽出失敗`);
    return null;
  }

  // 5. 浮動株比率計算
  const majorShareholderShares = majorShareholders.reduce((sum, s) => sum + s.shares, 0);

  // ── 方法1 (推奨): 大株主の持株比率 (%) から直接計算 ──
  const ratioSum = majorShareholders.reduce((sum, s) => sum + s.ratioPct, 0);
  if (ratioSum > 1 && ratioSum <= 100) {
    const floatingRatio = Math.max(0, 1 - ratioSum / 100);
    console.log(`  [${symbol}] 大株主比率合計: ${ratioSum.toFixed(1)}% → 浮動株比率: ${(floatingRatio * 100).toFixed(1)}% (比率ベース)`);
    return {
      floatingRatio,
      majorShareholders,
      majorShareholderShares,
      treasuryShares,
      fixedShares: majorShareholderShares,
      totalShares: totalSharesXbrl,
      docId: doc.docId,
      filerName: doc.filerName,
      filingDate: doc.filingDate,
    };
  }

  // ── 方法2: 株数ベースの計算 (比率データがない場合のフォールバック) ──
  const totalShares = totalSharesXbrl ?? totalSharesFromYF ?? null;
  if (!totalShares || totalShares <= 0) {
    console.log(`  [${symbol}] 発行済株式数不明かつ比率データなし — 浮動株比率計算不可`);
    return null;
  }

  // 大株主リストに自社名義が含まれる場合は treasury 重複除外
  const filerLower = doc.filerName.toLowerCase();
  const treasuryInMajor = majorShareholders.some(
    (s) => filerLower && s.name.toLowerCase().includes(filerLower),
  );

  let fixedShares = majorShareholderShares;
  if (!treasuryInMajor) fixedShares += treasuryShares;
  if (fixedShares > totalShares) fixedShares = totalShares;

  const floatingRatio = 1 - fixedShares / totalShares;

  console.log(`  [${symbol}] 固定株: ${fixedShares.toLocaleString()} / ${totalShares.toLocaleString()} → 浮動株比率: ${(floatingRatio * 100).toFixed(1)}% (株数ベース)`);

  return {
    floatingRatio,
    majorShareholders,
    majorShareholderShares,
    treasuryShares,
    fixedShares,
    totalShares: totalSharesXbrl,
    docId: doc.docId,
    filerName: doc.filerName,
    filingDate: doc.filingDate,
  };
}
