"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { useBank, useIndexMap, useUserData } from "@/lib/hooks";
import { acc, analyse, insightCards, type Cell } from "@/lib/insights";
import { Empty, Skeleton, Stat, fmtTime, pct } from "@/components/ui/controls";
import { SECTIONS, topicName } from "@/subjects/topics";
import { activeSubject } from "@/subjects";
import { PACE_MS } from "@/lib/quiz/session";

const typeName = (id: string) => activeSubject.questionTypes.find((t) => t.id === id)?.short ?? id;

/** Sequential single-hue scale on the ink colour: light = low accuracy... dark = high. Text stays in ink tokens. */
function heatStyle(c: Cell | undefined) {
  if (!c || !c.n) return { background: "transparent" };
  const a = acc(c);
  return { background: `color-mix(in oklab, var(--ink) ${Math.round(8 + a * 72)}%, var(--card))`, color: a > 0.55 ? "var(--bg)" : "var(--ink)" };
}

export function InsightsClient() {
  const { index, error } = useBank();
  const map = useIndexMap(index);
  const { data, error: localError } = useUserData();
  const [table, setTable] = useState(false);

  const r = useMemo(() => (data && index ? analyse(data.attempts, map) : null), [data, index, map]);
  const cards = useMemo(() => (r ? insightCards(r, { chapter: (id) => topicName(id), type: (id) => activeSubject.questionTypes.find((t) => t.id === id)?.name ?? id }, PACE_MS) : []), [r]);
  const coverage = useMemo(() => {
    if (!index || !data) return {} as Record<string, { seen: number; total: number }>;
    const m: Record<string, { seen: number; total: number }> = {};
    for (const q of index.questions) {
      if (q.status !== "published" || !q.chapter) continue;
      const e = (m[q.chapter] ??= { seen: 0, total: 0 });
      e.total++;
      if (data.stats[q.id]?.seen) e.seen++;
    }
    return m;
  }, [index, data]);

  if (error || localError) return <p role="alert">{error || localError}</p>;
  if (!r || !data) return <Skeleton lines={6} />;
  if (r.overall.n === 0)
    return (
      <div className="flex flex-col gap-6">
        <h1 className="text-[28px] leading-tight">Insights</h1>
        <Empty title="No answers yet" action={<Link href="/build?n=10&start=1" className="btn btn--primary mt-2">Start a quick 10</Link>}>
          Do a few quizzes and this page will show which chapters and question types need work, the traps you keep falling for, and your pace.
        </Empty>
        <Link href="/trends" className="tap-target text-[15px] underline underline-offset-4">Meanwhile: what the prelim papers test most →</Link>
      </div>
    );

  const chapterRows = SECTIONS.flatMap((s) => s.topicIds).filter((t) => r.byChapter[t]);
  const typeCols = activeSubject.questionTypes.map((t) => t.id).filter((t) => r.byType[t]);
  const days = Array.from({ length: 28 }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - (27 - i));
    const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    return { k, d, c: r.days[k] };
  });
  const maxDay = Math.max(1, ...days.map((x) => x.c?.n ?? 0));

  return (
    <div className="flex flex-col gap-8 pb-24">
      <header className="flex flex-col gap-1">
        <h1 className="text-[28px] leading-tight">Insights</h1>
        <p className="m-0 text-muted">From {r.overall.n} answers on this device.</p>
      </header>

      <div className="grid grid-cols-3 gap-4">
        <Stat label="Accuracy" value={`${pct(r.overall.correct, r.overall.n)}%`} />
        <Stat label="Avg time" value={fmtTime(r.overall.timeMs / r.overall.n)} sub={`pace ${fmtTime(PACE_MS)}`} />
        <Stat label="Due" value={data.dueCount} sub="reviews today" />
      </div>

      {cards.length > 0 ? (
        <section className="flex flex-col gap-2" aria-label="Insights">
          {cards.map((c) => (
            <article key={c.id} className="card flex flex-col gap-2 p-4">
              <div className="flex items-start gap-3">
                <span aria-hidden="true" className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${c.tone === "bad" ? "bg-bad" : c.tone === "good" ? "bg-good" : "bg-muted"}`} />
                <div className="flex min-w-0 flex-col gap-1">
                  <h2 className="m-0 text-[17px] font-medium">{c.title}</h2>
                  <p className="m-0 text-[15px] text-ink-2">{c.body}</p>
                </div>
              </div>
              {c.drill && (
                <Link href={`/build?${c.drill}&start=1`} className="btn btn--secondary self-start">
                  Drill 10
                </Link>
              )}
            </article>
          ))}
        </section>
      ) : (
        <p className="m-0 text-muted">Answer a few more questions (at least 5) for personalised insights.</p>
      )}

      <section className="flex flex-col gap-3">
        <div className="flex items-baseline justify-between">
          <h2 className="label">Chapter × question type (accuracy)</h2>
          <button type="button" className="tap-target text-[14px] underline underline-offset-4" aria-expanded={table} onClick={() => setTable((t) => !t)}>
            {table ? "Show heatmap" : "Show as table"}
          </button>
        </div>
        {table ? (
          <table className="w-full border-collapse text-[14px]">
            <thead>
              <tr className="text-left text-muted">
                <th className="py-2 font-medium">Chapter</th>
                <th className="py-2 text-right font-medium">Answered</th>
                <th className="py-2 text-right font-medium">Correct</th>
                <th className="py-2 text-right font-medium">Avg time</th>
              </tr>
            </thead>
            <tbody>
              {chapterRows.map((ch) => {
                const c = r.byChapter[ch];
                return (
                  <tr key={ch} className="border-t border-line">
                    <td className="py-2">{topicName(ch)}</td>
                    <td className="py-2 text-right font-mono tabular-nums">{c.n}</td>
                    <td className="py-2 text-right font-mono tabular-nums">{pct(c.correct, c.n)}%</td>
                    <td className="py-2 text-right font-mono tabular-nums">{fmtTime(c.timeMs / c.n)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : (
          <div className="-mx-4 min-w-0 overflow-x-auto px-4" tabIndex={0} role="region" aria-label="Chapter and question type accuracy table">
            <table className="border-separate border-spacing-[2px] text-[12px]">
              <thead>
                <tr>
                  <th className="sticky left-0 bg-bg" />
                  {typeCols.map((t) => (
                    <th key={t} scope="col" className="h-20 w-10 align-bottom font-medium text-muted">
                      <span className="inline-block -rotate-60 whitespace-nowrap">{typeName(t)}</span>
                    </th>
                  ))}
                  <th scope="col" className="px-2 align-bottom font-medium text-muted">All</th>
                </tr>
              </thead>
              <tbody>
                {chapterRows.map((ch) => (
                  <tr key={ch}>
                    <th scope="row" className="sticky left-0 max-w-[132px] truncate bg-bg pr-2 text-left font-normal text-ink-2">
                      <Link href={`/build?chapter=${ch}`} className="tap-target hover:underline">{topicName(ch)}</Link>
                    </th>
                    {typeCols.map((t) => {
                      const c = r.heat[ch]?.[t];
                      return (
                        <td
                          key={t}
                          title={c ? `${topicName(ch)} · ${typeName(t)}: ${c.correct}/${c.n} correct` : `${topicName(ch)} · ${typeName(t)}: none yet`}
                          aria-label={c ? `${typeName(t)}: ${pct(c.correct, c.n)}% of ${c.n}` : `${typeName(t)}: none`}
                          className={`h-10 w-10 rounded-[4px] text-center font-mono tabular-nums ${c ? "" : "border border-dashed border-line"}`}
                          style={heatStyle(c)}
                        >
                          {c ? pct(c.correct, c.n) : ""}
                        </td>
                      );
                    })}
                    <td className="px-2 text-right font-mono tabular-nums">{pct(r.byChapter[ch].correct, r.byChapter[ch].n)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="flex items-center gap-2 text-[12px] text-muted" aria-hidden="true">
          <span>0%</span>
          <span className="h-2 w-28 rounded-full" style={{ background: "linear-gradient(90deg, color-mix(in oklab, var(--ink) 8%, var(--card)), var(--ink))" }} />
          <span>100% correct · dashed = not tried</span>
        </div>
      </section>

      {r.traps.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="label">Traps you fell for</h2>
          <ul className="m-0 flex list-none flex-col gap-2 p-0">
            {r.traps.slice(0, 6).map((t) => (
              <li key={t.text} className="flex items-start justify-between gap-3 text-[15px]">
                <Link href={`/q?id=${t.qids[0]}&ids=${t.qids.join(",")}`} className="tap-target min-w-0 hover:underline">{t.text}</Link>
                <span className="font-mono text-[13px] text-muted">×{t.count}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="flex flex-col gap-2">
        <h2 className="label">By difficulty</h2>
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {[1, 2, 3, 4, 5].map((d) => {
            const c = r.byDifficulty[d];
            return (
              <li key={d} className="flex items-center gap-3 text-[14px]">
                <span className="w-20 text-ink-2">Level {d}</span>
                <span className="h-2 flex-1 overflow-hidden rounded-full bg-surface" title={c ? `${c.correct}/${c.n}` : "none"}>
                  {c && <span className="block h-full rounded-full bg-ink" style={{ width: `${pct(c.correct, c.n)}%` }} />}
                </span>
                <span className="w-16 text-right font-mono tabular-nums">{c ? `${pct(c.correct, c.n)}%` : "–"}</span>
              </li>
            );
          })}
        </ul>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="label">Last 28 days</h2>
        <div className="flex h-16 items-end gap-[2px]" role="img" aria-label={`Questions answered per day over the last 28 days; ${days.reduce((n, x) => n + (x.c?.n ?? 0), 0)} in total`}>
          {days.map(({ k, d, c }) => (
            <span
              key={k}
              title={`${d.toLocaleDateString(undefined, { day: "numeric", month: "short" })}: ${c?.n ?? 0} answered${c ? `, ${pct(c.correct, c.n)}% correct` : ""}`}
              className="flex-1 rounded-t-[4px] bg-ink"
              style={{ height: c ? `${Math.max(8, (c.n / maxDay) * 100)}%` : 2, opacity: c ? 1 : 0.15 }}
            />
          ))}
        </div>
      </section>

      <section className="flex flex-col gap-2">
        <h2 className="label">Coverage: questions seen per chapter</h2>
        <ul className="m-0 flex list-none flex-col gap-2 p-0">
          {SECTIONS.flatMap((s) => s.topicIds)
            .filter((t) => coverage[t])
            .map((t) => (
              <li key={t} className="flex items-center gap-3 text-[14px]">
                <span className="min-w-0 flex-1 truncate text-ink-2">{topicName(t)}</span>
                <span className="h-1.5 w-24 overflow-hidden rounded-full bg-surface">
                  <span className="block h-full bg-ink" style={{ width: `${pct(coverage[t].seen, coverage[t].total)}%` }} />
                </span>
                <span className="w-14 text-right font-mono tabular-nums">{coverage[t].seen}/{coverage[t].total}</span>
              </li>
            ))}
        </ul>
      </section>

      <Link href="/trends" className="tap-target text-[15px] font-medium underline underline-offset-4">What the prelim papers test most →</Link>
    </div>
  );
}
