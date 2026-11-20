import Link from "next/link";

export const metadata = { title: "Offline" };

export default function Offline() {
  return (
    <div className="flex flex-col gap-4 pt-8">
      <h1 className="text-[28px]">You’re offline.</h1>
      <p className="measure text-ink-2">
        This page wasn’t saved for offline use. Quizzes from chapters you downloaded still work.
      </p>
      <Link href="/" className="btn btn--secondary">Go to home</Link>
    </div>
  );
}
