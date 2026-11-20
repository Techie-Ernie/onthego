import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs";
import path from "node:path";
import { devOnly } from "@/lib/admin/guard";
import type { BankShard, Question } from "@/lib/types";

const SUBJECT = "h2-physics";

export async function GET(req: NextRequest) {
  const blocked = devOnly();
  if (blocked) return blocked;
  const root = process.cwd();
  const dir = path.join(root, "data/bank", SUBJECT);
  const questions: Question[] = [];
  if (fs.existsSync(dir))
    for (const f of fs.readdirSync(dir).filter((f) => f.endsWith(".json") && f !== "index.json"))
      questions.push(...(JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")) as BankShard).questions);
  const read = (p: string) => (fs.existsSync(path.join(root, p)) ? JSON.parse(fs.readFileSync(path.join(root, p), "utf8")) : null);
  return NextResponse.json({
    questions: questions.sort((a, b) => a.id.localeCompare(b.id, "en", { numeric: true })),
    overrides: read(`data/overrides/${SUBJECT}.json`) ?? {},
    report: read("data/ingest-report.json"),
    syllabus: read(`syllabus/${SUBJECT}.json`),
    sample: req.nextUrl.searchParams.has("sample"),
  });
}
