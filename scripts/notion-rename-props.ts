#!/usr/bin/env tsx
// ============================================================
// Notion DB プロパティ リネーム + 新規追加
//
// 既存の「買値推奨」「利確目標」「損切ライン」を中期用にリネームし、
// 短期・長期用の価格プロパティを新規追加する。
//
// 使い方:
//   npx tsx scripts/notion-rename-props.ts          # dry-run
//   npx tsx scripts/notion-rename-props.ts --apply   # 実行
// ============================================================

import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

const NOTION_API_KEY = process.env.NOTION_API_KEY;
const DATABASE_ID = process.env.NOTION_DATABASE_ID;

if (!NOTION_API_KEY || !DATABASE_ID) {
  console.error("NOTION_API_KEY / NOTION_DATABASE_ID が未設定です");
  process.exit(1);
}

const apply = process.argv.includes("--apply");

const headers: Record<string, string> = {
  Authorization: `Bearer ${NOTION_API_KEY}`,
  "Notion-Version": "2022-06-28",
  "Content-Type": "application/json",
};

// リネーム: 旧名 → 新名
const renames: Record<string, string> = {
  "買値推奨": "中期買値",
  "利確目標": "中期利確",
  "損切ライン": "中期損切",
};

// 新規追加（number型）
const newProps = [
  "短期買値", "短期利確", "短期損切",
  "長期買値", "長期利確", "長期損切",
];

async function main() {
  // 現在のプロパティ取得
  const dbRes = await fetch(`https://api.notion.com/v1/databases/${DATABASE_ID}`, {
    headers,
  });
  if (!dbRes.ok) {
    console.error(`DB取得エラー: ${dbRes.status} ${await dbRes.text()}`);
    process.exit(1);
  }
  const db = await dbRes.json();
  const existingProps = Object.keys(db.properties);

  console.log("=== Notion DB プロパティ更新 ===\n");

  // リネーム対象の確認
  const properties: Record<string, unknown> = {};

  for (const [oldName, newName] of Object.entries(renames)) {
    if (existingProps.includes(oldName)) {
      console.log(`  リネーム: "${oldName}" → "${newName}"`);
      properties[oldName] = { name: newName };
    } else if (existingProps.includes(newName)) {
      console.log(`  スキップ: "${newName}" は既に存在`);
    } else {
      console.log(`  ⚠ "${oldName}" が見つかりません → "${newName}" を新規作成`);
      properties[newName] = { number: {} };
    }
  }

  // 新規プロパティ追加
  for (const name of newProps) {
    if (existingProps.includes(name)) {
      console.log(`  スキップ: "${name}" は既に存在`);
    } else {
      console.log(`  新規追加: "${name}" (number)`);
      properties[name] = { number: {} };
    }
  }

  if (Object.keys(properties).length === 0) {
    console.log("\n変更なし。");
    return;
  }

  if (!apply) {
    console.log("\n⚠ dry-run モードです。--apply を付けて実行してください。");
    return;
  }

  // 実行
  console.log("\n更新中...");
  const updateRes = await fetch(`https://api.notion.com/v1/databases/${DATABASE_ID}`, {
    method: "PATCH",
    headers,
    body: JSON.stringify({ properties }),
  });

  if (!updateRes.ok) {
    console.error(`更新エラー: ${updateRes.status} ${await updateRes.text()}`);
    process.exit(1);
  }

  console.log("✅ 完了！");

  // 結果確認
  const updated = await updateRes.json();
  const updatedProps = Object.keys(updated.properties).sort();
  const priceProps = updatedProps.filter(
    (p) => p.includes("買値") || p.includes("利確") || p.includes("損切"),
  );
  console.log("\n価格プロパティ一覧:");
  for (const p of priceProps) {
    console.log(`  - ${p}`);
  }
}

main().catch(console.error);
