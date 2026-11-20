import { describe, expect, it } from "vitest";
import { analyse, insightCards } from "./insights";
import type { Attempt } from "@/lib/store/schema";
import type { QuestionIndexEntry } from "@/lib/types";

const now = new Date(2026, 10, 20).getTime();
const entry = (id: string, chapter: string, type: string, misconception?: string) =>
  [id, { id, chapter, types: [type], misconception, difficulty: 3 } as unknown as QuestionIndexEntry] as const;
const att = (qid: string, correct: boolean, o: Partial<Attempt> = {}): Attempt =>
  ({ id: `${qid}${Math.random()}`, quizId: "z", qid, chosen: "A", answer: correct ? "A" : "B", correct, guessed: false, unsure: false, timeMs: 30_000, at: now - 86_400_000, chapter: null, primaryType: null, updatedAt: 0, deviceId: "" }) as Attempt;

describe("insights", () => {
  const index = new Map([entry("a", "currents", "graph", "Confusing emf with p.d."), entry("b", "currents", "graph", "Confusing emf with p.d."), entry("c", "waves", "recall"), entry("d", "waves", "recall")]);
  const attempts = [
    ...Array.from({ length: 6 }, (_, i) => att(i % 2 ? "a" : "b", false)),
    ...Array.from({ length: 10 }, () => att("c", true)),
    att("d", true, { timeMs: 400_000 }),
  ];
  const r = analyse(attempts, index, now);
  it("aggregates by chapter and type, and counts traps by distinct question", () => {
    expect(r.byChapter.currents).toMatchObject({ n: 6, correct: 0 });
    expect(r.byType.recall.n).toBe(11);
    expect(r.heat.currents.graph.n).toBe(6);
    expect(r.traps[0]).toMatchObject({ text: "Confusing emf with p.d.", count: 2 });
  });
  it("produces actionable cards with drills", () => {
    const cards = insightCards(r, { chapter: (x) => x, type: (x) => x });
    expect(cards[0].id).toBe("weak-currents");
    expect(cards[0].drill).toBe("chapter=currents&n=10");
    expect(cards.some((c) => c.id === "trap")).toBe(true);
  });
  it("stays quiet with too little data", () => {
    expect(insightCards(analyse(attempts.slice(0, 3), index, now), { chapter: (x) => x, type: (x) => x })).toEqual([]);
  });
});
