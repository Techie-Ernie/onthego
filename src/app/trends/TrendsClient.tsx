"use client";

import Link from "next/link";
import { Empty, Section, Skeleton, Stat, pct } from "@/components/ui/controls";
import { useBank } from "@/lib/hooks";
import type { QuestionIndexEntry } from "@/lib/types";
import { activeSubject } from "@/subjects";
import { SECTIONS, TOPIC_BY_ID, topicName } from "@/subjects/topics";

const sectionNames = new Map(SECTIONS.flatMap(({ name, topicIds }) => topicIds.map((id) => [id, name] as const)));
const numberStyle = "shrink-0 font-mono tabular-nums";

function increment<K>(counts: Map<K, number>, key: K) {
  counts.set(key, (counts.get(key) ?? 0) + 1);
}

function ranked(counts: Map<string, number>) {
  return [...counts].sort(([a, aCount], [b, bCount]) => bCount - aCount || a.localeCompare(b));
}

function summarise(questions: QuestionIndexEntry[]) {
  const chapters = new Map<string, number>();
  const types = new Map<string, number>();
  const difficulty = new Map<number, number>();
  const outcomes = new Map<string, number>();
  const traps = new Map<string, number>();
  const schools = new Map<string, { years: Set<number>; chapters: Map<string, number> }>();
  let total = 0;

  for (const question of questions) {
    if (question.status !== "published") continue;
    total++;

    const chapter = question.chapter;
    if (chapter && sectionNames.has(chapter)) increment(chapters, chapter);
    for (const type of new Set(question.types)) increment(types, type);
    for (const outcome of new Set(question.outcomes)) increment(outcomes, outcome);
    if (question.difficulty != null) increment(difficulty, question.difficulty);
    const trap = question.misconception?.trim();
    if (trap) increment(traps, trap);

    for (const school of new Set(question.schools)) {
      const stats = schools.get(school) ?? { years: new Set<number>(), chapters: new Map<string, number>() };
      for (const year of question.years) stats.years.add(year);
      if (chapter) increment(stats.chapters, chapter);
      schools.set(school, stats);
    }
  }

  return {
    total,
    chapters: ranked(chapters),
    types,
    difficulty,
    outcomes: ranked(outcomes).slice(0, 10),
    traps: ranked(traps).slice(0, 6),
    schools: [...schools].sort(([a], [b]) => a.localeCompare(b)),
    papers: [...schools.values()].reduce((sum, school) => sum + school.years.size, 0),
    papers2026: [...schools.values()].filter((school) => school.years.has(2026)).length,
  };
}

function Bar({ count, total }: { count: number; total: number }) {
  return (
    <span
      aria-hidden="true"
      title={`${count} of ${total} published questions`}
      className="block h-1.5 overflow-hidden rounded-full bg-surface"
    >
      <span className="block h-full rounded-full bg-ink" style={{ width: `${pct(count, total)}%` }} />
    </span>
  );
}

function Distribution({ rows, total }: { rows: { label: string; count: number }[]; total: number }) {
  return (
    <ul className="flex flex-col gap-3">
      {rows.map(({ label, count }) => (
        <li key={label} className="flex flex-col gap-1.5 text-sm">
          <div className="flex justify-between gap-3">
            <span className="min-w-0 text-ink-2">{label}</span>
            <span className={numberStyle}>{count}</span>
          </div>
          <Bar count={count} total={total} />
        </li>
      ))}
    </ul>
  );
}

export function TrendsClient() {
  const { index, error } = useBank();
  const stats = index && summarise(index.questions);
  const topChapters = stats?.chapters.slice(0, 6) ?? [];

  return (
    <div className="flex flex-col gap-8 pb-24">
      <header className="flex flex-col gap-1">
        <h1 className="text-[28px] leading-tight">Bank trends</h1>
        <p className="text-muted">What JC prelim papers test most across the question bank.</p>
      </header>

      {error ? (
        <Empty title="Could not load the question bank" />
      ) : !stats ? (
        <Skeleton />
      ) : (
        <>
          <div className="card grid grid-cols-3 gap-3 p-4">
            <Stat label="Questions" value={stats.total} />
            <Stat label="Schools" value={stats.schools.length} />
            <Stat label="Papers" value={stats.papers} />
          </div>

          {stats.total === 0 ? (
            <Empty title="No published questions yet" />
          ) : (
            <>
              <Section title="Chapters by question count">
                {stats.chapters.length ? (
                  <ol className="flex flex-col divide-y divide-line">
                    {stats.chapters.map(([id, count]) => (
                      <li key={id}>
                        <Link
                          href={`/build?chapter=${encodeURIComponent(id)}`}
                          className="group flex flex-col gap-2 py-2.5"
                        >
                          <div className="flex items-start justify-between gap-3 text-sm">
                            <div className="min-w-0">
                              <span className="block text-ink-2 group-hover:underline group-focus-visible:underline">
                                {topicName(id)}
                              </span>
                              <span className="block text-xs text-muted">{sectionNames.get(id)}</span>
                            </div>
                            <span className={numberStyle}>{count}</span>
                          </div>
                          <Bar count={count} total={stats.total} />
                        </Link>
                      </li>
                    ))}
                  </ol>
                ) : (
                  <p className="text-sm text-muted">No classified chapters yet.</p>
                )}
              </Section>

              <Section title="Question-type mix">
                <p className="text-sm text-muted">A question can have more than one type.</p>
                <Distribution
                  rows={activeSubject.questionTypes.map(({ id, name }) => ({
                    label: name,
                    count: stats.types.get(id) ?? 0,
                  }))}
                  total={stats.total}
                />
              </Section>

              <Section title="Difficulty distribution">
                <Distribution
                  rows={[1, 2, 3, 4, 5].map((level) => ({
                    label: `Level ${level}`,
                    count: stats.difficulty.get(level) ?? 0,
                  }))}
                  total={stats.total}
                />
              </Section>

              <Section title="Most tested learning outcomes">
                {stats.outcomes.length ? (
                  <ol className="flex flex-col gap-3">
                    {stats.outcomes.map(([id, count]) => {
                      const [topicId] = id.split(".");
                      return (
                        <li key={id} className="flex justify-between gap-3 text-sm">
                          <div className="min-w-0 text-ink-2">
                            <span className="block text-xs text-muted">{topicName(topicId)}</span>
                            <span className="wrap-break-word">{TOPIC_BY_ID[topicId]?.outcomes[id] ?? id}</span>
                          </div>
                          <span className={numberStyle}>{count}</span>
                        </li>
                      );
                    })}
                  </ol>
                ) : (
                  <p className="text-sm text-muted">No learning outcomes tagged yet.</p>
                )}
              </Section>

              <Section title="Common traps in the bank">
                {stats.traps.length ? (
                  <ol className="flex flex-col gap-3">
                    {stats.traps.map(([trap, count]) => (
                      <li key={trap} className="flex justify-between gap-3 text-sm">
                        <span className="min-w-0 wrap-break-word text-ink-2">{trap}</span>
                        <span className={numberStyle}>{count}</span>
                      </li>
                    ))}
                  </ol>
                ) : (
                  <p className="text-sm text-muted">No misconceptions tagged yet.</p>
                )}
              </Section>

              <Section title="Per-school chapter emphasis">
                {topChapters.length && stats.schools.length ? (
                  <div className="card min-w-0 overflow-x-auto" tabIndex={0} role="region" aria-label="Per-school chapter emphasis">
                    <table className="w-full min-w-[34rem] table-fixed border-collapse text-xs">
                      <thead className="text-muted">
                        <tr>
                          <th scope="col" className="w-20 px-3 py-2 text-left font-medium">School</th>
                          {topChapters.map(([id]) => (
                            <th key={id} scope="col" className="px-2 py-2 text-right align-bottom font-medium">
                              {topicName(id)}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {stats.schools.map(([school, { chapters }]) => (
                          <tr key={school} className="border-t border-line">
                            <th scope="row" className="wrap-break-word px-3 py-2 text-left font-medium text-ink-2">{school}</th>
                            {topChapters.map(([id]) => (
                              <td key={id} className="px-2 py-2 text-right font-mono tabular-nums">{chapters.get(id) ?? 0}</td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="text-sm text-muted">No school chapter counts available yet.</p>
                )}
              </Section>
            </>
          )}

          <p className="text-sm text-muted">
            Based on <span className={numberStyle}>{stats.papers2026}</span> 2026 prelim Paper 1s. The chapter breakdown excludes unclassified questions.
          </p>
        </>
      )}
    </div>
  );
}
