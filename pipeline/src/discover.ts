/**
 * Walk a local folder of papers and classify each PDF by filename/folder conventions.
 * Pure `classifyPath` is unit-tested; `discoverLocal` does the IO.
 */
import fs from "node:fs";
import path from "node:path";
import type { ExamType } from "../../src/lib/types";

export interface PaperFile {
  source: "local" | "grail";
  /** path relative to the source root (used as provenance originalFile) */
  rel: string;
  abs: string;
  school: string;
  year: number;
  exam: ExamType;
  level: "H1" | "H2" | "H3";
  paperNo: number;
  role: "qp" | "key";
}

export interface SkippedFile {
  rel: string;
  reason: string;
}

const KEY_RE = /(?<![A-Za-z])(ans|answers?|ms|soln|solutions?|guide|mark\s*scheme|suggested|with answers|worked)(?![A-Za-z])/i;
const EXAM_RE: [RegExp, ExamType][] = [
  [/prelim/i, "Prelim"],
  [/promo/i, "Promo"],
  [/\b(mye|mid[- ]?year)\b/i, "MYE"],
  [/\bCT\d?\b|common test/i, "CT"],
  [/\bBT\d?\b|block test/i, "BT"],
];

/** "ACJC Physics" -> ACJC, "SAJC - note …" -> SAJC, "DHS Physics Prelim 2026" -> DHS */
export function schoolFromFolder(folder: string): string {
  const m = folder.trim().match(/^([A-Za-z]{2,6})\b/);
  return (m ? m[1] : folder).toUpperCase();
}

export function classifyPath(rel: string): { file?: Omit<PaperFile, "abs" | "source">; skip?: string } {
  const parts = rel.split(/[\\/]/);
  const name = parts[parts.length - 1];
  if (!/\.pdf$/i.test(name)) return { skip: "not a pdf" };
  const school = schoolFromFolder(parts[0]);
  const base = name.replace(/\.pdf$/i, "");

  // level: filename wins, then folder
  const tok = (t: string) => new RegExp(`(?<![A-Za-z0-9])${t}(?![A-Za-z0-9])`, "i");
  const levelIn = (s: string) => (tok("H3").test(s) ? "H3" : tok("H1").test(s) ? "H1" : /H2|9478|9749/i.test(s) ? "H2" : null);
  const level = levelIn(base) ?? levelIn(parts.slice(1, -1).join("/")) ?? levelIn(parts[0]) ?? "H2";
  if (level !== "H2") return { skip: `level ${level}` };

  const pm = base.match(/(?<![A-Za-z0-9])(?:P|Paper\s*)([1-4])(?![0-9])/i);
  if (!pm) return { skip: "no paper number" };
  const paperNo = Number(pm[1]);
  if (/apparatus|prep list|dataset/i.test(base)) return { skip: "practical support file" };

  const yearM = rel.match(/\b(20[12]\d)\b/);
  const year = yearM ? Number(yearM[1]) : 2026;
  const exam = EXAM_RE.find(([re]) => re.test(rel))?.[1] ?? "Prelim";
  const role = KEY_RE.test(base) ? "key" : "qp";
  return { file: { rel, school, year, exam, level, paperNo, role } };
}

export function discoverLocal(root: string, onlyPaper = 1): { files: PaperFile[]; skipped: SkippedFile[] } {
  const files: PaperFile[] = [];
  const skipped: SkippedFile[] = [];
  const walk = (dir: string) => {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, ent.name);
      if (ent.isDirectory()) walk(abs);
      else {
        const rel = path.relative(root, abs);
        if (!/\.pdf$/i.test(ent.name)) continue;
        const r = classifyPath(rel);
        if (r.skip) skipped.push({ rel, reason: r.skip });
        else if (r.file!.paperNo !== onlyPaper) skipped.push({ rel, reason: `paper ${r.file!.paperNo}` });
        else files.push({ ...r.file!, abs, source: "local" });
      }
    }
  };
  walk(root);
  files.sort((a, b) => a.rel.localeCompare(b.rel));
  return { files, skipped };
}
