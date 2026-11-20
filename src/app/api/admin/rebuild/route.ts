import { NextResponse } from "next/server";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { devOnly } from "@/lib/admin/guard";

const run = promisify(execFile);

/** Re-runs the bank build (applies overrides) and refreshes public/bank. */
export async function POST() {
  const blocked = devOnly();
  if (blocked) return blocked;
  try {
    const a = await run("npx", ["tsx", "pipeline/src/cli.ts", "build"], { cwd: process.cwd(), maxBuffer: 16 * 1024 * 1024 });
    const b = await run("node", ["scripts/copy-bank.mjs"], { cwd: process.cwd() });
    return NextResponse.json({ ok: true, log: a.stdout + b.stdout });
  } catch (e) {
    return NextResponse.json({ ok: false, log: String((e as { stderr?: string }).stderr ?? e) }, { status: 500 });
  }
}
