import { NextResponse } from "next/server";

/** The review tooling only exists on a developer machine: every admin route 404s in production builds. */
export function devOnly(): NextResponse | null {
  if (process.env.NODE_ENV === "production" || process.env.VERCEL) return new NextResponse("Not found", { status: 404 });
  return null;
}
