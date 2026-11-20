"use client";
import { useDeferredValue, useMemo, useState } from "react";
import Link from "next/link";
import { useBank } from "@/lib/hooks";
import { Skeleton } from "@/components/ui/controls";
import { schoolName } from "@/subjects/schools";
import { topicName } from "@/subjects/topics";

/** Client-side search over the index text (stem text, or a transcription for image-mode questions). */
export function SearchClient() {
  const { index, error } = useBank();
  const [q, setQ] = useState("");
  const dq = useDeferredValue(q.trim().toLowerCase());
  const results = useMemo(() => {
    if (!index || dq.length < 2) return [];
    const terms = dq.split(/\s+/);
    return index.questions
      .filter((x) => x.status === "published")
      .map((x) => {
        const hay = `${x.text} ${topicName(x.chapter).toLowerCase()} ${x.schools.map((s) => `${s} ${schoolName(s)}`).join(" ").toLowerCase()}`;
        return { x, hay, ok: terms.every((t) => hay.includes(t)) };
      })
      .filter((r) => r.ok)
      .slice(0, 60);
  }, [index, dq]);

  return (
    <div className="flex flex-col gap-5 pb-24">
      <h1 className="text-[28px] leading-tight">Search</h1>
      <input
        type="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="e.g. capacitor, terminal velocity, RI"
        aria-label="Search questions"
        className="h-12 rounded-md border border-line bg-card px-4 text-[16px]"
      />
      {error ? <p role="alert" className="text-muted">{error}</p> : !index ? (
        <Skeleton />
      ) : dq.length < 2 ? (
        <p className="m-0 text-muted">Search question text, chapters and schools.</p>
      ) : results.length === 0 ? (
        <p className="m-0 text-muted">No matches for “{q}”.</p>
      ) : (
        <ul className="m-0 flex list-none flex-col gap-2 p-0" aria-live="polite">
          {results.map(({ x }) => {
            const i = x.text.indexOf(dq.split(/\s+/)[0]);
            const snip = x.text.slice(Math.max(0, i - 40), i + 100).replace(/\$/g, "");
            return (
              <li key={x.id}>
                <Link href={`/q?id=${x.id}&ids=${results.map((r) => r.x.id).join(",")}`} className="card flex flex-col gap-1 px-4 py-3">
                  <span className="text-[13px] text-muted">
                    {topicName(x.chapter)} · {x.schools.map(schoolName).join(" · ")} {x.years.join(", ")}
                  </span>
                  <span className="line-clamp-2 text-[15px]">{i > 40 ? "…" : ""}{snip}…</span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
