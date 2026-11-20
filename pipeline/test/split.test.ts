import { describe, expect, it } from "vitest";
import { splitPaper, pickLabels, detectTable } from "../src/split";
import { line, page, question, gfx } from "./helpers";

function paper(layouts: ("list" | "row" | "grid")[], opts: Parameters<typeof question>[3][] = []) {
  const pages = [];
  let lines = [line("Data", 84, 100), line("speed of light in free space c = 3.00 x 10 8 m s-1", 84, 130)];
  pages.push(page(0, lines));
  let y = 80;
  let pg = 1;
  let cur: ReturnType<typeof question>[] = [];
  const flush = () => {
    pages.push(page(pg++, cur.flatMap((c) => c.lines), cur.flatMap((c) => c.graphics)));
    cur = [];
    y = 80;
  };
  layouts.forEach((lay, i) => {
    const q = question(i + 1, y, lay, opts[i] ?? {});
    if (q.bottom > 760) {
      flush();
      const q2 = question(i + 1, y, lay, opts[i] ?? {});
      cur.push(q2);
      y = q2.bottom + 30;
    } else {
      cur.push(q);
      y = q.bottom + 30;
    }
  });
  flush();
  return pages;
}

describe("splitPaper", () => {
  it("finds every question in sequence and ignores the data page", () => {
    const r = splitPaper(paper(["list", "row", "list", "row", "list"]), 5);
    expect(r.questions.map((q) => q.number)).toEqual([1, 2, 3, 4, 5]);
    expect(r.issues).toEqual([]);
  });

  it("reports a count mismatch against the expected paper length", () => {
    const r = splitPaper(paper(["list", "row"]), 30);
    expect(r.issues[0]).toMatch(/found 2 question numbers, expected 30/);
  });

  it("reads list and row options as text in order A–D", () => {
    const r = splitPaper(paper(["list", "row"]), 2);
    expect(r.questions[0].optionLayout).toBe("list");
    expect(r.questions[0].options.map((o) => o.text)).toEqual(["option a text", "option b text", "option c text", "option d text"]);
    expect(r.questions[1].optionLayout).toBe("row");
    expect(r.questions[1].options.map((o) => o.text)).toEqual(["1.0 m", "2.0 m", "3.0 m", "4.0 m"]);
    expect(r.questions[1].renderMode).toBe("text");
  });

  it("puts a stem figure in the stem and keeps it out of the options", () => {
    const r = splitPaper(paper(["list"], [{ figure: [200, 110, 400, 200] }]), 1);
    const q = r.questions[0];
    expect(q.figures).toHaveLength(1);
    expect(q.renderMode).toBe("mixed");
    expect(q.optionsHaveGraphics).toBe(false);
    expect(q.figures[0].afterParagraph).toBe(1);
  });

  it("crops each figure option separately in a 2×2 grid", () => {
    const r = splitPaper(paper(["grid"], [{ optionFigures: true }]), 1);
    const q = r.questions[0];
    expect(q.optionLayout).toBe("grid");
    expect(q.optionsHaveGraphics).toBe(true);
    expect(q.options.every((o) => o.crop && o.crop.pieces.length === 1)).toBe(true);
    // A's crop sits left of B's, C's below A's
    const [a, b, c] = q.options.map((o) => o.crop!.pieces[0].rect);
    expect(a[2]).toBeLessThanOrEqual(b[0] + 1);
    expect(c[1]).toBeGreaterThan(a[1]);
  });

  it("falls back to image mode when option labels can't be found", () => {
    const pages = [page(0, [line("1", 56, 80, { bold: true }), line("Some question with no options at all.", 84, 80)])];
    const r = splitPaper(pages, 1);
    expect(r.questions[0].renderMode).toBe("image");
    expect(r.questions[0].flags).toContain("options-not-found");
  });

  it("does not take a figure label 'A' inside the stem as an option", () => {
    const { lines, graphics } = question(1, 80, "list");
    lines.splice(2, 0, line("A", 300, 100), line("B", 360, 100)); // diagram labels
    const r = splitPaper([page(0, lines, graphics)], 1);
    expect(r.questions[0].options.map((o) => o.text)).toEqual(["option a text", "option b text", "option c text", "option d text"]);
  });
});

describe("pickLabels", () => {
  const L = (label: "A" | "B" | "C" | "D", x: number, y: number) => ({ label, piece: 0, x0: x, x1: x + 7, y0: y, y1: y + 12, alone: true, line: line(label, x, y), word: { chars: [], text: label, x0: x, x1: x + 7, y0: y, y1: y + 12 } });
  it("rejects inconsistent geometry", () => {
    expect(pickLabels([L("A", 84, 100), L("B", 200, 300), L("C", 84, 140), L("D", 300, 500)])).toBeNull();
  });
  it("chooses the last consistent set", () => {
    const r = pickLabels([L("A", 300, 50), L("B", 350, 50), L("A", 84, 200), L("B", 84, 220), L("C", 84, 240), L("D", 84, 260)]);
    expect(r?.layout).toBe("list");
    expect(r?.labels[0].y0).toBe(200);
  });
});

describe("detectTable", () => {
  const labels = [0, 1, 2, 3].map((i) => ({ y0: 100 + i * 14, y1: 110 + i * 14 }));
  it("sees cell-by-cell vertical rules through several option rows", () => {
    const boxes = [0, 1, 2, 3].map((i) => [240, 96 + i * 14, 241.5, 110 + i * 14] as [number, number, number, number]);
    expect(detectTable(labels, boxes, 480)).toBe(true);
  });
  it("ignores a small figure next to one option", () => {
    expect(detectTable(labels, [[300, 98, 360, 112]], 480)).toBe(false);
  });
  void gfx;
});
