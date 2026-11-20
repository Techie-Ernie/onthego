"use client";
import type { OptionLabel, Question } from "@/lib/types";
import { MathText } from "./MathText";
import { topicName } from "@/subjects/topics";

/** Answer + worked solution. Source line says whether it came from the school's answer key or was written by us. */
export function Explanation({ q, chosen }: { q: Question; chosen?: OptionLabel | null }) {
  const ex = q.explanation;
  const correct = chosen != null && chosen === q.answer;
  return (
    <section aria-label="Explanation" className="card flex flex-col gap-3 p-4">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className={`text-[17px] font-medium ${chosen == null ? "" : correct ? "text-good" : "text-bad"}`}>
          {chosen == null ? `Answer: ${q.answer}` : correct ? `Correct, ${q.answer}` : `Answer: ${q.answer} · you chose ${chosen}`}
        </span>
        {q.chapter && <span className="label">{topicName(q.chapter)}</span>}
      </div>
      {ex ? (
        <>
          <div className="flex flex-col gap-2 text-[16px] leading-[1.6]">
            {ex.body.split(/\n\n+/).map((p, i) => (
              <p key={i} className="m-0 measure">
                <MathText text={p} />
              </p>
            ))}
          </div>
          {Object.keys(ex.perOption).length > 0 && (
            <ul className="m-0 flex list-none flex-col gap-2 p-0">
              {(["A", "B", "C", "D"] as const)
                .filter((l) => ex.perOption[l] && l !== q.answer)
                .map((l) => (
                  <li key={l} className={`flex gap-3 text-[15px] leading-snug ${l === chosen ? "text-ink" : "text-ink-2"}`}>
                    <span className={`font-mono font-medium ${l === chosen ? "text-bad" : "text-muted"}`}>{l}</span>
                    <span className="min-w-0">
                      <MathText text={ex.perOption[l]!} />
                    </span>
                  </li>
                ))}
            </ul>
          )}
          <p className="m-0 text-[12px] text-muted">{ex.source === "key" ? "Based on the school's worked solution." : "No worked solution in the school's key; explanation written for onthego."}</p>
        </>
      ) : (
        <p className="m-0 text-muted">No explanation yet. The answer is from the school&apos;s answer key.</p>
      )}
      {q.misconception && (
        <p className="m-0 text-[14px] text-ink-2">
          <span className="label">Common trap · </span>
          {q.misconception}
        </p>
      )}
    </section>
  );
}
