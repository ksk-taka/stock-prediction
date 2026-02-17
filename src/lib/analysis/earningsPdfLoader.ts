/**
 * 決算資料PDF Bufferローダー
 *
 * earningsReader.ts のファイル探索ロジックを再利用しつつ、
 * テキスト抽出せずにPDFをBufferとして読み込む。
 * Gemini API の inlineData として直接送信するため。
 */

import { readFileSync, readdirSync } from "fs";
import { join } from "path";
import {
  findEarningsDir,
  parseFilename,
  DOC_PRIORITIES,
  type DocType,
} from "@/lib/utils/earningsReader";

// ---------- 型定義 ----------

export interface EarningsPdf {
  filename: string;
  type: DocType | "other";
  date: string;
  data: Buffer;
  sizeBytes: number;
}

export interface LoadPdfOptions {
  /** 含める資料タイプ (デフォルト: ["決算短信", "説明資料"]) */
  includeTypes?: string[];
  /** 合計サイズ上限バイト (デフォルト: 18MB) */
  maxTotalBytes?: number;
}

const DEFAULT_TYPES = ["決算短信", "説明資料"];
const DEFAULT_MAX_BYTES = 18 * 1024 * 1024; // 18MB (20MB上限に余裕)

// ---------- メイン関数 ----------

/**
 * 銘柄の決算資料PDFをBufferとして読み込む
 *
 * 対象タイプの全PDFを優先順位順 × 日付新しい順で返す。
 * 合計サイズが上限を超えた場合は残りをスキップ。
 */
export function loadEarningsPdfs(
  symbol: string,
  options?: LoadPdfOptions,
): EarningsPdf[] {
  const dir = findEarningsDir(symbol);
  if (!dir) {
    console.log(`[PDFLoader] ${symbol}: 決算資料フォルダなし`);
    return [];
  }

  const includeTypes = options?.includeTypes ?? DEFAULT_TYPES;
  const maxTotalBytes = options?.maxTotalBytes ?? DEFAULT_MAX_BYTES;

  const files = readdirSync(dir).filter((f) => f.endsWith(".pdf"));
  if (files.length === 0) {
    console.log(`[PDFLoader] ${symbol}: PDFファイルなし`);
    return [];
  }

  // ファイルを解析・対象タイプのみ抽出
  const parsed = files
    .map(parseFilename)
    .filter((f) => includeTypes.includes(f.type));

  // 優先順位順 × 日付新しい順でソート（全件取得）
  const targetTypes = DOC_PRIORITIES.filter((t) => includeTypes.includes(t));
  const sorted = parsed.sort((a, b) => {
    const typeOrderA = targetTypes.indexOf(a.type as DocType);
    const typeOrderB = targetTypes.indexOf(b.type as DocType);
    if (typeOrderA !== typeOrderB) return typeOrderA - typeOrderB;
    return b.date.localeCompare(a.date);
  });

  const results: EarningsPdf[] = [];
  let totalBytes = 0;

  for (const file of sorted) {
    const filePath = join(dir, file.filename);
    const data = readFileSync(filePath);

    // サイズチェック
    if (totalBytes + data.length > maxTotalBytes) {
      console.log(
        `[PDFLoader] ${file.filename}: サイズ超過のためスキップ (累計${(totalBytes / 1024 / 1024).toFixed(1)}MB + ${(data.length / 1024 / 1024).toFixed(1)}MB > ${(maxTotalBytes / 1024 / 1024).toFixed(0)}MB)`,
      );
      continue;
    }

    totalBytes += data.length;
    results.push({
      filename: file.filename,
      type: file.type,
      date: file.date,
      data,
      sizeBytes: data.length,
    });

    console.log(
      `[PDFLoader] ${file.type} ${file.date}: ${(data.length / 1024).toFixed(0)}KB (${file.filename})`,
    );
  }

  console.log(
    `[PDFLoader] ${symbol}: ${results.length}件のPDF読み込み完了 (合計${(totalBytes / 1024 / 1024).toFixed(1)}MB)`,
  );

  return results;
}
