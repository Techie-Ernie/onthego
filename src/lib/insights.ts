import type { QuestionIndexEntry } from "@/lib/types";
import type { Attempt } from "@/lib/store/schema";

export interface Cell {
  n: number;
  correct: number;
  timeMs: number;
}
const cell = (): Cell => ({ n: 0, correct: 0, timeMs: 0 });
const add = (c: Cell, a: Attempt) => {
  c.n++;
  if (a.correct) c.correct++;
  c.timeMs += a.timeMs;
};
export const acc = (c: Cell) => (c.n ? c.correct / c.n : 0);

export interface Analysis {
  overall: Cell;
  byChapter: Record<string, Cell>;
  byType: Record<string, Cell>;
  /** chapter → type → cell */
  heat: Record<string, Record<string, Cell>>;
  byDifficulty: Record<number, Cell>;
  guessed: Cell;
  unsure: Cell;
  confident: Cell;
  /** misconceptions behind wrong answers, most frequent first */
  traps: { text: string; count: number; qids: string[] }[];
  /** last-7-days vs earlier accuracy */
  recent: Cell;
  earlier: Cell;
  /** per day (yyyy-mm-dd) counts for the activity strip */
  days: Record<string, Cell>;
}

/** Uses the latest bank metadata for each attempt (classifications can improve after the attempt was made). */
export function analyse(attempts: Attempt[], index: Map<string, QuestionIndexEntry>, now = Date.now()): Analysis {
  const r: Analysis = {
    overall: cell(), byChapter: {}, byType: {}, heat: {}, byDifficulty: {}, guessed: cell(), unsure: cell(), confident: cell(), traps: [], recent: cell(), earlier: cell(), days: {},
  };
  const traps = new Map<string, Set<string>>();
  for (const a of attempts) {
    const q = index.get(a.qid);
    const ch = q?.chapter ?? a.chapter ?? "_";
    const types = q?.types?.length ? q.types : a.primaryType ? [a.primaryType] : ["_"];
    add(r.overall, a);
    add((r.byChapter[ch] ??= cell()), a);
    for (const t of types) {
      add((r.byType[t] ??= cell()), a);
      add(((r.heat[ch] ??= {})[t] ??= cell()), a);
    }
    if (q?.difficulty) add((r.byDifficulty[q.difficulty] ??= cell()), a);
    add(a.guessed ? r.guessed : a.unsure ? r.unsure : r.confident, a);
    add(now - a.at < 7 * 86_400_000 ? r.recent : r.earlier, a);
    const d = new Date(a.at);
    add((r.days[`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`] ??= cell()), a);
    if (!a.correct && q?.misconception) {
      const k = q.misconception.trim();
      if (!traps.has(k)) traps.set(k, new Set());
      traps.get(k)!.add(a.qid);
    }
  }
  r.traps = [...traps.entries()].map(([text, s]) => ({ text, count: s.size, qids: [...s] })).sort((a, b) => b.count - a.count);
  return r;
}

export interface InsightCard {
  id: string;
  title: string;
  body: string;
  /** /build query string for a targeted drill */
  drill?: string;
  tone: "bad" | "good" | "neutral";
}

const MIN = 5;

/** Plain-language cards, most actionable first. Each card needs enough attempts to mean something. */
export function insightCards(r: Analysis, names: { chapter: (id: string) => string; type: (id: string) => string }, paceMs = 90_000): InsightCard[] {
  const cards: InsightCard[] = [];
  if (r.overall.n < MIN) return cards;
  const overall = acc(r.overall);
  const pc = (x: number) => `${Math.round(x * 100)}%`;

  const chapters = Object.entries(r.byChapter).filter(([k, c]) => k !== "_" && c.n >= MIN);
  const worst = chapters.sort((a, b) => acc(a[1]) - acc(b[1]))[0];
  if (worst && acc(worst[1]) < overall - 0.1)
    cards.push({
      id: `weak-${worst[0]}`,
      tone: "bad",
      title: `${names.chapter(worst[0])} is your weakest chapter`,
      body: `${pc(acc(worst[1]))} correct over ${worst[1].n} questions, against ${pc(overall)} overall.`,
      drill: `chapter=${worst[0]}&n=10`,
    });

  const types = Object.entries(r.byType).filter(([k, c]) => k !== "_" && c.n >= MIN);
  const wt = types.sort((a, b) => acc(a[1]) - acc(b[1]))[0];
  if (wt && acc(wt[1]) < overall - 0.12)
    cards.push({
      id: `type-${wt[0]}`,
      tone: "bad",
      title: `${names.type(wt[0])} questions trip you up`,
      body: `${pc(acc(wt[1]))} correct on ${wt[1].n} ${names.type(wt[0]).toLowerCase()} questions, across all chapters.`,
      drill: `type=${wt[0]}&n=10`,
    });

  if (r.traps[0] && r.traps[0].count >= 2)
    cards.push({
      id: "trap",
      tone: "bad",
      title: "A repeated trap",
      body: `You've fallen for “${r.traps[0].text}” on ${r.traps[0].count} different questions.`,
    });

  // speed: slow chapters (avg time above pace) with decent sample
  const slow = chapters.filter(([, c]) => c.timeMs / c.n > paceMs * 1.3).sort((a, b) => b[1].timeMs / b[1].n - a[1].timeMs / a[1].n)[0];
  if (slow)
    cards.push({
      id: `slow-${slow[0]}`,
      tone: "neutral",
      title: `${names.chapter(slow[0])} takes you longer`,
      body: `About ${Math.round(slow[1].timeMs / slow[1].n / 1000)} s per question, against an exam pace of ${Math.round(paceMs / 1000)} s. Try a timed set.`,
      drill: `chapter=${slow[0]}&n=10&timer=per-question`,
    });

  if (r.guessed.n >= MIN)
    cards.push({
      id: "guess",
      tone: acc(r.guessed) > 0.4 ? "neutral" : "bad",
      title: "Your guesses",
      body: `${pc(acc(r.guessed))} of ${r.guessed.n} guesses were right${acc(r.guessed) > 0.4 ? ". Your instincts are better than chance, so trust your elimination" : ", close to chance. Review these instead of moving on"}.`,
    });

  if (r.unsure.n >= MIN && acc(r.unsure) > overall + 0.05)
    cards.push({
      id: "unsure",
      tone: "good",
      title: "You know more than you think",
      body: `Questions you marked unsure were right ${pc(acc(r.unsure))} of the time, better than your overall ${pc(overall)}.`,
    });

  if (r.recent.n >= MIN && r.earlier.n >= MIN) {
    const d = acc(r.recent) - acc(r.earlier);
    if (Math.abs(d) >= 0.08)
      cards.push({
        id: "trend",
        tone: d > 0 ? "good" : "bad",
        title: d > 0 ? "You're improving" : "Dip this week",
        body: `${pc(acc(r.recent))} this week against ${pc(acc(r.earlier))} before.`,
      });
  }

  const best = chapters.sort((a, b) => acc(b[1]) - acc(a[1]))[0];
  if (best && acc(best[1]) >= 0.85 && best[1].n >= 8)
    cards.push({ id: `strong-${best[0]}`, tone: "good", title: `Strong in ${names.chapter(best[0])}`, body: `${pc(acc(best[1]))} over ${best[1].n} questions. Move on to harder ones.`, drill: `chapter=${best[0]}&n=10` });

  return cards;
}
