import type { Char, Line, PageData, Graphic, Rect } from "../src/pdf";

/** Build a line of text at (x, y) with uniform glyph width; `bold` for labels. */
export function line(text: string, x: number, y: number, opts: { size?: number; bold?: boolean; cw?: number } = {}): Line {
  const size = opts.size ?? 11;
  const cw = opts.cw ?? size * 0.55;
  const chars: Char[] = [...text].map((c, i) => ({
    c,
    x0: x + i * cw,
    x1: x + (i + 1) * cw,
    y0: y,
    y1: y + size * 1.1,
    by: y + size * 0.9,
    size,
    font: opts.bold ? "Arial-BoldMT" : "ArialMT",
    bold: !!opts.bold,
    italic: false,
  }));
  return { bbox: [x, y, x + text.length * cw, y + size * 1.1], chars, text };
}
export const gfx = (bbox: Rect, kind: Graphic["kind"] = "path"): Graphic => ({ kind, bbox });
export function page(index: number, lines: Line[], graphics: Graphic[] = []): PageData {
  return { index, w: 595, h: 842, lines, graphics };
}

/** A question with a number at x=56, stem at x=84, and options in the given layout. */
export function question(n: number, y: number, layout: "list" | "row" | "grid", opts: { figure?: Rect; optionFigures?: boolean } = {}): { lines: Line[]; graphics: Graphic[]; bottom: number } {
  const lines: Line[] = [line(String(n), 56, y, { bold: true }), line(`A ball of mass m moves on a smooth surface number ${n}.`, 84, y)];
  const graphics: Graphic[] = [];
  let cy = y + 20;
  if (opts.figure) {
    graphics.push(gfx(opts.figure));
    cy = opts.figure[3] + 10;
  }
  lines.push(line("Which statement is correct?", 84, cy));
  cy += 24;
  const L = ["A", "B", "C", "D"];
  if (layout === "list") {
    L.forEach((l, i) => {
      lines.push(line(l, 84, cy + i * 20, { bold: true }));
      lines.push(line(`option ${l.toLowerCase()} text`, 110, cy + i * 20));
    });
    cy += 80;
  } else if (layout === "row") {
    L.forEach((l, i) => {
      lines.push(line(l, 84 + i * 110, cy, { bold: true }));
      lines.push(line(`${i + 1}.0 m`, 100 + i * 110, cy));
    });
    cy += 20;
  } else {
    L.forEach((l, i) => {
      const cx = i % 2 ? 380 : 170;
      const ry = cy + Math.floor(i / 2) * 120;
      lines.push(line(l, cx, ry, { bold: true }));
      if (opts.optionFigures) graphics.push(gfx([cx - 50, ry + 16, cx + 60, ry + 100]));
    });
    cy += 240;
  }
  return { lines, graphics, bottom: cy };
}
