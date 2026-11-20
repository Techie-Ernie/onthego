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

const [cmd = "all", ...rest] = process.argv.slice(2);
const flag = (n: string) => rest.includes(`--${n}`);
const arg = (n: string) => {
  const i = rest.indexOf(`--${n}`);
  return i >= 0 ? rest[i + 1] : undefined;
};

async function ingest() {
  const { files, skipped } = discoverLocal(LOCAL_PAPERS);
  const { pairs, problems } = pairPapers(files);
  console.log(`discovered ${files.length} Paper 1 files (${skipped.length} other files skipped), ${pairs.length} papers`);
  for (const pr of problems) console.log(`  pairing: ${pr.key} ${pr.problem} ${pr.files.join(", ")}`);
  const only = arg("only");
  for (const p of pairs) {
    if (only && p.school !== only.toUpperCase()) continue;
    const t = Date.now();
    const e = await extractPaper(p, { force: flag("force") });
    const answers = Object.keys(e.keyResult.answers).length;
    console.log(`  ${p.key.padEnd(24)} ${e.questions.length} questions, ${answers} answers (${e.keyResult.method})${e.keyResult.issues.length ? `, ${e.keyResult.issues.length} key issues` : ""} ${Date.now() - t}ms`);
  }
}

async function main() {
  if (cmd === "ingest" || cmd === "all") await ingest();
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
