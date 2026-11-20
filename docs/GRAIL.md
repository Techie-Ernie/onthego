# Grail Wrapper (grail-wrapper.vercel.app): source notes for the scraper

Explored 2026-11-20 with about 12 requests (UA `onthego-bank-builder/0.1`, 1 s or more between requests).
Two sample PDFs were saved to `pipeline/cache/grail/samples/`, which is gitignored. Nothing was bulk-downloaded.

## TL;DR

- The site is a **static page plus one JSON index**. There is no SPA framework, `__NEXT_DATA__`, API, pagination or server-side filtering. `index.html` runs `fetch("./data.json")`, then does all filtering and grouping in inline vanilla JS.
- **`https://grail-wrapper.vercel.app/data.json`** (8.9 MB, about 9.5k entries, ETag and Last-Modified set) is the whole catalogue. One request gets everything.
- The wrapper hosts **no files**. It indexes two upstream sources:
  - **grail.moe** (6,680 entries): PDFs on `https://document.grail.moe/<hex32>.pdf` (S3 behind CloudFront, `immutable`).
  - **The Holy Grail Mk 6 Google Drive folder** (2,825 entries): `https://drive.google.com/file/d/<id>/view`.
- **H2 Physics Paper 1:** 379 entries make up about 206 distinct sittings across 26 schools, 2011 to 2026. About 174 sittings have a question paper and about 135 have both a question paper and answers. From 2017 onward (syllabus 9749) there are about 137 QP sittings and about 112 with answers.

## Pages and endpoints

| URL | What |
|---|---|
| `/robots.txt` | `User-agent: * / Allow: /`, sitemap at `/sitemap.xml` |
| `/` (`index.html`, 86 KB) | Static UI. Inline `<script>` has `fetch("./data.json")`. Query params such as `?q=` only drive client-side filters. |
| `/data.json` | The full index as a JSON array (see below) |
| `/reference.html`, `/reference/*.pdf` | Formula sheets, including `reference/h2-physics-formula-sheet.pdf` |

Response headers for `data.json`: `content-type: application/json`, `etag: "37bd…"`, `last-modified: Thu, 19 Nov 2026 01:40:59 GMT`, `cache-control: public, max-age=0, must-revalidate`, and `access-control-allow-origin: *`. **Use `If-None-Match` / `If-Modified-Since`** to get a cheap 304 on re-runs.

## `data.json` entry schema

Here is a grail.moe-sourced entry:

```json
{
  "id": "19909",
  "name": "CJC.2025.H2.Phy.PRELIM.P1 Q paper",
  "original_name": "CJC.2025.H2.Phy.PRELIM.P1 Q paper",
  "display_name": "CJC 2025 H2 Phy Prelim P1",
  "note_url": "https://grail.moe/library/19909/<slug>",
  "download_url": "https://api.grail.moe/note/download/19909",
  "inline_url": "https://document.grail.moe/3ca8b43a41e644f5bd9bd62294b50d45.pdf",
  "category": "GCE 'A' Levels",
  "subject": "H2 Physics",
  "doc_type": "Exam Papers",
  "year": "2025", "year_resolved": "2025", "year_source": "name",
  "school": "CJC",
  "paper_info": "Prelim P1", "paper_info_base": "Prelim P1", "paper_info_role": "Questions",
  "paper_number": 1, "paper_label": null,
  "group_id": "CJC|2025|H2 Physics|Prelim",
  "uploaded_by": "…", "uploaded_on": "…", "flagged": false, "flag_reason": null
}
```

Drive-sourced entries also carry `"source": "drive"` and `"drive_path": "H2 Physics / Prelims / 2011 / ACJC / ACJC_H2_PHY_P1.pdf"`. Their `id` is `gdrive:<fileId>`. Their `note_url`, `download_url` and `inline_url` are all `https://drive.google.com/file/d/<fileId>/view`.

Rare fields are `status_override`, `manually_edited` and `review_note`, which come from manual curation by the wrapper's author.

### Field values

- `subject`: H2 Chemistry 3189, **H2 Physics 1907**, H2 Mathematics 1627, H2 Economics 1491, H1 General Paper 980, H2 Computing 311.
- `doc_type`: `Exam Papers`, `Notes/Practices`, `MYEs/CAs/Other Tests`, `TYS Answers`, `User Mock Papers`.
- `school`: short codes such as `RI`, `HCI`, `DHS`, `NJC`, `EJC`, `ACJC`, `CJC`, `TMJC`, `MI` and others. It can be `null` or `""`, as on about 165 physics rows.
- `paper_number`: 1 to 4, or null. Null applies to Promo or CT papers split by "Sect A/B/C" and to whole-exam bundles.
- `paper_info_role`: free text. Values include `Questions`, `Answers`, `Solutions`, `QP`, `Guide`, `QP Guide`, `""` and `Questions & Answers`.
- `group_id`: the wrapper's own grouping key. Its shape varies:
  - `SCHOOL|YEAR|SUBJECT|TERM`
  - `manual|SCHOOL|YEAR|SUBJECT|TERM`
  - `single|<id>`
  - `linked|<id>|<id>`

  It does not contain the paper number. **Do not rely on it as a key.**

## Mapping to `{school, year, exam, paper, role}`

| target | source | notes |
|---|---|---|
| school | `school` | Drop or flag null or empty values. Normalise aliases: `RI` and `RJC`, `TPJC` (merged into TMJC), `AJC`, `IJC`, `JJC`, `SRJC` (now merged). |
| year | `year_resolved` | Null on about 72 physics rows. |
| exam | regex on `paper_info` + `original_name` + `drive_path` | `promo` gives Promo. `prelim` gives Prelim. `mye\|mid.?year` gives MYE. `\bct\b\|common test\|block test` gives CT. `a.?level\|tys` gives A-Level. Anything else is Other. The site's own `examTerm()` uses the same idea. `drive_path` is `H2 Physics / Prelims\|Promos / YEAR / SCHOOL / file.pdf`. |
| paper | `paper_number` | Fall back to `\bP(?:aper)?\s*([1-4])\b` on the name. |
| role | **re-derive from the filename** | See below. |

**`paper_info_role` is unreliable.** These files are labelled `Questions` but are really answer files:
- `NJC_2024_H2_Physics_Prelim_P1_Ans`
- `NJC_2025_H2_Physics_Prelim_P1_Sol`
- `(DHS) 2024 Prelim Phy P1 Ans_final`
- `ACJC 2025 … P1 Guide`

Classify `answer-key` when `original_name` (with `_` and `.` turned into spaces) or `paper_info` matches `\b(ans(wers?)?|sol(n|ns|ution|utions)?|mark ?scheme|ms|guide|worked)\b`. Otherwise classify `question-paper`. This changes 7 of the 379 P1 rows.

**Combined files.** Some files hold both questions and answers, for example `SAJC 2022 Prelim P1 QP + Guide` and `Questions & Answers`. Treat these as `question-paper` with a `has_inline_answers` hint. The answer key is usually a table on the last pages.

### How QPs and answers are paired

Questions and answers are **almost always separate files**, one entry each. They are linked only by sharing school, year, exam and paper. Build your own key, `school|year|exam|P<n>`, and attach the `question-paper` and `answer-key` entries to it.

Expect duplicates for the same slot:
- About 27 P1 slots have more than one file, such as re-uploads, `_v1`/`_final` versions, or the same paper on both grail.moe and Drive (17 sittings appear in both sources).
- Prefer grail.moe over Drive, then the newest `uploaded_on`. Keep the alternates as fallbacks.

`TYS Answers` entries (CJC "A level H2 Physics Answers", about 69) are answers to the national A-Level papers. They are not school papers, and the corresponding A-Level QPs are mostly not in this index.

## Files and hosting

| source | URL to fetch | notes |
|---|---|---|
| grail.moe | `inline_url` = `https://document.grail.moe/<hex32>.pdf` | Plain 200 `application/pdf` from S3 via CloudFront, `cache-control: immutable`, ETag. Verified with id 19909 (CJC 2025 Prelim P1, 16 pages, 9749/01, has a text layer). |
| grail.moe | ~~`download_url` = `https://api.grail.moe/note/download/<id>`~~ | **Disallowed by api.grail.moe robots.txt**, which blocks `/note/download` and `/*.pdf`. Do not use it. |
| Drive | `https://drive.google.com/uc?export=download&id=<fileId>` | Returns 303 to `drive.usercontent.google.com/download?...`, then 200 `application/octet-stream` with `content-disposition` carrying the original filename. Verified with ACJC 2011 P1 (17 pages, 9646/01, has a text layer). Large files may get Google's "can't scan for viruses" interstitial (HTML). Check the magic bytes `%PDF` and do not save HTML as `.pdf`. |

**Syllabus codes:** 2011 to 2016 papers are **9646** (the old syllabus, with 40 MCQs over 1 h 15 min). From 2017 they are **9749** (30 MCQs, 1 h). Read the code from page 1 (`9749/01`) and filter or tag by it instead of trusting the year.

## robots.txt summary

| host | rules relevant to us |
|---|---|
| grail-wrapper.vercel.app | `User-agent: *` Allow `/` |
| grail.moe | Allow `/`. Disallows `/account`, `/admin`, `/developer`, `/upload`, `/practice/papers/`, `/practice/lists`, `/hg-sheets/` and similar. We don't need grail.moe pages at all. |
| api.grail.moe | `User-agent: *` **Disallow `/note/download`, `/*.pdf`** |
| document.grail.moe | Blocks named AI and SEO crawlers (GPTBot, CCBot, **ClaudeBot**, anthropic-ai, Bytespider, SemrushBot and others) with `Disallow: /`. `User-agent: *` gets `Allow: /`. |

The document host's opt-out is aimed at AI-training and indexing crawlers. Our use is different: a one-off, user-run download for a personal offline bank, under a generic UA. Even so, keep the volume minimal: P1 files only, each fetched once and cached forever. Make the UA configurable.

## Rate-limit recommendation

- Send one request at a time, with **≥2 s between file downloads** plus jitter. That works out to about 350 P1 files in about 15 min.
- On 429 or 5xx, back off exponentially (30 s, 60 s, 120 s…) and stop after 5 consecutive failures.
- Re-fetch `data.json` at most once per run, as a conditional GET.
- Never fetch `api.grail.moe/note/download`, and never crawl grail.moe HTML.

## Recommended scraper design (`pipeline/`)

1. **Index step.** Conditional GET of `data.json` into `pipeline/cache/grail/data.json`, keeping `data.meta.json` with the ETag and Last-Modified.
2. **Select step (pure, offline).** Filter on `subject == "H2 Physics"`, `doc_type` in {Exam Papers, MYEs/CAs/Other Tests}, and `paper_number == 1` (falling back to name regex). Then normalise school, year, exam and role as above, and write `pipeline/cache/grail/manifest.jsonl`. Each line holds `{key, role, entry_id, source, fetch_url, alternates[]}` and is keyed by `school|year|exam|P1|role`.
3. **Fetch step (idempotent, resumable).** For each manifest row, pick a target path:
   - `pipeline/cache/grail/files/<source>/<id>.pdf`, where `<id>` is the grail id or the Drive fileId.
   - If the file exists and starts with `%PDF`, skip it.
   - Otherwise download to `*.part`, check the magic bytes and that `content-type` is not HTML, then atomically rename.
   - Record `{id, sha256, bytes, fetched_at, http_status, error}` in `pipeline/cache/grail/fetch-log.jsonl`. This is append-only; on restart, rebuild the state from it plus the files on disk.
   - Failed rows are retried on the next run, up to N attempts, and then marked `dead`.
4. **Pair step.** Group by key and choose the best QP and best answer key (grail over Drive, then the newest). Read the cover page to confirm `9749/01` or `9646/01` and "Paper 1 / Multiple Choice". Mismatches, such as a P2 file mislabelled as P1, go to a review list.
5. Content-hash dedupe (sha256) catches the same PDF reached via grail.moe and Drive.

Everything stays under `pipeline/cache/grail/`, which is gitignored by `/pipeline/cache/`. Never commit the PDFs.

## H2 Physics P1 volume (from the 2026-11-19 index)

- 379 P1 entries: 227 from grail.moe and 152 from Drive. They form about 206 sittings: 136 Prelim, 18 Promo, 2 A-Level and 18 other or unclassified.
- About 174 sittings have a QP and about 135 have a QP plus answers.
- 2017+ (9749): about 137 QP sittings and about 112 with answers.

QP sittings by year:

| 2011 | 2013 | 2015 | 2016 | 2017 | 2018 | 2019 | 2020 | 2021 | 2022 | 2023 | 2024 | 2025 | 2026 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 12 | 5 | 7 | 12 | 4 | 20 | 11 | 3 | 12 | 21 | 20 | 18 | 14 | 14 |

At 30 MCQs per 9749 paper, that is about **4,000 candidate questions**, or about 3,300 with answer keys.
