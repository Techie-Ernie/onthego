"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import type { Question } from "@/lib/types";
import { getQuestions, loadIndex } from "@/lib/bank";
import { store } from "@/lib/store/store";
import type { Attempt, Quiz } from "@/lib/store/schema";
import { createQuiz, PACE_MS, scoreQuiz } from "@/lib/quiz/session";
import { QuestionView } from "@/components/question/QuestionView";
import { Explanation } from "@/components/question/Explanation";
import { ReportButton } from "@/components/question/ReportButton";
import { Skeleton, Stat, fmtTime, pct } from "@/components/ui/controls";
import { sourceLine } from "@/subjects/schools";
import { topicName } from "@/subjects/topics";

export function ResultsClient() {
  const id = useSearchParams().get("id");
  return <Results key={id} id={id} />;
}

function Results({ id }: { id: string | null }) {
  const router = useRouter();
  const [quiz, setQuiz] = useState<Quiz | null>(null);
  const [questions, setQuestions] = useState<Question[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "wrong">("all");
  const [error, setError] = useState("");
  const [bankUnavailable, setBankUnavailable] = useState(false);
  const [attempts, setAttempts] = useState<Attempt[]>([]);
  const [retryError, setRetryError] = useState("");
  const [retrying, setRetrying] = useState(false);
  const retryLock = useRef(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const s = store();
      const quiz = id ? await s.getQuiz(id) : (await s.listQuizzes()).find((x) => x.status === "finished");
      if (cancelled) return;
      if (quiz?.status !== "finished") {
        setError("Finished quiz not found on this device.");
        return;
      }
      const saved = await s.listAttempts();
      if (cancelled) return;
      setAttempts(saved.filter((a) => a.quizId === quiz.id));
      setQuiz(quiz);
      try {
        const qs = await getQuestions(quiz.qids);
        if (!cancelled) setQuestions(qs);
      } catch {
        if (!cancelled) {
          setBankUnavailable(true);
          setQuestions([]);
        }
      }
    })().catch(() => {
      if (!cancelled) setError("Couldn’t load your saved results.");
    });
    return () => { cancelled = true; };
  }, [id]);

  const byId = useMemo(() => new Map((questions ?? []).map((q) => [q.id, q])), [questions]);
  const savedById = useMemo(() => new Map(attempts.map((a) => [a.qid, a])), [attempts]);
  const score = useMemo(() => (quiz && questions ? scoreQuiz(quiz, questions, attempts) : null), [quiz, questions, attempts]);
  const chapters = useMemo(() => {
    if (!quiz) return [];
    const m = new Map<string, { n: number; c: number }>();
    for (const qid of quiz.qids) {
      const q = savedById.get(qid) ?? byId.get(qid);
      if (!q?.answer) continue;
      const k = q.chapter ?? "";
      const r = m.get(k) ?? { n: 0, c: 0 };
      r.n++;
      if (quiz.answers[qid]?.chosen === q.answer) r.c++;
      m.set(k, r);
    }
    return [...m.entries()].sort((a, b) => a[1].c / a[1].n - b[1].c / b[1].n);
  }, [quiz, byId, savedById]);

  if (error) return <div className="flex flex-col items-start gap-3"><h1 className="text-[28px]">Results unavailable</h1><p role="alert">{error}</p><Link href="/build" className="btn btn--secondary">Build a quiz</Link></div>;
  if (!quiz || !questions || !score) return <div className="pt-6"><Skeleton lines={5} /></div>;

  const wrongIds = quiz.qids.filter((k) => {
    const answer = savedById.get(k)?.answer ?? byId.get(k)?.answer;
    return answer && quiz.answers[k]?.chosen !== answer;
  });
  const shakyIds = quiz.qids.filter((k) => quiz.answers[k]?.guessed || quiz.answers[k]?.unsure);
  const retry = async (ids: string[], label: string) => {
    if (retryLock.current || !ids.length) return;
    retryLock.current = true;
    setRetrying(true);
    setRetryError("");
    try {
      const index = await loadIndex();
      const q = await createQuiz(index, { ...quiz.config, ids, label, pool: "all", minutes: undefined, timer: "off", examPace: false }, null);
      if (q) {
        router.push(`/quiz?id=${q.id}`);
        return;
      }
      setRetryError("None of these questions are still available to retry.");
    } catch {
      setRetryError("Couldn’t start the retry. Try again when the bank is available.");
    }
    retryLock.current = false;
    setRetrying(false);
  };
  const answerTime = quiz.qids.reduce((sum, qid) => sum + (quiz.answers[qid]?.timeMs ?? 0), 0);
  const avg = quiz.qids.length ? answerTime / quiz.qids.length : 0;
  const shown = filter === "wrong" ? wrongIds : quiz.qids;

  return (
    <div className="flex flex-col gap-7 pb-24 pt-2">
      <header className="flex flex-col gap-1">
        <span className="label">{quiz.config.label ?? "Quiz"} · {new Date(quiz.finishedAt ?? quiz.createdAt).toLocaleDateString()}</span>
        <h1 className="text-[40px] leading-none tabular-nums">
          {score.total ? `${score.correct}/${score.total}` : "Results"}
        </h1>
        <p className="m-0 text-muted">{score.total ? `${pct(score.correct, score.total)}% correct` : "No scores available"}{score.answered < score.total ? ` · ${score.total - score.answered} left blank` : ""}</p>
      </header>

      <div className="grid grid-cols-3 gap-4">
        <Stat label="Total time" value={fmtTime(score.timeMs)} />
        <Stat label="Per question" value={fmtTime(avg)} sub={avg > PACE_MS ? "slower than exam pace" : "within exam pace"} />
        <Stat label="Guessed / unsure" value={shakyIds.length} />
      </div>

      <div className="flex flex-wrap gap-2">
        {wrongIds.length > 0 && (
          <button type="button" className="btn btn--primary" disabled={retrying} onClick={() => retry(wrongIds, "Retry wrong")}>
            Retry {wrongIds.length} wrong
          </button>
        )}
        {shakyIds.length > 0 && (
          <button type="button" className="btn btn--secondary" disabled={retrying} onClick={() => retry(shakyIds, "Retry guessed")}>
            Retry guessed/unsure
          </button>
        )}
        <Link href="/build" className="btn btn--secondary">New quiz</Link>
      </div>

      {retryError && <p role="alert" className="text-bad">{retryError}</p>}
      {bankUnavailable ? <p role="status" className="text-muted">Question review is unavailable. Reconnect to load the bank.</p>
        : questions.length < quiz.qids.length && <p role="status" className="text-muted">Some questions are no longer in the bank. Saved scores are included where available.</p>}

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
        {shown.length === 0 && <p className="m-0 text-muted">No incorrect answers to review.</p>}
        <ol className="m-0 flex list-none flex-col gap-2 p-0">
          {shown.map((qid) => {
            const q = byId.get(qid);
            const a = quiz.answers[qid];
            const i = quiz.qids.indexOf(qid);
            if (!q) return <li key={qid} className="card px-4 py-3 text-muted">Q{i + 1} · Question unavailable</li>;
            const answer = savedById.get(qid)?.answer ?? q.answer;
            const reviewed = answer === q.answer ? q : { ...q, answer, explanation: undefined };
            const ok = !!answer && a?.chosen === answer;
            return (
              <li key={qid} className="card min-w-0">
                <button type="button" aria-expanded={open === qid} onClick={() => setOpen(open === qid ? null : qid)} className="flex min-h-14 w-full items-center gap-3 px-4 py-3 text-left">
                  <span className={`grid h-7 w-7 shrink-0 place-items-center rounded-full text-[13px] font-medium ${ok ? "bg-good-soft text-good" : "bg-bad-soft text-bad"}`} aria-label={ok ? "correct" : "incorrect"}>
                    {ok ? "✓" : "✗"}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[15px]">Q{i + 1} · {topicName(q.chapter)}</span>
                    <span className="block text-[12px] text-muted">{q.appearances.map(sourceLine).join(" · ")}</span>
                    <span className="block text-[13px] text-muted">
                      {a?.chosen ? `You: ${a.chosen}` : "Blank"} · Answer {answer ?? "unavailable"} · {fmtTime(a?.timeMs ?? 0)}
                      {a?.guessed ? " · guessed" : a?.unsure ? " · unsure" : ""}
                    </span>
                  </span>
                </button>
                {open === qid && (
                  <div className="flex flex-col gap-4 border-t border-line p-4">
                    <QuestionView q={reviewed} selected={a?.chosen ?? null} reveal disabled />
                    {answer === q.answer ? <Explanation q={q} chosen={a?.chosen} /> : <p className="text-muted">The bank’s current answer key differs from the one used for this quiz.</p>}
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
