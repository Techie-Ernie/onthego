# Content notice

The question bank is built from school examination papers (JC Preliminary Examinations and similar). Copyright in those papers belongs to the setting schools (and, for syllabus text, SEAB/MOE/UCLES).

How this repo handles it:

- **Raw PDFs never enter git or the deployed site.** `Other JC Prelim 2026/`, `*.zip` and `pipeline/cache/` (scraper downloads, rendered pages, LLM results) are gitignored. Nothing under `public/` is a full paper.
- What *is* committed and served: per-question crops (WebP) and extracted text in `data/` / `public/q-assets/` / `public/bank/`. These are still reproductions of the schools' work.
- Every question records provenance (`appearances[]`: school, year, exam, paper, question number, original file name) and the app shows it on each question ("RI · 2026 Prelim · P1 Q14").
- Explanations are AI-generated and labelled as such.

Recommendations:

1. **Keep the GitHub repo private.** The committed crops are reproductions of the papers.
2. The public Vercel deployment republishes those crops. Before sharing `onthego.vercel.app` beyond yourself or a small study group, decide whether that is acceptable. Options: Vercel password protection / deployment protection, or asking the schools (many share prelims openly between JCs "for sharing", but that is not a licence to republish).
3. Papers marked "for external sharing" were shared between schools for revision. Papers whose folder notes say they're reserved (e.g. "SAJC – P3 will be used for mock") are not MCQ papers and are not ingested.
4. grail-wrapper / grail.moe sources: see `docs/GRAIL.md`. Its PDF host's robots.txt disallows AI crawlers by name; the scraper is written for you to run locally, not for an AI agent to run.
