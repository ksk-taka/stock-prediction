/**
 * Notion API クライアント
 *
 * 統合分析結果を Notion データベースに登録する。
 * 同じ銘柄は同一ページに日付付きトグルで追記。
 * 環境変数: NOTION_API_KEY, NOTION_DATABASE_ID
 */

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
  // 推奨価格
  buyPrice?: number;
  takeProfitPrice?: number;
  stopLossPrice?: number;
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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function buildProperties(entry: NotionAnalysisEntry, includeTitle: boolean): Record<string, any> {
  const truncate = (s: string, max = 2000) =>
    s.length > max ? s.slice(0, max - 3) + "..." : s;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const props: Record<string, any> = {};

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
    ["買値推奨", entry.buyPrice],
    ["利確目標", entry.takeProfitPrice],
    ["損切ライン", entry.stopLossPrice],
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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type NotionBlock = Record<string, any>;

function richText(
  content: string,
): { type: string; text: { content: string } }[] {
  const chunks: { type: string; text: { content: string } }[] = [];
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
    const res = await fetch(`https://api.notion.com/v1/pages/${pageId}`, {
      method: "PATCH",
      headers: notionHeaders(),
      body: JSON.stringify({ properties: buildProperties(entry, false) }),
    });
    if (!res.ok) {
      const errBody = await res.text().catch(() => "");
      console.warn(`[Notion] プロパティ更新失敗: ${res.status} ${errBody.slice(0, 200)}`);
    }
  } else {
    console.log(`[Notion] 新規ページ作成: ${entry.symbol}`);
    const res = await fetch("https://api.notion.com/v1/pages", {
      method: "POST",
      headers: notionHeaders(),
      body: JSON.stringify({
        parent: { database_id: dbId },
        properties: buildProperties(entry, true),
      }),
    });
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
