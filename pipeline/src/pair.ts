import type { PaperFile } from "./discover";

export interface PaperPair {
  key: string; // school|year|exam|paper
  school: string;
  year: number;
  exam: PaperFile["exam"];
  paperNo: number;
  qp: PaperFile;
  /** answer source; when `embedded`, the answers are inside the QP file itself (e.g. solutions appended) */
  answer: PaperFile | null;
  embedded: boolean;
  notes: string[];
}

export interface PairingProblem {
  key: string;
  problem: "no-question-paper" | "no-answer-file" | "multiple-question-papers" | "multiple-answer-files";
  files: string[];
}

export const pairKey = (f: Pick<PaperFile, "school" | "year" | "exam" | "paperNo">) =>
  `${f.school}|${f.year}|${f.exam}|P${f.paperNo}`;

/** Prefer the plain answer list over annotated copies; among duplicates prefer the shortest name. */
function rankKey(f: PaperFile): number {
  const n = f.rel.toLowerCase();
  let s = 0;
  if (/\b(ans|answers|ms|mark scheme|soln|solutions?)\b/.test(n)) s -= 2;
  if (/with (suggested )?answers|guide/.test(n)) s += 1;
  return s * 1000 + n.length;
}

export function pairPapers(files: PaperFile[]): { pairs: PaperPair[]; problems: PairingProblem[] } {
  const groups = new Map<string, PaperFile[]>();
  for (const f of files) {
    const k = pairKey(f);
    groups.set(k, [...(groups.get(k) ?? []), f]);
  }
  const pairs: PaperPair[] = [];
  const problems: PairingProblem[] = [];
  for (const [key, fs] of [...groups].sort((a, b) => a[0].localeCompare(b[0]))) {
    const qps = fs.filter((f) => f.role === "qp");
    const keys = fs.filter((f) => f.role === "key").sort((a, b) => rankKey(a) - rankKey(b));
    if (!qps.length) {
      problems.push({ key, problem: "no-question-paper", files: fs.map((f) => f.rel) });
      continue;
    }
    const notes: string[] = [];
    if (qps.length > 1) {
      problems.push({ key, problem: "multiple-question-papers", files: qps.map((f) => f.rel) });
      notes.push(`multiple QPs; using ${qps[0].rel}`);
    }
    if (keys.length > 1) notes.push(`multiple answer files; using ${keys[0].rel}, cross-checking others`);
    const qp = qps.sort((a, b) => a.rel.length - b.rel.length)[0];
    const [school, , exam] = key.split("|");
    pairs.push({
      key,
      school,
      year: qp.year,
      exam: exam as PaperFile["exam"],
      paperNo: qp.paperNo,
      qp,
      answer: keys[0] ?? null,
      embedded: keys.length === 0,
      notes,
    });
    if (!keys.length) problems.push({ key, problem: "no-answer-file", files: [qp.rel] });
  }
  return { pairs, problems };
}
