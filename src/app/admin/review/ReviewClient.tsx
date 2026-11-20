"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { OptionLabel, Question, Syllabus } from "@/lib/types";
import { QuestionView } from "@/components/question/QuestionView";

type Override = Record<string, unknown>;
interface Payload {
  questions: Question[];
  overrides: Record<string, Override>;
  report: { totals: Record<string, number>; renderModes: Record<string, number>; flags: Record<string, number> } | null;
  syllabus: Syllabus | null;
}

type View = "flagged" | "sample" | "needs-review" | "image" | "answers" | "all" | "approved";
const VIEWS: { id: View; label: string }[] = [
  { id: "sample", label: "Sample of 10" },
  { id: "flagged", label: "Flagged" },
  { id: "needs-review", label: "Unpublished" },
  { id: "answers", label: "Answer issues" },
  { id: "image", label: "Image mode" },
  { id: "approved", label: "Approved" },
  { id: "all", label: "All" },
];

/** Flags that only describe *why* a question is shown as an image; not by themselves a reason to review. */
const BENIGN = /^(option-[A-D]:low-text|stem:|image-fallback|table-options|option-[A-D]-cell-crop|has-duplicates|unclassified)/;

export function pickSample(qs: Question[]): Question[] {
  const used = new Set<string>();
  const out: Question[] = [];
  const take = (pred: (q: Question) => boolean, n: number) => {
    const schools = new Set(out.map((q) => q.appearances[0].school));
    for (const q of qs) {
      if (n <= 0) break;
      if (used.has(q.id) || !pred(q)) continue;
      if (schools.has(q.appearances[0].school) && qs.some((x) => !used.has(x.id) && pred(x) && !schools.has(x.appearances[0].school))) continue;
      used.add(q.id);
      out.push(q);
      schools.add(q.appearances[0].school);
      n--;
    }
  };
  take((q) => q.renderMode === "mixed" && q.figures.length > 0 && q.optionLayout === "list", 2);
  take((q) => q.optionLayout === "grid", 1);
  take((q) => q.renderMode === "image" && q.flags.includes("image-fallback") && !q.flags.includes("table-options") && q.options.every((o) => !o.image), 1);
  take((q) => q.flags.includes("table-options"), 1);
  take((q) => q.renderMode === "text" && q.stem.includes("$"), 1);
  take((q) => q.renderMode === "text" && !q.stem.includes("$"), 1);
  take((q) => q.flags.includes("shared-context"), 1);
  take((q) => q.flags.includes("options-not-found"), 1);
  take((q) => q.optionLayout === "grid" && q.renderMode === "image", 1);
  take(() => true, 10 - out.length);
  return out.slice(0, 10);
}

export function ReviewClient() {
  const [data, setData] = useState<Payload | null>(null);
  const [view, setView] = useState<View>("sample");
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(0);
  const [busy, setBusy] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [log, setLog] = useState("");

  const load = useCallback(async () => {
    const r = await fetch("/api/admin/bank", { cache: "no-store" });
    setData(await r.json());
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  const list = useMemo(() => {
    if (!data) return [];
    let qs = data.questions;
    if (view === "sample") return pickSample(qs);
    if (view === "flagged") qs = qs.filter((q) => !q.reviewedAt && (q.status !== "published" || q.flags.some((f) => !BENIGN.test(f))));
    if (view === "needs-review") qs = qs.filter((q) => q.status !== "published");
    if (view === "answers") qs = qs.filter((q) => q.flags.some((f) => /answer|disagree/.test(f)));
    if (view === "image") qs = qs.filter((q) => q.renderMode === "image");
    if (view === "approved") qs = qs.filter((q) => q.reviewedAt);
    if (query) qs = qs.filter((q) => q.id.includes(query.toLowerCase()) || q.stemText.toLowerCase().includes(query.toLowerCase()));
    return qs;
  }, [data, view, query]);
  const PER = 10;
  const shown = list.slice(page * PER, page * PER + PER);

  const patch = async (id: string, p: Override | null) => {
    setBusy(id);
    await fetch("/api/admin/override", { method: "POST", body: JSON.stringify({ id, patch: p }) });
    setDirty(true);
    setData((d) => (d ? { ...d, overrides: { ...d.overrides, [id]: p === null ? {} : { ...(d.overrides[id] ?? {}), ...p } } } : d));
    setBusy(null);
  };
  const rebuild = async () => {
    setBusy("rebuild");
    const r = await fetch("/api/admin/rebuild", { method: "POST" });
    const j = await r.json();
    setLog(j.log);
    await load();
    setDirty(false);
    setBusy(null);
  };

  return (
    <div className="fixed inset-0 z-30 overflow-auto bg-bg">
      <div className="mx-auto flex max-w-[1400px] flex-col gap-4 p-4">
        <header className="sticky top-0 z-10 -mx-4 flex flex-wrap items-center gap-3 border-b border-line bg-bg px-4 py-3">
          <h1 className="text-[20px]">Review queue</h1>
          <span className="label">dev only · {data ? `${data.questions.length} questions` : "loading"}</span>
          <div className="flex flex-wrap gap-2">
            {VIEWS.map((v) => (
              <button key={v.id} type="button" className="chip" aria-pressed={view === v.id} onClick={() => (setView(v.id), setPage(0))}>
                {v.label}
              </button>
            ))}
          </div>
          <input
            className="min-h-10 rounded-sm border border-line bg-card px-3 text-[14px]"
            placeholder="Search id or text"
            value={query}
            onChange={(e) => (setQuery(e.target.value), setPage(0))}
            aria-label="Search"
          />
          <span className="label">{list.length} shown</span>
          <button type="button" className="btn btn--primary ml-auto" disabled={busy === "rebuild"} onClick={rebuild}>
            {busy === "rebuild" ? "Rebuilding…" : dirty ? "Rebuild bank (pending changes)" : "Rebuild bank"}
          </button>
        </header>

        {data?.report && view !== "sample" && (
          <p className="label">
            Totals {JSON.stringify(data.report.totals)} · modes {JSON.stringify(data.report.renderModes)}
          </p>
        )}
        {view === "sample" && (
          <p className="measure text-ink-2">
            Ten questions picked to cover the risky cases: figures in the stem, figure options, image fallback, table options, LaTeX text, plain text, shared context and an embedded-image question. Left: the original crop from the PDF. Right: what a student sees, with the key answer highlighted.
          </p>
        )}
        {log && <pre className="max-h-40 overflow-auto rounded-sm border border-line bg-card p-2 text-[12px]">{log}</pre>}

        {shown.map((q) => (
          <ReviewItem key={q.id} q={q} override={data!.overrides[q.id] ?? {}} syllabus={data!.syllabus} busy={busy === q.id} onPatch={(p) => patch(q.id, p)} />
        ))}

        {list.length > PER && (
          <nav className="flex items-center justify-center gap-3 py-4" aria-label="Pages">
            <button className="btn btn--secondary" disabled={page === 0} onClick={() => setPage(page - 1)}>Previous page</button>
            <span className="label">
              {page + 1} / {Math.ceil(list.length / PER)}
            </span>
            <button className="btn btn--secondary" disabled={(page + 1) * PER >= list.length} onClick={() => setPage(page + 1)}>Next page</button>
          </nav>
        )}
      </div>
    </div>
  );
}

function ReviewItem({ q, override, syllabus, busy, onPatch }: { q: Question; override: Override; syllabus: Syllabus | null; busy: boolean; onPatch: (p: Override | null) => void }) {
  const [editing, setEditing] = useState(false);
  const [stem, setStem] = useState(q.stem);
  const [opts, setOpts] = useState<Record<string, string>>(Object.fromEntries(q.options.map((o) => [o.label, o.text ?? ""])));
  const p = q.appearances[0];
  const hasOverride = Object.keys(override).length > 0;

  return (
    <article className="card flex flex-col gap-3 p-4" aria-labelledby={`h-${q.id}`}>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 id={`h-${q.id}`} className="font-mono text-[15px]">{q.id}</h2>
        <span className="label">
          {p.school} · {p.year} {p.exam} · {p.paper} Q{p.questionNumber} · page {p.page} · {p.originalFile}
        </span>
        {q.appearances.length > 1 && <span className="label">also: {q.appearances.slice(1).map((a) => `${a.school} Q${a.questionNumber}`).join(", ")}</span>}
      </div>
      <div className="flex flex-wrap gap-1.5">
        <Tag tone="ink">{q.renderMode}</Tag>
        <Tag tone="ink">{q.optionLayout === "grid" ? "image options" : q.options.some((o) => o.text) ? "text options" : "options in image"}</Tag>
        <Tag tone={q.status === "published" ? "good" : "bad"}>{q.status}</Tag>
        <Tag tone="ink">key {q.answer}</Tag>
        {q.chapter && <Tag tone="ink">{q.chapter}</Tag>}
        {q.reviewedAt && <Tag tone="good">approved</Tag>}
        {hasOverride && <Tag tone="warn">override: {Object.keys(override).join(", ")}</Tag>}
        {q.flags.filter((f) => !/^option-[A-D]:low-text$/.test(f)).map((f) => (
          <Tag key={f} tone={BENIGN.test(f) ? "muted" : "bad"}>{f}</Tag>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <section aria-label="Original" className="flex flex-col gap-2">
          <span className="label">Original (PDF crop)</span>
          <div className="paper overflow-auto p-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={`/api/admin/crop?id=${q.id}&name=full`} alt={`Original ${q.id}`} style={{ width: "100%", height: "auto" }} />
          </div>
        </section>
        <section aria-label="Student view" className="flex flex-col gap-2">
          <span className="label">Student view (key revealed)</span>
          <div className="rounded-lg border border-line bg-bg p-3">
            <QuestionView q={q} reveal selected={null} disabled />
          </div>
        </section>
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t border-line pt-3">
        <button className="btn btn--secondary" disabled={busy || q.renderMode === "image"} onClick={() => onPatch({ renderMode: "image" })}>Switch to image</button>
        <span className="label ml-2">Answer</span>
        {(["A", "B", "C", "D"] as OptionLabel[]).map((l) => (
          <button key={l} className="chip" aria-pressed={q.answer === l || override.answer === l} disabled={busy} onClick={() => onPatch({ answer: l })}>
            {l}
          </button>
        ))}
        <label className="label ml-2" htmlFor={`ch-${q.id}`}>Chapter</label>
        <select
          id={`ch-${q.id}`}
          className="min-h-10 rounded-sm border border-line bg-card px-2 text-[14px]"
          value={(override.chapter as string) ?? q.chapter ?? ""}
          onChange={(e) => onPatch({ chapter: e.target.value || null })}
        >
          <option value="">(unclassified)</option>
          {syllabus?.sections.map((s) => (
            <optgroup key={s.id} label={s.name}>
              {s.topicIds.map((t) => (
                <option key={t} value={t}>{syllabus.topics.find((x) => x.id === t)?.name}</option>
              ))}
            </optgroup>
          ))}
        </select>
        <button className="btn btn--secondary" onClick={() => setEditing(!editing)} disabled={q.renderMode === "image"}>{editing ? "Close editor" : "Edit text"}</button>
        <button className="btn btn--secondary" disabled={busy} onClick={() => onPatch({ status: q.status === "published" ? "needs-review" : "published" })}>
          {q.status === "published" ? "Unpublish" : "Publish"}
        </button>
        {hasOverride && <button className="btn btn--secondary" disabled={busy} onClick={() => onPatch(null)}>Clear override</button>}
        <button className="btn btn--primary ml-auto" disabled={busy} onClick={() => onPatch({ approved: true, reviewedAt: new Date().toISOString().slice(0, 10) })}>Approve</button>
      </div>
      <p className="label -mt-1">Re-crop: switch to image mode for now; precise re-cropping is applied from <code>recrop</code> overrides by the pipeline (see README).</p>

      {editing && (
        <div className="flex flex-col gap-2">
          <label className="label" htmlFor={`stem-${q.id}`}>Stem (use $…$ for LaTeX, blank line between paragraphs)</label>
          <textarea id={`stem-${q.id}`} className="min-h-32 rounded-sm border border-line bg-card p-2 font-mono text-[13px]" value={stem} onChange={(e) => setStem(e.target.value)} />
          {q.optionLayout !== "grid" &&
            (["A", "B", "C", "D"] as const).map((l) => (
              <label key={l} className="flex items-center gap-2">
                <span className="w-6 font-medium">{l}</span>
                <input className="min-h-10 flex-1 rounded-sm border border-line bg-card px-2 font-mono text-[13px]" value={opts[l]} onChange={(e) => setOpts({ ...opts, [l]: e.target.value })} />
              </label>
            ))}
          <button className="btn btn--primary self-start" onClick={() => onPatch({ stem, optionText: q.optionLayout === "grid" ? undefined : opts })}>Save text</button>
        </div>
      )}
    </article>
  );
}

function Tag({ children, tone }: { children: React.ReactNode; tone: "ink" | "good" | "bad" | "warn" | "muted" }) {
  const c = { ink: "border-line text-ink", good: "border-good text-good", bad: "border-bad text-bad", warn: "border-warn text-warn", muted: "border-line text-muted" }[tone];
  return <span className={`rounded-full border px-2 py-0.5 text-[13px] ${c}`}>{children}</span>;
}
