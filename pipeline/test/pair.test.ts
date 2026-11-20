import { describe, expect, it } from "vitest";
import { classifyPath } from "../src/discover";
import { pairPapers } from "../src/pair";
import type { PaperFile } from "../src/discover";

describe("classifyPath", () => {
  const c = (p: string) => classifyPath(p).file;
  it("handles underscores, dots and folder levels", () => {
    expect(c("NJC/H2 Physics/NJC_2026_H2_Physics_Prelim_P1_Ans.pdf")).toMatchObject({ school: "NJC", paperNo: 1, role: "key" });
    expect(c("CJC PHY/H2/J2.H2.PRELIM.2026.Paper 1_QP.pdf")).toMatchObject({ school: "CJC", paperNo: 1, role: "qp", year: 2026, exam: "Prelim" });
    expect(c("DHS Physics Prelim 2026/H2/DHS 2026 Y6 Physics H2 P1 Prelim (with suggested answers) (for external sharing).pdf")?.role).toBe("key");
    expect(c("RVHS/RVHS H2 Physics P1 Soln.pdf")?.role).toBe("key");
    expect(c("SAJC - note P3 will be used/2026 SAJC H2 Physics Prelim P1_for sharing.pdf")).toMatchObject({ school: "SAJC", role: "qp" });
  });
  it("skips H1/H3 and practical files", () => {
    expect(classifyPath("TMJC/TMJC_2026_H1 Physics_P1_QP_n_MS.pdf").skip).toMatch(/H1/);
    expect(classifyPath("ACJC Physics/H2/2026 J2 H1 Physics Prelim P2 Guide sharing.pdf").skip).toMatch(/H1/);
    expect(classifyPath("DHS/H3/2026 Y6 Physics H3 P1 Prelim.pdf").skip).toMatch(/H3/);
    expect(classifyPath("JPJC/H2/2026 Prelim H2 Phy P4 Apparatus List.pdf").skip).toBeTruthy();
  });
  it("does not read PU3 as a paper number", () => {
    expect(c("MI Physics/H2/2026 PU3 H2 PHYSICS PRELIM P1 ANS.pdf")?.paperNo).toBe(1);
  });
});

describe("pairPapers", () => {
  const f = (rel: string, role: "qp" | "key", school = "RI"): PaperFile => ({ rel, abs: rel, source: "local", school, year: 2026, exam: "Prelim", level: "H2", paperNo: 1, role });
  it("pairs QP with key by school/year/exam/paper", () => {
    const { pairs, problems } = pairPapers([f("RI/q.pdf", "qp"), f("RI/a.pdf", "key"), f("NJC/q.pdf", "qp", "NJC"), f("NJC/a.pdf", "key", "NJC")]);
    expect(pairs.map((p) => [p.school, p.answer?.rel])).toEqual([["NJC", "NJC/a.pdf"], ["RI", "RI/a.pdf"]]);
    expect(problems).toEqual([]);
  });
  it("logs a paper with no answer file and marks it embedded", () => {
    const { pairs, problems } = pairPapers([f("SAJC/q.pdf", "qp", "SAJC")]);
    expect(pairs[0].embedded).toBe(true);
    expect(problems[0].problem).toBe("no-answer-file");
  });
  it("logs a key with no question paper", () => {
    const { pairs, problems } = pairPapers([f("X/a.pdf", "key", "X")]);
    expect(pairs).toHaveLength(0);
    expect(problems[0].problem).toBe("no-question-paper");
  });
  it("prefers the plain answer list over an annotated copy", () => {
    const { pairs } = pairPapers([f("VJC/P1.pdf", "qp", "VJC"), f("VJC/P1 with answers.pdf", "key", "VJC"), f("VJC/P1 Ans.pdf", "key", "VJC")]);
    expect(pairs[0].answer?.rel).toBe("VJC/P1 Ans.pdf");
  });
});
