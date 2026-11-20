"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import type { Question } from "@/lib/types";
import { getQuestions, loadIndex } from "@/lib/bank";
import { store } from "@/lib/store/store";
import type { Quiz } from "@/lib/store/schema";
import { createQuiz, scoreQuiz } from "@/lib/quiz/session";
import { QuestionView } from "@/components/question/QuestionView";
import { Explanation } from "@/components/question/Explanation";
import { ReportButton } from "@/components/question/ReportButton";
import { Skeleton, Stat, fmtTime, pct } from "@/components/ui/controls";
import { topicName } from "@/subjects/topics";

export function ResultsClient() {
  const id = useSearchParams().get("id");
  const router = useRouter();
  const [quiz, setQuiz] = useState<Quiz | null>(null);
  const [questions, setQuestions] = useState<Question[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "wrong">("all");
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    (async () => {
      const q = id ? await store().getQuiz(id) : (await store().listQuizzes()).find((x) => x.status === "finished");
      if (!q) return setMissing(true);
      setQuiz(q);
      setQuestions(await getQuestions(q.qids));
    })();
  }, [id]);

  const byId = useMemo(() => new Map((questions ?? []).map((q) => [q.id, q])), [questions]);
  const score = useMemo(() => (quiz && questions ? scoreQuiz(quiz, questions) : null), [quiz, questions]);
  const chapters = useMemo(() => {
    if (!quiz) return [];
    const m = new Map<string, { n: number; c: number }>();
    for (const qid of quiz.qids) {
      const q = byId.get(qid);
      if (!q) continue;
      const k = q.chapter ?? "";
      const r = m.get(k) ?? { n: 0, c: 0 };
      r.n++;
      if (quiz.answers[qid]?.chosen === q.answer) r.c++;
      m.set(k, r);
    }
    return [...m.entries()].sort((a, b) => a[1].c / a[1].n - b[1].c / b[1].n);
  }, [quiz, byId]);

  if (missing) return <p className="pt-6">Quiz not found on this device. <Link href="/build" className="underline">Start a new one</Link>.</p>;
  if (!quiz || !questions || !score) return <div className="pt-6"><Skeleton lines={5} /></div>;

  const wrongIds = quiz.qids.filter((k) => quiz.answers[k]?.chosen !== byId.get(k)?.answer);
  const shakyIds = quiz.qids.filter((k) => quiz.answers[k]?.guessed || quiz.answers[k]?.unsure);
  const retry = async (ids: string[], label: string) => {
    const index = await loadIndex();
    const q = await createQuiz(index, { ...quiz.config, ids, label, pool: "all", minutes: undefined, timer: "off" }, null);
    if (q) router.push(`/quiz?id=${q.id}`);
  };
  const avg = score.total ? score.timeMs / score.total : 0;
  const shown = filter === "wrong" ? wrongIds : quiz.qids;

  return (
    <div className="flex flex-col gap-7 pb-24 pt-2">
      <header className="flex flex-col gap-1">
        <span className="label">{quiz.config.label ?? "Quiz"} · {new Date(quiz.finishedAt ?? quiz.createdAt).toLocaleDateString()}</span>
        <h1 className="text-[40px] leading-none tabular-nums">
          {score.correct}/{score.total}
        </h1>
        <p className="m-0 text-muted">{pct(score.correct, score.total)}% correct{score.answered < score.total ? ` · ${score.total - score.answered} left blank` : ""}</p>
      </header>

      <div className="grid grid-cols-3 gap-4">
        <Stat label="Total time" value={fmtTime(score.timeMs)} />
        <Stat label="Per question" value={fmtTime(avg)} sub={avg > 90_000 ? "slower than exam pace" : "within exam pace"} />
        <Stat label="Guessed / unsure" value={shakyIds.length} />
      </div>

      <div className="flex flex-wrap gap-2">
        {wrongIds.length > 0 && (
          <button type="button" className="btn btn--primary" onClick={() => retry(wrongIds, "Retry wrong")}>
            Retry {wrongIds.length} wrong
          </button>
        )}
        {shakyIds.length > 0 && (
          <button type="button" className="btn btn--secondary" onClick={() => retry(shakyIds, "Retry guessed")}>
            Retry guessed/unsure
          </button>
        )}
        <Link href="/build" className="btn btn--secondary">New quiz</Link>
      </div>

      {chapters.length > 1 && (
        <section className="flex flex-col gap-2">
          <h2 className="label">By chapter</h2>
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {chapters.map(([ch, r]) => (
              <li key={ch} className="flex items-center gap-3">
                <span className="min-w-0 flex-1 truncate text-[15px]">{topicName(ch || null)}</span>
                <span className="h-1.5 w-24 overflow-hidden rounded-full bg-surface" aria-hidden="true">
                  <span className="block h-full bg-ink" style={{ width: `${pct(r.c, r.n)}%` }} />
                </span>
                <span className="w-12 text-right font-mono text-[14px] tabular-nums">{r.c}/{r.n}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h2 className="label">Questions</h2>
          <div className="flex gap-2">
            <button type="button" aria-pressed={filter === "all"} className="chip" onClick={() => setFilter("all")}>All</button>
            <button type="button" aria-pressed={filter === "wrong"} className="chip" onClick={() => setFilter("wrong")}>Wrong ({wrongIds.length})</button>
          </div>
        </div>
        <ol className="m-0 flex list-none flex-col gap-2 p-0">
          {shown.map((qid) => {
            const q = byId.get(qid);
            const a = quiz.answers[qid];
            if (!q) return null;
            const ok = a?.chosen === q.answer;
            const i = quiz.qids.indexOf(qid);
            return (
              <li key={qid} className="card overflow-hidden">
                <button type="button" aria-expanded={open === qid} onClick={() => setOpen(open === qid ? null : qid)} className="flex min-h-14 w-full items-center gap-3 px-4 py-3 text-left">
                  <span className={`grid h-7 w-7 shrink-0 place-items-center rounded-full text-[13px] font-medium ${ok ? "bg-good-soft text-good" : "bg-bad-soft text-bad"}`} aria-label={ok ? "correct" : "incorrect"}>
                    {ok ? "✓" : "✗"}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[15px]">Q{i + 1} · {topicName(q.chapter)}</span>
                    <span className="block text-[13px] text-muted">
                      {a?.chosen ? `You: ${a.chosen}` : "Blank"} · Answer {q.answer} · {fmtTime(a?.timeMs ?? 0)}
                      {a?.guessed ? " · guessed" : a?.unsure ? " · unsure" : ""}
                    </span>
                  </span>
                </button>
                {open === qid && (
                  <div className="flex flex-col gap-4 border-t border-line p-4">
                    <QuestionView q={q} selected={a?.chosen ?? null} reveal disabled />
                    <Explanation q={q} chosen={a?.chosen} />
                    <p className="m-0 text-[12px] text-muted">
                      {q.appearances.map((p) => `${p.school} ${p.year} ${p.exam} P1 Q${p.questionNumber}`).join(" · ")}
                    </p>
                    <ReportButton qid={q.id} />
                  </div>
                )}
              </li>
            );
          })}
        </ol>
      </section>
    </div>
  );
}
