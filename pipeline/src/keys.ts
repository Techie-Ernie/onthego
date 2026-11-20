/**
 * Answer-key parsing. Keys come in many shapes:
 *   - summary grids ("1 C   6 A   11 B …"), one row or column per block
 *   - per-question solutions starting "12   D   <working>"
 *   - horizontal rows ("Qn 1 2 3 …" / "Ans C A A …")
 *   - annotated question papers with "Ans: B" / "Answer: B" under each question
 * Several strategies run independently and must agree; disagreements are reported, never guessed.
 */
import { execFileSync } from "node:child_process";
import type { OptionLabel } from "../../src/lib/types";

export interface KeyResult {
  answers: Record<number, OptionLabel>;
  method: string;
  /** questions whose answer could not be determined or strategies disagreed */
  issues: { q: number; problem: "missing" | "conflict"; detail: string }[];
  strategies: Record<string, number>; // strategy -> how many answers it found
}

export function pdfPagesText(file: string): string[] {
  const out = execFileSync("pdftotext", ["-layout", "-enc", "UTF-8", file, "-"], { maxBuffer: 64 * 1024 * 1024 }).toString("utf8");
  return out.split("\f");
}

const L = (s: string) => s as OptionLabel;

/**
 * Strategy 1 ("grid"): "N  X" pairs followed by wide whitespace or end of line. A match counts only at the
 * start of a line or when the line holds ≥2 pairs (a summary-grid row), so stray "2 C" (coulombs) in working is ignored.
 */
export function gridPairs(lines: string[], expected: number): Map<number, Map<OptionLabel, number>> {
  const votes = new Map<number, Map<OptionLabel, number>>();
  const re = /(?:^\s*|\s{2,}|\t)(\d{1,2})[.)]?\s+([A-D])(?=\s{2,}|\s*$|\t)/g;
  for (const line of lines) {
    const ms = [...line.matchAll(re)];
    for (const m of ms) {
      const atStart = /^\s*$/.test(line.slice(0, m.index! + m[0].indexOf(m[1])));
      if (!atStart && ms.length < 2) continue;
      const n = Number(m[1]);
      if (n < 1 || n > expected) continue;
      const v = votes.get(n) ?? new Map();
      v.set(L(m[2]), (v.get(L(m[2])) ?? 0) + 1);
      votes.set(n, v);
    }
  }
  return votes;
}

/**
 * Strategy 1b ("lead", weak): a solution paragraph that starts "12   D Since the …" (letter then one space).
 * Weak because a question stem can start "3  A ball is …"; only used where no strong strategy has an answer.
 */
export function leadPairs(lines: string[], expected: number): Map<number, Map<OptionLabel, number>> {
  const votes = new Map<number, Map<OptionLabel, number>>();
  for (const line of lines) {
    const m = line.match(/^\s{0,6}(\d{1,2})[.)]?\s+([A-D])\s+\S/);
    if (!m) continue;
    const n = Number(m[1]);
    if (n < 1 || n > expected) continue;
    const v = votes.get(n) ?? new Map();
    v.set(L(m[2]), (v.get(L(m[2])) ?? 0) + 1);
    votes.set(n, v);
  }
  return votes;
}

function majority(v: Map<OptionLabel, number> | undefined): OptionLabel | null | "tie" {
  if (!v) return null;
  const sorted = [...v].sort((a, b) => b[1] - a[1]);
  if (sorted.length > 1 && sorted[0][1] === sorted[1][1]) return "tie";
  return sorted[0][0];
}

/** Strategy 2: a row of question numbers followed by a row of letters. */
export function horizontalRows(lines: string[], expected: number): Map<number, OptionLabel> {
  const out = new Map<number, OptionLabel>();
  for (let i = 0; i < lines.length; i++) {
    const nums = lines[i].match(/^\s*(?:Qn|Ques(?:tion)?s?|Q|No\.?)?\s*((?:\d{1,2}\s+){4,}\d{1,2})\s*$/i);
    if (!nums) continue;
    const ns = nums[1].trim().split(/\s+/).map(Number);
    for (let j = i + 1; j <= i + 3 && j < lines.length; j++) {
      const lets = lines[j].match(/^\s*(?:Ans(?:wer)?s?|Key)?\s*((?:[A-D]\s+){4,}[A-D])\s*$/i);
      if (!lets) continue;
      const ls = lets[1].trim().split(/\s+/);
      if (ls.length !== ns.length) break;
      ns.forEach((n, k) => n >= 1 && n <= expected && out.set(n, L(ls[k])));
      break;
    }
  }
  return out;
}

/** Strategy 3: "Ans: B" annotations in reading order. Only usable when the count is exact. */
export function inlineAnswers(lines: string[]): OptionLabel[] {
  const out: OptionLabel[] = [];
  const re = /\b(?:Ans(?:wer)?|Key)\s*[:.\-–]\s*\(?([A-D])\)?(?![A-Za-z])/g;
  for (const line of lines) {
    if (/\b(?:Ans(?:wer)?s?)\s+(?:[A-D]\s+){3,}/i.test(line)) continue; // horizontal row, handled by strategy 2
    for (const m of line.matchAll(re)) out.push(L(m[1]));
  }
  return out;
}

export function parseAnswerKey(pages: string[], expected = 30): KeyResult {
  const lines = pages.flatMap((p) => p.split("\n"));
  const grid = gridPairs(lines, expected);
  const lead = leadPairs(lines, expected);
  const rows = horizontalRows(lines, expected);
  const inline = inlineAnswers(lines);

  const strategies: Record<string, number> = { grid: grid.size, lead: lead.size, rows: rows.size, inline: inline.length };
  // a strategy that found only a handful of answers is noise from solution working, not a key layout
  const enough = (n: number) => n >= Math.ceil(expected * 0.4);
  const gridOk = enough(grid.size);
  const leadOk = enough(lead.size);
  const inlineOk = inline.length === expected;

  const answers: Record<number, OptionLabel> = {};
  const issues: KeyResult["issues"] = [];
  const used = new Set<string>();

  for (let q = 1; q <= expected; q++) {
    const strong = new Map<OptionLabel, string[]>();
    const add = (l: OptionLabel, why: string) => strong.set(l, [...(strong.get(l) ?? []), why]);
    const notes: string[] = [];
    if (gridOk) {
      const g = majority(grid.get(q));
      if (g === "tie") notes.push(`grid tie ${JSON.stringify(Object.fromEntries(grid.get(q)!))}`);
      else if (g) add(g, "grid");
    }
    if (rows.has(q)) add(rows.get(q)!, "rows");
    if (inlineOk) add(inline[q - 1], "inline");

    if (strong.size === 1) {
      answers[q] = [...strong.keys()][0];
      strong.get(answers[q])!.forEach((w) => used.add(w));
    } else if (strong.size > 1) {
      issues.push({ q, problem: "conflict", detail: [...strong].map(([l, w]) => `${l} (${w.join(",")})`).join(" vs ") });
    } else {
      const l = leadOk ? majority(lead.get(q)) : null;
      if (l && l !== "tie") {
        answers[q] = l;
        used.add("lead");
      } else {
        issues.push({ q, problem: notes.length ? "conflict" : "missing", detail: notes.join("; ") || `no strategy found Q${q}` });
      }
    }
  }
  return { answers, method: [...used].sort().join("+") || "none", issues, strategies };
}

/** For files that contain the questions AND solutions: index of the first page that starts the solutions. */
export function solutionsStartPage(pages: string[]): number {
  for (let i = 1; i < pages.length; i++) {
    const head = pages[i].split("\n").slice(0, 12).join("\n");
    if (/\b(Paper\s*1\s*)?(Solutions?|Answers?|Answer Key|Mark Scheme)\b/i.test(head) && !/answer all questions/i.test(head)) return i;
  }
  return -1;
}
