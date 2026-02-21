/**
 * Notion API 型定義
 *
 * このプロジェクトで使用する範囲の型定義を提供。
 * 公式の @notionhq/client の型は非常に複雑なため、
 * 必要な部分のみを定義。
 */

// ---------- リッチテキスト ----------

export interface NotionRichTextItem {
  type?: "text";
  text: {
    content: string;
    link?: { url: string } | null;
  };
  annotations?: {
    bold?: boolean;
    italic?: boolean;
    strikethrough?: boolean;
    underline?: boolean;
    code?: boolean;
    color?: string;
  };
  plain_text?: string;
}

// ---------- プロパティ値 ----------

export interface NotionTitleProperty {
  title: NotionRichTextItem[];
}

export interface NotionRichTextProperty {
  rich_text: NotionRichTextItem[];
}

export interface NotionNumberProperty {
  number: number | null;
}

export interface NotionSelectProperty {
  select: { name: string; color?: string } | null;
}

export interface NotionMultiSelectProperty {
  multi_select: Array<{ name: string; color?: string }>;
}

export interface NotionDateProperty {
  date: { start: string; end?: string | null } | null;
}

export interface NotionCheckboxProperty {
  checkbox: boolean;
}

export interface NotionUrlProperty {
  url: string | null;
}

export interface NotionFormulaProperty {
  formula: {
    type: "string" | "number" | "boolean" | "date";
    string?: string | null;
    number?: number | null;
    boolean?: boolean | null;
    date?: { start: string; end?: string | null } | null;
  };
}

// プロパティの共用体型
export type NotionPropertyValue =
  | NotionTitleProperty
  | NotionRichTextProperty
  | NotionNumberProperty
  | NotionSelectProperty
  | NotionMultiSelectProperty
  | NotionDateProperty
  | NotionCheckboxProperty
  | NotionUrlProperty
  | NotionFormulaProperty;

// ---------- ブロック ----------

export interface NotionParagraphBlock {
  object: "block";
  type: "paragraph";
  paragraph: {
    rich_text: NotionRichTextItem[];
    color?: string;
  };
}

export interface NotionHeading2Block {
  object: "block";
  type: "heading_2";
  heading_2: {
    rich_text: NotionRichTextItem[];
    color?: string;
  };
}

export interface NotionHeading3Block {
  object: "block";
  type: "heading_3";
  heading_3: {
    rich_text: NotionRichTextItem[];
    color?: string;
  };
}

export interface NotionBulletedListItemBlock {
  object: "block";
  type: "bulleted_list_item";
  bulleted_list_item: {
    rich_text: NotionRichTextItem[];
    color?: string;
  };
}

export interface NotionCodeBlock {
  object: "block";
  type: "code";
  code: {
    rich_text: NotionRichTextItem[];
    language: string;
  };
}

export interface NotionToggleBlock {
  object: "block";
  type: "toggle";
  toggle: {
    rich_text: NotionRichTextItem[];
    color?: string;
    children?: NotionBlock[];
  };
}

export interface NotionDividerBlock {
  object: "block";
  type: "divider";
  divider: Record<string, never>;
}

// ブロックの共用体型
export type NotionBlock =
  | NotionParagraphBlock
  | NotionHeading2Block
  | NotionHeading3Block
  | NotionBulletedListItemBlock
  | NotionCodeBlock
  | NotionToggleBlock
  | NotionDividerBlock;

// ---------- ページ ----------

export interface NotionPage {
  object: "page";
  id: string;
  created_time: string;
  last_edited_time: string;
  archived: boolean;
  properties: Record<string, NotionPropertyValue & { id: string; type: string }>;
  url: string;
}

// ---------- クエリ結果 ----------

export interface NotionQueryResult {
  object: "list";
  results: NotionPage[];
  has_more: boolean;
  next_cursor: string | null;
}

// ---------- ヘルパー型 ----------

// ページ作成/更新用のプロパティ
export type NotionPropertiesInput = Record<string, NotionPropertyValue>;
