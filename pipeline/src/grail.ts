/**
 * grail-wrapper.vercel.app source (see docs/GRAIL.md).
 *
 *   npm run pipeline -- grail-index     conditional GET of data.json (allowed for all agents by robots.txt)
 *   npm run pipeline -- grail-select    offline: filter H2 Physics Paper 1 → pipeline/cache/grail/manifest.json
 *   npm run pipeline -- grail-fetch     download PDFs from document.grail.moe (run this yourself, see below)
 *   npm run pipeline -- grail-status    what is downloaded / missing
 *
 * robots.txt (checked 2026-11-20):
 *   - document.grail.moe: `User-agent: *` Allow, but ClaudeBot / anthropic-ai (and other AI crawlers) Disallow: /
 *     → grail-fetch refuses to run inside an AI agent session (CLAUDECODE / AI_AGENT env). A person runs it.
 *   - drive.google.com/uc and drive.usercontent.google.com: Disallow for every user agent
 *     → never fetched automatically. Download those by hand into pipeline/cache/grail/manual/<driveFileId>.pdf
 *       (the list is in grail-status); they are then picked up like any other file.
 *   - api.grail.moe/note/download: Disallow → never used.
 * Politeness: one request at a time, ≥2 s + jitter between downloads, exponential backoff, stop after 5 failures,
 * every file cached forever (idempotent and resumable via files on disk + fetch-log.jsonl).
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { CACHE } from "./paths";
import type { ExamType } from "../../src/lib/types";
import type { PaperFile } from "./discover";

const DIR = path.join(CACHE, "grail");
const INDEX_URL = "https://grail-wrapper.vercel.app/data.json";
const UA = process.env.GRAIL_UA ?? "onthego-bank-builder/0.1 (personal offline study bank)";

interface GrailEntry {
  id: string;
  name?: string;
  original_name?: string;
  display_name?: string;
  inline_url?: string;
  subject?: string;
  doc_type?: string;
  year_resolved?: string | null;
  school?: string | null;
  paper_info?: string | null;
  paper_number?: number | null;
  source?: string;
  drive_path?: string;
  uploaded_on?: string;
  flagged?: boolean;
}

export interface ManifestFile {
  entryId: string;
  host: "grail" | "drive";
  url: string;
  /** local path where the PDF is (or will be) cached */
  file: string;
  name: string;
  uploadedOn?: string;
}
export interface ManifestSitting {
  key: string;
  school: string;
  year: number;
  exam: ExamType;
  paperNo: 1;
  qp: ManifestFile[];
  key_: ManifestFile[];
}

const ALIASES: Record<string, string> = { RJC: "RI", TPJC: "TMJC", MJC: "TMJC", IJC: "YIJC", YJC: "YIJC", SRJC: "ASRJC", AJC: "ASRJC", JJC: "JPJC", PJC: "JPJC" };
const ANSWER_RE = /(?<![a-z])(ans(wers?)?|sol(n|ns|ution|utions)?|mark ?scheme|ms|guide|worked|suggested)(?![a-z])/i;

const COMBINED_RE = /(qn|qns|qp|questions?)\s*(and|&|\+|with)\s*(ans|answers?|soln|sol|solutions?|guide)/i;

export function examOf(s: string): ExamType {
  if (/promo/i.test(s)) return "Promo";
  if (/prelim/i.test(s)) return "Prelim";
  if (/\bmye\b|mid.?year/i.test(s)) return "MYE";
  if (/\bct\d?\b|common test|block test|\bbt\d?\b/i.test(s)) return "CT";
  if (/a.?level|\btys\b/i.test(s)) return "A-Level";
  return "Other";
}

export function selectEntries(entries: GrailEntry[], minYear = 2017): { sittings: ManifestSitting[]; skipped: Record<string, number> } {
  const skipped: Record<string, number> = {};
  const skip = (r: string) => (skipped[r] = (skipped[r] ?? 0) + 1);
  const map = new Map<string, ManifestSitting>();
  for (const e of entries) {
    if (e.subject !== "H2 Physics") continue;
    if (!["Exam Papers", "MYEs/CAs/Other Tests"].includes(e.doc_type ?? "")) {
      skip("doc_type");
      continue;
    }
    const name = (e.original_name ?? e.name ?? "").replace(/[_.]/g, " ");
    const text = `${name} ${e.paper_info ?? ""} ${e.drive_path ?? ""}`;
    const paper = e.paper_number ?? Number(name.match(/(?<![a-z0-9])P(?:aper)?\s*([1-4])(?![0-9])/i)?.[1] ?? NaN);
    if (paper !== 1) {
      skip("not paper 1");
      continue;
    }
    const year = Number(e.year_resolved);
    if (!year) {
      skip("no year");
      continue;
    }
    if (year < minYear) {
      skip(`before ${minYear} (old 9646 syllabus)`);
      continue;
    }
    let school = (e.school ?? "").trim().toUpperCase();
    if (!school) {
      skip("no school");
      continue;
    }
    school = ALIASES[school] ?? school;
    if (e.flagged) {
      skip("flagged on grail");
      continue;
    }
    const exam = examOf(text);
    // "qn and soln", "Qn and Ans", "QP + Guide", "Questions & Answers": one file with both → a QP with embedded answers
    const combined = COMBINED_RE.test(name) || COMBINED_RE.test(e.paper_info ?? "");
    const role = !combined && (ANSWER_RE.test(name) || ANSWER_RE.test(e.paper_info ?? "")) ? "key" : "qp";
    const isDrive = e.source === "drive" || String(e.id).startsWith("gdrive:");
    const fileId = isDrive ? String(e.id).replace(/^gdrive:/, "") : String(e.id);
    const f: ManifestFile = {
      entryId: String(e.id),
      host: isDrive ? "drive" : "grail",
      url: isDrive ? `https://drive.google.com/file/d/${fileId}/view` : e.inline_url ?? "",
      file: isDrive ? path.join(DIR, "manual", `${fileId}.pdf`) : path.join(DIR, "files", `${fileId}.pdf`),
      name: e.original_name ?? e.name ?? fileId,
      uploadedOn: e.uploaded_on,
    };
    if (!isDrive && !/^https:\/\/document\.grail\.moe\/[0-9a-f]+\.pdf$/.test(f.url)) {
      skip("unexpected url");
      continue;
    }
    const key = `${school}|${year}|${exam}|P1`;
    const s = map.get(key) ?? { key, school, year, exam, paperNo: 1 as const, qp: [], key_: [] };
    (role === "qp" ? s.qp : s.key_).push(f);
    map.set(key, s);
  }
  const rank = (a: ManifestFile, b: ManifestFile) => (a.host === b.host ? (b.uploadedOn ?? "").localeCompare(a.uploadedOn ?? "") : a.host === "grail" ? -1 : 1);
  const sittings = [...map.values()].map((s) => ({ ...s, qp: s.qp.sort(rank), key_: s.key_.sort(rank) })).sort((a, b) => a.key.localeCompare(b.key));
  return { sittings, skipped };
}

export async function grailIndex(): Promise<string> {
  fs.mkdirSync(DIR, { recursive: true });
  const metaFile = path.join(DIR, "data.meta.json");
  const meta = fs.existsSync(metaFile) ? JSON.parse(fs.readFileSync(metaFile, "utf8")) : {};
  const headers: Record<string, string> = { "user-agent": UA };
  if (meta.etag && fs.existsSync(path.join(DIR, "data.json"))) headers["if-none-match"] = meta.etag;
  const res = await fetch(INDEX_URL, { headers });
  if (res.status === 304) return "index unchanged (304)";
  if (!res.ok) throw new Error(`index ${res.status}`);
  const body = await res.text();
  JSON.parse(body);
  fs.writeFileSync(path.join(DIR, "data.json"), body);
  fs.writeFileSync(metaFile, JSON.stringify({ etag: res.headers.get("etag"), lastModified: res.headers.get("last-modified"), fetchedAt: new Date().toISOString() }, null, 1));
  return `index saved (${(body.length / 1e6).toFixed(1)} MB)`;
}

export function grailSelect(minYear = 2017) {
  const entries = JSON.parse(fs.readFileSync(path.join(DIR, "data.json"), "utf8")) as GrailEntry[];
  const r = selectEntries(Array.isArray(entries) ? entries : (entries as { items: GrailEntry[] }).items, minYear);
  fs.writeFileSync(path.join(DIR, "manifest.json"), JSON.stringify(r, null, 1));
  return r;
}

function loadManifest(): ManifestSitting[] {
  const f = path.join(DIR, "manifest.json");
  if (!fs.existsSync(f)) throw new Error("run grail-select first");
  return (JSON.parse(fs.readFileSync(f, "utf8")) as { sittings: ManifestSitting[] }).sittings;
}

const isPdf = (file: string) => {
  if (!fs.existsSync(file)) return false;
  const fd = fs.openSync(file, "r");
  const b = Buffer.alloc(5);
  fs.readSync(fd, b, 0, 5, 0);
  fs.closeSync(fd);
  return b.toString("latin1") === "%PDF-";
};

export async function grailFetch(opts: { limit?: number; delayMs?: number } = {}) {
  if (process.env.CLAUDECODE || process.env.AI_AGENT) {
    throw new Error(
      "grail-fetch downloads from document.grail.moe, whose robots.txt disallows AI agents (ClaudeBot, anthropic-ai). Run it yourself in a normal terminal: npm run pipeline -- grail-fetch",
    );
  }
  const sittings = loadManifest();
  // only the best QP + best key per sitting (alternates are fallbacks if the first fails)
  const wanted: ManifestFile[][] = sittings.flatMap((s) => [s.qp.filter((f) => f.host === "grail"), s.key_.filter((f) => f.host === "grail")]).filter((l) => l.length);
  const log = path.join(DIR, "fetch-log.jsonl");
  fs.mkdirSync(path.join(DIR, "files"), { recursive: true });
  let fetched = 0;
  let failures = 0;
  let backoff = 30_000;
  for (const alts of wanted) {
    if (alts.some((f) => isPdf(f.file))) continue;
    if (opts.limit && fetched >= opts.limit) break;
    for (const f of alts) {
      await new Promise((r) => setTimeout(r, (opts.delayMs ?? 2000) + Math.random() * 1000));
      try {
        const res = await fetch(f.url, { headers: { "user-agent": UA } });
        if (res.status === 429 || res.status >= 500) {
          failures++;
          console.log(`  ${res.status} on ${f.name}; backing off ${backoff / 1000}s`);
          if (failures >= 5) throw new Error("5 consecutive failures; stopping (re-run later to resume)");
          await new Promise((r) => setTimeout(r, backoff));
          backoff *= 2;
          continue;
        }
        if (!res.ok || /html/.test(res.headers.get("content-type") ?? "")) throw new Error(`HTTP ${res.status} ${res.headers.get("content-type")}`);
        const buf = Buffer.from(await res.arrayBuffer());
        if (buf.subarray(0, 5).toString("latin1") !== "%PDF-") throw new Error("not a PDF");
        fs.writeFileSync(f.file + ".part", buf);
        fs.renameSync(f.file + ".part", f.file);
        fs.appendFileSync(log, JSON.stringify({ id: f.entryId, sha256: crypto.createHash("sha256").update(buf).digest("hex"), bytes: buf.length, at: new Date().toISOString() }) + "\n");
        console.log(`  ✓ ${f.name} (${(buf.length / 1024).toFixed(0)} KB)`);
        fetched++;
        failures = 0;
        backoff = 30_000;
        break;
      } catch (e) {
        if (String(e).includes("consecutive")) throw e;
        fs.appendFileSync(log, JSON.stringify({ id: f.entryId, error: String(e), at: new Date().toISOString() }) + "\n");
        console.log(`  ✗ ${f.name}: ${e}`);
      }
    }
  }
  return fetched;
}

export function grailStatus() {
  const sittings = loadManifest();
  const have = (l: ManifestFile[]) => l.find((f) => isPdf(f.file));
  const rows = sittings.map((s) => ({ key: s.key, qp: !!have(s.qp), key_: !!have(s.key_), qpCandidates: s.qp.length, keyCandidates: s.key_.length }));
  const manualNeeded = sittings.flatMap((s) =>
    [s.qp, s.key_].filter((l) => l.length && !have(l) && l.every((f) => f.host === "drive")).map((l) => ({ key: s.key, url: l[0].url, saveAs: path.relative(process.cwd(), l[0].file) })),
  );
  return { rows, manualNeeded };
}

/** Downloaded grail papers as PaperFiles for the normal pair/extract stages. */
export function grailPaperFiles(): PaperFile[] {
  if (!fs.existsSync(path.join(DIR, "manifest.json"))) return [];
  const out: PaperFile[] = [];
  for (const s of loadManifest()) {
    for (const [role, list] of [["qp", s.qp], ["key", s.key_]] as const) {
      const f = list.find((x) => isPdf(x.file));
      if (!f) continue;
      out.push({ source: "grail", rel: `grail:${f.entryId} ${f.name}`, abs: f.file, school: s.school, year: s.year, exam: s.exam, level: "H2", paperNo: 1, role });
    }
  }
  return out;
}
