"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import type { OptionLabel, Question } from "@/lib/types";
import { getQuestions } from "@/lib/bank";
import { store } from "@/lib/store/store";
import { QuestionView } from "@/components/question/QuestionView";
import { Explanation } from "@/components/question/Explanation";
import { ReportButton } from "@/components/question/ReportButton";
import { sourceLine } from "@/subjects/schools";
import { Skeleton } from "@/components/ui/controls";

/** One question on its own (from search, review lists). Try it, then reveal. ?ids= gives prev/next. */
export function QClient() {
  const params = useSearchParams();
  const id = params.get("id");
  const ids = (params.get("ids") ?? "").split(",").filter(Boolean);
  return <QuestionPage key={id} id={id} ids={ids} />;
}

function QuestionPage({ id, ids }: { id: string | null; ids: string[] }) {
  const [q, setQ] = useState<Question | null>(null);
  const [error, setError] = useState("");
  const [chosen, setChosen] = useState<OptionLabel | null>(null);
  const [reveal, setReveal] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    getQuestions([id]).then(([question]) => {
      if (cancelled) return;
      if (question) setQ(question);
      else setError("This question is no longer in the bank.");
    }, () => {
      if (!cancelled) setError("Couldn’t load this question. Reconnect to the bank and try again.");
    });
    store().listBookmarks().then((b) => {
      if (!cancelled) setSaved(b.some((x) => x.qid === id));
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [id]);

  if (error || !id) return <div className="flex flex-col items-start gap-3"><h1 className="text-[28px]">Question unavailable</h1><p role="alert">{error || "No question was selected."}</p><Link href="/search" className="btn btn--secondary">Search questions</Link></div>;
  if (!q) return <Skeleton lines={5} />;
  const i = ids.indexOf(q.id);
  const nav = (j: number) => `/q?id=${ids[j]}&ids=${ids.join(",")}`;

  return (
    <div className="flex flex-col gap-5 pb-24">
      <div className="flex items-center justify-between gap-3">
        <h1 className="label min-w-0">{q.appearances.map(sourceLine).join(" · ") || "Question"}</h1>
        <button
          type="button"
          className="chip shrink-0"
          aria-pressed={saved}
          disabled={saving}
          onClick={async () => {
            setSaving(true);
            setSaveError("");
            try {
              await store().setBookmark(q.id, !saved);
              setSaved(!saved);
            } catch {
              setSaveError("Couldn’t update the bookmark.");
            } finally {
              setSaving(false);
            }
          }}
        >
          {saved ? "Saved" : "Save"}
        </button>
      </div>
      {saveError && <p role="alert" className="text-bad">{saveError}</p>}
      <QuestionView q={q} selected={chosen} onSelect={(l) => !reveal && setChosen(l)} reveal={reveal} disabled={reveal} />
      <p aria-live="polite" role="status" className="sr-only">{reveal ? `Correct answer: ${q.answer}` : ""}</p>
      {reveal ? (
        <>
          <Explanation q={q} chosen={chosen} />
          <ReportButton qid={q.id} />
        </>
      ) : (
        <button type="button" className="btn btn--primary" onClick={() => setReveal(true)}>
          {chosen ? "Check" : "Show answer"}
        </button>
      )}
      {ids.length > 1 && (
        <div className="flex gap-2">
          {i > 0 && <Link href={nav(i - 1)} className="btn btn--secondary">← Previous</Link>}
          {i >= 0 && i < ids.length - 1 && <Link href={nav(i + 1)} className="btn btn--secondary ml-auto">Next →</Link>}
        </div>
      )}
    </div>
  );
}
