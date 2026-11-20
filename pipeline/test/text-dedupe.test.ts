import { describe, expect, it } from "vitest";
import { judgeLines, lineToText } from "../src/text";
import { clusterDuplicates } from "../src/dedupe";
import { line } from "./helpers";

describe("text confidence", () => {
  it("accepts plain prose", () => {
    expect(judgeLines([line("A ball is thrown vertically upwards.", 84, 100)], 11).ok).toBe(true);
  });
  it("rejects private-use glyphs and symbol fonts", () => {
    const l = line("resistivity  of a wire", 84, 100);
    expect(judgeLines([l], 11).reasons).toContain("unmapped-glyph");
    l.chars[12].font = "SymbolMT";
    expect(judgeLines([l], 11).reasons.some((r) => r.startsWith("math-font"))).toBe(true);
  });
  it("rejects a stacked fraction (centred short rows)", () => {
    const r = judgeLines([line("2mu", 120, 100), line("3k", 124, 112)], 11);
    expect(r.ok).toBe(false);
  });
  it("rejects table-like gaps", () => {
    expect(judgeLines([line("4.0", 120, 100), line("3.6", 260, 100)], 11).reasons).toContain("wide-gap");
  });
});

describe("superscripts", () => {
  it("turns a raised small run into LaTeX", () => {
    const l = line("m s-1", 84, 100);
    for (const c of l.chars.slice(3)) {
      c.size = 7;
      c.by -= 4;
    }
    expect(lineToText(l, 11)).toBe("m $\\mathrm{s}^{-1}$");
  });
});

describe("clusterDuplicates", () => {
  const t = "A ball is thrown vertically upwards with speed 20 m s-1. What is the maximum height reached? A 10 m B 20 m C 30 m D 40 m";
  it("clusters near-identical text from different papers", () => {
    const c = clusterDuplicates([
      { id: "a", text: t, answer: "B", group: "p1" },
      { id: "b", text: t.replace("upwards", "upward"), answer: "B", group: "p2" },
      { id: "c", text: "A capacitor is charged through a resistor.", answer: "C", group: "p3" },
    ]);
    expect(c.find((g) => g.includes("a"))?.sort()).toEqual(["a", "b"]);
  });
  it("never clusters two questions from the same paper", () => {
    const c = clusterDuplicates([
      { id: "a", text: t, answer: "B", group: "p1" },
      { id: "b", text: t, answer: "B", group: "p1" },
    ]);
    expect(c).toHaveLength(2);
  });
});
