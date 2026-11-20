import { describe, expect, it } from "vitest";
import { parseAnswerKey, solutionsStartPage } from "../src/keys";

const grid = ["Answers", " 1    C          6         A", " 2    D          7         B", " 3    B          8         D", " 4    C          9         A", " 5    B          10        A"].join("\n");

describe("parseAnswerKey", () => {
  it("reads a summary grid", () => {
    const r = parseAnswerKey([grid], 10);
    expect(r.answers).toEqual({ 1: "C", 2: "D", 3: "B", 4: "C", 5: "B", 6: "A", 7: "B", 8: "D", 9: "A", 10: "A" });
    expect(r.issues).toEqual([]);
  });

  it("ignores '2 C' (coulombs) inside working", () => {
    const sol = grid + "\n" + "        Q = It so the charge is    2 C" + "\n  total = 5 A for the circuit";
    const r = parseAnswerKey([sol], 10);
    expect(r.answers[2]).toBe("D");
    expect(r.answers[5]).toBe("B");
  });

  it("reads per-question solution paragraphs (letter then prose)", () => {
    const lines = Array.from({ length: 6 }, (_, i) => `${i + 1}     ${"ABCDAB"[i]} Since the force is ${i}`).join("\n");
    const r = parseAnswerKey([lines], 6);
    expect(Object.values(r.answers).join("")).toBe("ABCDAB");
  });

  it("reads 'Ans: X' annotations only when the count is exact", () => {
    const ok = Array.from({ length: 4 }, (_, i) => `question ${i + 1} text\n   Ans: ${"DCBA"[i]}`).join("\n");
    expect(parseAnswerKey([ok], 4).answers).toEqual({ 1: "D", 2: "C", 3: "B", 4: "A" });
    const short = Array.from({ length: 3 }, (_, i) => `Ans: ${"DCB"[i]}`).join("\n");
    const r = parseAnswerKey([short], 4);
    expect(Object.keys(r.answers)).toHaveLength(0);
    expect(r.issues).toHaveLength(4);
  });

  it("reads horizontal Qn/Ans rows", () => {
    const rows = "Qn   1  2  3  4  5\nAns  C  A  A  B  B";
    expect(parseAnswerKey([rows], 5).answers).toEqual({ 1: "C", 2: "A", 3: "A", 4: "B", 5: "B" });
  });

  it("reports a conflict instead of guessing", () => {
    const text = grid + "\n" + Array.from({ length: 10 }, (_, i) => `Ans: ${i === 1 ? "A" : "CDBCBABDAA"[i]}`).join("\n");
    const r = parseAnswerKey([text], 10);
    expect(r.answers[2]).toBeUndefined();
    expect(r.issues).toEqual([expect.objectContaining({ q: 2, problem: "conflict" })]);
  });

  it("flags missing answers", () => {
    const r = parseAnswerKey([" 1    C\n 2    D"], 3);
    expect(r.issues.find((i) => i.q === 3)?.problem).toBe("missing");
  });
});

describe("solutionsStartPage", () => {
  it("finds appended solutions but not the cover instructions", () => {
    expect(solutionsStartPage(["Answer all questions", "1 A ball", "Paper 1 Solutions\nQn 1 2"])).toBe(2);
  });
});
