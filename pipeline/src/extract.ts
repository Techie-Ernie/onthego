/**
 * Stage 1: for every paired paper, split questions, crop images, attach answers.
 * Output per paper: pipeline/cache/extract/<slug>.json (+ crops in pipeline/cache/crops/<slug>/).
 * Cached by (pdf hashes, EXTRACT_VERSION): reruns are free unless --force or the PDFs change.
 */
import fs from "node:fs";
import path from "node:path";
import { openPdf, extractPage } from "./pdf";
import { splitPaper, type SplitQuestion } from "./split";
import { parseAnswerKey, pdfPagesText, solutionsStartPage, type KeyResult } from "./keys";
import { PageRenderer, cropToWebp, fileHash, dHash, type CropOut } from "./crops";
import type { PaperPair } from "./pair";
import type { OptionLabel, Provenance } from "../../src/lib/types";
import { CACHE } from "./paths";

export const EXTRACT_VERSION = 10;

export interface RawQuestion {
  localId: string; // e.g. ri-2026-prelim-p1-q14
  provenance: Provenance;
  split: Omit<SplitQuestion, "pieces" | "stemCrop" | "fullCrop" | "figures" | "options"> & {
    figures: { afterParagraph: number; crop: CropOut }[];
    options: { label: OptionLabel; text?: string; textOk: boolean; crop?: CropOut }[];
  };
  stemCrop: CropOut;
  fullCrop: CropOut;
  /** page crop of each original page region (for the review queue) */
  answer: OptionLabel | null;
  answerIssue?: string;
  imageHash: string;
}

export interface PaperExtract {
  version: number;
  key: string;
  slug: string;
  qpHash: string;
  answerHash: string | null;
  qp: string;
  answerFile: string | null;
  embedded: boolean;
  keyResult: KeyResult;
  splitIssues: string[];
  questions: RawQuestion[];
}

export const slugOf = (p: PaperPair) => `${p.school}-${p.year}-${p.exam}-p${p.paperNo}`.toLowerCase();

export async function extractPaper(p: PaperPair, opts: { force?: boolean; expected?: number } = {}): Promise<PaperExtract> {
  const expected = opts.expected ?? 30;
  const slug = slugOf(p);
  const outJson = path.join(CACHE, "extract", `${slug}.json`);
  const qpHash = fileHash(p.qp.abs);
  const answerHash = p.answer ? fileHash(p.answer.abs) : null;
  if (!opts.force && fs.existsSync(outJson)) {
    const prev = JSON.parse(fs.readFileSync(outJson, "utf8")) as PaperExtract;
    if (prev.version === EXTRACT_VERSION && prev.qpHash === qpHash && prev.answerHash === answerHash) return prev;
  }

  // answers
  let keyPages = pdfPagesText((p.answer ?? p.qp).abs);
  const qpPagesText = pdfPagesText(p.qp.abs);
  let qpPageLimit = qpPagesText.length;
  if (p.embedded) {
    const s = solutionsStartPage(qpPagesText);
    keyPages = s >= 0 ? qpPagesText.slice(s) : [];
    if (s > 0) qpPageLimit = s;
  }
  const keyResult = parseAnswerKey(keyPages, expected);

  // questions
  const doc = openPdf(p.qp.abs);
  const pages = Array.from({ length: Math.min(qpPageLimit, doc.countPages()) }, (_, i) => extractPage(doc, i));
  const split = splitPaper(pages, expected);
  const renderer = new PageRenderer(p.qp.abs, qpHash);
  const size = (i: number) => ({ w: pages[i].w, h: pages[i].h });
  const cropDir = path.join(CACHE, "crops", slug);
  fs.rmSync(cropDir, { recursive: true, force: true });

  const questions: RawQuestion[] = [];
  for (const q of split.questions) {
    const base = `q${String(q.number).padStart(2, "0")}`;
    const fullCrop = await cropToWebp(renderer, q.fullCrop, size, cropDir, `${base}-full`);
    const stemCrop = await cropToWebp(renderer, q.stemCrop, size, cropDir, `${base}-stem`);
    const figures = [];
    for (const [i, f] of q.figures.entries()) figures.push({ afterParagraph: f.afterParagraph, crop: await cropToWebp(renderer, f.crop, size, cropDir, `${base}-fig${i + 1}`, { trim: true }) });
    const options = [];
    for (const o of q.options) {
      options.push({
        label: o.label,
        text: o.text,
        textOk: o.textOk,
        crop: o.crop ? await cropToWebp(renderer, o.crop, size, cropDir, `${base}-opt${o.label}`, { trim: true }) : undefined,
      });
    }
    const answer = keyResult.answers[q.number] ?? null;
    const issue = keyResult.issues.find((i) => i.q === q.number);
    const { pieces: _p, stemCrop: _s, fullCrop: _f, figures: _fi, options: _o, ...rest } = q;
    questions.push({
      localId: `${slug}-q${q.number}`,
      provenance: {
        source: p.qp.source,
        school: p.school,
        year: p.year,
        exam: p.exam,
        paper: `H2 Paper ${p.paperNo}`,
        questionNumber: q.number,
        originalFile: p.qp.rel,
        page: q.page + 1,
      },
      split: { ...rest, figures, options },
      stemCrop,
      fullCrop,
      answer,
      answerIssue: issue ? `${issue.problem}: ${issue.detail}` : undefined,
      imageHash: await dHash(fullCrop.file),
    });
  }

  const out: PaperExtract = {
    version: EXTRACT_VERSION,
    key: p.key,
    slug,
    qpHash,
    answerHash,
    qp: p.qp.rel,
    answerFile: p.answer?.rel ?? (p.embedded ? `${p.qp.rel} (embedded solutions)` : null),
    embedded: p.embedded,
    keyResult,
    splitIssues: split.issues,
    questions,
  };
  fs.mkdirSync(path.dirname(outJson), { recursive: true });
  fs.writeFileSync(outJson, JSON.stringify(out, null, 1));
  return out;
}
