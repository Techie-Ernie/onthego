/**
 * Thin layer over MuPDF (WASM): per-page characters with geometry + fonts, and graphics boxes.
 * Everything downstream works on these plain objects so it can be unit-tested with synthetic pages.
 */
import * as mupdf from "mupdf";
import fs from "node:fs";

export type Rect = [number, number, number, number]; // x0, y0, x1, y1 (PDF points, origin top-left)

export interface Char {
  c: string;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  /** baseline y */
  by: number;
  size: number;
  font: string;
  bold: boolean;
  italic: boolean;
}

export interface Line {
  bbox: Rect;
  chars: Char[];
  text: string;
}

export interface Graphic {
  kind: "path" | "image";
  bbox: Rect;
}

export interface PageData {
  index: number; // 0-based
  w: number;
  h: number;
  lines: Line[];
  graphics: Graphic[];
}

/**
 * Documents are kept referenced for the life of the process: MuPDF-WASM's finalizer can crash
 * ("function signature mismatch" in fz_drop_document) when the GC frees some PDFs mid-run.
 * The CLI exits right after a run, so nothing leaks beyond it.
 */
const KEEP: mupdf.Document[] = [];
export function openPdf(file: string): mupdf.Document {
  const doc = mupdf.Document.openDocument(fs.readFileSync(file), "application/pdf");
  KEEP.push(doc);
  return doc;
}

const STROKE = () =>
  new mupdf.StrokeState({
    lineCap: "Butt",
    lineJoin: "Miter",
    lineWidth: 0,
    miterLimit: 10,
    dashCap: "Butt",
    startCap: "Butt",
    endCap: "Butt",
  } as never);

function transformRect(ctm: number[]): Rect {
  // unit square through ctm
  const pts = [
    [0, 0],
    [1, 0],
    [0, 1],
    [1, 1],
  ].map(([x, y]) => [ctm[0] * x + ctm[2] * y + ctm[4], ctm[1] * x + ctm[3] * y + ctm[5]]);
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

export function extractPage(doc: mupdf.Document, index: number): PageData {
  const page = doc.loadPage(index);
  const [bx0, by0, bx1, by1] = page.getBounds();
  const lines: Line[] = [];
  const st = page.toStructuredText("preserve-whitespace,use-cid-for-unknown-unicode");
  let cur: Line | null = null;
  st.walk({
    beginLine(bbox) {
      cur = { bbox: bbox as Rect, chars: [], text: "" };
    },
    onChar(c, origin, font, size, quad) {
      if (!cur) return;
      const xs = [quad[0], quad[2], quad[4], quad[6]];
      const ys = [quad[1], quad[3], quad[5], quad[7]];
      const name = font.getName();
      cur.chars.push({
        c,
        x0: Math.min(...xs),
        x1: Math.max(...xs),
        y0: Math.min(...ys),
        y1: Math.max(...ys),
        by: origin[1],
        size,
        font: name,
        bold: font.isBold() || /bold|black|heavy|semibold/i.test(name),
        italic: font.isItalic() || /italic|oblique/i.test(name),
      });
    },
    endLine() {
      if (cur && cur.chars.length) {
        cur.text = cur.chars.map((c) => c.c).join("");
        lines.push(cur);
      }
      cur = null;
    },
  });

  const graphics: Graphic[] = [];
  const ss = STROKE();
  const push = (kind: Graphic["kind"], r: Rect) => {
    if (!r.every(Number.isFinite)) return;
    graphics.push({ kind, bbox: r });
  };
  const dev = new mupdf.Device({
    fillPath(path: mupdf.Path, _eo: boolean, ctm: mupdf.Matrix) {
      push("path", path.getBounds(ss, ctm) as Rect);
    },
    strokePath(path: mupdf.Path, stroke: mupdf.StrokeState, ctm: mupdf.Matrix) {
      push("path", path.getBounds(stroke, ctm) as Rect);
    },
    fillImage(_img: mupdf.Image, ctm: mupdf.Matrix) {
      push("image", transformRect(ctm as number[]));
    },
    fillImageMask(_img: mupdf.Image, ctm: mupdf.Matrix) {
      push("image", transformRect(ctm as number[]));
    },
    fillShade(shade: mupdf.Shade) {
      push("path", shade.getBounds() as Rect);
    },
  } as never);
  page.run(dev, mupdf.Matrix.identity);
  dev.close();

  return { index, w: bx1 - bx0, h: by1 - by0, lines, graphics };
}

/** Renders a page to PNG bytes at `scale` (1 = 72 dpi). */
export function renderPagePng(doc: mupdf.Document, index: number, scale: number): Uint8Array {
  const page = doc.loadPage(index);
  const pix = page.toPixmap(mupdf.Matrix.scale(scale, scale), mupdf.ColorSpace.DeviceRGB, false, true);
  return pix.asPNG();
}

/* ---------- geometry helpers ---------- */
export const rw = (r: Rect) => r[2] - r[0];
export const rh = (r: Rect) => r[3] - r[1];
export function union(a: Rect | null, b: Rect): Rect {
  if (!a) return [...b] as Rect;
  return [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])];
}
export function intersects(a: Rect, b: Rect, pad = 0): boolean {
  return a[0] - pad < b[2] && b[0] - pad < a[2] && a[1] - pad < b[3] && b[1] - pad < a[3];
}
export function contains(outer: Rect, inner: Rect, pad = 0): boolean {
  return inner[0] >= outer[0] - pad && inner[1] >= outer[1] - pad && inner[2] <= outer[2] + pad && inner[3] <= outer[3] + pad;
}
export function center(r: Rect): [number, number] {
  return [(r[0] + r[2]) / 2, (r[1] + r[3]) / 2];
}
