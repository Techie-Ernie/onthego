# Instructions for a classification + explanation batch (H2 Physics 9478 MCQs)

You are processing one batch of multiple-choice questions from Singapore JC H2 Physics prelim papers. Work through every item; correctness matters more than speed. Never guess silently: record uncertainty in `confidence` and `issues`.

## Inputs
- `pipeline/cache/agent/<batch>/batch.json`: `items[]` with `id`, `image` (absolute PNG path: the question exactly as printed), `keyAnswer` (from the school's answer key), `keyStatus`, `extractedText` (may be garbled, the image is the truth), and `output` (where to write results).
- `syllabus/h2-physics.json`: the topic taxonomy. Use only its topic `id`s for chapters and its outcome `id`s (e.g. `circular-motion.c`) for outcomes. Read the topic names, keywords and outcome texts before classifying.

Question types (ids): `quantitative` (direct calculation/formula substitution), `multi-step` (chained calculations or derivations), `proportionality` (what happens to X if Y is doubled / ratios), `conceptual` (qualitative explanation, no numbers), `graph` (graph/data interpretation), `diagram` (circuits, ray/wave diagrams, free-body, field lines), `statements` (which of the following statements are correct, 1/2/3 style), `recall` (definitions, laws, standard facts), `practical` (measurement, uncertainties, apparatus, accuracy), `application` (novel or unfamiliar context).

## For each item
1. Open the image with the Read tool and read the whole question, including diagrams and every option.
2. Solve it yourself from first principles, independently of `keyAnswer`. Put your answer in `derivedAnswer`. If you cannot decide, use `null`. Then compare with `keyAnswer`:
   - If they agree: write the explanation.
   - If they disagree: re-check your working once. If you still disagree, keep your `derivedAnswer`, set `confidence` to "low", and describe the disagreement in `issues`. Still write the explanation for the key's answer if it is defensible; otherwise explain both.
3. Classify:
   - `chapter`: the one primary syllabus topic id.
   - `secondaryChapters`: other topic ids for cross-topic questions (often empty).
   - `outcomes`: learning-outcome ids tested, only where you are confident.
   - `primaryType` and `types` (multi-label, primary included).
   - `difficulty` 1–5 for a typical JC2 student (1 = one-step recall, 3 = typical prelim, 5 = hardest in paper), with a one-sentence `difficultyReason`.
   - `misconception`: a short phrase for the misconception the distractors target, or `null`.
4. Explanation (concise; students read this on a phone):
   - `body`: 2–6 sentences or short lines on why the correct option is right. Use `$…$` LaTeX for maths and units (e.g. `$v = \sqrt{gr}$`, `$3.0\ \mathrm{m\,s^{-1}}$`). No markdown headings. Paragraphs separated by a blank line.
   - `perOption`: an object with keys "A","B","C","D". For each wrong option, say *why it is wrong* in one sentence, naming the error that leads to it where possible (e.g. "Uses diameter instead of radius."). For the correct option, write "Correct." plus at most one clause.
5. `transcription`: only when the item's `renderMode` is "image": a faithful plain-text transcription of the stem and options with `$…$` LaTeX, describing any diagram in brackets, e.g. "[Diagram: block on a 30° incline, friction f up the slope]". This is used for search only. Otherwise `null`.
6. `issues`: anything a human reviewer should know (missing diagram in the crop, cut-off text, options that look mislabelled, ambiguous question, answer disagreement). Otherwise `null`.

## Output
Write a single JSON array to the batch's `output` path with exactly one object per item, in input order:

```json
{
  "id": "ri-2026-prelim-p1-q7",
  "chapter": "collisions",
  "secondaryChapters": ["energy-and-fields"],
  "outcomes": ["collisions.c"],
  "primaryType": "multi-step",
  "types": ["multi-step", "application"],
  "difficulty": 4,
  "difficultyReason": "Needs momentum conservation at common velocity plus energy stored in the spring.",
  "misconception": "Assuming all kinetic energy is stored in the spring",
  "derivedAnswer": "A",
  "confidence": "high",
  "explanation": { "body": "…", "perOption": { "A": "Correct. …", "B": "…", "C": "…", "D": "…" } },
  "transcription": null,
  "issues": null
}
```

Validate the file afterwards: it must parse as JSON (`node -e "JSON.parse(require('fs').readFileSync(process.argv[1],'utf8'))" <path>`). Escape backslashes correctly in JSON (LaTeX `\sqrt` is written `\\sqrt` inside JSON strings). Do not modify any other file.

Finish with a short report: number of items, how many disagree with the key (ids), and any items with issues.
