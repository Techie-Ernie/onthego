"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useBank, useUserData } from "@/lib/hooks";
import { store } from "@/lib/store/store";
import type { Quiz } from "@/lib/store/schema";
import { Stat, pct } from "@/components/ui/controls";
import { weakChapters } from "@/lib/quiz/build";
import { topicName } from "@/subjects/topics";

export function HomeClient() {
  const { index, error } = useBank();
  const { data, error: localError } = useUserData();
  const [active, setActive] = useState<Quiz | null>(null);
  const [recent, setRecent] = useState<Quiz[]>([]);
  useEffect(() => {
    store().activeQuiz().then((q) => setActive(q ?? null)).catch(() => {});
    store().listQuizzes().then((l) => setRecent(l.filter((q) => q.status === "finished").slice(0, 3))).catch(() => {});
  }, []);

  const published = index?.questions.filter((q) => q.status === "published").length ?? 0;
  const seen = data ? Object.values(data.stats).filter((s) => s.seen > 0).length : 0;
  const weak = useMemo(() => (data ? [...weakChapters(data.chapters)].slice(0, 2) : []), [data]);
  const today = useMemo(() => {
    if (!data) return 0;
    const d = new Date();
    d.setHours(0, 0, 0, 0);
    return data.attempts.filter((a) => a.at >= d.getTime()).length;
  }, [data]);
  const totals = data ? data.attempts.reduce((m, a) => ({ n: m.n + 1, c: m.c + (a.correct ? 1 : 0) }), { n: 0, c: 0 }) : { n: 0, c: 0 };

  return (
    <div className="flex flex-col gap-6">
      {active && (
        <Link href={`/quiz?id=${active.id}`} className="card flex items-center gap-4 border-ink p-4">
          <span className="min-w-0 flex-1">
            <span className="block text-[17px] font-medium">Continue your quiz</span>
            <span className="block text-[14px] text-muted">
              Question {active.current + 1} of {active.qids.length} · {Object.values(active.answers).filter((a) => a.chosen).length} answered
            </span>
          </span>
          <span aria-hidden="true" className="text-[20px]">→</span>
        </Link>
      )}

      <div className="grid grid-cols-2 gap-2">
        <Link href="/build?n=10&start=1" className="card flex min-h-24 flex-col justify-between p-4">
          <span className="text-[17px] font-medium">Quick 10</span>
          <span className="text-[13px] text-muted">Mixed chapters, ~15 min</span>
        </Link>
        <Link href={data?.dueCount ? `/build?pool=due&n=${Math.min(data.dueCount, 20)}&start=1` : "/mistakes"} className="card flex min-h-24 flex-col justify-between p-4">
          <span className="text-[17px] font-medium">{data?.dueCount ? `Review ${data.dueCount} due` : "Review"}</span>
          <span className="text-[13px] text-muted">{data?.dueCount ? "Spaced repetition" : "Nothing due today"}</span>
        </Link>
        {weak.length > 0 ? (
          <Link href={`/build?${weak.map((w) => `chapter=${w}`).join("&")}&n=10&start=1`} className="card flex min-h-24 flex-col justify-between p-4">
            <span className="text-[17px] font-medium">Weakest topic</span>
            <span className="truncate text-[13px] text-muted">{topicName(weak[0])}</span>
          </Link>
        ) : (
          <Link href="/build?pool=unseen&n=5&start=1" className="card flex min-h-24 flex-col justify-between p-4">
            <span className="text-[17px] font-medium">Quick 5</span>
            <span className="text-[13px] text-muted">Unseen questions</span>
          </Link>
        )}
        <Link href="/build?timer=overall&n=30" className="card flex min-h-24 flex-col justify-between p-4">
          <span className="text-[17px] font-medium">Full paper</span>
          <span className="text-[13px] text-muted">30 questions, 45 min timer</span>
        </Link>
      </div>
      <Link href="/build" className="btn btn--primary btn--block">Build your own quiz</Link>

      <section className="grid grid-cols-3 gap-4 border-t border-line pt-5">
        <Stat label="Today" value={today} sub="answered" />
        <Stat label="Accuracy" value={totals.n ? `${pct(totals.c, totals.n)}%` : "–"} sub={`${totals.n} total`} />
        <Stat label="Bank" value={index ? `${seen}/${published}` : "–"} sub="seen" />
      </section>

      {(error || localError) && <p role="status" className="m-0 text-muted">{error || localError}</p>}

      {recent.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="label">Recent</h2>
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {recent.map((q) => {
              const n = q.qids.length;
              return (
                <li key={q.id}>
                  <Link href={`/results?id=${q.id}`} className="card flex min-h-14 items-center justify-between px-4">
                    <span className="text-[15px]">{q.config.label ?? `${n}-question quiz`}</span>
                    <span className="text-[13px] text-muted">{new Date(q.finishedAt ?? q.createdAt).toLocaleDateString(undefined, { day: "numeric", month: "short" })}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      )}
      <Link href="/search" className="tap-target text-[15px] font-medium underline underline-offset-4">Search questions</Link>
    </div>
  );
}
