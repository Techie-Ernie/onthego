"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { useBank, useUserData } from "@/lib/hooks";
import { Empty, Segmented, Skeleton, pct } from "@/components/ui/controls";
import { SECTIONS, topicName } from "@/subjects/topics";
import { isDue } from "@/lib/quiz/srs";

type Tab = "due" | "wrong" | "shaky" | "saved";

/** Mistake book: everything you got wrong, guessed or saved, grouped by chapter, with SM-2 review queue on top. */
export function MistakesClient() {
  const { index } = useBank();
  const { data } = useUserData();
  const [tab, setTab] = useState<Tab>("due");

  const groups = useMemo(() => {
    if (!index || !data) return null;
    const byId = new Map(index.questions.map((q) => [q.id, q]));
    const lastAttempt = new Map<string, (typeof data.attempts)[number]>();
    for (const a of data.attempts) lastAttempt.set(a.qid, a);
    const now = Date.now();
    const ids = new Set<string>();
    if (tab === "due") data.srs.filter((c) => isDue(c, now)).forEach((c) => ids.add(c.qid));
    if (tab === "wrong") for (const [k, s] of Object.entries(data.stats)) if (s.wrong > 0) ids.add(k);
    if (tab === "shaky") data.attempts.filter((a) => a.guessed || a.unsure).forEach((a) => ids.add(a.qid));
    if (tab === "saved") data.bookmarks.forEach((b) => ids.add(b.qid));
    const m = new Map<string, { id: string; wrong: number; seen: number; last?: boolean; due?: number }[]>();
    const srs = new Map(data.srs.map((c) => [c.qid, c]));
    for (const id of ids) {
      const q = byId.get(id);
      if (!q || q.status !== "published") continue;
      const k = q.chapter ?? "";
      if (!m.has(k)) m.set(k, []);
      const s = data.stats[id];
      m.get(k)!.push({ id, wrong: s?.wrong ?? 0, seen: s?.seen ?? 0, last: lastAttempt.get(id)?.correct, due: srs.get(id)?.due });
    }
    const order = SECTIONS.flatMap((s) => s.topicIds);
    return [...m.entries()].sort((a, b) => order.indexOf(a[0]) - order.indexOf(b[0]));
  }, [index, data, tab]);

  if (!groups || !data) return <Skeleton lines={5} />;
  const total = groups.reduce((n, [, l]) => n + l.length, 0);
  const allIds = groups.flatMap(([, l]) => l.map((x) => x.id));

  return (
    <div className="flex flex-col gap-6 pb-24">
      <header className="flex flex-col gap-1">
        <h1 className="text-[28px] leading-tight">Review</h1>
        <p className="m-0 text-muted">Questions you missed, guessed or saved. Reviews are spaced out so each one comes back just before you&apos;d forget it.</p>
      </header>
      <Segmented
        label="Show"
        value={tab}
        onChange={setTab}
        options={[
          { value: "due", label: `Due today (${data.dueCount})` },
          { value: "wrong", label: "Got wrong" },
          { value: "shaky", label: "Guessed / unsure" },
          { value: "saved", label: `Saved (${data.bookmarks.length})` },
        ]}
      />
      {total > 0 && (
        <Link href={`/build?${tab === "due" ? "pool=due&start=1" : tab === "saved" ? "pool=bookmarked&start=1" : tab === "wrong" ? "pool=wrong&start=1" : ""}&n=${Math.min(total, 20)}`} className="btn btn--primary btn--block">
          {tab === "due" ? `Review ${Math.min(total, 20)} due now` : `Practise these (${Math.min(total, 20)})`}
        </Link>
      )}
      {total === 0 ? (
        <Empty title={tab === "due" ? "Nothing due today" : "Nothing here yet"} action={<Link href="/build" className="btn btn--secondary mt-2">Start a quiz</Link>}>
          {tab === "due"
            ? "Questions you get wrong, guess or mark unsure are scheduled for review automatically."
            : tab === "saved"
              ? "Tap the bookmark icon during a quiz to save a question here."
              : "Finish a quiz and the questions you miss will collect here, grouped by chapter."}
        </Empty>
      ) : (
        groups.map(([ch, list]) => (
          <section key={ch} className="flex flex-col gap-2">
            <div className="flex items-baseline justify-between">
              <h2 className="text-[17px] font-medium">{topicName(ch || null)}</h2>
              <span className="label">{list.length}</span>
            </div>
            <ul className="m-0 flex list-none flex-col gap-2 p-0">
              {list.map((x) => (
                <li key={x.id}>
                  <Link href={`/q?id=${x.id}&from=review&ids=${allIds.join(",")}`} className="card flex min-h-14 items-center gap-3 px-4 py-2">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[15px]">{x.id.replace(/-2026-prelim-p1-q/, " · Q").toUpperCase()}</span>
                      <span className="block text-[13px] text-muted">
                        missed {x.wrong}/{x.seen} · {pct(x.seen - x.wrong, x.seen)}% right
                        {x.due ? ` · next ${new Date(x.due).toLocaleDateString(undefined, { day: "numeric", month: "short" })}` : ""}
                      </span>
                    </span>
                    <span aria-hidden="true" className="text-muted">›</span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
    </div>
  );
}
