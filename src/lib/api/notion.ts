/**
 * Notion API クライアント
 *
 * 統合分析結果を Notion データベースに登録する。
 * 同じ銘柄は同一ページに日付付きトグルで追記。
 * 環境変数: NOTION_API_KEY, NOTION_DATABASE_ID
 */

import type {
  NotionBlock,
  NotionPropertiesInput,
  NotionRichTextItem,
} from "@/types/notion";

// ---------- 型定義 ----------

export interface NotionAnalysisEntry {
  symbol: string;
  companyName: string;
  decision: "entry" | "wait" | "avoid";
  confidence: "high" | "medium" | "low";
  summary: string;
  signalEvaluation: string;
  catalyst: string;
  riskFactor: string;
  analysisDate: string; // "2026-02-17"
  model: string; // "gemini-2.5-flash"
  pdfCount: number;
  totalTokens: number;
  reportMarkdown: string;
  // 定量データ
  price?: number;
  per?: number;
  pbr?: number;
  cnper?: number;
  psr?: number;
  eps?: number;
  roe?: number;
  dividendYield?: number;
  marketCap?: number; // 億円
  w52High?: number;
  fcf?: number; // 億円
  sharpeRatio?: number; // 6ヶ月
  volume?: number; // 当日出来高
  avgVolume5d?: number; // 3ヶ月平均出来高（5日平均の代替）
  volumeRatio?: number; // 出来高倍率
  equityRatio?: number; // 自己資本比率 (%)
  consolidationDays?: number; // もみ合い日数
  earningsDate?: string; // "2026-05-15"
  marketSegment?: string;
  hasYutai?: boolean; // 優待有無
  // 3期間判定
  shortTerm?: "entry" | "wait" | "avoid";
  midTerm?: "entry" | "wait" | "avoid";
  longTerm?: "entry" | "wait" | "avoid";
  // 推奨価格（期間別）
  shortTermBuy?: number;
  shortTermTP?: number;
  shortTermSL?: number;
  midTermBuy?: number;
  midTermTP?: number;
  midTermSL?: number;
  longTermBuy?: number;
  longTermTP?: number;
  longTermSL?: number;
  // メモ
  memo?: string;
}

// ---------- マッピング ----------

const DECISION_MAP: Record<string, string> = {
  entry: "GO",
  wait: "WAIT",
  avoid: "AVOID",
};

const CONFIDENCE_MAP: Record<string, string> = {
  high: "High",
  medium: "Medium",
  low: "Low",
};

const MODEL_MAP: Record<string, string> = {
  "gemini-2.5-flash": "Gemini-2.5-flash",
  "gemini-2.5-pro": "Gemini-2.5-pro",
};

// ---------- Notion API ヘルパー ----------

function notionHeaders(): Record<string, string> {
  return {
    Authorization: `Bearer ${process.env.NOTION_API_KEY}`,
    "Notion-Version": "2022-06-28",
    "Content-Type": "application/json",
  };
}

// ---------- プロパティ構築（共通） ----------

function buildProperties(entry: NotionAnalysisEntry, includeTitle: boolean): NotionPropertiesInput {
  const truncate = (s: string, max = 2000) =>
    s.length > max ? s.slice(0, max - 3) + "..." : s;

  const props: NotionPropertiesInput = {};

  if (includeTitle) {
    props["銘柄コード"] = { title: [{ text: { content: entry.symbol } }] };
  }

  // テキスト系
  props["企業名"] = { rich_text: [{ text: { content: truncate(entry.companyName) } }] };
  props["概要"] = { rich_text: [{ text: { content: truncate(entry.summary) } }] };
  props["シグナル評価"] = { rich_text: [{ text: { content: truncate(entry.signalEvaluation) } }] };
  props["カタリスト"] = { rich_text: [{ text: { content: truncate(entry.catalyst) } }] };
  props["リスク"] = { rich_text: [{ text: { content: truncate(entry.riskFactor) } }] };

  // セレクト系
  props["確信度"] = { select: { name: CONFIDENCE_MAP[entry.confidence] ?? "Medium" } };
  props["モデル"] = { select: { name: MODEL_MAP[entry.model] ?? entry.model } };

  // 日付系
  props["分析日"] = { date: { start: entry.analysisDate } };
  if (entry.earningsDate) props["決算日"] = { date: { start: entry.earningsDate } };

  // 数値系（常に設定）
  props["PDF数"] = { number: entry.pdfCount };
  props["トークン数"] = { number: entry.totalTokens };

  // 数値系（オプショナル）
  const numFields: [string, number | undefined][] = [
    ["株価", entry.price],
    ["PER", entry.per],
    ["PBR", entry.pbr],
    ["CNPER", entry.cnper],
    ["PSR", entry.psr],
    ["EPS", entry.eps],
    ["ROE", entry.roe],
    ["配当利回り", entry.dividendYield],
    ["時価総額", entry.marketCap],
    ["52W高値", entry.w52High],
    ["FCF", entry.fcf],
    ["シャープレシオ", entry.sharpeRatio],
    ["前日出来高", entry.volume],
    ["直近5営業日平均出来高", entry.avgVolume5d],
    ["出来高倍率", entry.volumeRatio],
    ["自己資本比率", entry.equityRatio],
    ["もみ合い日数", entry.consolidationDays],
    ["短期買値", entry.shortTermBuy],
    ["短期利確", entry.shortTermTP],
    ["短期損切", entry.shortTermSL],
    ["中期買値", entry.midTermBuy],
    ["中期利確", entry.midTermTP],
    ["中期損切", entry.midTermSL],
    ["長期買値", entry.longTermBuy],
    ["長期利確", entry.longTermTP],
    ["長期損切", entry.longTermSL],
  ];
  for (const [key, val] of numFields) {
    if (val != null && isFinite(val)) props[key] = { number: val };
  }

  // セレクト系（オプショナル）
  if (entry.marketSegment) {
    props["市場区分"] = { select: { name: entry.marketSegment } };
  }
  if (entry.hasYutai != null) {
    props["優待"] = { select: { name: entry.hasYutai ? "有" : "無" } };
  }
  // メモ
  if (entry.memo) {
    props["メモ"] = { rich_text: [{ text: { content: truncate(entry.memo) } }] };
  }
  // 3期間判定
  if (entry.shortTerm) {
    props["短期判定"] = { select: { name: DECISION_MAP[entry.shortTerm] ?? "WAIT" } };
  }
  if (entry.midTerm) {
    props["中期判定"] = { select: { name: DECISION_MAP[entry.midTerm] ?? "WAIT" } };
  }
  if (entry.longTerm) {
    props["長期判定"] = { select: { name: DECISION_MAP[entry.longTerm] ?? "WAIT" } };
  }

  return props;
}

// ---------- Markdown → Notion Blocks 変換 ----------

function richText(content: string): NotionRichTextItem[] {
  const chunks: NotionRichTextItem[] = [];
  for (let i = 0; i < content.length; i += 2000) {
    chunks.push({
      type: "text",
      text: { content: content.slice(i, i + 2000) },
    });
  }
  return chunks.length > 0
    ? chunks
    : [{ type: "text", text: { content: "" } }];
}

function markdownToBlocks(markdown: string): NotionBlock[] {
  const lines = markdown.split("\n");
  const blocks: NotionBlock[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (line.trim() === "" || line.trim().startsWith("<!--")) {
      i++;
      continue;
    }

    if (line.startsWith("## ")) {
      blocks.push({
        object: "block",
        type: "heading_2",
        heading_2: { rich_text: richText(line.slice(3).trim()) },
      });
      i++;
      continue;
    }

    if (line.startsWith("### ")) {
      blocks.push({
        object: "block",
        type: "heading_3",
        heading_3: { rich_text: richText(line.slice(4).trim()) },
      });
      i++;
      continue;
    }

    if (line.trim().startsWith("```")) {
      const lang = line.trim().slice(3).trim() || "plain text";
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].trim().startsWith("```")) {
        codeLines.push(lines[i]);
        i++;
      }
      i++;
      blocks.push({
        object: "block",
        type: "code",
        code: {
          rich_text: richText(codeLines.join("\n")),
          language: lang === "json" ? "json" : "plain text",
        },
      });
      continue;
    }

    const bulletMatch = line.match(/^(\s*)[*\-]\s+(.+)/);
    if (bulletMatch) {
      blocks.push({
        object: "block",
        type: "bulleted_list_item",
        bulleted_list_item: { rich_text: richText(bulletMatch[2]) },
      });
      i++;
      continue;
    }

    if (line.trim().startsWith("|")) {
      if (line.match(/^\|[\s\-:]+\|/)) {
        i++;
        continue;
      }
      blocks.push({
        object: "block",
        type: "paragraph",
        paragraph: { rich_text: richText(line.trim()) },
      });
      i++;
      continue;
    }

    const paraLines: string[] = [line];
    i++;
    while (
      i < lines.length &&
      lines[i].trim() !== "" &&
      !lines[i].startsWith("#") &&
      !lines[i].startsWith("```") &&
      !lines[i].match(/^[*\-]\s+/) &&
      !lines[i].trim().startsWith("|") &&
      !lines[i].trim().startsWith("<!--")
    ) {
      paraLines.push(lines[i]);
      i++;
    }
    blocks.push({
      object: "block",
      type: "paragraph",
      paragraph: { rich_text: richText(paraLines.join("\n")) },
    });
  }

  return blocks;
}

// ---------- DB検索: 既存ページを探す ----------

async function findExistingPage(
  symbol: string,
): Promise<{ id: string; url: string; analysisDate?: string } | null> {
  const dbId = process.env.NOTION_DATABASE_ID;
  if (!dbId) return null;

  const res = await fetch(`https://api.notion.com/v1/databases/${dbId}/query`, {
    method: "POST",
    headers: notionHeaders(),
    body: JSON.stringify({
      filter: {
        property: "銘柄コード",
        title: { equals: symbol },
      },
      page_size: 1,
    }),
  });

  if (!res.ok) return null;
  const data = await res.json();
  if (data.results?.length > 0) {
    const page = data.results[0];
    const dateVal = page.properties?.["分析日"]?.date?.start;
    return {
      id: page.id,
      url: page.url,
      analysisDate: dateVal ? dateVal.slice(0, 10) : undefined,
    };
  }
  return null;
}

/**
 * 同日中に既に分析済みかチェック
 */
export async function hasAnalysisToday(symbol: string): Promise<boolean> {
  if (!isNotionConfigured()) return false;
  const existing = await findExistingPage(symbol);
  if (!existing?.analysisDate) return false;
  const today = new Date(Date.now() + 9 * 3600_000)
    .toISOString()
    .slice(0, 10);
  return existing.analysisDate === today;
}

// ---------- トグルブロック追加 ----------

async function appendToggleWithReport(
  pageId: string,
  entry: NotionAnalysisEntry,
): Promise<void> {
  const decisionLabel = DECISION_MAP[entry.decision] ?? "WAIT";
  const toggleTitle = `${entry.analysisDate} ${decisionLabel} (${MODEL_MAP[entry.model] ?? entry.model})`;

  const reportBlocks = markdownToBlocks(entry.reportMarkdown);

  const toggleBlock: NotionBlock = {
    object: "block",
    type: "toggle",
    toggle: {
      rich_text: richText(toggleTitle),
      children: reportBlocks.slice(0, 100),
    },
  };

  const res = await fetch(
    `https://api.notion.com/v1/blocks/${pageId}/children`,
    {
      method: "PATCH",
      headers: notionHeaders(),
      body: JSON.stringify({ children: [toggleBlock] }),
    },
  );

  if (!res.ok) {
    const errBody = await res.text().catch(() => "");
    throw new Error(
      `Notion API トグル追加失敗: ${res.status} ${errBody.slice(0, 500)}`,
    );
  }

  if (reportBlocks.length > 100) {
    const data = await res.json();
    const toggleId = data.results?.[0]?.id;
    if (toggleId) {
      for (let offset = 100; offset < reportBlocks.length; offset += 100) {
        const batch = reportBlocks.slice(offset, offset + 100);
        const appendRes = await fetch(
          `https://api.notion.com/v1/blocks/${toggleId}/children`,
          {
            method: "PATCH",
            headers: notionHeaders(),
            body: JSON.stringify({ children: batch }),
          },
        );
        if (!appendRes.ok) {
          console.warn(
            `[Notion] トグル内追加ブロック失敗 (offset=${offset}): ${appendRes.status}`,
          );
          break;
        }
      }
    }
  }
}

// ---------- メイン関数 ----------

export function isNotionConfigured(): boolean {
  return !!(process.env.NOTION_API_KEY && process.env.NOTION_DATABASE_ID);
}

// ---------- 検証用: DB日付範囲クエリ ----------

export interface AnalysisPageSummary {
  pageId: string;
  pageUrl: string;
  symbol: string;
  companyName: string;
  analysisDate: string;
  price: number;
  shortTermDecision: string | null;
  midTermDecision: string | null;
  longTermDecision: string | null;
  shortTermBuy: number | null;
  shortTermTP: number | null;
  shortTermSL: number | null;
  midTermBuy: number | null;
  midTermTP: number | null;
  midTermSL: number | null;
  longTermBuy: number | null;
  longTermTP: number | null;
  longTermSL: number | null;
  confidence: string | null;
}

function extractNumber(props: Record<string, unknown>, key: string): number | null {
  const prop = props?.[key] as { number?: number } | undefined;
  const val = prop?.number;
  return val != null && isFinite(val) ? val : null;
}

function extractSelect(props: Record<string, unknown>, key: string): string | null {
  const prop = props?.[key] as { select?: { name?: string } } | undefined;
  return prop?.select?.name ?? null;
}

function extractRichText(props: Record<string, unknown>, key: string): string {
  const prop = props?.[key] as { rich_text?: Array<{ plain_text?: string }> } | undefined;
  const rt = prop?.rich_text;
  if (!Array.isArray(rt)) return "";
  return rt.map((t) => t.plain_text ?? "").join("");
}

/**
 * 分析日が指定範囲内かつ GO 判定がある全ページを取得
 */
export async function queryAnalysisByDateRange(
  fromDate: string,
  toDate: string,
): Promise<AnalysisPageSummary[]> {
  const dbId = process.env.NOTION_DATABASE_ID;
  if (!dbId) return [];

  const results: AnalysisPageSummary[] = [];
  let startCursor: string | undefined;

  do {
    const body: Record<string, unknown> = {
      filter: {
        and: [
          { property: "分析日", date: { on_or_after: fromDate } },
          { property: "分析日", date: { on_or_before: toDate } },
          {
            or: [
              { property: "短期判定", select: { equals: "GO" } },
              { property: "中期判定", select: { equals: "GO" } },
              { property: "長期判定", select: { equals: "GO" } },
            ],
          },
        ],
      },
      page_size: 100,
    };
    if (startCursor) body.start_cursor = startCursor;

    const res = await fetch(
      `https://api.notion.com/v1/databases/${dbId}/query`,
      { method: "POST", headers: notionHeaders(), body: JSON.stringify(body) },
    );
    if (!res.ok) {
      console.warn(`[Notion] queryAnalysisByDateRange failed: ${res.status}`);
      break;
    }
    const data = await res.json() as { results?: Array<{ id: string; url: string; properties: Record<string, unknown> }>; has_more?: boolean; next_cursor?: string | null };
    for (const page of data.results ?? []) {
      const props = page.properties;
      const titleProp = props?.["銘柄コード"] as { title?: Array<{ plain_text?: string }> } | undefined;
      const titleArr = titleProp?.title;
      const symbol = Array.isArray(titleArr)
        ? titleArr.map((t) => t.plain_text ?? "").join("")
        : "";
      if (!symbol) continue;

      results.push({
        pageId: page.id,
        pageUrl: page.url,
        symbol,
        companyName: extractRichText(props, "企業名"),
        analysisDate: ((props?.["分析日"] as { date?: { start?: string } })?.date?.start ?? "").slice(0, 10),
        price: extractNumber(props, "株価") ?? 0,
        shortTermDecision: extractSelect(props, "短期判定"),
        midTermDecision: extractSelect(props, "中期判定"),
        longTermDecision: extractSelect(props, "長期判定"),
        shortTermBuy: extractNumber(props, "短期買値"),
        shortTermTP: extractNumber(props, "短期利確"),
        shortTermSL: extractNumber(props, "短期損切"),
        midTermBuy: extractNumber(props, "中期買値"),
        midTermTP: extractNumber(props, "中期利確"),
        midTermSL: extractNumber(props, "中期損切"),
        longTermBuy: extractNumber(props, "長期買値"),
        longTermTP: extractNumber(props, "長期利確"),
        longTermSL: extractNumber(props, "長期損切"),
        confidence: extractSelect(props, "確信度"),
      });
    }
    startCursor = data.has_more ? (data.next_cursor ?? undefined) : undefined;
  } while (startCursor);

  return results;
}

// ---------- 検証用: ページ内トグルタイトル取得 ----------

/**
 * ページ直下のトグルブロックタイトル一覧を返す（冪等性チェック用）
 */
export async function getPageBlockTitles(pageId: string): Promise<string[]> {
  const titles: string[] = [];
  let startCursor: string | undefined;

  do {
    const url = startCursor
      ? `https://api.notion.com/v1/blocks/${pageId}/children?page_size=100&start_cursor=${startCursor}`
      : `https://api.notion.com/v1/blocks/${pageId}/children?page_size=100`;
    const res = await fetch(url, { headers: notionHeaders() });
    if (!res.ok) break;
    const data = await res.json() as { results?: Array<{ type: string; toggle?: { rich_text?: Array<{ plain_text?: string }> } }>; has_more?: boolean; next_cursor?: string | null };
    for (const block of data.results ?? []) {
      if (block.type === "toggle") {
        const rt = block.toggle?.rich_text;
        if (Array.isArray(rt)) {
          titles.push(
            rt.map((t) => t.plain_text ?? "").join(""),
          );
        }
      }
    }
    startCursor = data.has_more ? (data.next_cursor ?? undefined) : undefined;
  } while (startCursor);

  return titles;
}

// ---------- 検証用: シンプルトグル追加 ----------

/**
 * 軽量なトグルブロックを追加（検証結果用）
 */
export async function appendSimpleToggle(
  pageId: string,
  title: string,
  bodyLines: string[],
): Promise<void> {
  const children: NotionBlock[] = bodyLines.map((line) => ({
    object: "block",
    type: "bulleted_list_item",
    bulleted_list_item: { rich_text: richText(line) },
  }));

  const toggleBlock: NotionBlock = {
    object: "block",
    type: "toggle",
    toggle: {
      rich_text: richText(title),
      children: children.slice(0, 100),
    },
  };

  const res = await fetch(
    `https://api.notion.com/v1/blocks/${pageId}/children`,
    {
      method: "PATCH",
      headers: notionHeaders(),
      body: JSON.stringify({ children: [toggleBlock] }),
    },
  );
  if (!res.ok) {
    const errBody = await res.text().catch(() => "");
    console.warn(`[Notion] 検証トグル追加失敗: ${res.status} ${errBody.slice(0, 200)}`);
  }
}

// ---------- 検証用: プロパティ更新 ----------

export interface ReviewPropertyUpdate {
  reviewDate: string;
  shortTermResult?: string;
  shortTermReturnPct?: number;
  midTermResult?: string;
  midTermReturnPct?: number;
  longTermResult?: string;
  longTermReturnPct?: number;
}

/**
 * 検証結果プロパティを更新
 */
export async function updateReviewProperties(
  pageId: string,
  update: ReviewPropertyUpdate,
): Promise<void> {
  const props: NotionPropertiesInput = {
    "検証日": { date: { start: update.reviewDate } },
  };
  if (update.shortTermResult) {
    props["短期結果"] = { select: { name: update.shortTermResult } };
  }
  if (update.shortTermReturnPct != null) {
    props["短期騰落率"] = { number: Math.round(update.shortTermReturnPct * 100) / 100 };
  }
  if (update.midTermResult) {
    props["中期結果"] = { select: { name: update.midTermResult } };
  }
  if (update.midTermReturnPct != null) {
    props["中期騰落率"] = { number: Math.round(update.midTermReturnPct * 100) / 100 };
  }
  if (update.longTermResult) {
    props["長期結果"] = { select: { name: update.longTermResult } };
  }
  if (update.longTermReturnPct != null) {
    props["長期騰落率"] = { number: Math.round(update.longTermReturnPct * 100) / 100 };
  }

  const res = await fetch(`https://api.notion.com/v1/pages/${pageId}`, {
    method: "PATCH",
    headers: notionHeaders(),
    body: JSON.stringify({ properties: props }),
  });
  if (!res.ok) {
    const errBody = await res.text().catch(() => "");
    console.warn(`[Notion] 検証プロパティ更新失敗: ${res.status} ${errBody.slice(0, 200)}`);
  }
}

// ---------- 検証記録DB: バッチサマリー作成 ----------

export interface ReviewBatchSummary {
  title: string; // "2026-02-18 分析 → 1w検証"
  analysisDate: string;
  reviewDate: string;
  reviewLabel: string; // 1w / 2w / 3w / 4w / custom
  totalPages: number;
  goJudgments: number;
  shortGo: number;
  midGo: number;
  longGo: number;
  tpHit: number;
  slHit: number;
  notReached: number;
  undecided: number;
  winRate: number; // %
  avgReturn: number; // %
}

export async function createReviewBatchSummary(
  summary: ReviewBatchSummary,
  bodyBlocks?: NotionBlock[],
): Promise<void> {
  const dbId = process.env.NOTION_REVIEW_DATABASE_ID;
  if (!dbId) {
    console.warn("[Notion] NOTION_REVIEW_DATABASE_ID が未設定です");
    return;
  }

  // Notion の % フォーマットは小数を期待 (0.4444 → 44.44%)
  const props: NotionPropertiesInput = {
    "タイトル": { title: [{ type: "text", text: { content: summary.title } }] },
    "分析日": { date: { start: summary.analysisDate } },
    "検証日": { date: { start: summary.reviewDate } },
    "検証ラベル": { select: { name: summary.reviewLabel } },
    "分析件数": { number: summary.totalPages },
    "GO判定数": { number: summary.goJudgments },
    "短期GO": { number: summary.shortGo },
    "中期GO": { number: summary.midGo },
    "長期GO": { number: summary.longGo },
    "利確到達": { number: summary.tpHit },
    "損切到達": { number: summary.slHit },
    "買値未到達": { number: summary.notReached },
    "未決着": { number: summary.undecided },
    "勝率": { number: Math.round(summary.winRate * 100) / 10000 },
    "平均騰落率": { number: Math.round(summary.avgReturn * 100) / 10000 },
  };

  const body: { parent: { database_id: string }; properties: NotionPropertiesInput; children?: NotionBlock[] } = {
    parent: { database_id: dbId },
    properties: props,
  };
  if (bodyBlocks && bodyBlocks.length > 0) {
    body.children = bodyBlocks.slice(0, 100); // Notion上限100ブロック
  }

  const res = await fetch("https://api.notion.com/v1/pages", {
    method: "POST",
    headers: notionHeaders(),
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const errBody = await res.text().catch(() => "");
    console.warn(`[Notion] 検証記録サマリー作成失敗: ${res.status} ${errBody.slice(0, 200)}`);
  }
}

/** 検証記録ページ用のブロックを構築するヘルパー */
export function buildReviewBlocks(sections: { heading: string; lines: string[] }[]): NotionBlock[] {
  const blocks: NotionBlock[] = [];
  for (const section of sections) {
    blocks.push({
      object: "block",
      type: "heading_3",
      heading_3: { rich_text: richText(section.heading) },
    });
    for (const line of section.lines) {
      blocks.push({
        object: "block",
        type: "bulleted_list_item",
        bulleted_list_item: { rich_text: richText(line) },
      });
    }
  }
  return blocks;
}

// ---------- メイン関数 ----------

/**
 * Notion API のバリデーションエラーから存在しないプロパティ名を抽出
 */
function extractMissingProperty(errBody: string): string | null {
  // "XXX is not a property that exists." パターン
  const match = errBody.match(/"message":"(.+?) is not a property that exists\."/);
  return match ? match[1] : null;
}

/**
 * プロパティを送信し、存在しないプロパティがあれば除外してリトライ
 */
async function sendWithPropertyRetry(
  url: string,
  method: "POST" | "PATCH",
  body: Record<string, unknown>,
  maxRetries = 3,
): Promise<Response> {
  const props = body.properties as NotionPropertiesInput;
  const removed: string[] = [];

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const res = await fetch(url, {
      method,
      headers: notionHeaders(),
      body: JSON.stringify(body),
    });

    if (res.ok) {
      if (removed.length > 0) {
        console.warn(`[Notion] DB に存在しないプロパティを除外: ${removed.join(", ")}`);
      }
      return res;
    }

    const errBody = await res.text().catch(() => "");
    const missing = extractMissingProperty(errBody);

    if (res.status === 400 && missing && props[missing] != null && attempt < maxRetries) {
      delete props[missing];
      removed.push(missing);
      continue;
    }

    // リトライ不能なエラー
    const errRes = new Response(errBody, { status: res.status, statusText: res.statusText });
    return errRes;
  }

  // ここには到達しないが型安全のため
  throw new Error("[Notion] リトライ上限超過");
}

export async function createAnalysisPage(
  entry: NotionAnalysisEntry,
): Promise<{ id: string; url: string }> {
  const apiKey = process.env.NOTION_API_KEY;
  const dbId = process.env.NOTION_DATABASE_ID;
  if (!apiKey || !dbId)
    throw new Error("NOTION_API_KEY or NOTION_DATABASE_ID not set");

  const existing = await findExistingPage(entry.symbol);

  let pageId: string;
  let pageUrl: string;

  if (existing) {
    console.log(`[Notion] 既存ページ検出: ${entry.symbol}`);
    pageId = existing.id;
    pageUrl = existing.url;
    // プロパティ更新（titleは更新しない）
    const res = await sendWithPropertyRetry(
      `https://api.notion.com/v1/pages/${pageId}`,
      "PATCH",
      { properties: buildProperties(entry, false) },
    );
    if (!res.ok) {
      const errBody = await res.text().catch(() => "");
      console.warn(`[Notion] プロパティ更新失敗: ${res.status} ${errBody.slice(0, 200)}`);
    }
  } else {
    console.log(`[Notion] 新規ページ作成: ${entry.symbol}`);
    const res = await sendWithPropertyRetry(
      "https://api.notion.com/v1/pages",
      "POST",
      {
        parent: { database_id: dbId },
        properties: buildProperties(entry, true),
      },
    );
    if (!res.ok) {
      const errBody = await res.text().catch(() => "");
      throw new Error(
        `Notion API error: ${res.status} ${errBody.slice(0, 500)}`,
      );
    }
    const data = await res.json();
    pageId = data.id;
    pageUrl = data.url;
  }

  await appendToggleWithReport(pageId, entry);

  return { id: pageId, url: pageUrl };
}
