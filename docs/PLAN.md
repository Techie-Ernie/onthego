# onthego — plan

Kind: software (a study app). Palette `card-pastels` (off-white ground, one pink accent `#d0106f`; the UI stays neutral so the exam figures carry the colour), type `chivo` (Chivo + Chivo Mono), radius soft. Dealt with the taste-skill (`.agents/skills/design-taste-frontend`). The skill targets marketing sites. For an app we keep its system rules: one accent, no violet, a 4/8 spacing scale, 16px reading text, 13px minimum, 44px tap targets, one button pair, one card recipe, sentence case, hover-step/press micro-interactions, no scroll fades. Its section/hero/photograph rules don't apply to app screens.

## Architecture

```
Other JC Prelim 2026/   raw PDFs (gitignored, never shipped)
pipeline/               offline Node/TS scripts (tsx), never imported by the app
  cache/                downloads, rendered pages, LLM results (gitignored)
  src/
    discover.ts         walk local folder -> PaperFile[] (school, year, exam, paper, role=qp|key)
    pair.ts             pair QP <-> key, log unpaired
    split.ts            MuPDF structured text -> question blocks (stem, A-D, figures)
    keys.ts             parse answer keys (tables, "1 C", MS pages, answers-in-solutions)
    figures.ts          crop figures/options/whole-question to WebP (sharp), 2x+
    dedupe.ts           normalised-text hash + trigram Jaccard + image dHash clusters
    llm.ts              Anthropic client with on-disk cache (key = sha256(model+prompt+image hashes))
    classify.ts         chapter/type/difficulty/misconception (phase 5)
    explain.ts          explanations + answer verification (phase 5)
    overrides.ts        apply data/overrides/*.json (review-queue fixes survive reruns)
    build.ts            orchestrates -> data/ + public/q-assets/
  test/                 vitest: pairing, splitting, option/figure association, count validation
syllabus/h2-physics.json  taxonomy built from the SEAB 9478 (2026) syllabus PDF
subjects/*.ts             subject config (id, name, taxonomy, question types, branding)
data/
  bank/h2-physics/index.json         slim index (id, chapter, types, difficulty, flags, text snippet)
  bank/h2-physics/<topicId>.json     full question shards per topic (lazy-loaded, cached per topic)
  ingest-report.json
  overrides/h2-physics.json          review-queue corrections (committed)
public/q-assets/h2-physics/<topicId>/<qid>-*.webp
src/ (Next.js App Router)
  lib/bank/          loaders for index + shards (fetch from /bank/... static, SW-cached)
  lib/store/         UserDataStore interface + IndexedDB impl (sync plugs in here)
  lib/quiz/          filter/build/select, SM-2, analytics, insights
  components/        QuestionCard, OptionGrid, Figure (zoom), Math (KaTeX)
  app/               /, /build, /quiz/[id], /results/[id], /mistakes, /insights, /trends,
                     /search, /settings, /admin/review (dev-only)
public/sw.js         hand-written service worker: app shell precache, per-topic runtime caches
```

Bank shards are copied to `public/bank/` at build time (`prebuild`) so they are static files Vercel serves from its CDN and the service worker can cache per topic.

## Data model (abridged — `src/lib/types.ts` is the source of truth)

```ts
Question {
  id: string                 // stable: hash of canonical normalised text (or image hash)
  subject: SubjectId
  stem: string               // text with $…$ LaTeX
  stemText: string           // plain text (search/dedupe), even for image mode
  textQuality: "high" | "low"
  renderMode: "text" | "mixed" | "image"
  hasFigure: boolean
  figures: { src, w, h, alt, position: "stem-top"|"stem-inline"|"before-options" }[]
  stemImage?: { src, w, h, alt }        // renderMode image
  options: { label: "A"|"B"|"C"|"D", text?: string, image?: {src,w,h,alt} }[]
  optionLayout: "list" | "grid"
  answer: "A"|"B"|"C"|"D"
  chapter: string; secondaryChapters: string[]; outcomes: string[]
  types: QuestionType[]; primaryType: QuestionType
  difficulty?: 1..5; difficultyReason?: string; misconception?: string
  explanation?: { body, perOption: Record<label,string>, model, verified: boolean }
  appearances: Provenance[]  // all dedupe-cluster members
  flags: string[]            // review reasons
  status: "published" | "needs-review"
}
Provenance { source: "local"|"grail", school, year, exam, paper, questionNumber, originalFile, page }
```

User data (`UserDataStore`, schema-versioned, exportable JSON): `attempts[]`, `quizzes[]` (in-progress + finished), `srs{qid -> {ef, interval, reps, due}}`, `bookmarks`, `flags`, `presets`, `settings`, `reports[]`. Every record carries `updatedAt` and a client `deviceId` so a later server sync can merge last-writer-wins per record.

## Phases

1. Scaffold & deploy: Next.js + Tailwind v4 + tokens, PWA manifest + SW shell, Vercel config.
2. Syllabus taxonomy from the PDF.
3. Ingestion v1 on the local Prelims folder (Paper 1 MCQs only), report + 10-question side-by-side sample. **Checkpoint with the user before scaling up.**
4. grail-wrapper scraper → same pipeline.
5. Categorisation + explanations (needs `ANTHROPIC_API_KEY`), review queue.
6. Core app. 7. Insights & trends. 8. Offline/perf/a11y polish. 9. `docs/FUTURE.md`.

## Decisions taken without asking
- Pipeline is Node/TypeScript (MuPDF WASM + sharp), not Python: no pip/PyMuPDF on this machine, and one language for app + pipeline types.
- Only H2 Paper 1 (MCQ) is ingested; P2–P4 are structured papers and out of scope. H1 Paper 1 MCQs are skipped for now (different syllabus), easy to add later as another subject.
- Without an API key, classification/explanations are skipped and the questions are kept but marked `needs-review`; the app hides questions with no chapter from chapter filters.
