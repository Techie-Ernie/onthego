# onthego

Mobile-first H2 Physics (9478) MCQ practice built from real JC prelim papers. Short, targeted quizzes that work offline. Subject-agnostic by design (Chemistry/Biology later — see `docs/FUTURE.md`).

- Plan and data model: `docs/PLAN.md`
- Source/copyright situation: `docs/CONTENT-NOTICE.md` (keep this repo private)
- grail-wrapper source survey: `docs/GRAIL.md`

## Layout

| Path | What |
|---|---|
| `src/` | Next.js app (App Router, TypeScript, Tailwind v4, KaTeX) |
| `src/lib/types.ts` | the shared data model (app + pipeline) |
| `src/subjects/` | subject config (question types, paper shape, branding) |
| `syllabus/h2-physics.json` | taxonomy built from the SEAB 9478 (2026) syllabus PDF |
| `pipeline/` | offline ingestion (never shipped). `pipeline/cache/` is gitignored |
| `data/bank/` | the built question bank (index + per-topic shards), committed |
| `data/overrides/` | review-queue corrections, committed, survive reruns |
| `data/ingest-report.json` | counts, render modes, failures, low-confidence items, image-bank size |
| `public/q-assets/` | WebP crops per subject/topic, content-hashed, committed |
| `public/sw.js` | service worker (app shell + per-topic offline caches) |

## Running the pipeline

Needs Node 22+ and poppler (`pdftotext`, `pdftoppm`). The papers folder defaults to `./Other JC Prelim 2026` (gitignored); override with `LOCAL_PAPERS=/path`.

```bash
npm install
npm run pipeline -- all            # discover + pair + split + crop + answers, then build the bank
npm run pipeline -- ingest --force # re-extract everything (otherwise cached per PDF hash)
npm run pipeline -- ingest --only RI
npm run pipeline -- build          # re-merge extracts + classifications + overrides → data/bank
npm test                           # pairing, key parsing, splitting, option/figure association, dedupe
```

Stages:

1. **discover/pair** (`discover.ts`, `pair.ts`): classify every PDF by folder/filename (school, year, exam, level, paper, QP vs key) and pair QP ↔ key by `school|year|exam|paper`. Unpaired files are logged.
2. **extract** (`split.ts`, `keys.ts`, `crops.ts`, `extract.ts`): MuPDF structured text + vector/image boxes → question regions (multi-page aware, shared preambles copied to each question), A–D option layout (list/row/2×2 grid/table), figures, text confidence → render mode. Pages are rendered by poppler at 216 dpi and cropped to WebP. The answer key is parsed with several independent strategies that must agree; disagreements are flagged, never guessed.
3. **build** (`build.ts`): dedupe (trigram Jaccard + image dHash; same-paper pairs never merge; different answers never merge), apply classifications/explanations/overrides, write shards and assets, write the ingest report.

### Rendering policy

- `text`: stem and options are clean text (LaTeX for super/subscripts).
- `mixed`: clean text plus cropped figures placed where they appeared.
- image options: when options are graphs/diagrams, each option is cropped separately and shown as a tappable 2×2 grid.
- `image`: whenever text confidence is low (symbol fonts, stacked fractions, tables, unmapped glyphs, missing labels), the whole question is a high-DPI crop with A–D buttons below. A wrong rendering is worse than an ugly one.

### Review queue

`npm run dev`, then open <http://localhost:3000/admin/review> (dev only; every admin route 404s in production). Left: the original PDF crop. Right: exactly what a student sees with the key highlighted. Actions write to `data/overrides/h2-physics.json`; press **Rebuild bank** to apply. The **Sample of 10** tab covers the risky cases.

## Classification and explanations (no API key)

Nothing calls a model API. Batches are prepared by the pipeline and run by local agents: Claude Code subagents or the Codex CLI.

```bash
npm run pipeline -- agent-key-batches        # one batch per 20 questions, with each paper's answer-key pages attached
pipeline/codex-all.sh 4                      # run every batch without output through `codex exec`, 4 at a time
pipeline/codex-batch.sh kb-07                # or a single batch
npm run pipeline -- agent-import             # validate + merge into data/classifications, data/explanations, data/transcriptions
npm run pipeline -- build
```

The rules for agents are in `pipeline/agent-instructions-key.md`:

- **Answers always come from the school's answer key.** The agent also solves the question independently, but only to check the key. A disagreement flags the question (`explanation-disagrees-with-key`) for the review queue; it never changes the answer.
- **Explanations come from the school's worked solution.** The agent rewrites it cleanly in LaTeX. Only when a key has no working does the agent write its own (`source: "generated"`), and the app labels which kind each explanation is.
- The agent also assigns: chapter, secondary chapters, learning outcomes, question types, difficulty 1–5 and the misconception the distractors target. For image-mode questions it writes a transcription, used for search.

Outputs land in `data/agent-output/*.json`, which is committed so a rerun never has to redo agent work.

## Running the app

```bash
npm run dev     # copies data/bank → public/bank, then next dev
npm run build && npm start
```

## Deploying (Vercel)

```bash
vercel link --project onthego     # once
vercel --prod
```

Nothing secret is needed, at runtime or in the pipeline. `.vercelignore` keeps the source PDFs, zip and pipeline caches out of the upload (the 100 MB limit). Enable Vercel Analytics in the dashboard (privacy-friendly, no personal data).
