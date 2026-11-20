/**
 * Key-based explanation batches: every item carries its paper's worked-solution pages (PNG + text layer),
 * so the subagent rewrites the school's own solution instead of inventing one.
 *   npm run pipeline -- agent-key-batches [--size 20] [--explain-only-first N]
 * Output: data/agent-output/kb-NN.json (imported after batch-*.json, so key explanations win).
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import sharp from "sharp";
import { CACHE, DATA, LOCAL_PAPERS } from "./paths";
import { loadExtracts, readJson, classificationsFile } from "./build";
import { discoverLocal } from "./discover";
import { grailPaperFiles } from "./grail";
import { pdfPagesText, solutionsStartPage } from "./keys";
import type { Question } from "../../src/lib/types";

const DIR = path.join(CACHE, "agent-kb");
const OUT = path.join(DATA, "agent-output");

function keyAssets(slug: string, pdf: string, embedded: boolean) {
  const dir = path.join(DIR, "keys", slug);
  const textFile = path.join(dir, "text.txt");
  if (!fs.existsSync(textFile)) {
    fs.mkdirSync(dir, { recursive: true });
    execFileSync("pdftoppm", ["-r", "110", "-png", pdf, path.join(dir, "p")]);
    const pages = pdfPagesText(pdf);
    fs.writeFileSync(textFile, pages.map((t, i) => `=== page ${i + 1} ===\n${t}`).join("\n"));
  }
  const pages = fs.readFileSync(textFile, "utf8").split(/^=== page \d+ ===$/m).slice(1);
  const images = fs.readdirSync(dir).filter((f) => f.endsWith(".png")).sort().map((f) => path.join(dir, f));
  const from = embedded ? Math.max(0, solutionsStartPage(pages)) : 0;
  return { textFile, images, pages, from };
}

/** Pages whose text mentions the question number at a line start (best guess; the agent verifies). */
function pageHint(pages: string[], n: number, from: number): number[] {
  const re = new RegExp(`^\\s*(Q(?:uestion)?\\s*)?${n}(?![0-9])[\\s.):]`, "m");
  const hits = pages.map((t, i) => (i >= from && re.test(t) ? i + 1 : 0)).filter(Boolean);
  return hits.slice(0, 4);
}

export async function prepareKeyBatches(size = 20, explainOnlyFirst = 0) {
  const bank = path.join(DATA, "bank", "h2-physics");
  const qs: Question[] = fs
    .readdirSync(bank)
    .filter((f) => f !== "index.json")
    .flatMap((f) => JSON.parse(fs.readFileSync(path.join(bank, f), "utf8")).questions as Question[])
    .sort((a, b) => a.id.localeCompare(b.id, "en", { numeric: true }));
  const cls = readJson<Record<string, unknown>>(classificationsFile, {});
  const extracts = loadExtracts();
  const raw = new Map(extracts.flatMap((e) => e.questions.map((r) => [r.localId, { r, e }] as const)));
  const abs = new Map<string, string>();
  for (const f of discoverLocal(LOCAL_PAPERS).files) abs.set(f.rel, f.abs);
  for (const f of grailPaperFiles()) abs.set(f.rel, f.abs);

  fs.mkdirSync(DIR, { recursive: true });
  for (const d of fs.readdirSync(DIR)) if (d.startsWith("kb-")) fs.rmSync(path.join(DIR, d), { recursive: true });
  const batches: string[] = [];
  for (let i = 0; i < qs.length; i += size) {
    const name = `kb-${String(batches.length + 1).padStart(2, "0")}`;
    const dir = path.join(DIR, name);
    fs.mkdirSync(dir, { recursive: true });
    const items = [];
    for (const [j, q] of qs.slice(i, i + size).entries()) {
      const hit = raw.get(q.id);
      if (!hit) continue;
      const { r, e } = hit;
      const keyRel = e.embedded ? e.qp : e.answerFile;
      const keyPdf = keyRel ? abs.get(keyRel) : undefined;
      const png = path.join(dir, `${q.id}.png`);
      await sharp(r.fullCrop.file).resize({ width: 1100, withoutEnlargement: true }).png().toFile(png);
      const k = keyPdf ? keyAssets(e.slug, keyPdf, e.embedded) : null;
      const explainOnly = i + j < explainOnlyFirst || !!cls[q.id];
      items.push({
        id: q.id,
        mode: explainOnly ? "explain" : "full",
        image: png,
        questionNumber: r.provenance.questionNumber,
        source: `${r.provenance.school} ${r.provenance.year} ${r.provenance.exam} P1 Q${r.provenance.questionNumber}`,
        keyAnswer: q.answer,
        keyStatus: q.flags.find((f) => f.startsWith("answer-")) ?? "ok",
        renderMode: q.renderMode,
        extractedText: q.stemText.slice(0, 1500),
        keyText: k?.textFile ?? null,
        keyPageImages: k?.images ?? [],
        keyPageHint: k ? pageHint(k.pages, r.provenance.questionNumber, k.from) : [],
      });
    }
    fs.writeFileSync(path.join(dir, "batch.json"), JSON.stringify({ batch: name, output: path.join(OUT, `${name}.json`), items }, null, 1));
    batches.push(name);
  }
  fs.mkdirSync(OUT, { recursive: true });
  return batches;
}
