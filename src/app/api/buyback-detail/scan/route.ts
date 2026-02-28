import { NextResponse } from "next/server";
import { spawn, type ChildProcess } from "child_process";
import { join } from "path";

export const dynamic = "force-dynamic";

const isVercel = !!process.env.VERCEL;

export async function POST() {
  if (isVercel) {
    return await triggerGitHubAction();
  }
  return await spawnLocalScan();
}

// ── Vercel: GitHub Actions トリガー ──

async function triggerGitHubAction() {
  const ghToken = process.env.GITHUB_PAT;
  const repo = process.env.GITHUB_REPO ?? "ksk-taka/stock-prediction";

  if (!ghToken) {
    return NextResponse.json(
      { error: "GITHUB_PAT が設定されていません" },
      { status: 500 },
    );
  }

  try {
    const res = await fetch(
      `https://api.github.com/repos/${repo}/dispatches`,
      {
        method: "POST",
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${ghToken}`,
          "X-GitHub-Api-Version": "2022-11-28",
        },
        body: JSON.stringify({
          event_type: "scan-buyback-detail",
        }),
      },
    );

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`GitHub API ${res.status}: ${text}`);
    }

    return NextResponse.json({
      ok: true,
      message: "自社株買い詳細スキャンを開始しました。完了まで数十分かかります。",
    });
  } catch (err) {
    return NextResponse.json(
      { error: `GitHub Actions の起動に失敗しました: ${err}` },
      { status: 500 },
    );
  }
}

// ── ローカル: spawn で直接実行 ──

const g = globalThis as unknown as {
  __buybackDetailChild?: ChildProcess;
  __buybackDetailRunning?: boolean;
};

async function spawnLocalScan() {
  if (g.__buybackDetailRunning && g.__buybackDetailChild && !g.__buybackDetailChild.killed) {
    return NextResponse.json(
      { error: "スキャンは既に実行中です" },
      { status: 409 },
    );
  }

  g.__buybackDetailRunning = true;

  try {
    const result = await new Promise<{ exitCode: number; stderr: string }>((resolve, reject) => {
      const cwd = process.cwd();
      const tsxBin = join(cwd, "node_modules", ".bin", "tsx");
      const child = spawn(tsxBin, ["scripts/fetch-buyback-detail.ts", "--force"], {
        cwd,
        stdio: ["ignore", "ignore", "pipe"],
        shell: true,
      });
      g.__buybackDetailChild = child;

      let stderr = "";
      child.stderr?.on("data", (chunk: Buffer) => {
        stderr += chunk.toString();
      });

      const timeout = setTimeout(() => {
        child.kill();
        reject(new Error("スキャンがタイムアウトしました（30分）"));
      }, 30 * 60 * 1000);

      child.on("close", (code) => {
        clearTimeout(timeout);
        resolve({ exitCode: code ?? 1, stderr });
      });
      child.on("error", (err) => {
        clearTimeout(timeout);
        reject(err);
      });
    });

    if (result.exitCode !== 0) {
      const detail = result.stderr ? `\n${result.stderr.slice(0, 500)}` : "";
      return NextResponse.json(
        { error: `スキャンが異常終了しました (exit code: ${result.exitCode})${detail}` },
        { status: 500 },
      );
    }

    return NextResponse.json({ ok: true, message: "自社株買い詳細スキャン完了" });
  } catch (err) {
    return NextResponse.json(
      { error: String(err) },
      { status: 500 },
    );
  } finally {
    g.__buybackDetailRunning = false;
    g.__buybackDetailChild = undefined;
  }
}
