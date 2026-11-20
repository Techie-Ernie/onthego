import katex from "katex";
import { Fragment, useMemo } from "react";

/** Split text on unescaped $…$ into plain and math segments. "\$" is a literal dollar. */
export function splitMath(src: string): { math: boolean; text: string }[] {
  const out: { math: boolean; text: string }[] = [];
  let buf = "";
  let inMath = false;
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (c === "\\" && src[i + 1] === "$") {
      buf += inMath ? "\\$" : "$";
      i++;
      continue;
    }
    if (c === "$") {
      if (buf) out.push({ math: inMath, text: buf });
      buf = "";
      inMath = !inMath;
      continue;
    }
    buf += c;
  }
  if (buf) out.push({ math: inMath, text: inMath ? "$" + buf : buf }); // unbalanced: show literally
  return out;
}

function renderKatex(tex: string): string {
  try {
    return katex.renderToString(tex, { throwOnError: true, output: "htmlAndMathml", strict: "ignore" });
  } catch {
    return "";
  }
}

/** Inline text with KaTeX math. Falls back to the raw source if KaTeX can't parse a segment. */
export function MathText({ text, className }: { text: string; className?: string }) {
  const parts = useMemo(() => splitMath(text).map((p) => (p.math ? { ...p, html: renderKatex(p.text) } : { ...p, html: "" })), [text]);
  return (
    <span className={className}>
      {parts.map((p, i) =>
        p.math && p.html ? (
          <span key={i} dangerouslySetInnerHTML={{ __html: p.html }} />
        ) : (
          <Fragment key={i}>{p.math ? `$${p.text}$` : p.text}</Fragment>
        ),
      )}
    </span>
  );
}
