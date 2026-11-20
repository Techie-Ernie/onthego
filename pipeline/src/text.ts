/**
 * Turning positioned characters into text: words, superscript/subscript → LaTeX, and a confidence verdict.
 * Rule of thumb: when in doubt, report low confidence so the question falls back to an image.
 */
import type { Char, Line } from "./pdf";

export interface Word {
  chars: Char[];
  text: string;
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

export function lineWords(line: Line): Word[] {
  const words: Word[] = [];
  let cur: Char[] = [];
  const flush = () => {
    if (cur.length) {
      words.push({
        chars: cur,
        text: cur.map((c) => c.c).join(""),
        x0: Math.min(...cur.map((c) => c.x0)),
        x1: Math.max(...cur.map((c) => c.x1)),
        y0: Math.min(...cur.map((c) => c.y0)),
        y1: Math.max(...cur.map((c) => c.y1)),
      });
    }
    cur = [];
  };
  let prev: Char | null = null;
  for (const ch of line.chars) {
    if (/\s/.test(ch.c)) {
      flush();
      prev = null;
      continue;
    }
    if (prev && ch.x0 - prev.x1 > Math.max(1.8, prev.size * 0.28)) flush();
    cur.push(ch);
    prev = ch;
  }
  flush();
  return words;
}

const MATH_FONT = /symbol|mt-?extra|cambria-?math|cambriamath|euclid|mathtype|stix|wingding|webding|math/i;
const ODD = /[-�\u0000-\u0008\u000B\u000C\u000E-\u001F]/;

/** Mathematical alphanumerics (𝑔, 𝑡 …) → plain letters. */
export function normaliseMathAlnum(s: string): string {
  return [...s]
    .map((ch) => {
      const cp = ch.codePointAt(0)!;
      if (cp < 0x1d400 || cp > 0x1d7ff) return ch;
      if (cp >= 0x1d7ce) return String((cp - 0x1d7ce) % 10);
      const idx = (cp - 0x1d400) % 52;
      return String.fromCharCode(idx < 26 ? 65 + idx : 97 + idx - 26);
    })
    .join("");
}

export interface TextVerdict {
  ok: boolean;
  reasons: string[];
}

/** Inspect lines that will be shown as text. */
export function judgeLines(lines: Line[], bodySize: number): TextVerdict {
  const reasons = new Set<string>();
  for (const l of lines) {
    for (const c of l.chars) {
      if (ODD.test(c.c)) reasons.add("unmapped-glyph");
      if (MATH_FONT.test(c.font) && !/\s/.test(c.c)) reasons.add(`math-font:${c.font.replace(/^[A-Z]{6}\+/, "")}`);
      const cp = c.c.codePointAt(0)!;
      if (cp >= 0x1d400 && cp <= 0x1d7ff) reasons.add("math-alphanumerics");
      if (/[∫∑∏√∂∇]/.test(c.c)) reasons.add("math-operator");
    }
    const ws = lineWords(l);
    for (let i = 1; i < ws.length; i++) {
      if (ws[i].x0 - ws[i - 1].x1 > Math.max(14, bodySize * 1.4)) reasons.add("wide-gap");
    }
    // characters far off the baseline beyond normal super/subscripts (stacked fractions, limits)
    const base = dominantBaseline(l, bodySize);
    for (const c of l.chars) {
      if (/\s/.test(c.c)) continue;
      if (Math.abs(c.by - base) > bodySize * 0.6) reasons.add("off-baseline");
    }
    const mainChars = l.chars.filter((c) => !/\s/.test(c.c));
    if (mainChars.length && mainChars.length <= 6 && Math.max(...mainChars.map((c) => c.size)) < bodySize * 0.82) reasons.add("small-fragment");
  }
  // visual rows (MuPDF can split one printed row into several lines)
  const rows: Line[][] = [];
  for (const l of [...lines].filter((x) => x.text.trim()).sort((a, b) => a.bbox[1] - b.bbox[1])) {
    const row = rows.find((r) => Math.abs(r[0].bbox[1] - l.bbox[1]) < bodySize * 0.45 && Math.abs(r[0].bbox[3] - l.bbox[3]) < bodySize * 0.6);
    if (row) row.push(l);
    else rows.push([l]);
  }
  const rowBox = (r: Line[]) => [Math.min(...r.map((l) => l.bbox[0])), Math.min(...r.map((l) => l.bbox[1])), Math.max(...r.map((l) => l.bbox[2])), Math.max(...r.map((l) => l.bbox[3]))];
  for (const r of rows) {
    // separate lines on one row with a wide gap = a table / aligned columns
    const sorted = [...r].sort((a, b) => a.bbox[0] - b.bbox[0]);
    for (let i = 1; i < sorted.length; i++) if (sorted[i].bbox[0] - sorted[i - 1].bbox[2] > Math.max(14, bodySize * 1.4)) reasons.add("wide-gap");
  }
  rows.sort((a, b) => rowBox(a)[1] - rowBox(b)[1]);
  for (let i = 1; i < rows.length; i++) {
    const a = rowBox(rows[i - 1]);
    const b = rowBox(rows[i]);
    const vgap = b[1] - a[3];
    const hOverlap = Math.min(a[2], b[2]) - Math.max(a[0], b[0]);
    const wa = a[2] - a[0];
    const wb = b[2] - b[0];
    // centred numerator/denominator: close rows, overlapping, not left-aligned, at least one short
    if (vgap < bodySize * 0.9 && hOverlap > 0 && Math.abs(a[0] - b[0]) > 1.5 && (Math.min(wa, wb) < Math.max(wa, wb) * 0.6 || Math.max(wa, wb) < bodySize * 8)) reasons.add("stacked-rows");
  }
  // stacked lines: two lines overlapping horizontally while overlapping (or nearly touching) vertically
  const sorted = [...lines].sort((a, b) => a.bbox[1] - b.bbox[1]);
  for (let i = 0; i < sorted.length; i++) {
    for (let j = i + 1; j < sorted.length; j++) {
      const a = sorted[i].bbox;
      const b = sorted[j].bbox;
      if (b[1] > a[3] + 1) break;
      const hOverlap = Math.min(a[2], b[2]) - Math.max(a[0], b[0]);
      const vOverlap = Math.min(a[3], b[3]) - Math.max(a[1], b[1]);
      if (hOverlap > 2 && vOverlap > 1.5 && !(sorted[i].text.trim() === "" || sorted[j].text.trim() === "")) reasons.add("stacked-lines");
    }
  }
  return { ok: reasons.size === 0, reasons: [...reasons] };
}

export function dominantBaseline(l: Line, bodySize: number): number {
  const counts = new Map<number, number>();
  for (const c of l.chars) {
    if (/\s/.test(c.c) || c.size < bodySize * 0.85) continue;
    const k = Math.round(c.by * 2) / 2;
    counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  if (!counts.size) return l.chars[0]?.by ?? 0;
  return [...counts].sort((a, b) => b[1] - a[1])[0][0];
}

const GREEK: Record<string, string> = {
  α: "\\alpha", β: "\\beta", γ: "\\gamma", δ: "\\delta", ε: "\\varepsilon", θ: "\\theta", λ: "\\lambda", μ: "\\mu",
  π: "\\pi", ρ: "\\rho", σ: "\\sigma", τ: "\\tau", φ: "\\phi", ω: "\\omega", Δ: "\\Delta", Ω: "\\Omega", Φ: "\\Phi",
  η: "\\eta", ν: "\\nu", χ: "\\chi", ψ: "\\psi", κ: "\\kappa", Σ: "\\Sigma", Θ: "\\Theta", Λ: "\\Lambda",
};
const SYM: Record<string, string> = { "−": "-", "–": "-", "×": "\\times ", "÷": "\\div ", "±": "\\pm ", "°": "^{\\circ}", "∝": "\\propto ", "≈": "\\approx ", "≤": "\\le ", "≥": "\\ge ", "→": "\\rightarrow ", "½": "\\tfrac{1}{2}" };

function texChar(c: Char): string {
  const ch = c.c;
  if (GREEK[ch]) return GREEK[ch] + " ";
  if (SYM[ch]) return SYM[ch];
  if (/[A-Za-z]/.test(ch)) return c.italic ? ch : `\\mathrm{${ch}}`;
  if (/[{}%#&_$]/.test(ch)) return `\\${ch}`;
  if (ch === "\\") return "\\backslash ";
  if (ch === "^") return "\\hat{}";
  if (ch === "~") return "\\sim ";
  return ch;
}
function tex(chars: Char[]): string {
  return chars
    .map(texChar)
    .join("")
    .replace(/\\mathrm\{([A-Za-z])\}(?:\\mathrm\{([A-Za-z])\})+/g, (m) => `\\mathrm{${m.replace(/\\mathrm\{|\}/g, "")}}`);
}

/**
 * Convert one line to text with $…$ only around super/subscripted runs (base + script).
 * Plain characters stay plain; a literal $ is escaped.
 */
export function lineToText(l: Line, bodySize: number): string {
  const base = dominantBaseline(l, bodySize);
  type Kind = "n" | "sup" | "sub";
  const kindOf = (c: Char): Kind => {
    if (/\s/.test(c.c)) return "n";
    const small = c.size < bodySize * 0.86;
    if (small && c.by < base - bodySize * 0.12) return "sup";
    if (small && c.by > base + bodySize * 0.06) return "sub";
    return "n";
  };
  const out: string[] = [];
  let plain: Char[] = [];
  const chars = l.chars;
  let i = 0;
  const flushPlain = (keepTail: number) => {
    const head = plain.slice(0, plain.length - keepTail);
    out.push(normaliseMathAlnum(head.map((c) => (c.c === "$" ? "\\$" : c.c)).join("")));
    plain = plain.slice(plain.length - keepTail);
  };
  while (i < chars.length) {
    const k = kindOf(chars[i]);
    if (k === "n") {
      plain.push(chars[i]);
      i++;
      continue;
    }
    // base: trailing non-space plain chars (max 8)
    let tail = 0;
    while (tail < plain.length && tail < 8 && !/\s/.test(plain[plain.length - 1 - tail].c)) tail++;
    flushPlain(tail);
    const baseChars = plain;
    plain = [];
    let math = tex(baseChars.map((c) => ({ ...c, c: normaliseMathAlnum(c.c) })));
    while (i < chars.length && kindOf(chars[i]) !== "n") {
      const kk = kindOf(chars[i]);
      const run: Char[] = [];
      while (i < chars.length && kindOf(chars[i]) === kk) run.push(chars[i++]);
      math += `${kk === "sup" ? "^" : "_"}{${tex(run.map((c) => ({ ...c, c: normaliseMathAlnum(c.c) })))}}`;
    }
    out.push(`$${math || "{}"}$`);
  }
  flushPlain(0);
  return out.join("").replace(/[ \t]+/g, " ").trim();
}

/** Join lines into paragraphs: a new paragraph when the vertical gap is large or the line starts left of the block. */
export function linesToParagraphs(lines: Line[], bodySize: number): string[] {
  const sorted = [...lines].filter((l) => l.text.trim()).sort((a, b) => a.bbox[1] - b.bbox[1] || a.bbox[0] - b.bbox[0]);
  // merge lines that share a visual row (MuPDF may split a row into several lines)
  const rows: Line[][] = [];
  for (const l of sorted) {
    const row = rows.find((r) => Math.abs(r[0].bbox[1] - l.bbox[1]) < bodySize * 0.45 && Math.abs(r[0].bbox[3] - l.bbox[3]) < bodySize * 0.6);
    if (row) row.push(l);
    else rows.push([l]);
  }
  const paras: string[] = [];
  let cur: string[] = [];
  let prevBottom: number | null = null;
  for (const r of rows) {
    r.sort((a, b) => a.bbox[0] - b.bbox[0]);
    const text = r.map((l) => lineToText(l, bodySize)).filter(Boolean).join(" ");
    const top = Math.min(...r.map((l) => l.bbox[1]));
    if (prevBottom !== null && top - prevBottom > bodySize * 0.9 && cur.length) {
      paras.push(cur.join(" "));
      cur = [];
    }
    cur.push(text);
    prevBottom = Math.max(...r.map((l) => l.bbox[3]));
  }
  if (cur.length) paras.push(cur.join(" "));
  return paras.map((p) => p.replace(/\s+/g, " ").trim()).filter(Boolean);
}

export function plainText(lines: Line[]): string {
  return normaliseMathAlnum(
    [...lines]
      .sort((a, b) => a.bbox[1] - b.bbox[1] || a.bbox[0] - b.bbox[0])
      .map((l) => l.text)
      .join(" "),
  )
    .replace(/\s+/g, " ")
    .trim();
}
