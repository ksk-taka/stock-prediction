import { NextResponse } from "next/server";
import { spawn, type ChildProcess } from "child_process";

export const dynamic = "force-dynamic";

// Use globalThis to survive HMR in dev mode
const g = globalThis as unknown as { __scanChild?: ChildProcess; __scanRunning?: boolean };

export async function POST() {
  // Check if a previous scan process is actually still alive
  if (g.__scanRunning && g.__scanChild && !g.__scanChild.killed) {
    return NextResponse.json(
      { error: "スキャンは既に実行中です" },
      { status: 409 },
    );
  }

  // Reset stale flag (process died without cleanup)
  g.__scanRunning = true;

  try {
    const exitCode = await new Promise<number>((resolve, reject) => {
      const child = spawn("npx", ["tsx", "scripts/scan-new-highs.ts", "--csv"], {
        cwd: process.cwd(),
        stdio: "ignore",
        shell: true,
      });
      g.__scanChild = child;

      const timeout = setTimeout(() => {
        child.kill();
        reject(new Error("スキャンがタイムアウトしました（10分）"));
      }, 10 * 60 * 1000);

      child.on("close", (code) => {
        clearTimeout(timeout);
        resolve(code ?? 1);
      });
      child.on("error", (err) => {
        clearTimeout(timeout);
        reject(err);
      });
    });

    if (exitCode !== 0) {
      return NextResponse.json(
        { error: `スキャンが異常終了しました (exit code: ${exitCode})` },
        { status: 500 },
      );
    }

    return NextResponse.json({ ok: true, message: "スキャン完了" });
  } catch (err) {
    return NextResponse.json(
      { error: String(err) },
      { status: 500 },
    );
  } finally {
    g.__scanRunning = false;
    g.__scanChild = undefined;
  }
}
