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
import { Skeleton } from "@/components/ui/controls";

/** One question on its own (from search, review lists). Try it, then reveal. ?ids= gives prev/next. */
export function QClient() {
  const params = useSearchParams();
  const id = params.get("id");
  const ids = (params.get("ids") ?? "").split(",").filter(Boolean);
  const [q, setQ] = useState<Question | null>(null);
  const [missing, setMissing] = useState(false);
  const [chosen, setChosen] = useState<OptionLabel | null>(null);
  const [reveal, setReveal] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!id) return setMissing(true);
    setQ(null);
    setChosen(null);
    setReveal(false);
    getQuestions([id]).then((r) => (r[0] ? setQ(r[0]) : setMissing(true)), () => setMissing(true));
    store().listBookmarks().then((b) => setSaved(b.some((x) => x.qid === id)));
  }, [id]);

  if (missing) return <p className="pt-6">Question not found.</p>;
  if (!q) return <Skeleton lines={5} />;
  const i = ids.indexOf(q.id);
  const nav = (j: number) => `/q?id=${ids[j]}&ids=${ids.join(",")}`;

  return (
    <div className="flex flex-col gap-5 pb-24">
      <div className="flex items-center justify-between gap-3">
        <span className="label">{q.appearances.map((p) => `${p.school} ${p.year} ${p.exam} P1 Q${p.questionNumber}`).join(" · ")}</span>
        <button
          type="button"
          className="chip"
          aria-pressed={saved}
          onClick={async () => {
            await store().setBookmark(q.id, !saved);
            setSaved(!saved);
          }}
        >
          {saved ? "Saved" : "Save"}
        </button>
      </div>
      <QuestionView q={q} selected={chosen} onSelect={(l) => !reveal && setChosen(l)} reveal={reveal} disabled={reveal} />
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
