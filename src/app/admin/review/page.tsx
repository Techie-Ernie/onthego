import { notFound } from "next/navigation";
import { ReviewClient } from "./ReviewClient";

export const metadata = { title: "Review queue", robots: { index: false } };

export default function ReviewPage() {
  if (process.env.NODE_ENV === "production" || process.env.VERCEL) notFound();
  return <ReviewClient />;
}
