import { Suspense } from "react";
import type { Metadata } from "next";
import { Skeleton } from "@/components/ui/controls";
import { QClient } from "./QClient";

export const metadata: Metadata = { title: "Question" };

export default function QPage() {
  return (
    <Suspense fallback={<Skeleton lines={5} />}>
      <QClient />
    </Suspense>
  );
}
