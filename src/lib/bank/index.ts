"use client";
import type { BankIndex, BankShard, Question, QuestionIndexEntry, SubjectId } from "@/lib/types";

/**
 * Bank access. The slim index (filters, counts, search) is always loaded; full questions live in per-topic shards
 * fetched on demand. Both are static files under /bank/<subject>/, cached by the service worker.
 */
const shardCache = new Map<string, Promise<BankShard>>();
let indexPromise: Promise<BankIndex> | null = null;

export function loadIndex(subject: SubjectId = "h2-physics"): Promise<BankIndex> {
  if (!indexPromise)
    indexPromise = fetch(`/bank/${subject}/index.json`).then((r) => {
      if (!r.ok) throw new Error(`bank index ${r.status}`);
      return r.json();
    });
  indexPromise.catch(() => (indexPromise = null));
  return indexPromise;
}

export function loadShard(shard: string, subject: SubjectId = "h2-physics"): Promise<BankShard> {
  const key = `${subject}/${shard}`;
  if (!shardCache.has(key)) {
    const p = fetch(`/bank/${subject}/${shard}.json`).then((r) => {
      if (!r.ok) throw new Error(`shard ${shard} ${r.status}`);
      return r.json() as Promise<BankShard>;
    });
    p.catch(() => shardCache.delete(key));
    shardCache.set(key, p);
  }
  return shardCache.get(key)!;
}

/** Full questions for ids, in the given order. Loads only the shards needed. */
export async function getQuestions(ids: string[], index?: BankIndex): Promise<Question[]> {
  const idx = index ?? (await loadIndex());
  const byId = new Map(idx.questions.map((q) => [q.id, q]));
  const shards = [...new Set(ids.map((id) => byId.get(id)?.shard).filter(Boolean) as string[])];
  const loaded = await Promise.all(shards.map((s) => loadShard(s)));
  const all = new Map(loaded.flatMap((s) => s.questions.map((q) => [q.id, q] as const)));
  return ids.map((id) => all.get(id)).filter(Boolean) as Question[];
}

/** Every image URL a question needs (for prefetch / offline caching). */
export function questionAssetUrls(q: Question): string[] {
  return [q.stemImage?.src, ...q.figures.map((f) => f.src), ...q.options.map((o) => o.image?.src)].filter(Boolean) as string[];
}

export const publishedOnly = (qs: QuestionIndexEntry[]) => qs.filter((q) => q.status === "published");
