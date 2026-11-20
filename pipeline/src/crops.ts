/**
 * Page rendering (cached PNG per page) and crop → WebP.
 * Crops are in PDF points; SCALE px per pt (3 = 216 dpi, comfortably ≥2× for phone screens).
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import sharp, { type Sharp } from "sharp";
import { execFileSync } from "node:child_process";
import type { Rect } from "./pdf";
import type { CropSpec } from "./split";
import { CACHE } from "./paths";

export const SCALE = 3;

export function fileHash(file: string): string {
  return crypto.createHash("sha1").update(fs.readFileSync(file)).digest("hex").slice(0, 16);
}

export class PageRenderer {
  private dir: string;
  constructor(
    private pdfFile: string,
    pdfHash: string,
  ) {
    this.dir = path.join(CACHE, "pages", pdfHash);
    fs.mkdirSync(this.dir, { recursive: true });
  }
  pagePath(index: number): string {
    const p = path.join(this.dir, `p${index + 1}@${SCALE}x.png`);
    if (!fs.existsSync(p)) {
      // poppler renders shadings/patterns that MuPDF-WASM rejects; 72*SCALE dpi
      const prefix = path.join(this.dir, `tmp-${index + 1}`);
      execFileSync("pdftoppm", ["-r", String(72 * SCALE), "-f", String(index + 1), "-l", String(index + 1), "-png", "-singlefile", "-aa", "yes", "-aaVector", "yes", this.pdfFile, prefix]);
      fs.renameSync(`${prefix}.png`, p);
    }
    return p;
  }
}

export interface CropOut {
  file: string; // absolute path in cache
  w: number;
  h: number;
  bytes: number;
  hash: string;
}

function clampRect(r: Rect, wPt: number, hPt: number): Rect {
  return [Math.max(0, r[0]), Math.max(0, r[1]), Math.min(wPt, r[2]), Math.min(hPt, r[3])];
}

/** Crop (and vertically stitch multi-page) a spec into a WebP file. Idempotent by content hash of the spec. */
export async function cropToWebp(
  renderer: PageRenderer,
  spec: CropSpec,
  pageSize: (page: number) => { w: number; h: number },
  outDir: string,
  name: string,
  opts: { trim?: boolean } = {},
): Promise<CropOut> {
  fs.mkdirSync(outDir, { recursive: true });
  const parts: Buffer[] = [];
  for (const pc of spec.pieces) {
    const { w, h } = pageSize(pc.page);
    const r = clampRect(pc.rect, w, h);
    const left = Math.floor(r[0] * SCALE);
    const top = Math.floor(r[1] * SCALE);
    const width = Math.max(1, Math.ceil((r[2] - r[0]) * SCALE));
    const height = Math.max(1, Math.ceil((r[3] - r[1]) * SCALE));
    const meta = await sharp(renderer.pagePath(pc.page)).metadata();
    const ext = { left, top, width: Math.min(width, meta.width! - left), height: Math.min(height, meta.height! - top) };
    parts.push(await sharp(renderer.pagePath(pc.page)).extract(ext).png().toBuffer());
  }
  let img: Sharp;
  // no pieces (a split failure): a small blank placeholder; the agent pass flags it unreadable → excluded
  if (parts.length === 0) img = sharp({ create: { width: 24, height: 24, channels: 3, background: "#ffffff" } });
  else if (parts.length === 1) img = sharp(parts[0]);
  else {
    const metas = await Promise.all(parts.map((p) => sharp(p).metadata()));
    const W = Math.max(...metas.map((m) => m.width!));
    const H = metas.reduce((s, m) => s + m.height!, 0) + (parts.length - 1) * 12;
    let y = 0;
    const comps = parts.map((p, i) => {
      const c = { input: p, left: 0, top: y };
      y += metas[i].height! + 12;
      return c;
    });
    img = sharp({ create: { width: W, height: H, channels: 3, background: "#ffffff" } }).composite(comps);
    img = sharp(await img.png().toBuffer());
  }
  if (opts.trim) {
    try {
      const trimmed = await img.clone().trim({ background: "#ffffff", threshold: 12 }).png().toBuffer();
      img = sharp(trimmed).extend({ top: 12, bottom: 12, left: 12, right: 12, background: "#ffffff" });
      img = sharp(await img.png().toBuffer());
    } catch {
      /* all-white crop: keep as is */
    }
  }
  const webp = await img.flatten({ background: "#ffffff" }).webp({ quality: 80, effort: 5 }).toBuffer();
  const meta = await sharp(webp).metadata();
  const hash = crypto.createHash("sha1").update(webp).digest("hex").slice(0, 10);
  const file = path.join(outDir, `${name}.webp`);
  fs.writeFileSync(file, webp);
  return { file, w: meta.width!, h: meta.height!, bytes: webp.length, hash };
}

/** 64-bit difference hash of an image file, for near-duplicate image detection. */
export async function dHash(file: string): Promise<string> {
  const { data } = await sharp(file).greyscale().resize(9, 8, { fit: "fill" }).raw().toBuffer({ resolveWithObject: true });
  let bits = "";
  for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) bits += data[y * 9 + x] > data[y * 9 + x + 1] ? "1" : "0";
  return BigInt("0b" + bits).toString(16).padStart(16, "0");
}
export function hamming(a: string, b: string): number {
  let x = BigInt("0x" + a) ^ BigInt("0x" + b);
  let n = 0;
  while (x) {
    n += Number(x & 1n);
    x >>= 1n;
  }
  return n;
}
