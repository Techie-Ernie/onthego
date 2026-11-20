import type { Metadata } from "next";
import { MistakesClient } from "./MistakesClient";

export const metadata: Metadata = { title: "Review" };

export default function MistakesPage() {
  return <MistakesClient />;
}
