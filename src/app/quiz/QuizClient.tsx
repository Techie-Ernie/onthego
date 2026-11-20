"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import type { OptionLabel, Question } from "@/lib/types";
import { getQuestions, questionAssetUrls } from "@/lib/bank";
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
  const router = useRouter();
  const id = useSearchParams().get("id");
  const [quiz, setQuiz] = useState<Quiz | null>(null);
  const [questions, setQuestions] = useState<Question[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [showGrid, setShowGrid] = useState(false);
  const [bookmarks, setBookmarks] = useState<Set<string>>(new Set());
  const [now, setNow] = useState(() => Date.now());
  const [submitting, setSubmitting] = useState(false);
  const shownAt = useRef<number>(Date.now());
  const quizRef = useRef<Quiz | null>(null);
  quizRef.current = quiz;

  // load
  useEffect(() => {
    (async () => {
      const s = store();
      const q = id ? await s.getQuiz(id) : await s.activeQuiz();
      if (!q) return setError("This quiz doesn't exist on this device.");
      if (q.status === "finished") return router.replace(`/results?id=${q.id}`);
      setQuiz(q);
      setBookmarks(new Set((await s.listBookmarks()).map((b) => b.qid)));
      try {
        const qs = await getQuestions(q.qids);
        setQuestions(qs);
        cacheQuizAssets([...new Set(qs.map((x) => `/bank/h2-physics/${x.chapter ?? "_unclassified"}.json`)), ...qs.flatMap(questionAssetUrls)]).catch(() => {});
      } catch {
        setError("Couldn't load these questions. If you're offline, download the topic first (Settings → Offline).");
      }
      // questions already answered in immediate mode stay revealed when resuming
      if (q.config.feedback === "immediate") setChecked(Object.fromEntries(q.qids.filter((x) => q.answers[x]?.answeredAt).map((x) => [x, true])));
    })();
  }, [id, router]);

  const qid = quiz?.qids[quiz.current];
  const q = useMemo(() => questions?.find((x) => x.id === qid) ?? null, [questions, qid]);
  const ans: QuizAnswer | undefined = qid ? quiz?.answers[qid] : undefined;
  const immediate = quiz?.config.feedback === "immediate";
  const revealed = !!(qid && immediate && checked[qid]);

  // time accounting: add visible time to the current question; autosave every change
  const commitTime = useCallback(() => {
    const cur = quizRef.current;
    if (!cur || cur.status !== "active") return cur;
    const k = cur.qids[cur.current];
    const dt = Math.min(Date.now() - shownAt.current, 10 * 60_000); // cap idle gaps
    shownAt.current = Date.now();
    if (!k || dt <= 0) return cur;
    const locked = cur.config.feedback === "immediate" && !!cur.answers[k]?.answeredAt;
    if (locked) return { ...cur, elapsedMs: cur.elapsedMs + dt };
    return { ...setAnswer(cur, k, { timeMs: (cur.answers[k]?.timeMs ?? 0) + dt }), elapsedMs: cur.elapsedMs + dt };
  }, []);

  const save = useCallback(async (next: Quiz) => {
    setQuiz(next);
    await store().putQuiz(next);
  }, []);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    const onHide = () => {
      if (document.visibilityState === "hidden") {
        const c = commitTime();
        if (c) store().putQuiz(c);
      } else shownAt.current = Date.now();
    };
    document.addEventListener("visibilitychange", onHide);
    return () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", onHide);
    };
  }, [commitTime]);

  // prefetch images for the next two questions
  useEffect(() => {
    if (!quiz || !questions) return;
    for (const nq of quiz.qids.slice(quiz.current + 1, quiz.current + 3)) {
      const qq = questions.find((x) => x.id === nq);
      if (qq) for (const u of questionAssetUrls(qq)) new Image().src = u;
    }
  }, [quiz?.current, questions]); // eslint-disable-line react-hooks/exhaustive-deps

  const select = (label: OptionLabel) => {
    if (!quiz || !qid || revealed) return;
    const c = commitTime() ?? quiz;
    save(setAnswer(c, qid, { chosen: c.answers[qid]?.chosen === label && !immediate ? null : label }));
  };
  const toggleFlag = (k: "guessed" | "unsure" | "flagged") => {
    if (!quiz || !qid) return;
    save(setAnswer(quiz, qid, { [k]: !quiz.answers[qid][k] }));
  };
  const check = () => {
    if (!quiz || !qid || !ans?.chosen) return;
    const c = commitTime() ?? quiz;
    setChecked((m) => ({ ...m, [qid]: true }));
    save(setAnswer(c, qid, { answeredAt: Date.now() }));
  };
  const go = (i: number) => {
    if (!quiz) return;
    const c = commitTime() ?? quiz;
    const k = c.qids[c.current];
    const stamped = !immediate && c.answers[k]?.chosen && !c.answers[k].answeredAt ? setAnswer(c, k, { answeredAt: Date.now() }) : c;
    save({ ...stamped, current: Math.max(0, Math.min(c.qids.length - 1, i)) });
    setShowGrid(false);
    window.scrollTo({ top: 0 });
  };
  const submit = async () => {
    if (!quiz || !questions || submitting) return;
    const unanswered = quiz.qids.filter((k) => !quiz.answers[k]?.chosen).length;
    if (unanswered && !confirm(`${unanswered} unanswered. Submit anyway?`)) return;
    setSubmitting(true);
    const c = commitTime() ?? quiz;
    const done = await finishQuiz(c, questions);
    router.replace(`/results?id=${done.id}`);
  };
  const bookmark = async () => {
    if (!qid) return;
    const on = !bookmarks.has(qid);
    await store().setBookmark(qid, on);
    setBookmarks((b) => {
      const n = new Set(b);
      if (on) n.add(qid);
      else n.delete(qid);
      return n;
    });
  };

  // overall countdown: auto-submit at zero
  const remaining = quiz?.timeLimitMs != null ? quiz.timeLimitMs - (quiz.elapsedMs + (now - shownAt.current)) : null;
  useEffect(() => {
    if (remaining != null && remaining <= 0 && !submitting) submit();
  }, [remaining != null && remaining <= 0]); // eslint-disable-line react-hooks/exhaustive-deps

  // keyboard: 1–4 / a–d select, Enter = check/next, ←/→ navigate
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (error || !quiz || !questions || !q) return; // `primary` only exists once the quiz has rendered
      if (e.target instanceof HTMLElement && /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
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
        <p>{error}</p>
        <Link href="/build" className="btn btn--primary self-start">Build a quiz</Link>
      </div>
    );
  if (!quiz || !questions || !q || !qid) return <div className="pt-6"><Skeleton lines={5} /></div>;

  const last = quiz.current === quiz.qids.length - 1;
  const answeredCount = quiz.qids.filter((k) => quiz.answers[k]?.chosen).length;
  const qTime = (ans?.timeMs ?? 0) + (revealed ? 0 : now - shownAt.current);
  const primary = () => {
    if (immediate && !revealed) return ans?.chosen ? check() : undefined;
    if (last) return submit();
    go(quiz.current + 1);
  };

  return (
    <div className="flex flex-col gap-5 pb-32">
      {/* top bar */}
      <header className="sticky top-0 z-10 -mx-4 flex flex-col gap-2 border-b border-line bg-bg/95 px-4 pb-2 pt-3 backdrop-blur">
        <div className="flex items-center gap-3">
          <Link
            href="/"
            aria-label="Leave quiz (progress is saved)"
            className="grid h-11 w-11 place-items-center rounded-full text-[22px] leading-none hover:bg-surface"
            onClick={() => {
              const c = commitTime();
              if (c) store().putQuiz(c);
            }}
          >
            ×
          </Link>
          <button type="button" className="flex-1 text-left font-mono text-[15px] tabular-nums" onClick={() => setShowGrid((s) => !s)} aria-expanded={showGrid}>
            {quiz.current + 1} / {quiz.qids.length}
            <span className="ml-2 text-muted">· {answeredCount} answered</span>
          </button>
          {remaining != null && (
            <span role="timer" aria-label="Time left" className={`font-mono text-[15px] tabular-nums ${remaining < 60_000 ? "text-bad" : ""}`}>
              {fmtTime(remaining)}
            </span>
          )}
          <button type="button" aria-pressed={bookmarks.has(qid)} aria-label="Bookmark" onClick={bookmark} className="grid h-11 w-11 place-items-center rounded-full hover:bg-surface">
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
        <nav aria-label="Jump to question" className="card grid grid-cols-6 gap-2 p-3 sm:grid-cols-10">
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

      <QuestionView q={q} selected={ans?.chosen ?? null} onSelect={select} reveal={revealed} disabled={revealed} />

      {/* confidence marks: feed the mistake book and SM-2 grading */}
      {!revealed && (
        <div className="flex flex-wrap gap-2" aria-label="Mark this question">
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
        </div>
      )}

      {revealed && (
        <>
          <Explanation q={q} chosen={ans?.chosen} />
          <ReportButton key={qid} qid={qid} />
        </>
      )}

      {/* bottom action bar (thumb zone) */}
      <div className="fixed inset-x-0 bottom-0 z-10 border-t border-line bg-bg/95 pb-[var(--safe-b)] backdrop-blur">
        <div className="mx-auto flex max-w-[720px] gap-2 px-4 py-3">
          <button type="button" className="btn btn--secondary" onClick={() => go(quiz.current - 1)} disabled={quiz.current === 0} aria-label="Previous question">
            ←
          </button>
          {!immediate && !last && (
            <button type="button" className="btn btn--secondary" onClick={submit} disabled={submitting}>
              Submit
            </button>
          )}
          <button type="button" className="btn btn--primary flex-1" onClick={primary} disabled={submitting || (immediate && !revealed && !ans?.chosen)}>
            {immediate && !revealed ? "Check" : last ? (submitting ? "Saving…" : "Finish") : "Next"}
          </button>
        </div>
      </div>
    </div>
  );
}
