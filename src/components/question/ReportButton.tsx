"use client";
import { useState } from "react";
import { store, newId } from "@/lib/store/store";
import type { Report } from "@/lib/store/schema";

const KINDS: { value: Report["kind"]; label: string }[] = [
  { value: "wrong-answer", label: "Answer looks wrong" },
  { value: "bad-crop", label: "Image cut off / unreadable" },
  { value: "typo", label: "Text or maths error" },
  { value: "bad-explanation", label: "Explanation is wrong or unclear" },
  { value: "other", label: "Something else" },
];

/** Saves the report locally (no account in v1). Reports are included in the data export and shown in Settings. */
export function ReportButton({ qid }: { qid: string }) {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<Report["kind"]>("wrong-answer");
  const [note, setNote] = useState("");
  const [done, setDone] = useState(false);
  if (done) return <span className="text-[14px] text-muted">Reported. Thanks.</span>;
  if (!open)
    return (
      <button type="button" className="text-[14px] text-muted underline underline-offset-4" onClick={() => setOpen(true)}>
        Report a problem
      </button>
    );
  return (
    <form
      className="card flex flex-col gap-3 p-4"
      onSubmit={async (e) => {
        e.preventDefault();
        await store().addReport({ id: newId(), qid, kind, note: note.trim(), at: Date.now(), sent: false, updatedAt: Date.now(), deviceId: "" });
        setDone(true);
      }}
    >
      <fieldset className="m-0 flex flex-col gap-2 border-0 p-0">
        <legend className="label mb-2">What&apos;s wrong?</legend>
        {KINDS.map((k) => (
          <label key={k.value} className="flex min-h-11 items-center gap-3 text-[15px]">
            <input type="radio" name="kind" value={k.value} checked={kind === k.value} onChange={() => setKind(k.value)} className="h-5 w-5 accent-[var(--action)]" />
            {k.label}
          </label>
        ))}
      </fieldset>
      <label className="flex flex-col gap-1">
        <span className="label">Details (optional)</span>
        <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} className="rounded-md border border-line bg-card p-3 text-[16px]" />
      </label>
      <div className="flex gap-2">
        <button type="submit" className="btn btn--primary">Send report</button>
        <button type="button" className="btn btn--secondary" onClick={() => setOpen(false)}>Cancel</button>
      </div>
    </form>
  );
}
