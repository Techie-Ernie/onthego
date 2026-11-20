import type { QuestionIndexEntry } from "@/lib/types";
import type { PoolMode, QuizConfig } from "@/lib/store/schema";

/** Per-question history summary, derived from attempts + bookmarks + SRS. */
export interface QStat {
  seen: number;
  wrong: number;
  /** last attempt result */
  lastCorrect?: boolean;
  bookmarked?: boolean;
  due?: boolean;
}

export interface ChapterStat {
  attempts: number;
  correct: number;
}

/** Filter the bank to the config's facets (ignores pool + length). */
export function matchFilters(q: QuestionIndexEntry, c: QuizConfig): boolean {
  if (q.status !== "published") return false;
  if (c.chapters.length && !(q.chapter && c.chapters.includes(q.chapter)) && !q.secondaryChapters.some((s) => c.chapters.includes(s))) return false;
  if (c.types.length && !q.types.some((t) => c.types.includes(t))) return false;
  if (q.difficulty != null && (q.difficulty < c.difficulty[0] || q.difficulty > c.difficulty[1])) return false;
  if (q.difficulty == null && (c.difficulty[0] > 1 || c.difficulty[1] < 5)) return false;
  if (c.schools.length && !q.schools.some((s) => c.schools.includes(s))) return false;
  if (c.years.length && !q.years.some((y) => c.years.includes(y))) return false;
  if (c.figure === "with" && !q.hasFigure) return false;
  if (c.figure === "without" && q.hasFigure) return false;
  return true;
}

/** Weak chapters: accuracy below 60% with at least 3 attempts, or the three lowest if none qualify. */
export function weakChapters(chapters: Record<string, ChapterStat>): Set<string> {
  const rows = Object.entries(chapters).filter(([, s]) => s.attempts >= 3);
  const weak = rows.filter(([, s]) => s.correct / s.attempts < 0.6).map(([k]) => k);
  if (weak.length) return new Set(weak);
  return new Set(rows.sort((a, b) => a[1].correct / a[1].attempts - b[1].correct / b[1].attempts).slice(0, 3).map(([k]) => k));
}

export function matchPool(q: QuestionIndexEntry, pool: PoolMode, stats: Record<string, QStat>, weak: Set<string>): boolean {
  const s = stats[q.id];
  switch (pool) {
    case "all":
      return true;
    case "unseen":
      return !s || s.seen === 0;
    case "wrong":
      return !!s && s.wrong > 0;
    case "bookmarked":
      return !!s?.bookmarked;
    case "due":
      return !!s?.due;
    case "weak":
      return !!q.chapter && weak.has(q.chapter);
  }
}

export function candidatePool(index: QuestionIndexEntry[], c: QuizConfig, stats: Record<string, QStat>, chapters: Record<string, ChapterStat> = {}) {
  if (c.ids?.length) {
    const set = new Set(c.ids);
    return index.filter((q) => set.has(q.id) && q.status === "published");
  }
  const weak = c.pool === "weak" ? weakChapters(chapters) : new Set<string>();
  return index.filter((q) => matchFilters(q, c) && matchPool(q, c.pool, stats, weak));
}

export function effectiveLength(c: QuizConfig, minutesPerQuestion = 1.5): number {
  if (c.minutes) return Math.max(1, Math.floor(c.minutes / minutesPerQuestion));
  return c.length;
}

/** Deterministic PRNG so a seed reproduces a quiz (tests, shared presets). */
export function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Pick questions: prefer less-seen questions, spread across chapters (round-robin), never repeat within a quiz,
 * and never pick two questions from the same paper sitting in a row when avoidable. Explicit ids keep their order.
 */
export function pickQuestions(pool: QuestionIndexEntry[], n: number, stats: Record<string, QStat>, rand = Math.random, keepOrder = false): string[] {
  if (keepOrder) return pool.slice(0, n).map((q) => q.id);
  const shuffled = [...pool].map((q) => ({ q, k: (stats[q.id]?.seen ?? 0) + rand() })).sort((a, b) => a.k - b.k);
  const byChapter = new Map<string, QuestionIndexEntry[]>();
  for (const { q } of shuffled) {
    const k = q.chapter ?? "_";
    if (!byChapter.has(k)) byChapter.set(k, []);
    byChapter.get(k)!.push(q);
  }
  const queues = [...byChapter.values()].sort(() => rand() - 0.5);
  const out: string[] = [];
  while (out.length < n && queues.some((qq) => qq.length)) {
    for (const qq of queues) {
      const next = qq.shift();
      if (next) out.push(next.id);
      if (out.length >= n) break;
    }
  }
  // final light shuffle so chapters aren't in a fixed cycle
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}
