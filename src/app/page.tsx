import Link from "next/link";
import { activeSubject } from "@/subjects";
import { HomeClient } from "@/components/home/HomeClient";

export default function Home() {
  return (
    <div className="flex flex-col gap-6">
      <header className="flex items-center justify-between pt-2">
        <span className="flex items-center gap-2 text-[20px] font-medium tracking-tight">
          <span aria-hidden="true" className="inline-block h-3 w-3 rounded-full bg-action" />
          onthego
        </span>
        <span className="label">{activeSubject.name} · {activeSubject.code}</span>
      </header>
      <section className="flex flex-col gap-3">
        <h1 className="text-[32px] leading-tight">Ten questions before your stop.</h1>
        <p className="measure text-ink-2">
          Short H2 Physics MCQ quizzes from real JC prelim papers. Pick a chapter and a length, then go. Downloaded topics work offline.
        </p>
      </section>
      <HomeClient />
    </div>
  );
}
