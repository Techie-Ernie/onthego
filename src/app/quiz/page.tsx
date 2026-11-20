import { Suspense } from "react";
import type { Metadata } from "next";
import { Skeleton } from "@/components/ui/controls";
import { QuizClient } from "./QuizClient";

export const metadata: Metadata = { title: "Quiz" };

export default function QuizPage() {
  return (
    <Suspense fallback={<div className="pt-6"><Skeleton lines={5} /></div>}>
      <QuizClient />
    </Suspense>
  );
}
