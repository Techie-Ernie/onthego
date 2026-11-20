/**
 * Phase 5 without an API key: prepare batches for Claude Code subagents.
 *   npm run pipeline -- agent-batches [--size 20] [--only-missing]
 * Writes pipeline/cache/agent/batch-NN/{batch.json, <id>.png} and expects results in data/agent-output/batch-NN.json.
 * `npm run pipeline -- agent-import` validates and merges results into data/classifications + data/explanations.
 */
import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { CACHE, DATA, ROOT } from "./paths";
import { loadExtracts, readJson, classificationsFile, explanationsFile, type Classification } from "./build";
import type { Question, Syllabus } from "../../src/lib/types";
import { H2_PHYSICS_TYPES } from "../../src/subjects/index";

export const AGENT_DIR = path.join(CACHE, "agent");
export const AGENT_OUT = path.join(DATA, "agent-output");

export async function prepareBatches(size = 20, onlyMissing = true) {
  const bank = path.join(DATA, "bank", "h2-physics");
  const qs: Question[] = fs
    .readdirSync(bank)
    .filter((f) => f !== "index.json")
    .flatMap((f) => JSON.parse(fs.readFileSync(path.join(bank, f), "utf8")).questions as Question[])
    .sort((a, b) => a.id.localeCompare(b.id, "en", { numeric: true }));
  const done = readJson<Record<string, unknown>>(classificationsFile, {});
  const todo = onlyMissing ? qs.filter((q) => !done[q.id]) : qs;
  const raw = new Map(loadExtracts().flatMap((e) => e.questions.map((r) => [r.localId, r])));
  fs.rmSync(AGENT_DIR, { recursive: true, force: true });
  const batches: string[] = [];
  for (let i = 0; i < todo.length; i += size) {
    const name = `batch-${String(batches.length + 1).padStart(2, "0")}`;
    const dir = path.join(AGENT_DIR, name);
    fs.mkdirSync(dir, { recursive: true });
    const items = [];
    for (const q of todo.slice(i, i + size)) {
      const r = raw.get(q.id);
      if (!r) continue;
      const png = path.join(dir, `${q.id}.png`);
      await sharp(r.fullCrop.file).resize({ width: 1100, withoutEnlargement: true }).png().toFile(png);
      items.push({
        id: q.id,
        image: png,
        source: `${q.appearances[0].school} ${q.appearances[0].year} ${q.appearances[0].exam} P1 Q${q.appearances[0].questionNumber}`,
        keyAnswer: q.answer,
        keyStatus: q.flags.find((f) => f.startsWith("answer-")) ?? "ok",
        renderMode: q.renderMode,
        extractedText: q.stemText.slice(0, 1500),
      });
    }
    fs.writeFileSync(path.join(dir, "batch.json"), JSON.stringify({ batch: name, output: path.join(AGENT_OUT, `${name}.json`), items }, null, 1));
    batches.push(name);
  }
  fs.mkdirSync(AGENT_OUT, { recursive: true });
  return { batches, count: todo.length };
}

export interface AgentResult {
  id: string;
  chapter: string;
  secondaryChapters: string[];
  outcomes: string[];
  primaryType: string;
  types: string[];
  difficulty: number;
  difficultyReason: string;
  misconception?: string | null;
  derivedAnswer: "A" | "B" | "C" | "D" | null;
  confidence: "high" | "medium" | "low";
  explanation: { body: string; perOption: Record<string, string> };
  transcription?: string | null;
  issues?: string | null;
  explanationSource?: "key" | "generated";
  keyPage?: number;
}

export function importResults(model = "claude-opus-5-5 via Claude Code") {
  const syllabus = JSON.parse(fs.readFileSync(path.join(ROOT, "syllabus/h2-physics.json"), "utf8")) as Syllabus;
  const topics = new Set(syllabus.topics.map((t) => t.id));
  const outcomes = new Set(syllabus.topics.flatMap((t) => t.outcomes.map((o) => o.id)));
  const types = new Set(H2_PHYSICS_TYPES.map((t) => t.id));
  const cls = readJson<Record<string, Classification>>(classificationsFile, {});
  const exp = readJson<Record<string, unknown>>(explanationsFile, {});
  const transcriptionsFile = path.join(DATA, "transcriptions", "h2-physics.json");
  const tr = readJson<Record<string, string>>(transcriptionsFile, {});
  const problems: string[] = [];
  let n = 0;
  if (!fs.existsSync(AGENT_OUT)) return { n, problems };
  for (const f of fs.readdirSync(AGENT_OUT).filter((f) => f.endsWith(".json")).sort()) {
    let rows: AgentResult[];
    try {
      rows = JSON.parse(fs.readFileSync(path.join(AGENT_OUT, f), "utf8"));
    } catch (e) {
      problems.push(`${f}: invalid JSON (${(e as Error).message})`);
      continue;
    }
    for (const r of rows) {
      const explainOnly = !r.chapter && !!r.explanation;
      if (explainOnly) {
        if (r.explanation?.body) {
          exp[r.id] = {
            body: r.explanation.body,
            perOption: r.explanation.perOption ?? {},
            model,
            verified: false,
            source: r.explanationSource ?? "generated",
            derivedAnswer: r.derivedAnswer ?? "?",
            confidence: r.confidence,
            issues: r.issues ?? undefined,
          };
          n++;
        } else problems.push(`${f} ${r.id}: no explanation`);
        continue;
      }
      const bad: string[] = [];
      if (!topics.has(r.chapter)) bad.push(`chapter ${r.chapter}`);
      if (!types.has(r.primaryType)) bad.push(`primaryType ${r.primaryType}`);
      if (!(r.difficulty >= 1 && r.difficulty <= 5)) bad.push(`difficulty ${r.difficulty}`);
      if (bad.length) {
        problems.push(`${f} ${r.id}: ${bad.join(", ")}`);
        continue;
      }
      cls[r.id] = {
        chapter: r.chapter,
        secondaryChapters: (r.secondaryChapters ?? []).filter((t) => topics.has(t) && t !== r.chapter),
        outcomes: (r.outcomes ?? []).filter((o) => outcomes.has(o)),
        primaryType: r.primaryType,
        types: [...new Set([r.primaryType, ...(r.types ?? []).filter((t) => types.has(t))])],
        difficulty: Math.round(r.difficulty),
        difficultyReason: r.difficultyReason,
        misconception: r.misconception ?? undefined,
        model,
      };
      if (r.explanation?.body) {
        exp[r.id] = {
          body: r.explanation.body,
          perOption: r.explanation.perOption ?? {},
          model,
          verified: false, // set by build when derivedAnswer matches the key
          source: r.explanationSource ?? "generated",
          derivedAnswer: r.derivedAnswer ?? "?",
          confidence: r.confidence,
          issues: r.issues ?? undefined,
        };
      }
      if (r.transcription) tr[r.id] = r.transcription;
      n++;
    }
  }
  const sortObj = (o: Record<string, unknown>) => Object.fromEntries(Object.entries(o).sort(([a], [b]) => a.localeCompare(b, "en", { numeric: true })));
  for (const [file, obj] of [[classificationsFile, cls], [explanationsFile, exp], [transcriptionsFile, tr]] as const) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(sortObj(obj), null, 1) + "\n");
  }
  return { n, problems };
}
