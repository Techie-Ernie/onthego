/**
 * Split a question paper (already extracted to PageData) into questions:
 *   1. find the question-number column and the 1..N sequence
 *   2. carve each question's region (may span pages)
 *   3. locate the A–D option labels and their layout (list / row / grid)
 *   4. assign graphics to the stem (figures) or to option cells (figure-in-options)
 *   5. decide the render mode from text confidence
 * Pure functions over PageData — see pipeline/test/split.test.ts.
 */
import type { Line, PageData, Rect, Graphic } from "./pdf";
import { center, contains, intersects, rh, rw, union } from "./pdf";
import { judgeLines, lineWords, linesToParagraphs, plainText, type Word } from "./text";
import type { OptionLabel, RenderMode } from "../../src/lib/types";

export interface Piece {
  page: number; // 0-based
  rect: Rect;
}

export interface CropSpec {
  pieces: Piece[];
}

export interface SplitOption {
  label: OptionLabel;
  text?: string;
  textOk: boolean;
  /** present when the option has graphics: crop of the option cell (label excluded) */
  crop?: CropSpec;
}

export interface SplitFigure {
  crop: CropSpec;
  afterParagraph: number;
}

export interface SplitQuestion {
  number: number;
  page: number; // first page, 0-based
  pieces: Piece[]; // full question region
  stemParagraphs: string[];
  stemText: string;
  stemOk: boolean;
  stemReasons: string[];
  figures: SplitFigure[];
  options: SplitOption[];
  optionLayout: "list" | "row" | "grid" | "none";
  optionsHaveGraphics: boolean;
  renderMode: RenderMode;
  /** crop used for image mode: the stem (and options when they are text) */
  stemCrop: CropSpec;
  /** crop of the whole question for the review queue */
  fullCrop: CropSpec;
  flags: string[];
}

export interface SplitResult {
  questions: SplitQuestion[];
  numberColumnX: number | null;
  issues: string[];
}

/* ------------------------------------------------------------------ */

const isBlank = (l: Line) => l.text.trim() === "";

/** Remove running headers/footers: lines in the top/bottom bands that repeat across pages or look like page furniture. */
export function bodyLines(pages: PageData[]): Map<number, Line[]> {
  const band = (p: PageData, l: Line) => l.bbox[3] < p.h * 0.065 || l.bbox[1] > p.h * 0.935;
  const norm = (s: string) => s.replace(/\d+/g, "#").replace(/\s+/g, " ").trim().toLowerCase();
  const freq = new Map<string, number>();
  for (const p of pages) {
    const seen = new Set<string>();
    for (const l of p.lines) if (!isBlank(l) && (l.bbox[3] < p.h * 0.12 || l.bbox[1] > p.h * 0.88)) seen.add(norm(l.text));
    for (const s of seen) freq.set(s, (freq.get(s) ?? 0) + 1);
  }
  const furniture = /turn over|\[turn|^\s*#\s*$|©|blank page|^\s*-?\s*#\s*-?\s*$|9478\/0?1|9749\/0?1/i;
  const out = new Map<number, Line[]>();
  for (const p of pages) {
    out.set(
      p.index,
      p.lines.filter((l) => {
        if (isBlank(l)) return false;
        const n = norm(l.text);
        const edge = l.bbox[3] < p.h * 0.12 || l.bbox[1] > p.h * 0.88;
        if (edge && !/^#[.)]?$/.test(n) && (freq.get(n) ?? 0) >= Math.max(3, pages.length * 0.3)) return false;
        if (band(p, l) && furniture.test(n)) return false;
        if (band(p, l) && /^\s*\d{1,2}\s*$/.test(l.text)) return false; // page number
        return true;
      }),
    );
  }
  return out;
}

export function bodyGraphics(p: PageData): Graphic[] {
  return p.graphics.filter((g) => {
    const [x0, y0, x1, y1] = g.bbox;
    if (y1 < p.h * 0.06 || y0 > p.h * 0.94) return false; // header/footer rules, logos
    if (rw(g.bbox) > p.w * 0.9 && rh(g.bbox) > p.h * 0.8) return false; // page frame
    if (rw(g.bbox) < 0.3 && rh(g.bbox) < 0.3) return false;
    if (x1 - x0 > p.w * 0.85 && rh(g.bbox) < 2) return false; // full-width rule
    return true;
  });
}

const DATA_PAGE = /speed of light in free space|uniformly accelerated motion|data and formulae|^\s*formulae\s*$/im;
const END_MARK = /end of paper|end of question paper|\*\*\*\s*end/i;

interface NumCand {
  n: number;
  page: number;
  line: Line;
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  /** remaining words on the same line after the number */
  restX: number | null;
}

function numberCandidates(page: PageData, lines: Line[]): NumCand[] {
  const out: NumCand[] = [];
  for (const l of lines) {
    const ws = lineWords(l);
    if (!ws.length) continue;
    const m = ws[0].text.match(/^(\d{1,2})[.)]?$/);
    if (!m) continue;
    const n = Number(m[1]);
    if (n < 1 || n > 60) continue;
    const next = ws[1];
    if (next && next.x0 - ws[0].x1 < 2) continue; // "1 hour", "2 m s" …
    out.push({ n, page: page.index, line: l, x0: ws[0].x0, x1: ws[0].x1, y0: l.bbox[1], y1: l.bbox[3], restX: next ? next.x0 : null });
  }
  return out;
}

export function findQuestionStarts(pages: PageData[], body: Map<number, Line[]>, expected: number): { starts: NumCand[]; column: number | null } {
  const cands: NumCand[] = [];
  for (const p of pages) {
    const lines = body.get(p.index) ?? [];
    const pageText = lines.map((l) => l.text).join("\n");
    if (DATA_PAGE.test(pageText)) continue;
    cands.push(...numberCandidates(p, lines));
  }
  cands.sort((a, b) => a.page - b.page || a.y0 - b.y0 || a.x0 - b.x0);

  let best: NumCand[] = [];
  for (const first of cands.filter((c) => c.n === 1)) {
    const col = first.x0;
    const seq = [first];
    for (const c of cands) {
      const last = seq[seq.length - 1];
      if (c.page < last.page || (c.page === last.page && c.y0 <= last.y1)) continue;
      if (c.n === last.n + 1 && Math.abs(c.x0 - col) < 14) seq.push(c);
      if (seq.length >= expected) break;
    }
    if (seq.length > best.length) best = seq;
  }
  return { starts: best, column: best[0]?.x0 ?? null };
}

/** Bottom of real content on a page (text or graphics), ignoring furniture. */
function contentBottom(p: PageData, lines: Line[], gfx: Graphic[]): number {
  let b = 0;
  for (const l of lines) b = Math.max(b, l.bbox[3]);
  for (const g of gfx) b = Math.max(b, g.bbox[3]);
  return b;
}
function contentTop(lines: Line[], gfx: Graphic[]): number {
  let t = Infinity;
  for (const l of lines) t = Math.min(t, l.bbox[1]);
  for (const g of gfx) t = Math.min(t, g.bbox[1]);
  return t;
}

/* ------------------------------------------------------------------ */

interface Item {
  piece: number;
  /** reading order key: piece index then y */
  line?: Line;
  words?: Word[];
  gfx?: Graphic;
}

interface LabelCand {
  label: OptionLabel;
  piece: number;
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  /** label is alone on its visual row (sits above its content) */
  alone: boolean;
  line: Line;
  word: Word;
}

function labelCandidates(items: Item[], bodySize: number): LabelCand[] {
  const out: LabelCand[] = [];
  for (const it of items) {
    if (!it.line || !it.words) continue;
    const ws = it.words;
    ws.forEach((w, i) => {
      const m = w.text.match(/^\(?([A-D])[.)]?$/);
      if (!m) return;
      const prevGap = i === 0 ? Infinity : w.x0 - ws[i - 1].x1;
      const nextGap = i === ws.length - 1 ? Infinity : ws[i + 1].x0 - w.x1;
      if (prevGap < 8 || nextGap < 4.5) return;
      // option labels are body-size or larger, upright
      if (w.chars[0].size < bodySize * 0.8) return;
      out.push({ label: m[1] as OptionLabel, piece: it.piece, x0: w.x0, x1: w.x1, y0: w.y0, y1: w.y1, alone: ws.length === 1, line: it.line!, word: w });
    });
  }
  return out;
}

type Layout = "list" | "row" | "grid";
function layoutOf(a: LabelCand, b: LabelCand, c: LabelCand, d: LabelCand, tol: number): Layout | null {
  const sameY = (p: LabelCand, q: LabelCand) => p.piece === q.piece && Math.abs(p.y0 - q.y0) < tol;
  const sameX = (p: LabelCand, q: LabelCand) => Math.abs(p.x0 - q.x0) < tol * 1.2;
  const below = (p: LabelCand, q: LabelCand) => q.piece > p.piece || (q.piece === p.piece && q.y0 > p.y1 - 1);
  if (sameX(a, b) && sameX(b, c) && sameX(c, d) && below(a, b) && below(b, c) && below(c, d)) return "list";
  if (sameY(a, b) && sameY(b, c) && sameY(c, d) && a.x0 < b.x0 && b.x0 < c.x0 && c.x0 < d.x0) return "row";
  if (sameY(a, b) && sameY(c, d) && sameX(a, c) && sameX(b, d) && a.x0 < b.x0 && below(a, c)) return "grid";
  return null;
}

/** Choose the last consistent A,B,C,D set in reading order. */
export function pickLabels(cands: LabelCand[], tol = 5): { labels: LabelCand[]; layout: Layout } | null {
  const ord = (x: LabelCand) => x.piece * 1e5 + x.y0 * 10 + x.x0 / 100;
  const by = (l: OptionLabel) => cands.filter((c) => c.label === l).sort((p, q) => ord(q) - ord(p));
  for (const d of by("D"))
    for (const c of by("C").filter((x) => ord(x) < ord(d)))
      for (const b of by("B").filter((x) => ord(x) < ord(c)))
        for (const a of by("A").filter((x) => ord(x) < ord(b))) {
          const lay = layoutOf(a, b, c, d, tol);
          if (lay) return { labels: [a, b, c, d], layout: lay };
        }
  return null;
}

const SHARED_RE = /(?:use|refer to|for|read)\b.{0,60}?\b(?:questions?|qns?\.?)\s*(\d{1,2})\s*(?:and|to|-|–|&)\s*(\d{1,2})/i;

interface SharedBlock {
  page: number;
  rect: Rect;
  from: number;
  to: number;
}

/** Preambles shared by several questions: from the matching line down to the next question number. */
function findSharedBlocks(pages: PageData[], body: Map<number, Line[]>, gfxBy: Map<number, Graphic[]>, starts: NumCand[], leftEdge: number, rightEdge: number): SharedBlock[] {
  const out: SharedBlock[] = [];
  for (const p of pages) {
    for (const l of body.get(p.index) ?? []) {
      const m = l.text.match(SHARED_RE);
      if (!m) continue;
      const from = Number(m[1]);
      const to = Number(m[2]);
      if (to < from || to - from > 5) continue;
      const nextStart = starts.find((s) => s.n === from);
      if (!nextStart || nextStart.page !== p.index || nextStart.y0 < l.bbox[1]) continue;
      // the line must not sit inside another question's own stem: it has to be the first thing after that question's content
      out.push({ page: p.index, rect: [leftEdge, l.bbox[1] - 3, rightEdge, nextStart.y0 - 3], from, to });
    }
  }
  void gfxBy;
  return out;
}

/** Merge 1-D intervals that touch (within tol). */
function mergeIntervals(iv: [number, number][], tol = 2): [number, number][] {
  const out: [number, number][] = [];
  for (const [a, b] of [...iv].sort((x, y) => x[0] - y[0])) {
    const last = out[out.length - 1];
    if (last && a <= last[1] + tol) last[1] = Math.max(last[1], b);
    else out.push([a, b]);
  }
  return out;
}

/**
 * Options set out as rows of a ruled table: a vertical rule (often drawn cell by cell) running through ≥2 option
 * rows, or a horizontal rule (often drawn in pieces) spanning a good part of the column near the options.
 */
export function detectTable(labels: { y0: number; y1: number }[], boxes: Rect[], columnWidth: number): boolean {
  if (labels.length < 2) return false;
  const top = Math.min(...labels.map((l) => l.y0)) - 30;
  const bottom = Math.max(...labels.map((l) => l.y1)) + 6;
  const near = boxes.filter((b) => b[3] > top && b[1] < bottom);
  const vByX = new Map<number, [number, number][]>();
  const hByY = new Map<number, [number, number][]>();
  for (const b of near) {
    if (rw(b) < 2.5 && rh(b) > 4) vByX.set(Math.round(b[0]), [...(vByX.get(Math.round(b[0])) ?? []), [b[1], b[3]]]);
    if (rh(b) < 2.5 && rw(b) > 4) hByY.set(Math.round(b[1]), [...(hByY.get(Math.round(b[1])) ?? []), [b[0], b[2]]]);
  }
  for (const iv of vByX.values())
    for (const [a, b] of mergeIntervals(iv)) if (labels.filter((l) => a < l.y0 && b > l.y1).length >= 2) return true;
  for (const iv of hByY.values()) if (mergeIntervals(iv).some(([a, b]) => b - a > columnWidth * 0.35)) return true;
  return false;
}

/* ------------------------------------------------------------------ */

export function splitPaper(pages: PageData[], expected = 30): SplitResult {
  const issues: string[] = [];
  const body = bodyLines(pages);
  const gfxBy = new Map(pages.map((p) => [p.index, bodyGraphics(p)]));
  const { starts, column } = findQuestionStarts(pages, body, expected);
  if (starts.length !== expected) issues.push(`found ${starts.length} question numbers, expected ${expected}`);
  if (!starts.length) return { questions: [], numberColumnX: null, issues };

  // body text size: most common char size in body lines
  const sizeCount = new Map<number, number>();
  for (const ls of body.values()) for (const l of ls) for (const c of l.chars) if (!/\s/.test(c.c)) sizeCount.set(Math.round(c.size * 2) / 2, (sizeCount.get(Math.round(c.size * 2) / 2) ?? 0) + 1);
  const bodySize = [...sizeCount].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 11;

  const pageBy = new Map(pages.map((p) => [p.index, p]));
  // right edge of the text block across the paper
  const rightEdge = Math.min(
    Math.max(...pages.map((p) => p.w)) - 20,
    Math.max(...[...body.values()].flat().map((l) => l.bbox[2])) + 6,
  );
  const leftEdge = (column ?? 50) - 4;

  const sharedBlocks = findSharedBlocks(pages, body, gfxBy, starts, leftEdge, rightEdge);
  if (sharedBlocks.length) issues.push(...sharedBlocks.map((b) => `shared context for Q${b.from}-Q${b.to} on page ${b.page + 1}`));

  const questions: SplitQuestion[] = [];
  for (let qi = 0; qi < starts.length; qi++) {
    const s = starts[qi];
    const next = starts[qi + 1];
    const flags: string[] = [];
    const pieces: Piece[] = [];
    // pages covered
    let lastPage = next ? next.page : s.page;
    if (!next) {
      // last question: may run onto following pages until END OF PAPER / blank
      for (let pi = s.page + 1; pi < s.page + 3; pi++) {
        const p = pageBy.get(pi);
        if (!p) break;
        const ls = body.get(pi) ?? [];
        const text = ls.map((l) => l.text).join(" ");
        if (!ls.length || END_MARK.test(text) && ls.length < 3 || /solution|answer/i.test(text.slice(0, 200))) break;
        if (numberCandidates(p, ls).some((c) => Math.abs(c.x0 - s.x0) < 14)) break;
        lastPage = pi;
      }
    }
    const meaningful = (pi: number, rect: Rect) => {
      const ls = (body.get(pi) ?? []).filter((l) => contains(rect, l.bbox, 2) && l.text.trim() && !/blank page/i.test(l.text) && !END_MARK.test(l.text));
      const gs = (gfxBy.get(pi) ?? []).filter((g) => contains(rect, g.bbox, 2) && g.bbox[0] > leftEdge - 2 && g.bbox[2] < rightEdge + 2 && rw(g.bbox) > 12 && rh(g.bbox) > 12);
      return ls.length > 0 || gs.length > 0;
    };
    for (let pi = s.page; pi <= lastPage; pi++) {
      const p = pageBy.get(pi)!;
      const ls = (body.get(pi) ?? []).filter((l) => !/blank page/i.test(l.text));
      const gs = (gfxBy.get(pi) ?? []).filter((g) => g.bbox[0] > leftEdge - 2 && g.bbox[2] < rightEdge + 2);
      const top = pi === s.page ? s.y0 - 3 : Math.max(p.h * 0.06, contentTop(ls, gs) - 3);
      let bottom: number;
      if (next && pi === next.page) bottom = next.y0 - 3;
      else bottom = contentBottom(p, ls.filter((l) => !END_MARK.test(l.text)), gs) + 3;
      // a shared preamble for the following questions ends this question early
      const shared = sharedBlocks.find((b) => b.page === pi && b.rect[1] > top && b.rect[1] < bottom && b.from > s.n);
      if (shared) bottom = shared.rect[1] - 2;
      if (bottom - top < 4) continue;
      const rect: Rect = [leftEdge, top, rightEdge, bottom];
      if (pi !== s.page && !meaningful(pi, rect)) continue;
      pieces.push({ page: pi, rect });
    }
    // prepend shared context ("Use the following information to answer questions 7 and 8")
    for (const b of sharedBlocks) if (s.n >= b.from && s.n <= b.to && !(b.page === s.page && b.rect[1] >= s.y0)) {
      pieces.unshift({ page: b.page, rect: b.rect });
      flags.push("shared-context");
    }
    if (!pieces.length) {
      issues.push(`Q${s.n}: empty region`);
      continue;
    }
    if (pieces.length > 1) flags.push("spans-pages");

    // gather items inside pieces
    const items: Item[] = [];
    pieces.forEach((pc, k) => {
      for (const l of body.get(pc.page) ?? []) {
        if (l === s.line && lineWords(l).length === 1) continue;
        if (!contains(pc.rect, l.bbox, 2)) {
          if (!intersects(pc.rect, l.bbox)) continue;
        }
        if (END_MARK.test(l.text)) continue;
        let line = l;
        if (l === s.line) {
          // drop the number word itself
          const ws = lineWords(l);
          const keep = l.chars.filter((c) => c.x0 >= ws[0].x1 + 0.5);
          line = { ...l, chars: keep, text: keep.map((c) => c.c).join(""), bbox: [ws[1]?.x0 ?? l.bbox[0], l.bbox[1], l.bbox[2], l.bbox[3]] };
          if (!line.text.trim()) continue;
        }
        items.push({ piece: k, line, words: lineWords(line) });
      }
      for (const g of gfxBy.get(pc.page) ?? []) if (intersects(pc.rect, g.bbox, -1)) items.push({ piece: k, gfx: g });
    });

    // ---- options ----
    const picked = pickLabels(labelCandidates(items, bodySize));
    const textItems = items.filter((i) => i.line);
    const gfxItems = items.filter((i) => i.gfx);
    const isRule = (g: Graphic) => rh(g.bbox) < 1.6 && rw(g.bbox) < 90; // fraction bars / underlines
    const mathRules = gfxItems.filter((i) => isRule(i.gfx!));
    const realGfx = gfxItems.filter((i) => !isRule(i.gfx!));

    const options: SplitOption[] = [];
    let optionsHaveGraphics = false;
    let stemEnd = { piece: pieces.length - 1, y: Infinity }; // exclusive
    let optionLayout: SplitQuestion["optionLayout"] = "none";
    if (!picked) {
      flags.push("options-not-found");
    } else {
      optionLayout = picked.layout;
      const [A, B, C, D] = picked.labels;
      const end = { piece: pieces.length - 1, y: pieces[pieces.length - 1].rect[3] };
      const right = rightEdge;
      const cells: { piece: number; rect: Rect }[] = [];
      const firstTop = Math.min(...picked.labels.filter((l) => l.piece === A.piece).map((l) => l.y0));
      stemEnd = { piece: A.piece, y: firstTop - 1.5 };
      if (picked.layout === "list") {
        picked.labels.forEach((L, i) => {
          const nx = picked.labels[i + 1];
          const bottom = nx && nx.piece === L.piece ? nx.y0 - 1 : L.piece === end.piece ? end.y : pieces[L.piece].rect[3];
          cells.push({ piece: L.piece, rect: [L.x1 + 1.5, L.y0 - 2, right, bottom] });
        });
      } else if (picked.layout === "row") {
        const rowBottom = end.piece === A.piece ? end.y : pieces[A.piece].rect[3];
        picked.labels.forEach((L, i) => {
          const nx = picked.labels[i + 1];
          cells.push({ piece: L.piece, rect: [L.x1 + 1.5, L.y0 - 2, nx ? nx.x0 - 2 : right, rowBottom] });
        });
      } else {
        const xm = (A.x1 + B.x0) / 2;
        const rowsSame = A.piece === C.piece;
        const r1Bottom = rowsSame ? C.y0 - 2 : pieces[A.piece].rect[3];
        const r2Bottom = C.piece === end.piece ? end.y : pieces[C.piece].rect[3];
        const lx = (L: LabelCand) => (L.alone ? leftEdge : L.x1 + 1.5);
        const top = (L: LabelCand) => (L.alone ? L.y1 + 0.5 : L.y0 - 2);
        cells.push({ piece: A.piece, rect: [A.alone ? leftEdge : A.x1 + 1.5, top(A), xm, r1Bottom] });
        cells.push({ piece: B.piece, rect: [B.alone ? xm : B.x1 + 1.5, top(B), right, r1Bottom] });
        cells.push({ piece: C.piece, rect: [lx(C), top(C), xm, r2Bottom] });
        cells.push({ piece: D.piece, rect: [D.alone ? xm : D.x1 + 1.5, top(D), right, r2Bottom] });
      }

      // Option content can rise above its label (equation images, raised fractions): grow each cell's top to
      // include graphics/text that share the label's row, then keep neighbouring cells from overlapping.
      cells.forEach((cell, i) => {
        const L = picked.labels[i];
        const xs: [number, number] = [cell.rect[0], cell.rect[2]];
        let top = cell.rect[1];
        const touch = (b: Rect) => b[3] > L.y0 - 1 && b[1] < L.y1 + 1 && (b[0] + b[2]) / 2 >= xs[0] && (b[0] + b[2]) / 2 <= xs[1];
        for (const g of realGfx) if (g.piece === cell.piece && touch(g.gfx!.bbox)) top = Math.min(top, g.gfx!.bbox[1] - 2);
        for (const g of mathRules) if (g.piece === cell.piece && touch(g.gfx!.bbox)) top = Math.min(top, g.gfx!.bbox[1] - 2);
        for (const t of textItems) if (t.piece === cell.piece && touch(t.line!.bbox)) top = Math.min(top, t.line!.bbox[1] - 1);
        if (!(picked.layout === "grid" && L.alone)) cell.rect = [cell.rect[0], top, cell.rect[2], cell.rect[3]];
      });
      const overlapsX = (a: Rect, b: Rect) => Math.min(a[2], b[2]) - Math.max(a[0], b[0]) > 4;
      cells.forEach((c) => {
        for (const d of cells)
          if (d !== c && d.piece === c.piece && d.rect[1] > c.rect[1] + 2 && overlapsX(c.rect, d.rect)) c.rect = [c.rect[0], c.rect[1], c.rect[2], Math.min(c.rect[3], d.rect[1] - 0.5)];
      });
      // Cells with nothing below them (the last row) only extend through contiguous content, so page furniture,
      // crop marks or the next page's leftovers far below never become part of an option.
      cells.forEach((c, i) => {
        const capped = cells.some((d) => d !== c && d.piece === c.piece && d.rect[1] > c.rect[1] + 2 && overlapsX(c.rect, d.rect));
        if (capped) return;
        const L = picked.labels[i];
        let bottom = L.y1;
        const boxes = [
          ...realGfx.filter((g) => g.piece === c.piece).map((g) => g.gfx!.bbox),
          ...mathRules.filter((g) => g.piece === c.piece).map((g) => g.gfx!.bbox),
          ...textItems.filter((t) => t.piece === c.piece).map((t) => t.line!.bbox),
        ]
          .filter((b) => b[1] >= c.rect[1] - 2 && (b[0] + b[2]) / 2 >= c.rect[0] && (b[0] + b[2]) / 2 <= c.rect[2])
          .sort((a, b) => a[1] - b[1]);
        for (const b of boxes) if (b[1] <= bottom + 22) bottom = Math.max(bottom, b[3]);
        c.rect = [c.rect[0], c.rect[1], c.rect[2], Math.min(c.rect[3], bottom + 3)];
      });
      {
        const lastPiece = pieces.length - 1;
        const onLast = cells.filter((c) => c.piece === lastPiece);
        if (onLast.length === cells.length || onLast.length) {
          const b = Math.max(...onLast.map((c) => c.rect[3])) + 3;
          if (onLast.length && b < pieces[lastPiece].rect[3]) {
            const cut = items.filter((it) => {
              if (it.piece !== lastPiece) return false;
              const bb = it.line ? it.line.bbox : it.gfx!.bbox;
              if (bb[1] < b) return false;
              if (it.line) return it.line.text.trim().length > 0;
              return rw(bb) > 15 && rh(bb) > 15;
            });
            if (cut.length) flags.push("content-below-options");
            else pieces[lastPiece] = { ...pieces[lastPiece], rect: [pieces[lastPiece].rect[0], pieces[lastPiece].rect[1], pieces[lastPiece].rect[2], b] };
          }
        }
      }
      stemEnd = { piece: A.piece, y: Math.min(stemEnd.y, ...cells.filter((c) => c.piece === A.piece).map((c) => c.rect[1] - 0.5)) };

      // Options laid out as table rows (rules running across several options): never crop per option.
      const span = picked.labels.filter((l) => l.piece === A.piece);
      const isTable = picked.layout === "list" && detectTable(span, [...realGfx, ...mathRules].filter((g) => g.piece === A.piece).map((g) => g.gfx!.bbox), rightEdge - leftEdge);
      if (isTable) flags.push("table-options");

      const labelWords = new Set(picked.labels.map((l) => l.word));
      cells.forEach((cell, i) => {
        const inCell = (r: Rect) => {
          const [cx, cy] = center(r);
          return cx >= cell.rect[0] - 1 && cx <= cell.rect[2] + 1 && cy >= cell.rect[1] - 1 && cy <= cell.rect[3] + 1;
        };
        const gs = realGfx.filter((g) => g.piece === cell.piece && inCell(g.gfx!.bbox));
        const ls = textItems
          .filter((t) => t.piece === cell.piece)
          .map((t) => {
            // keep only the words in the cell (a row can hold several options), minus the label words
            const ws = t.words!.filter((w) => !labelWords.has(w) && inCell([w.x0, w.y0, w.x1, w.y1]));
            if (!ws.length) return null;
            const chars = ws.flatMap((w) => w.chars);
            const ln: Line = { bbox: [Math.min(...ws.map((w) => w.x0)), t.line!.bbox[1], Math.max(...ws.map((w) => w.x1)), t.line!.bbox[3]], chars, text: "" };
            // re-insert spaces between words
            ln.chars = ws.flatMap((w, k) => (k ? [{ ...w.chars[0], c: " " }, ...w.chars] : w.chars));
            ln.text = ln.chars.map((c) => c.c).join("");
            return ln;
          })
          .filter(Boolean) as Line[];
        const label = picked.labels[i].label;
        const verdict = judgeLines(ls, bodySize);
        const rules = mathRules.filter((g) => g.piece === cell.piece && inCell(g.gfx!.bbox));
        if (rules.length) verdict.reasons.push("fraction-rule");
        const text = linesToParagraphs(ls, bodySize).join(" ");
        const opt: SplitOption = { label, text: text || undefined, textOk: verdict.reasons.length === 0 && !!text };
        if (isTable) opt.textOk = false;
        if (gs.length && !isTable) {
          optionsHaveGraphics = true;
          // tight crop: union of graphics and the cell's text
          let r: Rect | null = null;
          for (const g of gs) r = union(r, g.gfx!.bbox);
          for (const l of ls) r = union(r, l.bbox);
          r = [Math.max(cell.rect[0], r![0] - 4), Math.max(cell.rect[1], r![1] - 4), Math.min(cell.rect[2], r![2] + 4), Math.min(cell.rect[3], r![3] + 4)];
          opt.crop = { pieces: [{ page: pieces[cell.piece].page, rect: r }] };
        }
        options.push(opt);
      });
      if (optionsHaveGraphics) {
        // every option becomes an image so the grid is uniform
        options.forEach((o, i) => {
          if (!o.crop) {
            const cell = cells[i];
            o.crop = { pieces: [{ page: pieces[cell.piece].page, rect: cell.rect }] };
            flags.push(`option-${o.label}-cell-crop`);
          }
        });
      }
    }

    // ---- stem ----
    const inStem = (piece: number, y: number) => piece < stemEnd.piece || (piece === stemEnd.piece && y < stemEnd.y);
    const stemLines = textItems.filter((t) => inStem(t.piece, (t.line!.bbox[1] + t.line!.bbox[3]) / 2));
    const stemGfx = realGfx.filter((g) => inStem(g.piece, g.gfx!.bbox[1] + 1));

    // figures: cluster graphics, then absorb text lines inside them (diagram labels)
    type Cluster = { piece: number; rect: Rect; lines: Set<Item> };
    const clusters: Cluster[] = [];
    for (const g of stemGfx) {
      const hit = clusters.find((c) => c.piece === g.piece && intersects(c.rect, g.gfx!.bbox, 10));
      if (hit) hit.rect = union(hit.rect, g.gfx!.bbox);
      else clusters.push({ piece: g.piece, rect: [...g.gfx!.bbox] as Rect, lines: new Set() });
    }
    let changed = true;
    while (changed) {
      changed = false;
      for (let i = 0; i < clusters.length; i++)
        for (let j = i + 1; j < clusters.length; j++)
          if (clusters[i].piece === clusters[j].piece && intersects(clusters[i].rect, clusters[j].rect, 8)) {
            clusters[i].rect = union(clusters[i].rect, clusters[j].rect);
            clusters[j].lines.forEach((l) => clusters[i].lines.add(l));
            clusters.splice(j, 1);
            changed = true;
            j--;
          }
      for (const c of clusters)
        for (const t of stemLines) {
          if (t.piece !== c.piece || c.lines.has(t)) continue;
          const b = t.line!.bbox;
          // a line belongs to the figure when it sits inside (or mostly inside) the figure box
          const inside = contains(c.rect, b, 6) || (intersects(c.rect, b, 2) && rw(b) < rw(c.rect) * 0.6 && rw(b) < 200);
          if (inside) {
            c.lines.add(t);
            const nr = union(c.rect, b);
            if (nr.some((v, k) => v !== c.rect[k])) changed = true;
            c.rect = nr;
          }
        }
    }
    // ignore specks (bullets, tiny marks)
    const figClusters = clusters.filter((c) => rw(c.rect) > 12 && rh(c.rect) > 8);
    const figLineSet = new Set<Item>();
    figClusters.forEach((c) => c.lines.forEach((l) => figLineSet.add(l)));
    const proseItems = stemLines.filter((t) => !figLineSet.has(t));
    const proseLines = proseItems.map((t) => t.line!);

    const stemVerdict = judgeLines(proseLines, bodySize);
    const stemRules = mathRules.filter((g) => inStem(g.piece, g.gfx!.bbox[1]) && !figClusters.some((c) => c.piece === g.piece && contains(c.rect, g.gfx!.bbox, 2)));
    if (stemRules.length) stemVerdict.reasons.push("fraction-rule");

    // paragraphs + figure positions: compute in reading order
    const paragraphs: string[] = [];
    const figures: SplitFigure[] = [];
    {
      type Block = { piece: number; y: number; kind: "text"; line: Line } | { piece: number; y: number; kind: "fig"; c: Cluster };
      const blocks: Block[] = [
        ...proseItems.map((t) => ({ piece: t.piece, y: t.line!.bbox[1], kind: "text" as const, line: t.line! })),
        ...figClusters.map((c) => ({ piece: c.piece, y: c.rect[1], kind: "fig" as const, c })),
      ].sort((a, b) => a.piece - b.piece || a.y - b.y);
      let buf: Line[] = [];
      const flush = () => {
        if (buf.length) paragraphs.push(...linesToParagraphs(buf, bodySize));
        buf = [];
      };
      for (const b of blocks) {
        if (b.kind === "text") buf.push(b.line);
        else {
          flush();
          const r: Rect = [...b.c.rect] as Rect;
          // don't let padding slice into the prose line above/below
          let top = r[1] - 5;
          let bot = r[3] + 5;
          for (const t of proseItems) {
            if (t.piece !== b.c.piece) continue;
            const lb = t.line!.bbox;
            if (lb[3] <= r[1] + 1 && lb[3] > top) top = lb[3] + 0.5;
            if (lb[1] >= r[3] - 1 && lb[1] < bot) bot = lb[1] - 0.5;
          }
          r[1] = top + 5;
          r[3] = bot - 5;
          figures.push({
            crop: { pieces: [{ page: pieces[b.c.piece].page, rect: [Math.max(leftEdge, r[0] - 5), r[1] - 5, Math.min(rightEdge + 4, r[2] + 5), r[3] + 5] }] },
            afterParagraph: paragraphs.length,
          });
        }
      }
      flush();
    }

    const stemText = plainText(stemLines.map((t) => t.line!));
    const stemPieces = pieces
      .map((pc, k) => {
        if (k > stemEnd.piece) return null;
        if (k === stemEnd.piece && Number.isFinite(stemEnd.y)) return { page: pc.page, rect: [pc.rect[0], pc.rect[1], pc.rect[2], stemEnd.y] as Rect };
        return pc;
      })
      .filter((p): p is Piece => !!p && rh(p.rect) > 3);
    // shift the crop right of the number column
    const contentLeft = s.restX ? Math.min(s.restX, ...stemLines.map((t) => t.line!.bbox[0]), ...stemGfx.map((g) => g.gfx!.bbox[0])) - 4 : leftEdge;
    const trimLeft = (p: Piece): Piece => ({ page: p.page, rect: [Math.max(leftEdge, Math.min(contentLeft, p.rect[0] + 40)), p.rect[1], p.rect[2], p.rect[3]] });

    const optionsTextOk = options.length === 4 && (optionsHaveGraphics || options.every((o) => o.textOk));
    let renderMode: RenderMode;
    if (!picked) renderMode = "image";
    else if (!stemVerdict.ok || !paragraphs.length) renderMode = "image";
    else if (!optionsTextOk) renderMode = "image";
    else renderMode = figures.length ? "mixed" : "text";

    if (!stemVerdict.ok) flags.push(...stemVerdict.reasons.map((r) => `stem:${r}`));
    options.forEach((o) => {
      if (!optionsHaveGraphics && !o.textOk) flags.push(`option-${o.label}:low-text`);
    });
    if (renderMode === "image") flags.push("image-fallback");

    // image mode with text options: the stem crop must include the options (they're part of the picture)
    const stemCrop: CropSpec =
      renderMode === "image" && !optionsHaveGraphics ? { pieces: pieces.map(trimLeft) } : { pieces: stemPieces.map(trimLeft) };

    questions.push({
      number: s.n,
      page: s.page,
      pieces,
      stemParagraphs: paragraphs,
      stemText,
      stemOk: stemVerdict.ok,
      stemReasons: stemVerdict.reasons,
      figures,
      options,
      optionLayout,
      optionsHaveGraphics,
      renderMode,
      stemCrop,
      fullCrop: { pieces: pieces.map(trimLeft) },
      flags,
    });
  }
  return { questions, numberColumnX: column, issues };
}
