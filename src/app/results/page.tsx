import { Suspense } from "react";
import type { Metadata } from "next";
import { Skeleton } from "@/components/ui/controls";
import { ResultsClient } from "./ResultsClient";

export const metadata: Metadata = { title: "Results" };

export default function ResultsPage() {
  return (
    <Suspense fallback={<Skeleton lines={5} />}>
      <ResultsClient />
    </Suspense>
  );
}
