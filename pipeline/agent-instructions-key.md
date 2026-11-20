# Instructions for a key-based batch (H2 Physics 9478 MCQs)

You are processing one batch of multiple-choice questions from Singapore JC H2 Physics prelim papers. **The school's answer key is the authority.** The correct answer is always `keyAnswer`, and the explanation must come from the school's worked solution wherever one exists. Write your own reasoning only as a fallback, for parts the school didn't explain.

## Inputs (`pipeline/cache/agent-kb/<batch>/batch.json`)
Each item in `items[]` has:
- `id`, `mode` ("full" or "explain"), `questionNumber`, `source`.
- `image`: absolute PNG of the question exactly as printed.
- `keyAnswer` and `keyStatus` (from the parsed answer key), `renderMode`, `extractedText` (may be garbled; the image is the truth).
- `keyText`: the answer file's text layer, with `=== page N ===` separators.
- `keyPageImages`: one PNG per answer-file page (`p-01.png`, …, 1-based).
- `keyPageHint`: page numbers that probably hold this question's solution. Verify them.

Also read `syllabus/h2-physics.json` (topic ids, outcome ids like `circular-motion.c`) when `mode` is "full".

Question type ids: `quantitative`, `multi-step`, `proportionality`, `conceptual`, `graph`, `diagram`, `statements`, `recall`, `practical`, `application`. They mean: direct calculation; chained calculations; what-if-X-doubles and ratios; qualitative; graph/data interpretation; circuits, ray diagrams, free-body diagrams and field lines; "which statements are correct"; definitions and facts; measurement, uncertainty and apparatus; novel context.

## For each item
1. Read the question image.
2. Find the school's solution for question `questionNumber`. Start from `keyPageHint` and search `keyText` (Grep works well). Then **open the page image(s)**: equations and diagrams are often lost in the text layer. Some keys are just a letter table with no working; some are full worked solutions.
3. Check the answer. Confirm the key's letter for this question matches `keyAnswer`. If the solution page shows a different letter than `keyAnswer`, record both in `issues`. Also check the physics yourself: if the key's answer looks wrong, say so in `issues`, set `confidence` to "low", and still explain the key's answer. Put the letter you believe is correct in `derivedAnswer`, which is normally the same as `keyAnswer`.
4. Write the explanation:
   - If the school has a worked solution: `explanationSource` = "key". Write `body` as a clean, faithful rewrite of the school's working: same method, same steps, same numbers. Fix OCR and formatting, use `$…$` LaTeX (e.g. `$v = \sqrt{gr}$`, `$3.0\ \mathrm{m\,s^{-1}}$`), and keep it short enough for a phone (2–6 sentences or short lines, paragraphs separated by a blank line, no headings). Don't add a different method. You may add one short connecting clause where the school's working skips an obvious step.
   - If there is only a letter, or no usable working: `explanationSource` = "generated", and write the explanation yourself from first principles.
   - `perOption`: an object with keys "A","B","C","D". Use the school's comments on distractors where they exist. Otherwise give one sentence on why each wrong option is wrong, naming the error that leads to it (e.g. "Uses diameter instead of radius."). For the correct option, write "Correct." plus at most one clause.
5. Only when `mode` is "full", also classify:
   - `chapter`: the one primary topic id.
   - `secondaryChapters`: topic ids, often empty.
   - `outcomes`: outcome ids, only where you are confident.
   - `primaryType` and `types` (multi-label, primary included).
   - `difficulty` 1–5 for a typical JC2 student, plus a one-sentence `difficultyReason`.
   - `misconception`: a short phrase or `null`.
   - `transcription`: only if `renderMode` is "image". A faithful plain-text transcription with `$…$` LaTeX; describe diagrams in [brackets]. Otherwise `null`.
   When `mode` is "explain", omit all of these fields.
6. `issues`: anything a reviewer should know. Otherwise `null`.

## Output
Write a single JSON array to the batch's `output` path: one object per item, in input order.

```json
{
  "id": "ri-2026-prelim-p1-q7",
  "keyPage": 3,
  "explanationSource": "key",
  "derivedAnswer": "A",
  "confidence": "high",
  "explanation": { "body": "…", "perOption": { "A": "Correct. …", "B": "…", "C": "…", "D": "…" } },
  "issues": null,

  "chapter": "collisions", "secondaryChapters": [], "outcomes": ["collisions.c"],
  "primaryType": "multi-step", "types": ["multi-step"], "difficulty": 4, "difficultyReason": "…",
  "misconception": null, "transcription": null
}
```

(The second group of fields appears only in "full" mode.)

Validate afterwards with `node -e "JSON.parse(require('fs').readFileSync(process.argv[1],'utf8'))" <path>`. Escape backslashes in JSON strings: LaTeX `\sqrt` is written `\\sqrt`. Do not modify any other file, and do not commit.

Finish with a short report:
- the number of items, split into how many have "key" vs "generated" explanations;
- any key letters that don't match `keyAnswer`;
- any answers you believe are wrong (ids);
- other issues.
