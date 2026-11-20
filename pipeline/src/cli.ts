/**
 * onthego pipeline CLI
 *   npm run pipeline -- ingest [--force] [--only SCHOOL]   discover + pair + extract local papers
 *   npm run pipeline -- build                              merge → data/bank, public/q-assets, data/ingest-report.json
 *   npm run pipeline -- all                                ingest + build
 */
import { discoverLocal } from "./discover";
import { pairPapers } from "./pair";
import { extractPaper } from "./extract";
import { build } from "./build";
import { LOCAL_PAPERS } from "./paths";
import { prepareBatches, importResults } from "./agent-batches";
import { prepareKeyBatches } from "./agent-keys";
import { grailIndex, grailSelect, grailFetch, grailStatus, grailPaperFiles } from "./grail";
import { pdfPagesText } from "./keys";

const [cmd = "all", ...rest] = process.argv.slice(2);
const flag = (n: string) => rest.includes(`--${n}`);
const arg = (n: string) => {
  const i = rest.indexOf(`--${n}`);
  return i >= 0 ? rest[i + 1] : undefined;
};

async function ingest() {
  const { files: localFiles, skipped } = discoverLocal(LOCAL_PAPERS);
  const grailFiles = flag("no-grail") ? [] : grailPaperFiles();
  // local copies win when both sources have the same sitting
  const localKeys = new Set(localFiles.map((f) => `${f.school}|${f.year}|${f.exam}`));
  const files = [...localFiles, ...grailFiles.filter((f) => !localKeys.has(`${f.school}|${f.year}|${f.exam}`))];
  if (grailFiles.length) console.log(`grail: ${grailFiles.length} downloaded files (${grailFiles.length - files.length + localFiles.length} skipped: same sitting exists locally)`);
  const { pairs, problems } = pairPapers(files);
  console.log(`discovered ${files.length} Paper 1 files (${skipped.length} other files skipped), ${pairs.length} papers`);
  for (const pr of problems) console.log(`  pairing: ${pr.key} ${pr.problem} ${pr.files.join(", ")}`);
  const only = arg("only");
  for (const p of pairs) {
    if (only && p.school !== only.toUpperCase()) continue;
    // cover check: right syllabus and really Paper 1 MCQ
    const cover = pdfPagesText(p.qp.abs).slice(0, 2).join("\n");
    if (/9646\s*\/\s*0?1/.test(cover)) {
      console.log(`  ${p.key.padEnd(24)} skipped: old 9646 syllabus paper`);
      continue;
    }
    if (p.qp.source === "grail" && !/(9749|9478)\s*\/\s*0?1|paper\s*1|multiple\s*choice/i.test(cover)) {
      console.log(`  ${p.key.padEnd(24)} skipped: cover does not look like Paper 1 MCQ`);
      continue;
    }
    const t = Date.now();
    let e;
    try {
      e = await extractPaper(p, { force: flag("force") });
    } catch (err) {
      console.log(`  ${p.key.padEnd(24)} FAILED: ${(err as Error).message}`);
      continue;
    }
    const answers = Object.keys(e.keyResult.answers).length;
    console.log(`  ${p.key.padEnd(24)} ${e.questions.length} questions, ${answers} answers (${e.keyResult.method})${e.keyResult.issues.length ? `, ${e.keyResult.issues.length} key issues` : ""} ${Date.now() - t}ms`);
  }
}

async function main() {
  if (cmd === "ingest" || cmd === "all") await ingest();
  if (cmd === "grail-index") console.log(await grailIndex());
  if (cmd === "grail-select") {
    const r = grailSelect(Number(arg("min-year") ?? 2017));
    const qp = r.sittings.filter((x) => x.qp.length).length;
    const both = r.sittings.filter((x) => x.qp.length && x.key_.length).length;
    const grailOnly = r.sittings.filter((x) => x.qp.some((f) => f.host === "grail")).length;
    console.log(`${r.sittings.length} sittings: ${qp} with a QP, ${both} with QP + key, ${grailOnly} with a grail-hosted QP`);
    console.log("skipped:", r.skipped);
  }
  if (cmd === "grail-fetch") console.log(`fetched ${await grailFetch({ limit: arg("limit") ? Number(arg("limit")) : undefined })} files`);
  if (cmd === "grail-status") {
    const r = grailStatus();
    const n = (k: "qp" | "key_") => r.rows.filter((x) => x[k]).length;
    console.log(`${r.rows.length} sittings · QP downloaded ${n("qp")} · key downloaded ${n("key_")}`);
    console.log(`${r.manualNeeded.length} files only on Google Drive (robots.txt disallows automated download). Save by hand:`);
    for (const m of r.manualNeeded) console.log(`  ${m.key}  ${m.url}  ->  ${m.saveAs}`);
  }
  if (cmd === "agent-batches") {
    const r = await prepareBatches(Number(arg("size") ?? 20), !flag("all"));
    console.log(`${r.count} questions in ${r.batches.length} batches under pipeline/cache/agent/`);
  }
  if (cmd === "agent-key-batches") {
    const b = await prepareKeyBatches(Number(arg("size") ?? 20), Number(arg("explain-only-first") ?? 0), { prefix: arg("prefix") ?? "kb", onlyMissing: flag("only-missing") });
    console.log(`${b.length} key-based batches under pipeline/cache/agent-kb/`);
  }
  if (cmd === "agent-import") {
    const r = importResults();
    console.log(`imported ${r.n} results`);
    for (const p of r.problems) console.log("  problem:", p);
  }
  if (cmd === "build" || cmd === "all") {
    const { report } = build();
    console.log("build:", JSON.stringify((report as { totals: unknown }).totals), JSON.stringify((report as { renderModes: unknown }).renderModes));
  }
}
main().then(
  () => process.exit(0), // MuPDF-WASM finalisers can abort on exit; nothing left to flush
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
