"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import type { OptionLabel, Question } from "@/lib/types";
import { getQuestions, loadIndex, questionAssetUrls } from "@/lib/bank";
import { cacheQuizAssets } from "@/lib/offline";
import { store } from "@/lib/store/store";
import type { Quiz, QuizAnswer } from "@/lib/store/schema";
import { finishQuiz, PACE_MS, setAnswer } from "@/lib/quiz/session";
import { QuestionView } from "@/components/question/QuestionView";
import { Explanation } from "@/components/question/Explanation";
import { ReportButton } from "@/components/question/ReportButton";
import { Skeleton, fmtTime } from "@/components/ui/controls";

const LABELS: OptionLabel[] = ["A", "B", "C", "D"];

export function QuizClient() {
  const id = useSearchParams().get("id");
  return <QuizRun key={id} id={id} />;
}

function QuizRun({ id }: { id: string | null }) {
  const router = useRouter();
  const [quiz, setQuiz] = useState<Quiz | null>(null);
  const [questions, setQuestions] = useState<Question[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showGrid, setShowGrid] = useState(false);
  const [bookmarks, setBookmarks] = useState<Set<string>>(new Set());
  const [now, setNow] = useState(() => Date.now());
  const [submitting, setSubmitting] = useState(false);
  const [bookmarkError, setBookmarkError] = useState("");
  const [saveError, setSaveError] = useState("");
  const [submitFailed, setSubmitFailed] = useState(false);
  const shownAt = useRef<number | null>(null);
  const quizRef = useRef<Quiz | null>(null);
  const submitLock = useRef(false);
  const pendingSave = useRef(Promise.resolve());

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const s = store();
      const quiz = id ? await s.getQuiz(id) : await s.activeQuiz();
      if (cancelled) return;
      if (quiz?.status === "finished") return router.replace(`/results?id=${quiz.id}`);
      if (!quiz || quiz.status !== "active") {
        setError("This quiz is no longer active on this device.");
        return;
      }
      const index = await loadIndex();
      const [qs, marks] = await Promise.all([getQuestions(quiz.qids, index), s.listBookmarks()]);
      if (cancelled) return;
      if (!qs.length || qs.length !== quiz.qids.length || !qs[quiz.current]) {
        setError("Some questions in this quiz are no longer available. Build a new quiz to continue.");
        return;
      }
      quizRef.current = quiz;
      const time = Date.now();
      shownAt.current = document.visibilityState === "hidden" ? null : time;
      setNow(time);
      setQuiz(quiz);
      setQuestions(qs);
      setBookmarks(new Set(marks.map((b) => b.qid)));
      const ids = new Set(quiz.qids);
      const shards = new Set(index.questions.filter((entry) => ids.has(entry.id)).map((entry) => entry.shard));
      cacheQuizAssets([...Array.from(shards, (shard) => `/bank/h2-physics/${shard}.json`), ...qs.flatMap(questionAssetUrls)]).catch(() => {});
    })().catch(() => {
      if (!cancelled) setError("Couldn't open this quiz. If you're offline, reconnect to load its questions.");
    });
    return () => { cancelled = true; };
  }, [id, router]);

  const qid = quiz?.qids[quiz.current];
  const q = useMemo(() => questions?.find((x) => x.id === qid) ?? null, [questions, qid]);
  const ans: QuizAnswer | undefined = qid ? quiz?.answers[qid] : undefined;
  const immediate = quiz?.config.feedback === "immediate";
  const revealed = !!(immediate && ans?.answeredAt);

  const commitTime = useCallback(() => {
    const cur = quizRef.current;
    const start = shownAt.current;
    if (!cur || start == null) return cur;
    const time = Date.now();
    shownAt.current = time;
    const dt = Math.max(0, Math.min(time - start, (cur.timeLimitMs ?? Infinity) - cur.elapsedMs));
    const k = cur.qids[cur.current];
    if (!k || dt === 0) return cur;
    const locked = cur.config.feedback === "immediate" && !!cur.answers[k]?.answeredAt;
    const next = locked ? cur : setAnswer(cur, k, { timeMs: (cur.answers[k]?.timeMs ?? 0) + dt });
    return { ...next, elapsedMs: cur.elapsedMs + dt };
  }, []);

  const save = useCallback((next: Quiz) => {
    quizRef.current = next;
    setQuiz(next);
    setNow(Date.now());
    pendingSave.current = pendingSave.current.then(async () => {
      try {
        await store().putQuiz(next);
        setSaveError("");
      } catch {
        setSaveError("Couldn't save progress on this device. Keep this quiz open and try again.");
      }
    });
  }, []);

  useEffect(() => {
    const checkpoint = () => {
      if (submitLock.current) return;
      const next = commitTime();
      if (next && next !== quizRef.current) save(next);
    };
    const pause = () => {
      checkpoint();
      shownAt.current = null;
    };
    const resume = () => {
      if (quizRef.current && !submitLock.current && document.visibilityState !== "hidden") {
        shownAt.current ??= Date.now();
        setNow(Date.now());
      }
    };
    const onVisibility = () => document.visibilityState === "hidden" ? pause() : resume();
    const tick = setInterval(() => setNow(Date.now()), 250);
    const autosave = setInterval(checkpoint, 5000);
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", pause);
    window.addEventListener("pageshow", resume);
    return () => {
      pause();
      clearInterval(tick);
      clearInterval(autosave);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", pause);
      window.removeEventListener("pageshow", resume);
    };
  }, [commitTime, save]);

  // prefetch images for the next two questions
  useEffect(() => {
    if (!quiz || !questions) return;
    for (const nq of quiz.qids.slice(quiz.current + 1, quiz.current + 3)) {
      const qq = questions.find((x) => x.id === nq);
      if (qq) for (const u of questionAssetUrls(qq)) new Image().src = u;
    }
  }, [quiz?.current, questions]); // eslint-disable-line react-hooks/exhaustive-deps

  const select = (label: OptionLabel | null) => {
    if (submitLock.current || submitFailed || !qid || revealed) return;
    const c = commitTime();
    if (c) save(setAnswer(c, qid, { chosen: label, answeredAt: immediate || !label ? undefined : Date.now() }));
  };
  const toggleFlag = (k: "guessed" | "unsure" | "flagged") => {
    const c = quizRef.current;
    if (submitLock.current || submitFailed || !c || !qid) return;
    save(setAnswer(c, qid, { [k]: !c.answers[qid]?.[k] }));
  };
  const check = () => {
    if (submitLock.current || !qid || revealed || !quizRef.current?.answers[qid]?.chosen) return;
    const c = commitTime();
    if (c) save(setAnswer(c, qid, { answeredAt: Date.now() }));
  };
  const go = (i: number) => {
    if (submitLock.current || submitFailed) return;
    const c = commitTime();
    if (!c) return;
    save({ ...c, current: Math.max(0, Math.min(c.qids.length - 1, i)) });
    setShowGrid(false);
    window.scrollTo({ top: 0, behavior: "instant" });
  };
  const submit = useCallback(async (automatic = false) => {
    const current = quizRef.current;
    if (!current || !questions || submitLock.current) return;
    const unanswered = current.qids.filter((k) => !current.answers[k]?.chosen).length;
    if (!automatic && unanswered && !confirm(`${unanswered} unanswered. Submit anyway?`)) return;
    submitLock.current = true;
    setSubmitting(true);
    setSubmitFailed(false);
    const next = commitTime() ?? current;
    shownAt.current = null;
    save(next);
    try {
      await pendingSave.current;
      const done = await finishQuiz(next, questions);
      quizRef.current = done;
      router.replace(`/results?id=${done.id}`);
    } catch {
      setSubmitFailed(true);
      setSubmitting(false);
      submitLock.current = false;
    }
  }, [commitTime, questions, router, save]);
  const bookmark = async () => {
    if (!qid) return;
    setBookmarkError("");
    const on = !bookmarks.has(qid);
    try {
      await store().setBookmark(qid, on);
    } catch {
      setBookmarkError("Couldn’t update the bookmark.");
      return;
    }
    setBookmarks((b) => {
      const n = new Set(b);
      if (on) n.add(qid);
      else n.delete(qid);
      return n;
    });
  };

  const liveMs = shownAt.current == null ? 0 : Math.max(0, now - shownAt.current);
  const remaining = quiz?.timeLimitMs != null ? quiz.timeLimitMs - quiz.elapsedMs - liveMs : null;
  const expired = remaining != null && remaining <= 0;
  useEffect(() => {
    if (expired && !submitFailed) void submit(true);
  }, [expired, submit, submitFailed]);

  // keyboard: 1–4 / a–d select, Enter = check/next, ←/→ navigate
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (error || !quiz || !questions || !q || document.querySelector("dialog[open]")) return; // `primary` only exists once the quiz has rendered
      if (e.target instanceof HTMLElement && e.target.closest("a, button, input, textarea, select, [contenteditable]")) return;
      const k = e.key.toLowerCase();
      const idx = ["1", "2", "3", "4"].indexOf(k) >= 0 ? Number(k) - 1 : ["a", "b", "c", "d"].indexOf(k);
      if (idx >= 0 && !e.metaKey && !e.ctrlKey) select(LABELS[idx]);
      else if (e.key === "Enter") primary();
      else if (e.key === "ArrowRight" && quiz) go(quiz.current + 1);
      else if (e.key === "ArrowLeft" && quiz) go(quiz.current - 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (error)
    return (
      <div className="flex flex-col gap-4 pt-6">
        <h1 className="text-[28px]">Quiz unavailable</h1>
        <p role="alert">{error}</p>
        <Link href="/build" className="btn btn--primary self-start">Build a quiz</Link>
      </div>
    );
  if (!quiz || !questions || !q || !qid) return <div className="pt-6"><Skeleton lines={5} /></div>;

  const last = quiz.current === quiz.qids.length - 1;
  const answeredCount = quiz.qids.filter((k) => quiz.answers[k]?.chosen).length;
  const qTime = (ans?.timeMs ?? 0) + (revealed ? 0 : liveMs);
  const primary = () => {
    if (submitFailed) return submit(true);
    if (immediate && !revealed && ans?.chosen) return check();
    if (last) return submit();
    go(quiz.current + 1);
  };

  return (
    <div className="flex flex-col gap-5 pb-32">
      <h1 className="sr-only">Quiz</h1>
      {/* top bar */}
      <header className="sticky top-0 z-10 -mx-4 sm:-mx-6 flex flex-col gap-2 border-b border-line bg-bg/95 px-4 pb-2 pt-3 backdrop-blur">
        <div className="flex items-center gap-3">
          <Link
            href="/"
            aria-label="Leave quiz (progress is saved)"
            className="grid h-11 w-11 shrink-0 place-items-center rounded-full text-[22px] leading-none hover:bg-surface"
            onClick={() => {
              const c = commitTime();
              if (c && !submitLock.current) save(c);
            }}
          >
            ×
          </Link>
          <button type="button" className="min-h-11 flex-1 text-left font-mono text-[15px] tabular-nums" onClick={() => setShowGrid((s) => !s)} aria-expanded={showGrid} aria-label={`Question ${quiz.current + 1} of ${quiz.qids.length}, ${answeredCount} answered. Question list`}>
            {quiz.current + 1} / {quiz.qids.length}
            <span className="ml-2 text-muted">· {answeredCount} answered</span>
          </button>
          {remaining != null && (
            <span role="timer" aria-label="Time left" className={`font-mono text-[15px] tabular-nums ${remaining < 60_000 ? "text-bad" : ""}`}>
              {fmtTime(remaining)}
            </span>
          )}
          <button type="button" aria-pressed={bookmarks.has(qid)} aria-label="Bookmark" onClick={bookmark} className="grid h-11 w-11 shrink-0 place-items-center rounded-full hover:bg-surface">
            <svg width="20" height="20" viewBox="0 0 24 24" fill={bookmarks.has(qid) ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
              <path d="M6 3h12v18l-6-4-6 4z" />
            </svg>
          </button>
        </div>
        <div className="h-1 overflow-hidden rounded-full bg-surface" aria-hidden="true">
          <div className="h-full bg-ink transition-[width] duration-300" style={{ width: `${((quiz.current + 1) / quiz.qids.length) * 100}%` }} />
        </div>
        {quiz.config.timer === "per-question" && !revealed && (
          <div className="flex items-center gap-2" aria-label={`Time on this question ${fmtTime(qTime)}, pace ${fmtTime(PACE_MS)}`}>
            <div className="h-1 flex-1 overflow-hidden rounded-full bg-surface">
              <div className={`h-full ${qTime > PACE_MS ? "bg-bad" : "bg-action"}`} style={{ width: `${Math.min(100, (qTime / PACE_MS) * 100)}%` }} />
            </div>
            <span className="font-mono text-[12px] tabular-nums text-muted">{fmtTime(qTime)}</span>
          </div>
        )}
      </header>

      {showGrid && (
        <nav aria-label="Jump to question" className="card grid grid-cols-5 gap-2 p-3 sm:grid-cols-10">
          {quiz.qids.map((k, i) => {
            const a = quiz.answers[k];
            return (
              <button
                key={k}
                type="button"
                onClick={() => go(i)}
                aria-current={i === quiz.current ? "true" : undefined}
                aria-label={`Question ${i + 1}${a?.chosen ? ", answered" : ""}${a?.flagged ? ", flagged" : ""}`}
                className={`relative h-11 rounded-md border font-mono text-[14px] ${i === quiz.current ? "border-ink" : "border-line"} ${a?.chosen ? "bg-surface" : "bg-card"}`}
              >
                {i + 1}
                {a?.flagged && <span aria-hidden="true" className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-action" />}
              </button>
            );
          })}
        </nav>
      )}

      <QuestionView q={q} selected={ans?.chosen ?? null} onSelect={select} reveal={revealed} disabled={revealed || submitting || submitFailed || expired} />

      {/* confidence marks: feed the mistake book and SM-2 grading */}
      {!revealed && !submitFailed && !expired && (
        <div className="flex flex-wrap gap-2" role="group" aria-label="Mark this question">
          {(
            [
              ["unsure", "Unsure"],
              ["guessed", "Guessed"],
              ["flagged", "Flag for later"],
            ] as const
          ).map(([k, label]) => (
            <button key={k} type="button" aria-pressed={!!ans?.[k]} onClick={() => toggleFlag(k)} className="chip">
              {label}
            </button>
          ))}
          {!immediate && ans?.chosen && <button type="button" className="chip" onClick={() => select(null)}>Clear answer</button>}
        </div>
      )}

      <p aria-live="polite" role="status" className="sr-only">
        {revealed ? (ans?.chosen === q.answer ? `Correct, ${q.answer}` : `Correct answer: ${q.answer}. You chose ${ans?.chosen}.`) : ""}
      </p>
      {bookmarkError && <p role="alert" className="text-bad">{bookmarkError}</p>}
      {(submitFailed || saveError) && <p role="alert" className="text-bad">{submitFailed ? "Couldn’t finish this quiz. Retry submission to save your results." : saveError}</p>}

      {revealed && (
        <>
          <Explanation q={q} chosen={ans?.chosen} />
          <ReportButton key={qid} qid={qid} />
        </>
      )}

      {/* bottom action bar (thumb zone) */}
      <div className="quiz-actions fixed inset-x-0 bottom-0 z-10 border-t border-line bg-bg/95 pb-[var(--safe-b)] backdrop-blur">
        <div className="mx-auto flex max-w-[720px] gap-2 px-4 py-3">
          <button type="button" className="btn btn--secondary" onClick={() => go(quiz.current - 1)} disabled={quiz.current === 0 || submitting || submitFailed || expired} aria-label="Previous question">
            ←
          </button>
          {!immediate && !last && !submitFailed && (
            <button type="button" className="btn btn--secondary" onClick={() => submit()} disabled={submitting}>
              Submit
            </button>
          )}
          <button type="button" className="btn btn--primary flex-1" onClick={primary} disabled={submitting || (expired && !submitFailed)}>
            {submitting ? "Saving…" : submitFailed ? "Retry submission" : immediate && !revealed && ans?.chosen ? "Check" : last ? "Finish" : "Next"}
          </button>
        </div>
      </div>
    </div>
  );
}
