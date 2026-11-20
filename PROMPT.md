# Project: onthego

A mobile-first MCQ practice site for GCE A-Level H2 Physics (9478), built to be extensible to H2 Chemistry and Biology later. Target deployment: https://onthego.vercel.app

The core idea: students shouldn't need to sit a full paper. They build short, targeted quizzes (5 minutes on a bus, 10 questions on a topic) from a categorised bank of past MCQs, and the app learns where they go wrong.

Before writing any code:
1. Read and follow the **taste-skill** (already installed) for all UI work. Re-consult it at each UI phase.
2. Ask me for the path to my local PDF folder of 2026 JC Prelims papers, and for anything else you need that you can't discover yourself.
3. Write a short plan (architecture, data model, phases) to `docs/PLAN.md` and proceed. Don't wait for approval unless something is genuinely ambiguous or irreversible.

---

## 1. Stack and hosting

- Next.js (App Router) + TypeScript + Tailwind, deployed on Vercel as project `onthego` (target URL `onthego.vercel.app`). Set up the Vercel project, `vercel.json` if needed, and env var handling. Tell me what I need to run manually (`vercel login`, `vercel link`, etc.).
- The question bank is **built offline** by scripts and committed or stored as static JSON plus image assets, not scraped at runtime. The site itself reads from this bank.
- Math rendering with KaTeX. Physics MCQs are full of units, vectors, subscripts and Greek letters, so this must be solid.
- PWA: installable, offline-capable. Once the bank is cached, the app must work with no signal (commuting through tunnels is the main use case). See section 4.5 for caching strategy.
- v1 has **no login**. User state (history, mistakes, bookmarks, settings) lives in IndexedDB/localStorage behind a **storage abstraction layer** (`UserDataStore` interface) so Google sign-in plus a server DB (e.g. Neon/Supabase/Vercel Postgres) can be added later without rewriting the app. Don't implement auth now, but design for it: stable user-data schema, export/import of progress as JSON, and a clear place where sync will plug in.
- Make the subject a first-class concept (`subject: "h2-physics" | "h2-chemistry" | "h2-biology"`). The syllabus taxonomy, question types and branding should be config-driven, not hardcoded to physics.

## 2. Ingestion pipeline (scripts in `/pipeline`, not shipped to the client)

### Sources
1. **https://grail-wrapper.vercel.app/**, a site aggregating past papers. Explore it first and document how it's structured. Scrape politely: respect robots.txt, rate-limit, cache downloads locally (`/pipeline/cache`, gitignored), make the scraper resumable and idempotent.
2. **My local folder of 2026 JC Prelims PDFs.** Ask me for the path.

Record provenance for every question: `source` (grail / local), `school`, `year`, `exam` (Prelim / Promo / MYE / etc.), `paper` (H2 Paper 1), `questionNumber`, `originalFile`.

### Question/answer splitting
- Papers and answer keys are **separate files**. Pair them reliably (by school, year, exam, paper) and log any papers that can't be paired.
- Split each paper into individual questions: stem, options A-D, and any diagram/graph/table/circuit (see the rendering policy below for how these are stored and shown).
- Attach the correct answer from the key. Sanity-check: H2 Paper 1 is normally 30 questions with answers A-D. Flag any paper where counts don't match or an answer is missing or invalid.
- Use whichever extraction approach works best (PyMuPDF / pdfplumber / pdftotext, plus Claude vision for hard pages). Use the Anthropic API where it helps, read `ANTHROPIC_API_KEY` from env, and cache every API result so reruns are free.
- **Dedupe**: the same question often appears in multiple schools' papers or both sources. Detect near-duplicates (normalised text hash plus embedding or fuzzy match), cluster them, and keep one canonical question while recording all appearances (this also powers the "frequently tested" insight). For image-only questions, dedupe using the vision-extracted transcription or an image hash.

### Rendering policy (what the user actually sees)
The user must see the question as the examiner drew it, including every diagram. Use this decision order per question:

1. **Text + figures** (`renderMode: "mixed"`, or `"text"` if there is no figure): stem and options as text/LaTeX, with any diagram, graph, circuit or table cropped as an image and placed where it appeared in the original (above the options, or inline in the stem).
2. **Figure-in-options**: if options A-D are themselves images (graphs, circuits, ray diagrams, field lines), crop each option separately and render them as a labelled A-D grid. Never merge them into one image, because each option must be individually tappable. Store them as `options[i].image`.
3. **Full-question image fallback** (`renderMode: "image"`): if text extraction is unreliable (garbled equations, complex layout, unusual formatting), show a high-DPI crop of the whole question stem, but still render tappable A-D buttons beneath it. Flag these for review.

Requirements for all crops:
- Tight crops, at least 2x resolution, saved as WebP (with PNG fallback only if needed), sensibly sized so mobile loads are fast.
- Alt text for every image (generate with vision, concise and descriptive, e.g. "Graph of velocity against time showing...").
- Figures cropped from white PDFs must look right in dark mode: place them on a light card with a subtle border/radius rather than inverting colours (inversion breaks coloured lines and shaded regions).
- Extracted text is a convenience, but the image is the safety net. For any question with equations or symbols the pipeline is not confident about, prefer `renderMode: "image"` over showing wrong text. A wrong rendering is worse than an ugly one.
- Also store the extracted plain text of image-mode questions (even if imperfect) so search, categorisation and dedupe still work. Mark it `textQuality: "high" | "low"`.
- Each question record stores `renderMode`, `hasFigure`, `figures[]` (with position, dimensions, alt text) and `options[]` (text and/or image).

### Output
`data/questions.json` (or sharded by topic for load speed), `public/q-assets/<subject>/<topic>/…` for images (organised per topic so they can be cached per topic), and `data/ingest-report.json` listing counts, `renderMode` breakdown, failures and low-confidence items.

### Review queue
Build a dev-only page, `/admin/review`, disabled in production, to quickly fix flagged questions. For each item show the **original PDF page crop side by side with the rendered result exactly as a student would see it**, so mismatches (missing figure, wrong option order, mangled equation, wrong answer pairing, wrong category) are obvious at a glance. Provide one-click actions: switch `renderMode` to image, re-crop, edit text, fix answer, change category, approve. Corrections are saved as overrides that survive pipeline reruns.

## 3. Categorisation

Each question gets **chapter tags** and **type tags**, assigned by an LLM pass with structured JSON output, cached, then spot-checked in the review queue. For `renderMode: "image"` questions, the vision model should classify from the image itself, not only the extracted text.

### Chapters
Fetch and read the syllabus PDF: https://isomer-user-content.by.gov.sg/334/302197f9-5acc-4482-a058-621af208fd0e/9478_y26_sy.pdf

**Treat the syllabus as the source of truth** for the topic list, names and order, and build the taxonomy from it (store as `syllabus/h2-physics.json` with topic ids, names, section groupings, and learning-outcome snippets the classifier can use). For reference, I expect roughly: Measurement; Newtonian Mechanics (Kinematics, Dynamics, Forces, Work/Energy/Power, Motion in a Circle, Gravitational Field); Thermal Physics (Temperature & Ideal Gases, First Law of Thermodynamics); Waves (Wave Motion, Superposition); Electricity & Magnetism (Electric Fields, Current of Electricity, D.C. Circuits, Electromagnetism, Electromagnetic Induction, Alternating Current); Modern Physics (Quantum Physics, Nuclear Physics). If the PDF differs, the PDF wins.

- One **primary chapter** per question, plus optional **secondary chapters** for cross-topic questions (e.g. circular motion + gravitation).
- Where the syllabus gives learning outcomes, map each question to the specific outcome(s) it tests where confident.

### Question types (multi-label, but pick one primary)
Start with this set and refine it after looking at real data:
- **Quantitative**: direct calculation / formula substitution
- **Multi-step quantitative**: chained calculations or derivations
- **Proportionality / ratio reasoning**: "what happens to X if Y is doubled"
- **Qualitative / conceptual**: explain-the-physics, no numbers
- **Graph / data interpretation**
- **Diagram-based**: circuits, ray/wave diagrams, free-body, field lines
- **Statement evaluation**: "which of the following are correct" (1, 2, 3 style)
- **Memorisation / recall**: definitions, laws, standard facts
- **Experimental / practical**: measurement, uncertainties, apparatus, improving accuracy
- **Application / unfamiliar context**: novel scenarios

Also tag: **estimated difficulty** (1-5, with reasoning stored), **common misconception targeted** (short text, if identifiable), and **has_figure** (boolean).

### Explanations
Generate a concise worked explanation for each question (why the answer is right and, crucially, **why each wrong option is wrong**). Verify every explanation against the official answer key. If the model's derived answer disagrees with the key, flag it for review instead of publishing. Label these as AI-generated in the UI and allow reporting a bad question or explanation.

## 4. The app

### 4.1 Quiz builder (the main feature)
Fast, thumb-friendly setup in under 10 seconds:
- Filter by chapter(s) (multi-select, grouped by syllabus section), question type(s), difficulty, school/year, "has figure / no figure" (useful when the person can't look at diagrams easily, e.g. on a crowded train).
- Question pool modes: **All**, **Unseen only**, **Previously wrong**, **Bookmarked**, **Weak topics** (auto-selected from analytics).
- Length presets: 5 / 10 / 15 / custom, plus **time-boxed** ("I have 5 minutes").
- Optional timer (per question or overall), optional "exam pace" (about 1.5 min per question).
- **Quick-start cards** on the home screen: "5 min mixed", "Continue where I left off", "Fix my weak spots", "Random chapter".
- Save quiz presets and name them.
- Live "N questions match" count as filters change.

### 4.2 Quiz-taking experience
- Mobile-first, one question per screen, big tap targets, one-handed use, swipe or button for next, options selectable by tap, keyboard shortcuts (A-D, Enter) on desktop.
- Render every question according to the rendering policy in section 2: text, mixed, or image-based stems, and image-based option grids where applicable. Options are always tappable regardless of how they're displayed.
- Figures are zoomable (pinch/tap to open full-screen) and never cropped or squashed by the layout. Wide graphs and circuits must remain legible on a 390px screen (allow horizontal pan or zoom when needed).
- Two feedback modes: **immediate** (reveal answer and explanation after each question) and **exam mode** (reveal at the end).
- Flag question for later, bookmark, "I guessed" toggle, "I was unsure" confidence marker (feeds analytics).
- Auto-save progress after every answer, so closing the tab mid-quiz and resuming later works.
- Results screen: score, time, per-question review, breakdown by chapter and type, one-line takeaway.

### 4.3 Review and retention
- **Mistake book**: every wrongly answered, guessed or unsure question, with the option the user picked and the explanation.
- **Spaced repetition**: simple SM-2-style scheduling for missed questions. Home screen shows "N questions due for review".
- Retry-wrong-only from any result screen.

### 4.4 Analytics and insights
**Personal insights** (the most important differentiator, so make them concrete and not vanity stats):
- Accuracy by chapter and by question type, with a heatmap (chapter x type) that reveals patterns such as "strong on qualitative, weak on multi-step quantitative in Electromagnetism".
- Time per question vs. accuracy, to separate "slow but right" from "fast and careless".
- **Mistake pattern detection**: repeated wrong-option choices that map to a known misconception, guesses that happened to be right, topics where confidence and accuracy diverge, improvement or decline over time.
- Plain-language insight cards with an action: "You've missed 4 of the last 5 Gravitational Field questions. Start a 10-question drill." Tapping one launches a pre-built quiz.
- Streaks and a gentle study-habit tracker (without being obnoxious).

**Bank-level trend insights** (from the question bank itself):
- Topic frequency across years and schools: which chapters dominate Paper 1, and how that's shifting.
- Question-type distribution per chapter.
- "Most-repeated" question concepts (using the dedupe clusters), and "high-yield" topics that combine frequency with low average difficulty.
- Show these as a clear, clean "Trends" page, with caveats on sample size (e.g. low N for a given school/year).

### 4.5 Other necessary features
- Search questions by keyword (uses extracted text, including the low-quality text of image-mode questions).
- Per-question "report an issue" (wrong answer, bad crop, typo). v1 can write to a local queue and a mailto/GitHub-issue link, since there's no backend yet.
- Dark mode (figures sit on light cards, as specified in the rendering policy).
- Settings: default quiz length, feedback mode, data export/import/reset.
- Accessibility: proper contrast, focus states, screen-reader labels on options, alt text on figures.
- **Performance and offline caching**: keep the initial bundle small and lazy-load question shards. Don't precache everything. Cache **per topic**: the user can tap "Download for offline" on a chapter (with a visible size estimate and progress) or "Download all", and the service worker caches that topic's JSON shard and WebP images. Questions in a quiz in progress, plus the next few, are always cached automatically so a started quiz never fails mid-tunnel. Prefetch the next question's assets. Show clear offline status in the UI, and let the user manage and clear the cache in settings. Report the total size of the image bank in the ingest report so we can decide on budgets.
- Privacy-minimal analytics only (e.g. Vercel Analytics), and nothing personal.

## 5. Design

- Follow the **taste-skill**. Clean, calm, minimal, focused on reading and answering. No generic template look.
- Mobile-first (design at ~390px wide first), then scale up gracefully.
- Quiz screen should feel uncluttered: question, options, one primary action.
- Use a restrained type system with a good math-friendly font pairing. Make sure KaTeX output looks consistent with the surrounding text, and that image-based questions don't look jarringly different from text-based ones (consistent card treatment, spacing and sizing).

## 6. Phases (commit after each, keep the app deployable throughout)

1. **Scaffold & deploy**: Next.js app, Vercel project, PWA shell, design tokens per taste-skill, placeholder home page live.
2. **Syllabus taxonomy**: parse the syllabus PDF into `syllabus/h2-physics.json`.
3. **Ingestion v1**: process my local 2026 Prelims folder end-to-end (split, pair, figures, rendering modes, dedupe) with the ingest report. Show me the report and a sample of 10 questions (including at least 2 with diagrams, 1 with figure-based options, and 1 image-fallback) rendered side by side with the original PDF before scaling up.
4. **Scraper**: grail-wrapper ingestion, merged into the same pipeline.
5. **Categorisation + explanations**: LLM pass, answer verification, review queue.
6. **Core app**: quiz builder, quiz-taking, results, mistake book, local persistence.
7. **Analytics & insights**: personal insights and bank trends.
8. **Polish**: per-topic offline caching, performance, accessibility, empty/error states.
9. **Future (document only, don't build)**: Google sign-in, cloud sync, Chemistry/Biology onboarding. Write `docs/FUTURE.md` describing exactly where those plug in.

## 7. Quality bar and guardrails

- Correctness of the question bank matters more than quantity. A wrong answer key or a missing diagram damages trust. Prefer flagging over guessing.
- Write tests for the pipeline's riskiest parts (paper/answer pairing, question splitting, option/figure association, answer-count validation) and for quiz-builder filtering and spaced-repetition scheduling.
- Keep secrets out of the repo (`.env.local`, gitignored). Provide `.env.example`.
- Copyright: these are school exam papers. Keep the raw PDFs and scrape cache out of the repo and out of public assets, and record provenance and attribution for each question. Add a short `docs/CONTENT-NOTICE.md` explaining the source situation and suggesting the repo stay private. Flag anything you think I should decide about redistribution.
- Write a clear `README.md`: how to run the pipeline, how to run the app, how to deploy.
- When you finish each phase, give me a short summary: what works, what's flagged, what you need from me.

Start now with step 0 (read taste-skill, ask me for the PDF folder path) and then Phase 1.