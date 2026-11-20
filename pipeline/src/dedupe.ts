/**
 * Near-duplicate detection: normalised-text trigram Jaccard, backed by image dHash for low-quality text.
 * Pure; see pipeline/test/dedupe.test.ts.
 */
import { hamming } from "./crops";

export interface DedupeItem {
  id: string;
  text: string; // stem + options plain text
  imageHash?: string;
  answer: string | null;
  /** items in the same group (e.g. the same paper) are never duplicates of each other */
  group?: string;
}

export function normalise(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function trigrams(s: string): Set<string> {
  const n = normalise(s).replace(/ /g, "_");
  const out = new Set<string>();
  for (let i = 0; i + 3 <= n.length; i++) out.add(n.slice(i, i + 3));
  return out;
}

export function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter);
}

/** Union-find clusters. Two items join when text similarity ≥ 0.88, or ≥ 0.6 with near-identical images. */
export function clusterDuplicates(items: DedupeItem[], opts = { text: 0.88, textWithImage: 0.6, imageBits: 6 }): string[][] {
  const parent = new Map(items.map((i) => [i.id, i.id]));
  const find = (x: string): string => (parent.get(x) === x ? x : (parent.set(x, find(parent.get(x)!)), parent.get(x)!));
  const grams = items.map((i) => trigrams(i.text));
  for (let i = 0; i < items.length; i++)
    for (let j = i + 1; j < items.length; j++) {
      if (items[i].group && items[i].group === items[j].group) continue;
      const sim = jaccard(grams[i], grams[j]);
      if (sim < opts.textWithImage) continue;
      const img = items[i].imageHash && items[j].imageHash ? hamming(items[i].imageHash!, items[j].imageHash!) <= opts.imageBits : false;
      if (sim >= opts.text || img) parent.set(find(items[i].id), find(items[j].id));
    }
  const groups = new Map<string, string[]>();
  for (const it of items) groups.set(find(it.id), [...(groups.get(find(it.id)) ?? []), it.id]);
  return [...groups.values()];
}
