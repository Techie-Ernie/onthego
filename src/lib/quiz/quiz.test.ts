import { describe, expect, it } from "vitest";
import { candidatePool, effectiveLength, matchFilters, mulberry32, pickQuestions, weakChapters } from "./build";
import { gradeAttempt, isDue, review, newCard, DAY, entersDeck } from "./srs";
import type { QuestionIndexEntry } from "@/lib/types";
import type { QuizConfig } from "@/lib/store/schema";

const q = (id: string, o: Partial<QuestionIndexEntry> = {}): QuestionIndexEntry => ({
  id, chapter: "circular-motion", secondaryChapters: [], primaryType: "quantitative", types: ["quantitative"], difficulty: 3,
  hasFigure: false, renderMode: "text", shard: "circular-motion", schools: ["RI"], years: [2026], exams: ["Prelim"], appearances: 1, text: "", status: "published", ...o,
});
const cfg = (o: Partial<QuizConfig> = {}): QuizConfig => ({
  subject: "h2-physics", chapters: [], types: [], difficulty: [1, 5], schools: [], years: [], figure: "any", pool: "all", length: 10, timer: "off", examPace: false, feedback: "immediate", ...o,
});

describe("quiz filtering", () => {
  const bank = [
    q("a"),
    q("b", { chapter: "currents", types: ["conceptual"], difficulty: 1, hasFigure: true, schools: ["HCI"], years: [2025] }),
    q("c", { chapter: "currents", secondaryChapters: ["circuits"], difficulty: 5 }),
    q("d", { status: "needs-review" }),
    q("e", { chapter: null, difficulty: undefined, types: [], primaryType: null }),
  ];
  it("never includes unpublished questions", () => {
    expect(candidatePool(bank, cfg(), {}).map((x) => x.id)).not.toContain("d");
  });
  it("filters by chapter, including secondary chapters", () => {
    expect(candidatePool(bank, cfg({ chapters: ["circuits"] }), {}).map((x) => x.id)).toEqual(["c"]);
    expect(candidatePool(bank, cfg({ chapters: ["currents"] }), {}).map((x) => x.id)).toEqual(["b", "c"]);
  });
  it("filters by type, difficulty, school, year and figure", () => {
    expect(candidatePool(bank, cfg({ types: ["conceptual"] }), {}).map((x) => x.id)).toEqual(["b"]);
    expect(candidatePool(bank, cfg({ difficulty: [4, 5] }), {}).map((x) => x.id)).toEqual(["c"]);
    expect(candidatePool(bank, cfg({ schools: ["HCI"] }), {}).map((x) => x.id)).toEqual(["b"]);
    expect(candidatePool(bank, cfg({ years: [2025] }), {}).map((x) => x.id)).toEqual(["b"]);
    expect(candidatePool(bank, cfg({ figure: "with" }), {}).map((x) => x.id)).toEqual(["b"]);
  });
  it("unclassified questions only match unrestricted difficulty", () => {
    expect(matchFilters(bank[4], cfg())).toBe(true);
    expect(matchFilters(bank[4], cfg({ difficulty: [2, 5] }))).toBe(false);
  });
  it("pool modes", () => {
    const stats = { a: { seen: 2, wrong: 1, bookmarked: true }, b: { seen: 1, wrong: 0, due: true } };
    expect(candidatePool(bank, cfg({ pool: "unseen" }), stats).map((x) => x.id)).toEqual(["c", "e"]);
    expect(candidatePool(bank, cfg({ pool: "wrong" }), stats).map((x) => x.id)).toEqual(["a"]);
    expect(candidatePool(bank, cfg({ pool: "bookmarked" }), stats).map((x) => x.id)).toEqual(["a"]);
    expect(candidatePool(bank, cfg({ pool: "due" }), stats).map((x) => x.id)).toEqual(["b"]);
    const chapters = { "circular-motion": { attempts: 10, correct: 3 }, currents: { attempts: 10, correct: 9 } };
    expect(candidatePool(bank, cfg({ pool: "weak" }), {}, chapters).map((x) => x.id)).toEqual(["a"]);
  });
  it("explicit ids override facets but still drop unpublished", () => {
    expect(candidatePool(bank, cfg({ ids: ["d", "b"], chapters: ["x"] }), {}).map((x) => x.id)).toEqual(["b"]);
  });
  it("weakChapters falls back to the lowest three", () => {
    expect([...weakChapters({ a: { attempts: 5, correct: 4 }, b: { attempts: 5, correct: 5 }, c: { attempts: 1, correct: 0 } })].sort()).toEqual(["a", "b"]);
  });
  it("time-boxed length", () => {
    expect(effectiveLength(cfg({ minutes: 15 }))).toBe(10);
    expect(effectiveLength(cfg({ minutes: 1 }))).toBe(1);
    expect(effectiveLength(cfg({ length: 20 }))).toBe(20);
  });
  it("pickQuestions: no repeats, respects n, prefers unseen, spreads chapters", () => {
    const many = Array.from({ length: 40 }, (_, i) => q(`q${i}`, { chapter: ["x", "y", "z", "w"][i % 4] }));
    const stats = Object.fromEntries(many.slice(0, 20).map((m) => [m.id, { seen: 3, wrong: 0 }]));
    const ids = pickQuestions(many, 12, stats, mulberry32(7));
    expect(new Set(ids).size).toBe(12);
    expect(ids.every((id) => Number(id.slice(1)) >= 20)).toBe(true);
    const chapters = new Set(ids.map((id) => many.find((m) => m.id === id)!.chapter));
    expect(chapters.size).toBe(4);
    expect(pickQuestions(many.slice(0, 3), 10, {}, mulberry32(1))).toHaveLength(3);
  });
});

describe("SM-2", () => {
  const now = new Date(2026, 10, 20, 10).getTime();
  it("grades attempts", () => {
    expect(gradeAttempt({ correct: true, guessed: false, unsure: false, timeMs: 30_000 })).toBe(5);
    expect(gradeAttempt({ correct: true, guessed: false, unsure: false, timeMs: 400_000 })).toBe(4);
    expect(gradeAttempt({ correct: true, guessed: false, unsure: true, timeMs: 1 })).toBe(3);
    expect(gradeAttempt({ correct: true, guessed: true, unsure: false, timeMs: 1 })).toBe(2);
    expect(gradeAttempt({ correct: false, guessed: false, unsure: false, timeMs: 1 })).toBe(1);
    expect(gradeAttempt({ correct: false, guessed: true, unsure: false, timeMs: 1 })).toBe(0);
  });
  it("follows the 1, 6, ×EF interval sequence", () => {
    let c = newCard("x", now);
    c = review(c, 5, now);
    expect(c.interval).toBe(1);
    c = review(c, 5, now);
    expect(c.interval).toBe(6);
    c = review(c, 5, now);
    expect(c.interval).toBe(16); // 6 × EF before this review (2.7)
    expect(c.ef).toBeCloseTo(2.8, 5);
  });
  it("lapses reset reps and never drop EF below 1.3", () => {
    let c = newCard("x", now);
    for (let i = 0; i < 10; i++) c = review(c, 0, now);
    expect(c.reps).toBe(0);
    expect(c.interval).toBe(1);
    expect(c.lapses).toBe(10);
    expect(c.ef).toBe(1.3);
  });
  it("due dates are day-based", () => {
    const c = review(newCard("x", now), 1, now);
    expect(isDue(c, now)).toBe(false);
    expect(isDue(c, now + DAY)).toBe(true);
  });
  it("only missed, guessed or unsure attempts enter the deck", () => {
    expect(entersDeck({ correct: true, guessed: false, unsure: false })).toBe(false);
    expect(entersDeck({ correct: true, guessed: true, unsure: false })).toBe(true);
    expect(entersDeck({ correct: false, guessed: false, unsure: false })).toBe(true);
  });
});
