import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { devOnly } from "@/lib/admin/guard";

const FILE = () => path.join(process.cwd(), "data/overrides/h2-physics.json");

/** Merge a patch into the override for one question. Overrides are committed and survive pipeline reruns. */
export async function POST(req: NextRequest) {
  const blocked = devOnly();
  if (blocked) return blocked;
  const { id, patch } = (await req.json()) as { id: string; patch: Record<string, unknown> | null };
  if (!/^[a-z0-9-]+$/.test(id)) return NextResponse.json({ error: "bad id" }, { status: 400 });
  const file = FILE();
  const all = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, "utf8")) : {};
  if (patch === null) delete all[id];
  else {
    const next = { ...(all[id] ?? {}), ...patch };
    for (const [k, v] of Object.entries(next)) if (v === null) delete next[k];
    all[id] = next;
  }
  const sorted = Object.fromEntries(Object.entries(all).sort(([a], [b]) => a.localeCompare(b, "en", { numeric: true })));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(sorted, null, 2) + "\n");
  return NextResponse.json({ ok: true, override: sorted[id] ?? null });
}
