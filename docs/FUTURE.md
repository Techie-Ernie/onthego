# Future work

## Accounts and sync

- Implement `UserDataStore` from `src/lib/store/store.ts` on the server with account-scoped storage. Keep `IdbStore` behind `store()` for guest use and offline writes, then push and pull changes through authenticated endpoints. Email magic links are a simple starting point. Passkeys or school sign-in are options if account recovery or school onboarding calls for them.
- On first sign-in, offer to merge this device’s IndexedDB data using `exportAll()` and the versioned `UserDataExport` in `src/lib/store/schema.ts`. Preserve IDs and timestamps, make the upload safe to retry, and keep the local copy through server acknowledgement.
- Merge by account, record type and `id`, using `updatedAt` for last-writer-wins and `deviceId` to break ties. Add deletion markers so removed bookmarks and presets stay deleted. Test clock skew, concurrent quiz edits, and sign-out on shared devices.

## H2 Chemistry and Biology

- Add both subjects to `SUBJECTS` in `src/subjects/index.ts` and add `syllabus/h2-chemistry.json` and `syllabus/h2-biology.json` using the `Syllabus` shape in `src/lib/types.ts`. Give each `SubjectConfig` its own paper rules and question types, such as stoichiometry and organic mechanisms for Chemistry, and genetics and experimental data interpretation for Biology.
- Pass the subject through discovery, pairing, extraction and `pipeline/src/build.ts`, which currently hard-codes Physics and 30-question validation. Scope extract caches, classifications, explanations, overrides and reports by subject. Check rendering with chemical notation, molecular structures and labelled biological diagrams.
- Emit a `BankIndex` and per-topic `BankShard` files under `data/bank/<subject>/`, with crops under `public/q-assets/<subject>/`. Add subject selection in the app and carry it through quiz and review flows. In `src/lib/bank/index.ts`, key the index cache by subject and pass the index’s subject when loading shards. Keep question IDs distinct across subjects so attempts, bookmarks and review cards resolve correctly.

## Scaling the Grail bank

- Use `pipeline/src/grail.ts` to refresh the wrapper index conditionally and select Paper 1 candidates. Keep `grail-fetch` user-run because `document.grail.moe` blocks named AI crawlers. Use `grail-status` to identify Drive-only PDFs and download them manually to `pipeline/cache/grail/manual/<fileId>.pdf`.
- Keep the cover checks in `pipeline/src/cli.ts`. Skip 9646 papers and Grail papers whose covers fail the Paper 1 MCQ check. Verify syllabus compatibility and review ambiguous covers or answer keys before publishing. Prefer local copies of the same sitting.
- Run `pipeline/src/dedupe.ts` through the bank build across years. Preserve each occurrence in `Question.appearances`, review answer disagreements and reordered options, and preserve canonical IDs or provide aliases so old attempts still resolve.

## Explanations and re-cropping

- Use `pipeline/src/agent-keys.ts` to package schools’ worked solutions for local Claude Code or Codex agents. This workflow uses no API key. Import with `pipeline/src/agent-batches.ts` into `data/explanations/<subject>.json`. Keep source labels, paraphrase solutions, and keep the `build.ts` check that withholds low-confidence explanations and those that disagree with the key.
- Add a rectangle editor and preview to `src/app/admin/review/ReviewClient.tsx` using the dev crop and override routes under `src/app/api/admin/`. Persist page rectangles in PDF points via `Override.recrop` in `pipeline/src/build.ts` and implement the pending re-crop application with `pipeline/src/crops.ts`. Check page rotation and multi-page crops before rebuilding.

## Teachers, classes and sharing

- Use `Preset` and `QuizConfig` in `src/lib/store/schema.ts` to share preset links that open in `src/app/build/BuildClient.tsx`. Validate the config and handle links that reference retired topics or questions. Share quiz settings only.
- Build invite-only classes, teacher assignments and completion summaries on top of accounts. Store class membership and roles on the server and enforce access there. Make leaderboards optional, class-only and pseudonymous. Keep individual attempts private by default and set retention and deletion rules before collecting student data.

## Analytics and offline practice

- Tune intervals in `src/lib/quiz/srs.ts` using review history and later recall. Extend `src/lib/insights.ts` to join attempts with syllabus outcomes via the bank index. Show sample sizes and discount guesses so sparse data does not look like mastery.
- Use `src/lib/offline.ts` and `public/sw.js` to show download size and progress, retry failed downloads, and update each offline topic with its matching index and assets. Handle storage eviction and keep active quizzes usable during updates.

## Copyright and public release

- Keep the repo and deployments private until every publicly served reproduction, including question text, crops and any reproduced solution or syllabus material, has explicit permission or a licence covering republication. Replace or remove material without clearance. See [Content notice](CONTENT-NOTICE.md).
- Record permissions and required attribution alongside provenance. Check the Vercel build, static bank, image assets and offline caches for uncleared material before opening access. Attribution and access to a paper through Grail or inter-school sharing do not grant republication rights.
