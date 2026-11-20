import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { devOnly } from "@/lib/admin/guard";

/** Serves the original full-question crop from the pipeline cache (never published). */
export async function GET(req: NextRequest) {
  const blocked = devOnly();
  if (blocked) return blocked;
  const id = req.nextUrl.searchParams.get("id") ?? "";
  const name = req.nextUrl.searchParams.get("name") ?? "full";
  const m = id.match(/^([a-z0-9-]+)-q(\d+)$/);
  if (!m || !/^[a-z0-9]+$/.test(name)) return new NextResponse("bad id", { status: 400 });
  const file = path.join(process.cwd(), "pipeline/cache/crops", m[1], `q${m[2].padStart(2, "0")}-${name}.webp`);
  if (!fs.existsSync(file)) return new NextResponse("missing", { status: 404 });
  return new NextResponse(fs.readFileSync(file), { headers: { "content-type": "image/webp", "cache-control": "no-store" } });
}
