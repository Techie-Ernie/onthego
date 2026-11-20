/**
 * Stage 3: merge extracts + classifications + explanations + human overrides → the bank.
 *   data/bank/<subject>/index.json, data/bank/<subject>/<shard>.json
 *   public/q-assets/<subject>/<shard>/<id>-<name>.<hash>.webp
 *   data/ingest-report.json
 * Deterministic: the same inputs give byte-identical outputs.
 */
import fs from "node:fs";
import path from "node:path";
import { CACHE, DATA, PUBLIC, ROOT } from "./paths";
import type { PaperExtract, RawQuestion } from "./extract";
import type { CropOut } from "./crops";
import { clusterDuplicates } from "./dedupe";
import {
  BANK_SCHEMA_VERSION,
  type BankIndex,
  type BankShard,
  type Figure,
  type ImageRef,
  type Question,
  type QuestionIndexEntry,
  type SubjectId,
  type Syllabus,
  type OptionLabel,
} from "../../src/lib/types";

const SUBJECT: SubjectId = "h2-physics";

export interface Classification {
  chapter: string;
  secondaryChapters: string[];
  outcomes: string[];
  primaryType: string;
  types: string[];
  difficulty: number;
  difficultyReason: string;
  misconception?: string;
  model: string;
}

export interface Override {
  renderMode?: Question["renderMode"];
  answer?: OptionLabel;
  stem?: string;
  optionText?: Partial<Record<OptionLabel, string>>;
  chapter?: string;
  secondaryChapters?: string[];
  primaryType?: string;
  types?: string[];
  difficulty?: number;
  status?: Question["status"];
  approved?: boolean;
  reviewedAt?: string;
  note?: string;
  /** replace a crop: target "stem" | "fig1".. | "optA".. ; pieces in PDF points */
  recrop?: { target: string; pieces: { page: number; rect: [number, number, number, number] }[] }[];
  /** id of a question this one is a duplicate of (manual dedupe) */
  duplicateOf?: string;
}

export function readJson<T>(file: string, fallback: T): T {
  return fs.existsSync(file) ? (JSON.parse(fs.readFileSync(file, "utf8")) as T) : fallback;
}

export const overridesFile = path.join(DATA, "overrides", `${SUBJECT}.json`);
export const classificationsFile = path.join(DATA, "classifications", `${SUBJECT}.json`);
export const explanationsFile = path.join(DATA, "explanations", `${SUBJECT}.json`);

export function loadExtracts(): PaperExtract[] {
  const dir = path.join(CACHE, "extract");
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".json"))
    .sort()
    .map((f) => JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")) as PaperExtract);
}

function rawToQuestion(r: RawQuestion): { q: Question; crops: Map<string, CropOut> } {
  const s = r.split;
  const crops = new Map<string, CropOut>();
  const ref = (name: string, c: CropOut, alt: string): ImageRef => {
    crops.set(name, c);
    return { src: `@${name}`, w: c.w, h: c.h, alt, bytes: c.bytes };
  };
  const mode = s.renderMode;
  const paragraphs = s.stemParagraphs;
  const figures: Figure[] =
    mode === "image"
      ? []
      : s.figures.map((f, i) => ({
          ...ref(`fig${i + 1}`, f.crop, `Figure ${i + 1} for question ${s.number}`),
          position: f.afterParagraph === 0 ? "stem-top" : f.afterParagraph >= paragraphs.length ? "before-options" : "stem-inline",
          afterParagraph: f.afterParagraph,
        }));
  const options = s.options.map((o) => ({
    label: o.label,
    text: !s.optionsHaveGraphics && mode !== "image" ? o.text : undefined,
    image: o.crop ? ref(`opt${o.label}`, o.crop, `Option ${o.label} for question ${s.number}`) : undefined,
  }));
  const labels: OptionLabel[] = ["A", "B", "C", "D"];
  const fullOptions = labels.map((l) => options.find((o) => o.label === l) ?? { label: l });
  const flags = [...s.flags];
  if (!r.answer) flags.push(r.answerIssue?.startsWith("conflict") ? "answer-conflict" : "answer-missing");
  const q: Question = {
    id: r.localId,
    subject: SUBJECT,
    stem: mode === "image" ? "" : paragraphs.join("\n\n"),
    stemText: s.stemText + " " + s.options.map((o) => `${o.label} ${o.text ?? ""}`).join(" "),
    textQuality: s.stemOk && (s.optionsHaveGraphics || s.options.every((o) => o.textOk)) ? "high" : "low",
    renderMode: mode,
    hasFigure: s.figures.length > 0 || s.optionsHaveGraphics || (mode === "image" && /diagram|graph|figure|shown|circuit|below/i.test(s.stemText)),
    figures,
    stemImage: mode === "image" ? ref("stem", r.stemCrop, `Question ${s.number}: ${s.stemText.slice(0, 160)}`) : undefined,
    options: fullOptions,
    optionLayout: s.optionsHaveGraphics ? "grid" : "list",
    answer: (r.answer ?? "A") as OptionLabel,
    chapter: null,
    secondaryChapters: [],
    outcomes: [],
    types: [],
    primaryType: null,
    appearances: [r.provenance],
    flags,
    status: r.answer ? "published" : "needs-review",
  };
  crops.set("full", r.fullCrop);
  return { q, crops };
}

export interface BuildResult {
  questions: Question[];
  report: Record<string, unknown>;
}

export function build(opts: { write?: boolean } = {}): BuildResult {
  const write = opts.write ?? true;
  const extracts = loadExtracts();
  const overrides = readJson<Record<string, Override>>(overridesFile, {});
  const classifications = readJson<Record<string, Classification>>(classificationsFile, {});
  const explanations = readJson<Record<string, Question["explanation"] & { derivedAnswer?: string }>>(explanationsFile, {});
  const transcriptions = readJson<Record<string, string>>(path.join(DATA, "transcriptions", `${SUBJECT}.json`), {});
  const syllabus = readJson<Syllabus | null>(path.join(ROOT, "syllabus", `${SUBJECT}.json`), null);
  const topicIds = new Set(syllabus?.topics.map((t) => t.id) ?? []);

  const all: { q: Question; crops: Map<string, CropOut>; raw: RawQuestion }[] = [];
  for (const e of extracts) for (const r of e.questions) all.push({ ...rawToQuestion(r), raw: r });

  // ---- apply classification, explanation, overrides ----
  for (const item of all) {
    const q = item.q;
    const c = classifications[q.id];
    if (c && topicIds.has(c.chapter)) {
      Object.assign(q, {
        chapter: c.chapter,
        secondaryChapters: c.secondaryChapters.filter((t) => topicIds.has(t) && t !== c.chapter),
        outcomes: c.outcomes,
        primaryType: c.primaryType,
        types: c.types,
        difficulty: c.difficulty,
        difficultyReason: c.difficultyReason,
        misconception: c.misconception,
      });
    } else q.flags.push("unclassified");
    const tr = transcriptions[q.id];
    if (tr && q.renderMode === "image") q.stemText = tr;
    const o = overrides[q.id];
    if (o) {
      if (o.renderMode) {
        if (o.renderMode === "image" && q.renderMode !== "image") {
          q.stemImage = { src: "@stem", w: item.raw.stemCrop.w, h: item.raw.stemCrop.h, alt: `Question ${item.raw.split.number}`, bytes: item.raw.stemCrop.bytes };
          item.crops.set("stem", item.raw.split.optionsHaveGraphics ? item.raw.stemCrop : item.raw.fullCrop);
          q.stemImage = { ...q.stemImage, w: item.crops.get("stem")!.w, h: item.crops.get("stem")!.h };
          q.figures = [];
          q.stem = "";
          if (!item.raw.split.optionsHaveGraphics) q.options = q.options.map((op) => ({ label: op.label }));
        }
        q.renderMode = o.renderMode;
      }
      if (o.answer) {
        q.answer = o.answer;
        q.flags = q.flags.filter((f) => f !== "answer-missing" && f !== "answer-conflict");
        if (q.status === "needs-review") q.status = "published";
      }
      if (o.stem !== undefined) q.stem = o.stem;
      if (o.optionText) q.options = q.options.map((op) => (o.optionText![op.label] !== undefined ? { ...op, text: o.optionText![op.label] } : op));
      for (const k of ["chapter", "secondaryChapters", "primaryType", "types", "difficulty"] as const) if (o[k] !== undefined) (q as unknown as Record<string, unknown>)[k] = o[k];
      if (o.chapter) q.flags = q.flags.filter((f) => f !== "unclassified");
      if (o.status) q.status = o.status;
      if (o.approved) q.reviewedAt = o.reviewedAt ?? "approved";
      if (o.recrop) for (const rc of o.recrop) q.flags.push(`recrop-pending:${rc.target}`); // applied by `pipeline recrop`
    }
  }

  // ---- explanations: published only when the independently derived answer matches the (possibly corrected) key ----
  for (const { q } of all) {
    const ex = explanations[q.id];
    if (!ex) continue;
    const { derivedAnswer, confidence, issues, ...rest } = ex as typeof ex & { confidence?: string; issues?: string };
    if (issues) q.flags.push("agent-note");
    if (derivedAnswer !== q.answer) q.flags.push("explanation-disagrees-with-key");
    else if (confidence === "low") q.flags.push("explanation-low-confidence");
    else q.explanation = { body: rest.body, perOption: rest.perOption, model: rest.model, verified: true, source: (rest as { source?: "key" | "generated" }).source ?? "generated" };
  }

  // ---- dedupe ----
  const clusters = clusterDuplicates(
    all.map(({ q, raw }) => ({ id: q.id, text: q.stemText, imageHash: raw.imageHash, answer: q.answer, group: q.id.replace(/-q\d+$/, "") })),
  );
  const byId = new Map(all.map((a) => [a.q.id, a]));
  for (const [id, o] of Object.entries(overrides)) if (o.duplicateOf && byId.has(id) && byId.has(o.duplicateOf)) clusters.push([o.duplicateOf, id]);
  const dropped = new Set<string>();
  const dupReport: { canonical: string; members: string[]; answersAgree: boolean }[] = [];
  for (const cl of clusters) {
    if (cl.length < 2) continue;
    const members = cl.map((id) => byId.get(id)!).filter((m) => !dropped.has(m.q.id));
    if (members.length < 2) continue;
    // canonical: prefer a published, text-rendered, reviewed member
    members.sort((a, b) => score(b.q) - score(a.q) || a.q.id.localeCompare(b.q.id));
    const canon = members[0].q;
    const answersAgree = members.every((m) => m.q.answer === canon.answer);
    if (!answersAgree) {
      // same question with options in another order (or a key error): keep both, let a human decide
      for (const m of members) m.q.flags.push("near-duplicate-different-answer");
      dupReport.push({ canonical: canon.id, members: members.map((m) => m.q.id), answersAgree });
      continue;
    }
    for (const m of members.slice(1)) {
      canon.appearances.push(...m.q.appearances);
      dropped.add(m.q.id);
    }
    canon.flags.push("has-duplicates");
    dupReport.push({ canonical: canon.id, members: members.map((m) => m.q.id), answersAgree });
  }
  const kept = all.filter((a) => !dropped.has(a.q.id));

  // ---- assets + shards ----
  const shardOf = (q: Question) => q.chapter ?? "_unclassified";
  const assetRoot = path.join(PUBLIC, "q-assets", SUBJECT);
  const bankRoot = path.join(DATA, "bank", SUBJECT);
  if (write) {
    fs.rmSync(assetRoot, { recursive: true, force: true });
    fs.rmSync(bankRoot, { recursive: true, force: true });
    fs.mkdirSync(bankRoot, { recursive: true });
  }
  const shardAssetBytes = new Map<string, number>();
  const resolve = (item: (typeof kept)[number], ref: ImageRef | undefined): ImageRef | undefined => {
    if (!ref || !ref.src.startsWith("@")) return ref;
    const name = ref.src.slice(1);
    const crop = item.crops.get(name);
    if (!crop) return undefined;
    const shard = shardOf(item.q);
    const rel = `/q-assets/${SUBJECT}/${shard}/${item.q.id}-${name}.${crop.hash}.webp`;
    if (write) {
      const dst = path.join(PUBLIC, rel);
      fs.mkdirSync(path.dirname(dst), { recursive: true });
      fs.copyFileSync(crop.file, dst);
    }
    shardAssetBytes.set(shard, (shardAssetBytes.get(shard) ?? 0) + crop.bytes);
    return { ...ref, src: rel };
  };
  for (const item of kept) {
    const q = item.q;
    q.stemImage = resolve(item, q.stemImage);
    q.figures = q.figures.map((f) => ({ ...f, ...resolve(item, f)! }));
    q.options = q.options.map((o) => ({ ...o, image: resolve(item, o.image) }));
    q.appearances.sort((a, b) => a.school.localeCompare(b.school) || a.questionNumber - b.questionNumber);
  }

  const questions = kept.map((k) => k.q).sort((a, b) => a.id.localeCompare(b.id, "en", { numeric: true }));
  const shards = new Map<string, Question[]>();
  for (const q of questions) shards.set(shardOf(q), [...(shards.get(shardOf(q)) ?? []), q]);

  const indexEntries: QuestionIndexEntry[] = questions.map((q) => ({
    id: q.id,
    chapter: q.chapter,
    secondaryChapters: q.secondaryChapters,
    primaryType: q.primaryType,
    types: q.types,
    difficulty: q.difficulty,
    misconception: q.misconception,
    outcomes: q.outcomes,
    hasFigure: q.hasFigure,
    renderMode: q.renderMode,
    shard: shardOf(q),
    schools: [...new Set(q.appearances.map((a) => a.school))],
    years: [...new Set(q.appearances.map((a) => a.year))],
    exams: [...new Set(q.appearances.map((a) => a.exam))],
    appearances: q.appearances.length,
    text: q.stemText.toLowerCase().replace(/\s+/g, " ").slice(0, 600),
    status: q.status,
  }));
  const shardMeta: BankIndex["shards"] = [];
  for (const [id, qs] of [...shards].sort()) {
    const shard: BankShard = { schemaVersion: BANK_SCHEMA_VERSION, subject: SUBJECT, shard: id, questions: qs };
    const json = JSON.stringify(shard);
    if (write) fs.writeFileSync(path.join(bankRoot, `${id}.json`), json);
    shardMeta.push({ id, count: qs.length, jsonBytes: Buffer.byteLength(json), assetBytes: shardAssetBytes.get(id) ?? 0 });
  }
  const builtAt = new Date(Math.max(0, ...extracts.map((e) => fs.statSync(path.join(CACHE, "extract", `${e.slug}.json`)).mtimeMs))).toISOString();
  const index: BankIndex = { schemaVersion: BANK_SCHEMA_VERSION, subject: SUBJECT, builtAt, count: questions.length, shards: shardMeta, questions: indexEntries };
  if (write) fs.writeFileSync(path.join(bankRoot, "index.json"), JSON.stringify(index));

  // ---- report ----
  const count = <T extends string>(xs: T[]) => xs.reduce((m, x) => ((m[x] = (m[x] ?? 0) + 1), m), {} as Record<string, number>);
  const allQs = all.map((a) => a.q);
  const report = {
    subject: SUBJECT,
    builtAt,
    papers: extracts.map((e) => ({
      key: e.key,
      questionPaper: e.qp,
      answerFile: e.answerFile,
      questionsFound: e.questions.length,
      answersFound: Object.keys(e.keyResult.answers).length,
      keyMethod: e.keyResult.method,
      keyIssues: e.keyResult.issues,
      splitIssues: e.splitIssues,
      ok: e.questions.length === 30 && Object.keys(e.keyResult.answers).length === 30 && !e.keyResult.issues.length,
    })),
    totals: {
      extracted: allQs.length,
      afterDedupe: questions.length,
      duplicatesRemoved: dropped.size,
      published: questions.filter((q) => q.status === "published").length,
      needsReview: questions.filter((q) => q.status === "needs-review").length,
      classified: questions.filter((q) => q.chapter).length,
      withExplanation: questions.filter((q) => q.explanation).length,
    },
    renderModes: count(questions.map((q) => q.renderMode)),
    optionLayouts: count(questions.map((q) => (q.optionLayout === "grid" ? "image-options" : q.options.some((o) => o.text) ? "text-options" : "options-in-image"))),
    textQuality: count(questions.map((q) => q.textQuality)),
    withFigures: questions.filter((q) => q.hasFigure).length,
    flags: count(questions.flatMap((q) => q.flags.map((f) => f.replace(/^option-[A-D]/, "option-X").replace(/:.*$/, "")))),
    lowConfidence: questions
      .filter((q) => q.status === "needs-review" || q.flags.some((f) => /answer|content-below|options-not-found|disagree/.test(f)))
      .map((q) => ({ id: q.id, flags: q.flags.filter((f) => !/^option-[A-D]:low-text$/.test(f)) })),
    duplicates: dupReport,
    imageBank: {
      files: questions.reduce((n, q) => n + (q.stemImage ? 1 : 0) + q.figures.length + q.options.filter((o) => o.image).length, 0),
      totalBytes: [...shardAssetBytes.values()].reduce((a, b) => a + b, 0),
      perShard: Object.fromEntries(shardMeta.map((s) => [s.id, { questions: s.count, jsonBytes: s.jsonBytes, assetBytes: s.assetBytes }])),
    },
  };
  if (write) fs.writeFileSync(path.join(DATA, "ingest-report.json"), JSON.stringify(report, null, 2));
  return { questions, report };
}

function score(q: Question): number {
  return (q.status === "published" ? 8 : 0) + (q.reviewedAt ? 4 : 0) + (q.renderMode !== "image" ? 2 : 0) + (q.textQuality === "high" ? 1 : 0);
}
