import { Suspense } from "react";
import type { Metadata } from "next";
import { Skeleton } from "@/components/ui/controls";
import { BuildClient } from "./BuildClient";

export const metadata: Metadata = { title: "Build a quiz" };

export default function BuildPage() {
  return (
    <Suspense fallback={<Skeleton lines={6} />}>
      <BuildClient />
    </Suspense>
  );
}
