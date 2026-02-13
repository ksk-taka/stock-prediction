/**
 * Kabutan 株主優待ページスクレイパー
 *
 * URL: https://kabutan.jp/stock/yutai/?code=XXXX
 * - HTTP 302 redirect → 優待なし
 * - HTTP 200 → cheerioでパース
 */

import * as cheerio from "cheerio";
import { kabutanQueue } from "@/lib/utils/requestQueue";
import type { YutaiInfo } from "@/types/yutai";

const KABUTAN_YUTAI_URL = "https://kabutan.jp/stock/yutai/?code=";
const KABUTAN_DELAY_MS = 800;
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

const NO_YUTAI: YutaiInfo = {
  hasYutai: false,
  content: null,
  recordMonth: null,
  minimumShares: null,
  recordDate: null,
  longTermBenefit: null,
  yutaiYield: null,
};

function delay(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * 単一銘柄の株主優待情報を取得
 * @param code 4桁コード (例: "7203") or symbol (例: "7203.T")
 */
export async function fetchYutaiInfo(code: string): Promise<YutaiInfo> {
  const numericCode = code.replace(".T", "");
  const url = `${KABUTAN_YUTAI_URL}${numericCode}`;

  try {
    const res = await fetch(url, {
      headers: { "User-Agent": USER_AGENT },
      redirect: "manual",
    });

    // 302 リダイレクト = 優待なし
    if (res.status === 301 || res.status === 302) {
      return { ...NO_YUTAI };
    }

    if (!res.ok) {
      console.error(`[kabutan] HTTP ${res.status} for ${numericCode}`);
      return { ...NO_YUTAI };
    }

    const html = await res.text();
    return parseYutaiPage(html);
  } catch (err) {
    console.error(`[kabutan] Error fetching yutai for ${numericCode}:`, err);
    return { ...NO_YUTAI };
  }
}

/**
 * バッチで株主優待情報を取得（kabutanQueue 3並列 + 800ms遅延）
 */
export async function fetchYutaiBatch(
  codes: string[],
  onProgress?: (done: number, total: number) => void
): Promise<Map<string, YutaiInfo>> {
  const results = new Map<string, YutaiInfo>();
  let done = 0;

  const tasks = codes.map((code) =>
    kabutanQueue.add(async () => {
      const info = await fetchYutaiInfo(code);
      const symbol = code.includes(".T") ? code : `${code}.T`;
      results.set(symbol, info);
      done++;
      onProgress?.(done, codes.length);
      await delay(KABUTAN_DELAY_MS);
      return info;
    })
  );

  await Promise.allSettled(tasks);
  return results;
}

/**
 * Kabutan優待ページのHTMLをパース
 */
function parseYutaiPage(html: string): YutaiInfo {
  const $ = cheerio.load(html);

  const result: YutaiInfo = {
    hasYutai: true,
    content: null,
    recordMonth: null,
    minimumShares: null,
    recordDate: null,
    longTermBenefit: null,
    yutaiYield: null,
  };

  // 優待内容 (table.stock_yutai_top_3 td)
  const contentTd = $("table.stock_yutai_top_3 td").first();
  if (contentTd.length) {
    result.content = contentTd.text().trim() || null;
  }

  // table.stock_yutai_top_2 からフィールド抽出
  $("table.stock_yutai_top_2 tr").each((_, tr) => {
    $(tr)
      .find("th")
      .each((_, th) => {
        const thText = $(th).clone().children("div").remove().end().text().trim();
        const td = $(th).next("td");
        if (!td.length) return;
        const tdText = td.text().trim();

        if (thText.includes("権利確定月")) {
          result.recordMonth = tdText || null;
        } else if (thText.includes("最低必要株数")) {
          result.minimumShares = tdText || null;
        } else if (thText.includes("権利付き最終日")) {
          result.recordDate = tdText || null;
        } else if (thText.includes("長期保有優遇")) {
          result.longTermBenefit = tdText || null;
        }
      });
  });

  // 優待利回り (table.stock_yutai_top_1 td の2番目)
  const yieldTds = $("table.stock_yutai_top_1 td");
  if (yieldTds.length >= 2) {
    const yieldText = yieldTds.eq(1).text().trim();
    if (yieldText && yieldText !== "－%" && yieldText !== "-%") {
      result.yutaiYield = yieldText;
    }
  }

  return result;
}
