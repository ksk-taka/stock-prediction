/**
 * 決算資料PDFテキスト抽出ユーティリティ
 *
 * data/earnings/{code}_{name}/ 配下のPDFからテキストを抽出し、
 * LLM分析パイプラインに渡せる形式で返す。
 *
 * ファイル名パターン: {種類}_{YYYY-MM-DD}_{タイトル}.pdf
 *   種類: 決算短信, 説明資料, 有報, 半期報
 */

import { readFileSync, readdirSync, existsSync } from "fs";
import { join } from "path";

const EARNINGS_DIR = join(process.cwd(), "data", "earnings");

/** 資料の種類（優先順位順） */
export const DOC_PRIORITIES = ["決算短信", "説明資料", "半期報", "有報"] as const;
export type DocType = (typeof DOC_PRIORITIES)[number];

export interface ParsedFile {
  filename: string;
  type: DocType | "other";
  date: string;
}

/**
 * 銘柄コードから決算資料フォルダを探す
 */
export function findEarningsDir(symbol: string): string | null {
  const code = symbol.replace(".T", "");
  if (!existsSync(EARNINGS_DIR)) return null;

  const dirs = readdirSync(EARNINGS_DIR);
  const match = dirs.find((d) => d.startsWith(code + "_"));
  return match ? join(EARNINGS_DIR, match) : null;
}

/**
 * ファイル名を解析して種類と日付を取得
 */
export function parseFilename(filename: string): ParsedFile {
  const typeMatch = DOC_PRIORITIES.find((t) => filename.startsWith(t + "_"));
  const dateMatch = filename.match(/_(\d{4}-\d{2}-\d{2})_/);

  return {
    filename,
    type: typeMatch ?? "other",
    date: dateMatch ? dateMatch[1] : "",
  };
}

/**
 * PDFからテキスト抽出
 * pdfjs の CMap 警告を抑制しつつテキスト取得
 */
async function extractPdfText(filePath: string): Promise<string> {
  const { extractText } = await import("unpdf");
  const buffer = readFileSync(filePath);
  const uint8 = new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);

  // pdfjs の loadFont 警告を一時的に抑制
  const origWarn = console.warn;
  console.warn = (...args: unknown[]) => {
    const msg = String(args[0] ?? "");
    if (msg.includes("loadFont") || msg.includes("cMapUrl")) return;
    origWarn.apply(console, args);
  };

  try {
    const result = await extractText(uint8);
    return Array.isArray(result.text) ? result.text.join("\n\n") : String(result.text);
  } finally {
    console.warn = origWarn;
  }
}

/**
 * 銘柄の決算資料テキストを取得
 *
 * 優先順位: 決算短信 > 説明資料 > 半期報 > 有報（各種最新1件）
 * maxChars で合計文字数上限を制御（日本語: 約 1トークン ≈ 2~3文字）
 *
 * @param symbol - 銘柄コード (例: "7203.T")
 * @param maxChars - 最大文字数 (デフォルト: 80000 ≈ 約3万トークン)
 */
export async function getEarningsText(
  symbol: string,
  maxChars: number = 80000,
): Promise<{ text: string; sources: string[]; totalChars: number } | null> {
  const dir = findEarningsDir(symbol);
  if (!dir) return null;

  const files = readdirSync(dir).filter((f) => f.endsWith(".pdf"));
  if (files.length === 0) return null;

  // ファイルを解析・日付降順ソート
  const parsed = files
    .map(parseFilename)
    .filter((f): f is ParsedFile & { type: DocType } => f.type !== "other")
    .sort((a, b) => b.date.localeCompare(a.date));

  const results: string[] = [];
  const sources: string[] = [];
  let totalChars = 0;

  for (const targetType of DOC_PRIORITIES) {
    if (totalChars >= maxChars) break;

    const latest = parsed.find((f) => f.type === targetType);
    if (!latest) continue;

    try {
      const text = await extractPdfText(join(dir, latest.filename));

      // テキストが少なすぎる場合はスキップ（CMap不足等で抽出失敗）
      if (text.length < 200) {
        console.log(
          `  [決算] ${targetType} ${latest.date}: ${text.length}文字 → テキスト不足のためスキップ`,
        );
        continue;
      }

      const remaining = maxChars - totalChars;
      const truncated =
        text.length > remaining
          ? text.slice(0, remaining) + "\n...(以下省略)"
          : text;

      results.push(`【${targetType} ${latest.date}】\n${truncated}`);
      sources.push(latest.filename);
      totalChars += truncated.length;

      console.log(
        `  [決算] ${targetType} ${latest.date}: ${text.length.toLocaleString()}文字${text.length > remaining ? ` → ${truncated.length.toLocaleString()}文字に切り詰め` : ""}`,
      );
    } catch (err) {
      console.warn(
        `  [決算] PDF抽出エラー (${latest.filename}):`,
        err instanceof Error ? err.message : err,
      );
    }
  }

  if (results.length === 0) return null;

  return { text: results.join("\n\n"), sources, totalChars };
}

/**
 * 決算資料が利用可能な銘柄一覧を取得
 */
export function listAvailableEarnings(): {
  symbol: string;
  folder: string;
  pdfCount: number;
  files: string[];
}[] {
  if (!existsSync(EARNINGS_DIR)) return [];

  return readdirSync(EARNINGS_DIR)
    .map((d) => {
      const code = d.split("_")[0];
      const fullPath = join(EARNINGS_DIR, d);
      const pdfs = readdirSync(fullPath).filter((f) => f.endsWith(".pdf"));
      return {
        symbol: `${code}.T`,
        folder: d,
        pdfCount: pdfs.length,
        files: pdfs,
      };
    })
    .filter((d) => d.pdfCount > 0);
}
