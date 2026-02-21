/**
 * EDINET XBRL 財務データ抽出モジュール
 * ==========================================
 * EDINET API v2 から有価証券報告書の XBRL を取得し、
 * 財務諸表（B/S, P/L, C/F）の数値データを構造化して返す。
 *
 * 既存の edinetXbrl.ts の基盤（downloadXbrlZip, findXbrlFiles, parseNumber）を再利用。
 */

import * as cheerio from "cheerio";
import {
  searchAnnualReport,
  searchAnnualReportBatch,
  downloadXbrlZip,
  findXbrlFiles,
  type EDINETDocResult,
} from "./edinetXbrl";
import {
  getCachedEdinetFinancials,
  setCachedEdinetFinancials,
  isEdinetCacheValid,
} from "@/lib/cache/edinetCache";

// ── 型定義 ──

/** XBRL から抽出した財務諸表データ */
export interface EdinetFinancialData {
  // ── 貸借対照表 (B/S) ──
  currentAssets: number | null;          // 流動資産
  investmentSecurities: number | null;   // 投資有価証券
  totalAssets: number | null;            // 総資産
  totalLiabilities: number | null;       // 負債合計
  stockholdersEquity: number | null;     // 株主資本
  netAssets: number | null;              // 純資産

  // ── 損益計算書 (P/L) ──
  netSales: number | null;              // 売上高/営業収益
  operatingIncome: number | null;       // 営業利益
  ordinaryIncome: number | null;        // 経常利益
  netIncome: number | null;             // 当期純利益

  // ── キャッシュフロー計算書 (C/F) ──
  operatingCashFlow: number | null;     // 営業CF
  investingCashFlow: number | null;     // 投資CF
  freeCashFlow: number | null;          // FCF (= 営業CF + 投資CF)
  capitalExpenditure: number | null;    // 設備投資額

  // ── 1株情報 ──
  dividendPerShare: number | null;      // 1株当たり配当金

  // ── メタデータ ──
  docId: string;
  filerName: string;
  filingDate: string;
  fiscalYearEnd: string;                // 決算期末日
}

// ── XBRL 要素マッピング ──

interface XbrlElementDef {
  tags: string[];
  /** B/S = instant, P/L & C/F = duration */
  contextType: "instant" | "duration";
}

/**
 * タグ名を正規化: 小文字化、ハイフン/アンダースコア除去、IFRSサフィックス除去
 * これにより jppfs_cor / jpigp_cor 両方のタグを統一的にマッチできる
 * 例: "CurrentAssetsIFRS" → "currentassets"
 *     "CurrentAssets"     → "currentassets"
 */
function normalizeTagName(name: string): string {
  return name
    .toLowerCase()
    .replace(/[_-]/g, "")
    .replace(/ifrs$/, "");  // IFRS サフィックスを除去
}

/**
 * 財務項目 → XBRL タグ名マッピング
 * タグ名は normalizeTagName() 適用後の形式
 *
 * 対応する名前空間:
 *   - jppfs_cor: 日本基準 B/S, P/L, C/F
 *   - jpigp_cor: IFRS B/S, P/L, C/F (タグ名末尾の "IFRS" は正規化で除去)
 *   - jpcrp_cor: 経営指標サマリー (*SummaryOfBusinessResults)
 */
const XBRL_ELEMENTS: Record<string, XbrlElementDef> = {
  // ── B/S (instant) ──
  currentAssets: {
    tags: ["currentassets"],
    contextType: "instant",
  },
  investmentSecurities: {
    tags: [
      "investmentsecurities",
      "investmentsecuritiesnoncurrent",
      // IFRS: 非流動その他金融資産 (投資有価証券を含む)
      "otherfinancialassetsnca",
    ],
    contextType: "instant",
  },
  totalAssets: {
    tags: ["assets"],
    contextType: "instant",
  },
  totalLiabilities: {
    tags: ["liabilities"],
    contextType: "instant",
  },
  stockholdersEquity: {
    tags: [
      "stockholdersequity",
      "equityattributabletoownersofparent",
      "shareholdersequity",
    ],
    contextType: "instant",
  },
  netAssets: {
    tags: ["netassets", "equity"],
    contextType: "instant",
  },

  // ── P/L (duration) ──
  netSales: {
    tags: [
      "netsales",
      "operatingrevenue",
      "revenue",
      "operatingrevenue1",
      "netrevenuesoffinancialinstitutions",
      // IFRS企業: 企業固有タグ (normalizeTagNameでIFRSサフィックス除去済み)
      "totalnetrevenues",      // jpcrp030000:TotalNetRevenuesIFRS
      "operatingrevenues",     // jpcrp030000:OperatingRevenuesIFRS
      "salesrevenueandotheroperatingrevenue",
    ],
    contextType: "duration",
  },
  operatingIncome: {
    tags: ["operatingincome", "operatingprofit", "operatingprofitloss"],
    contextType: "duration",
  },
  ordinaryIncome: {
    tags: ["ordinaryincome", "ordinaryprofit", "profitlossbeforetax"],
    contextType: "duration",
  },
  netIncome: {
    tags: [
      "profitlossattributabletoownersofparent",
      "profitattributabletoownersofparent",
      "netincome",
      "netincomeattributabletoownersofparent",
      "netincomeloss",
    ],
    contextType: "duration",
  },

  // ── C/F (duration) ──
  operatingCashFlow: {
    tags: [
      "netcashprovidedbyusedinoperatingactivities",
      "cashflowsfromoperatingactivities",
      "cashflowsfromusedinoperatingactivities",
    ],
    contextType: "duration",
  },
  investingCashFlow: {
    tags: [
      "netcashprovidedbyusedininvestingactivities",
      "cashflowsfrominvestingactivities",
      "cashflowsfromusedinvestingactivities",
    ],
    contextType: "duration",
  },
  capitalExpenditure: {
    tags: [
      "purchaseofpropertyplantandequipmentandinvestmentproperty",
      "purchaseofpropertyplantandequipment",
      "purchaseoffixedassets",
      "capitalexpenditure",
    ],
    contextType: "duration",
  },

  // ── Per-share (duration) ──
  dividendPerShare: {
    tags: [
      "dividendpershare",
      "dividendpaidpersharecommonstock",
      "cashdividendspershareapplicabletotheyear",
    ],
    contextType: "duration",
  },
};

/**
 * サマリーテーブル (経営指標等) のタグ名マッピング
 * 0101010_honbun ファイルの jpcrp_cor:*SummaryOfBusinessResults に対応
 * 詳細財務諸表から取得できなかった場合のフォールバック
 */
const SUMMARY_ELEMENTS: Record<string, XbrlElementDef> = {
  netSales: {
    tags: [
      "netsalessummaryofbusinessresults",
      "operatingrevenue1summaryofbusinessresults",
      "revenuesummaryofbusinessresults",
    ],
    contextType: "duration",
  },
  operatingIncome: {
    tags: [
      "operatingincomesummaryofbusinessresults",
      "operatingprofitsummaryofbusinessresults",
    ],
    contextType: "duration",
  },
  ordinaryIncome: {
    tags: [
      "ordinaryincomelosssummaryofbusinessresults",
      "profitlossbeforetaxsummaryofbusinessresults",
    ],
    contextType: "duration",
  },
  netIncome: {
    tags: [
      "netincomelosssummaryofbusinessresults",
      "profitlossattributabletoownersofparentsummaryofbusinessresults",
    ],
    contextType: "duration",
  },
  netAssets: {
    tags: [
      "netassetssummaryofbusinessresults",
      "equityattributabletoownersofparentsummaryofbusinessresults",
    ],
    contextType: "instant",
  },
  operatingCashFlow: {
    tags: [
      // IFRS
      "cashflowsfromusedinoperatingactivitiessummaryofbusinessresults",
      // JGAAP
      "netcashprovidedbyusedinoperatingactivitiessummaryofbusinessresults",
    ],
    contextType: "duration",
  },
  investingCashFlow: {
    tags: [
      // IFRS
      "cashflowsfromusedininvestingactivitiessummaryofbusinessresults",
      // JGAAP
      "netcashprovidedbyusedininvestingactivitiessummaryofbusinessresults",
    ],
    contextType: "duration",
  },
  dividendPerShare: {
    tags: [
      "dividendpaidpersharesummaryofbusinessresults",
    ],
    contextType: "duration",
  },
};

// ── コンテキスト判定 ──

/** 連結 CurrentYear のコンテキストかどうか */
function isCurrentYearContext(contextRef: string, type: "instant" | "duration"): boolean {
  const ctx = contextRef.toLowerCase();
  // 非連結を除外
  if (ctx.includes("nonconsolidated")) return false;
  // セグメント別を除外（全社ベースのみ）
  if (ctx.includes("member") && !ctx.includes("consolidatedmember")) return false;

  if (type === "instant") {
    // "CurrentYearInstant" を完全一致で最優先
    return ctx === "currentyearinstant" ||
           ctx === "currentperiodinstant" ||
           (ctx.startsWith("currentyearinstant") && !ctx.includes("_")) ||
           (ctx.startsWith("currentperiodinstant") && !ctx.includes("_"));
  } else {
    // "CurrentYearDuration" を完全一致で最優先
    return ctx === "currentyearduration" ||
           ctx === "currentperiodduration" ||
           (ctx.startsWith("currentyearduration") && !ctx.includes("_")) ||
           (ctx.startsWith("currentperiodduration") && !ctx.includes("_"));
  }
}

/**
 * サマリーテーブル用: より緩いコンテキスト判定
 * CurrentYearDuration / CurrentYearInstant にマッチ（メンバー付きも許容しない）
 */
function isSummaryCurrentYearContext(contextRef: string, type: "instant" | "duration"): boolean {
  const ctx = contextRef.toLowerCase();
  if (ctx.includes("nonconsolidated")) return false;
  if (ctx.includes("member")) return false;

  if (type === "instant") {
    return ctx.includes("currentyearinstant") || ctx.includes("currentperiodinstant");
  } else {
    return ctx.includes("currentyearduration") || ctx.includes("currentperiodduration");
  }
}

// ── XBRL 数値パーサー ──

// Cheerio要素型（ジェネリックセレクタ結果）
type CheerioEl = Parameters<ReturnType<typeof cheerio.load>>[0];

/**
 * XBRL 要素から数値を抽出する。
 * ix:nonFraction の scale 属性にも対応。
 */
function parseXbrlNumeric(
  el: CheerioEl,
  $: ReturnType<typeof cheerio.load>,
): number | null {
  const $el = $(el);
  const text = $el.text().trim();
  if (!text) return null;

  // 全角→半角変換、カンマ除去
  let s = text.replace(/[０-９]/g, (ch) =>
    String.fromCharCode(ch.charCodeAt(0) - 0xfee0),
  );
  s = s.replace(/[．]/g, ".");
  s = s.replace(/[,\s\u3000]/g, "").replace(/[△▲]/g, "-");

  const match = s.match(/-?[\d]+\.?[\d]*/);
  if (!match) return null;

  let value = parseFloat(match[0]);

  // scale 属性: ix:nonFraction で使用 (e.g., scale="6" = ×10^6)
  const scale = $el.attr("scale");
  if (scale) {
    const exp = parseInt(scale, 10);
    if (!isNaN(exp)) {
      value *= Math.pow(10, exp);
    }
  }

  // sign 属性: "-" で負数
  const sign = $el.attr("sign");
  if (sign === "-" && value > 0) {
    value = -value;
  }

  return value;
}

// ── 決算期末日抽出 ──

function extractFiscalYearEnd(
  xbrlFiles: { name: string; content: string }[],
): string {
  for (const file of xbrlFiles) {
    const $ = cheerio.load(file.content, {
      xmlMode: file.content.trimStart().startsWith("<?xml"),
    });

    // context の period/instant から決算期末日を取得
    for (const el of $("*").toArray()) {
      const tagName = ((el as unknown as { tagName?: string }).tagName ?? "").toLowerCase();
      if (tagName.includes("context")) {
        const id = $(el).attr("id") ?? "";
        if (/currentyearinstant/i.test(id)) {
          const instant = $(el).find("*").filter((_, e) => {
            const tn = ((e as unknown as { tagName?: string }).tagName ?? "").toLowerCase();
            return tn.includes("instant");
          }).first().text().trim();
          if (instant && /^\d{4}-\d{2}-\d{2}$/.test(instant)) {
            return instant;
          }
        }
      }
    }
  }
  return "";
}

// ── メインパーサー ──

/**
 * XBRL ファイル群から財務データを抽出する。
 *
 * 3段階フォールバック:
 *   1. 詳細財務諸表 (IFRS jpigp_cor / JGAAP jppfs_cor) — 正確なB/S, P/L, CF
 *   2. サマリーテーブル (jpcrp_cor:*SummaryOfBusinessResults) — 経営指標等
 *   3. 会社固有タグ (jpcrp030000-asr_EXXXXX-000:*) — 企業独自の科目
 *
 * IFRS/JGAAP判定: normalizeTagName() でIFRSサフィックスを除去することで統一マッチング
 */
export function extractFinancialStatements(
  xbrlFiles: { name: string; content: string }[],
): Partial<EdinetFinancialData> {
  const result: Record<string, number | null> = {};

  for (const field of Object.keys(XBRL_ELEMENTS)) {
    result[field] = null;
  }

  // ── Phase 1: 詳細財務諸表から抽出 ──
  for (const file of xbrlFiles) {
    const isXml = file.content.trimStart().startsWith("<?xml");
    const $ = cheerio.load(file.content, { xmlMode: isXml });

    for (const [field, def] of Object.entries(XBRL_ELEMENTS)) {
      if (result[field] != null) continue;

      // 方法1: 直接タグ名マッチング (XMLモード: jppfs_cor:CurrentAssets, jpigp_cor:CurrentAssetsIFRS)
      for (const el of $("*").toArray()) {
        if (result[field] != null) break;
        const rawTagName = (el as unknown as { tagName?: string }).tagName ?? "";
        // 名前空間プレフィックスを除去してローカル名を正規化
        const colonIdx = rawTagName.indexOf(":");
        const localRaw = colonIdx >= 0 ? rawTagName.slice(colonIdx + 1) : rawTagName;
        const localName = normalizeTagName(localRaw);

        for (const pattern of def.tags) {
          if (localName === pattern) {
            const contextRef = $(el).attr("contextref") ?? $(el).attr("contextRef") ?? "";
            if (contextRef && isCurrentYearContext(contextRef, def.contextType)) {
              const value = parseXbrlNumeric(el, $);
              if (value != null) {
                result[field] = value;
                break;
              }
            }
          }
        }
      }

      if (result[field] != null) continue;

      // 方法2: inline XBRL (ix:nonFraction name属性)
      for (const el of $("*").toArray()) {
        if (result[field] != null) break;
        const rawTagName = ((el as unknown as { tagName?: string }).tagName ?? "").toLowerCase();
        if (!rawTagName.includes("nonfraction")) continue;

        const nameAttr = $(el).attr("name") ?? "";
        // 名前空間プレフィックスを除去してローカル名を正規化
        const colonIdx = nameAttr.indexOf(":");
        const localRaw = colonIdx >= 0 ? nameAttr.slice(colonIdx + 1) : nameAttr;
        const localName = normalizeTagName(localRaw);

        for (const pattern of def.tags) {
          if (localName === pattern) {
            const contextRef = $(el).attr("contextref") ?? $(el).attr("contextRef") ?? "";
            if (contextRef && isCurrentYearContext(contextRef, def.contextType)) {
              const value = parseXbrlNumeric(el, $);
              if (value != null) {
                result[field] = value;
                break;
              }
            }
          }
        }
      }
    }

    if (Object.values(result).every((v) => v != null)) break;
  }

  // ── Phase 2: サマリーテーブルから不足分を補完 ──
  for (const file of xbrlFiles) {
    if (Object.entries(SUMMARY_ELEMENTS).every(([field]) => result[field] != null)) break;

    const isXml = file.content.trimStart().startsWith("<?xml");
    const $ = cheerio.load(file.content, { xmlMode: isXml });

    for (const [field, def] of Object.entries(SUMMARY_ELEMENTS)) {
      if (result[field] != null) continue;

      // ix:nonFraction の name 属性からサマリータグをマッチ
      for (const el of $("*").toArray()) {
        if (result[field] != null) break;
        const rawTagName = ((el as unknown as { tagName?: string }).tagName ?? "").toLowerCase();

        // 直接タグ名チェック
        let localName: string;
        if (rawTagName.includes("nonfraction")) {
          const nameAttr = $(el).attr("name") ?? "";
          const colonIdx = nameAttr.indexOf(":");
          localName = normalizeTagName(colonIdx >= 0 ? nameAttr.slice(colonIdx + 1) : nameAttr);
        } else {
          const colonIdx = rawTagName.indexOf(":");
          const localRaw = colonIdx >= 0 ? rawTagName.slice(colonIdx + 1) : rawTagName;
          localName = normalizeTagName(localRaw);
        }

        for (const pattern of def.tags) {
          if (localName === pattern) {
            const contextRef = $(el).attr("contextref") ?? $(el).attr("contextRef") ?? "";
            if (contextRef && isSummaryCurrentYearContext(contextRef, def.contextType)) {
              const value = parseXbrlNumeric(el, $);
              if (value != null) {
                result[field] = value;
                break;
              }
            }
          }
        }
      }
    }
  }

  // FCF = 営業CF + 投資CF (直接取得できない場合)
  if (result.operatingCashFlow != null && result.investingCashFlow != null) {
    result.freeCashFlow = result.operatingCashFlow + result.investingCashFlow;
  }

  return result as Partial<EdinetFinancialData>;
}

// ── キャッシュ付きメイン関数 ──

const REQUEST_DELAY_MS = 1000;
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * 銘柄の EDINET 財務データを取得する (キャッシュ付き)。
 * searchAnnualReport → downloadXbrlZip → extractFinancialStatements
 */
export async function getEdinetFinancials(
  symbol: string,
  apiKey: string,
  opts?: { searchDays?: number; forceRefresh?: boolean },
): Promise<EdinetFinancialData | null> {
  // キャッシュ確認
  if (!opts?.forceRefresh && isEdinetCacheValid(symbol)) {
    return getCachedEdinetFinancials(symbol);
  }

  // 1. 有報検索
  const doc = await searchAnnualReport(symbol, apiKey, opts?.searchDays);
  if (!doc) return null;

  // 2. XBRL ZIP ダウンロード
  await sleep(REQUEST_DELAY_MS);
  const zipBuffer = await downloadXbrlZip(doc.docId, apiKey);
  if (!zipBuffer) return null;

  // 3. XBRL ファイル展開
  const xbrlFiles = findXbrlFiles(zipBuffer);
  if (xbrlFiles.length === 0) return null;

  // 4. 財務データ抽出
  const financials = extractFinancialStatements(xbrlFiles);
  const fiscalYearEnd = extractFiscalYearEnd(xbrlFiles);

  const data: EdinetFinancialData = {
    currentAssets: financials.currentAssets ?? null,
    investmentSecurities: financials.investmentSecurities ?? null,
    totalAssets: financials.totalAssets ?? null,
    totalLiabilities: financials.totalLiabilities ?? null,
    stockholdersEquity: financials.stockholdersEquity ?? null,
    netAssets: financials.netAssets ?? null,
    netSales: financials.netSales ?? null,
    operatingIncome: financials.operatingIncome ?? null,
    ordinaryIncome: financials.ordinaryIncome ?? null,
    netIncome: financials.netIncome ?? null,
    operatingCashFlow: financials.operatingCashFlow ?? null,
    investingCashFlow: financials.investingCashFlow ?? null,
    freeCashFlow: financials.freeCashFlow ?? null,
    capitalExpenditure: financials.capitalExpenditure ?? null,
    dividendPerShare: financials.dividendPerShare ?? null,
    docId: doc.docId,
    filerName: doc.filerName,
    filingDate: doc.filingDate,
    fiscalYearEnd,
  };

  // キャッシュ保存
  setCachedEdinetFinancials(symbol, data);

  return data;
}

/**
 * バッチ版: 複数銘柄の財務データを一括取得
 */
export async function getEdinetFinancialsBatch(
  symbols: string[],
  apiKey: string,
  opts?: { searchDays?: number; forceRefresh?: boolean },
  onProgress?: (done: number, total: number, symbol: string) => void,
): Promise<Map<string, EdinetFinancialData>> {
  const results = new Map<string, EdinetFinancialData>();

  // キャッシュ済みを先にチェック
  const uncached: string[] = [];
  if (!opts?.forceRefresh) {
    for (const sym of symbols) {
      if (isEdinetCacheValid(sym)) {
        const cached = getCachedEdinetFinancials(sym);
        if (cached) {
          results.set(sym, cached);
          continue;
        }
      }
      uncached.push(sym);
    }
  } else {
    uncached.push(...symbols);
  }

  if (uncached.length === 0) return results;

  // バッチで有報検索
  const docMap = await searchAnnualReportBatch(
    uncached,
    apiKey,
    opts?.searchDays,
    (searched, total, found) => {
      process.stdout.write(`\r  EDINET検索中: ${searched}/${total}日, ${found}件発見    `);
    },
  );
  console.log();

  // 各銘柄のXBRLを取得・パース
  let done = 0;
  for (const [sym, doc] of docMap) {
    await sleep(REQUEST_DELAY_MS);
    const zipBuffer = await downloadXbrlZip(doc.docId, apiKey);
    if (!zipBuffer) {
      done++;
      onProgress?.(done, docMap.size, sym);
      continue;
    }

    const xbrlFiles = findXbrlFiles(zipBuffer);
    if (xbrlFiles.length === 0) {
      done++;
      onProgress?.(done, docMap.size, sym);
      continue;
    }

    const financials = extractFinancialStatements(xbrlFiles);
    const fiscalYearEnd = extractFiscalYearEnd(xbrlFiles);

    const data: EdinetFinancialData = {
      currentAssets: financials.currentAssets ?? null,
      investmentSecurities: financials.investmentSecurities ?? null,
      totalAssets: financials.totalAssets ?? null,
      totalLiabilities: financials.totalLiabilities ?? null,
      stockholdersEquity: financials.stockholdersEquity ?? null,
      netAssets: financials.netAssets ?? null,
      netSales: financials.netSales ?? null,
      operatingIncome: financials.operatingIncome ?? null,
      ordinaryIncome: financials.ordinaryIncome ?? null,
      netIncome: financials.netIncome ?? null,
      operatingCashFlow: financials.operatingCashFlow ?? null,
      investingCashFlow: financials.investingCashFlow ?? null,
      freeCashFlow: financials.freeCashFlow ?? null,
      capitalExpenditure: financials.capitalExpenditure ?? null,
      dividendPerShare: financials.dividendPerShare ?? null,
      docId: doc.docId,
      filerName: doc.filerName,
      filingDate: doc.filingDate,
      fiscalYearEnd,
    };

    setCachedEdinetFinancials(sym, data);
    results.set(sym, data);

    done++;
    onProgress?.(done, docMap.size, sym);
  }

  return results;
}

// ── LLM 向けフォーマッタ ──

function fmtOku(n: number | null): string {
  if (n == null) return "N/A";
  const oku = n / 100_000_000;
  if (Math.abs(oku) >= 10_000) {
    return `${(oku / 10_000).toFixed(1)}兆円`;
  }
  return `${Math.round(oku).toLocaleString()}億円`;
}

/**
 * 財務データを LLM 分析用テキストにフォーマットする。
 * earningsReader.ts の PDF テキスト抽出のフォールバック/補完用。
 */
export function formatFinancialsForLLM(data: EdinetFinancialData): string {
  const lines: string[] = [];

  lines.push(`## 財務諸表サマリー（有価証券報告書 XBRL / ${data.filingDate}提出）`);
  lines.push("");

  // P/L
  lines.push("### 損益計算書 (P/L)");
  lines.push(`- 売上高: ${fmtOku(data.netSales)}`);
  if (data.operatingIncome != null && data.netSales != null && data.netSales > 0) {
    const margin = (data.operatingIncome / data.netSales) * 100;
    lines.push(`- 営業利益: ${fmtOku(data.operatingIncome)} (営業利益率: ${margin.toFixed(1)}%)`);
  } else {
    lines.push(`- 営業利益: ${fmtOku(data.operatingIncome)}`);
  }
  lines.push(`- 経常利益: ${fmtOku(data.ordinaryIncome)}`);
  lines.push(`- 当期純利益: ${fmtOku(data.netIncome)}`);
  lines.push("");

  // B/S
  lines.push("### 貸借対照表 (B/S)");
  lines.push(`- 流動資産: ${fmtOku(data.currentAssets)}`);
  lines.push(`- 投資有価証券: ${fmtOku(data.investmentSecurities)}`);
  lines.push(`- 総資産: ${fmtOku(data.totalAssets)}`);
  lines.push(`- 負債合計: ${fmtOku(data.totalLiabilities)}`);
  lines.push(`- 純資産: ${fmtOku(data.netAssets)}`);
  lines.push(`- 株主資本: ${fmtOku(data.stockholdersEquity)}`);

  // NC計算
  if (data.currentAssets != null && data.totalLiabilities != null) {
    const investSec = data.investmentSecurities ?? 0;
    const nc = data.currentAssets + investSec * 0.7 - data.totalLiabilities;
    lines.push(`- ネットキャッシュ: ${fmtOku(nc)} (= 流動資産 + 投資有価証券×70% − 負債合計)`);
  }
  lines.push("");

  // C/F
  lines.push("### キャッシュフロー計算書 (C/F)");
  lines.push(`- 営業CF: ${fmtOku(data.operatingCashFlow)}`);
  lines.push(`- 投資CF: ${fmtOku(data.investingCashFlow)}`);
  lines.push(`- FCF: ${fmtOku(data.freeCashFlow)}`);
  lines.push(`- 設備投資: ${fmtOku(data.capitalExpenditure)}`);
  lines.push("");

  // 算出指標
  lines.push("### 財務指標（算出）");
  if (data.netIncome != null && data.stockholdersEquity != null && data.stockholdersEquity > 0) {
    const roe = data.netIncome / data.stockholdersEquity;
    lines.push(`- ROE: ${(roe * 100).toFixed(1)}% (= 純利益 / 株主資本)`);
  }
  if (data.netAssets != null && data.totalAssets != null && data.totalAssets > 0) {
    const equityRatio = (data.netAssets / data.totalAssets) * 100;
    lines.push(`- 自己資本比率: ${equityRatio.toFixed(1)}%`);
  }
  if (data.dividendPerShare != null) {
    lines.push(`- 1株当たり配当金: ${data.dividendPerShare.toFixed(1)}円`);
  }

  return lines.join("\n");
}

// Re-export for convenience
export { searchAnnualReport, searchAnnualReportBatch, downloadXbrlZip, findXbrlFiles };
export type { EDINETDocResult };
