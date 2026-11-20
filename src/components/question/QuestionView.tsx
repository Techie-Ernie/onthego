"use client";
import type { OptionLabel, Question, QuestionOption } from "@/lib/types";
import { MathText } from "./MathText";
import { PaperImage } from "./PaperImage";

export interface QuestionViewProps {
  q: Question;
  selected?: OptionLabel | null;
  onSelect?: (label: OptionLabel) => void;
  /** show right/wrong states */
  reveal?: boolean;
  disabled?: boolean;
  /** compact = review lists */
  compact?: boolean;
}

/**
 * Renders a question per the rendering policy:
 *  text / mixed: stem text (KaTeX) with figures where they appeared
 *  image: high-DPI crop of the question; A–D buttons below are always tappable
 *  image options: a labelled 2×2 grid of individually tappable option images
 */
export function QuestionView({ q, selected = null, onSelect, reveal = false, disabled = false }: QuestionViewProps) {
  const paragraphs = q.stem ? q.stem.split(/\n\n+/) : [];
  const figuresAfter = (i: number) => q.figures.filter((f) => (f.afterParagraph ?? (f.position === "stem-top" ? 0 : paragraphs.length)) === i);
  const optionsInImage = q.renderMode === "image" && q.options.every((o) => !o.text && !o.image);

  return (
    <div className="flex flex-col gap-4">
      {q.renderMode === "image" && q.stemImage ? (
        <PaperImage img={q.stemImage} />
      ) : (
        <div className="flex flex-col gap-3 text-[17px] leading-[1.6] text-ink">
          {figuresAfter(0).map((f) => (
            <PaperImage key={f.src} img={f} />
          ))}
          {paragraphs.map((p, i) => (
            <div key={i} className="flex flex-col gap-3">
              <p className="m-0 measure">
                <MathText text={p} />
              </p>
              {figuresAfter(i + 1).map((f) => (
                <PaperImage key={f.src} img={f} />
              ))}
            </div>
          ))}
          {/* figures that sit after all text (before the options) */}
          {q.figures
            .filter((f) => (f.afterParagraph ?? 0) > paragraphs.length)
            .map((f) => (
              <PaperImage key={f.src} img={f} />
            ))}
        </div>
      )}

      <div role="radiogroup" aria-label="Answer options" className={optionGridClass(q, optionsInImage)}>
        {q.options.map((o) => (
          <OptionButton key={o.label} o={o} q={q} selected={selected === o.label} reveal={reveal} disabled={disabled} onSelect={onSelect} labelOnly={optionsInImage} />
        ))}
      </div>
      {optionsInImage && <p className="label -mt-2 text-center">Options A–D are in the question above.</p>}
    </div>
  );
}

function optionGridClass(q: Question, labelOnly: boolean) {
  if (labelOnly) return "grid grid-cols-4 gap-2";
  if (q.optionLayout === "grid") return "grid grid-cols-2 gap-2";
  return "flex flex-col gap-2";
}

function OptionButton({
  o,
  q,
  selected,
  reveal,
  disabled,
  onSelect,
  labelOnly,
}: {
  o: QuestionOption;
  q: Question;
  selected: boolean;
  reveal: boolean;
  disabled: boolean;
  onSelect?: (l: OptionLabel) => void;
  labelOnly: boolean;
}) {
  const correct = o.label === q.answer;
  const state = reveal ? (correct ? "correct" : selected ? "wrong" : "idle") : selected ? "selected" : "idle";
  const ring = {
    idle: "border-line bg-card hover:border-[color-mix(in_oklab,var(--ink)_30%,transparent)]",
    selected: "border-ink bg-action-soft shadow-[inset_0_0_0_1px_var(--ink)]",
    correct: "border-good bg-good-soft shadow-[inset_0_0_0_1px_var(--good)]",
    wrong: "border-bad bg-bad-soft shadow-[inset_0_0_0_1px_var(--bad)]",
  }[state];
  const badge = {
    idle: "border-line text-ink",
    selected: "border-ink bg-ink text-bg",
    correct: "border-good bg-good text-card",
    wrong: "border-bad bg-bad text-card",
  }[state];
  const srState = reveal ? (correct ? ", correct answer" : selected ? ", your answer, incorrect" : "") : "";

  const label = (
    <span aria-hidden="true" className={`grid h-8 w-8 shrink-0 place-items-center rounded-full border text-[15px] font-medium ${badge}`}>
      {o.label}
    </span>
  );

  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      aria-label={labelOnly || o.image ? `Option ${o.label}${o.image ? `: ${o.image.alt}` : ""}${srState}` : undefined}
      disabled={disabled}
      onClick={() => onSelect?.(o.label)}
      className={`rounded-md border text-left transition-[border-color,background-color,transform] duration-150 active:scale-[0.99] disabled:cursor-default ${ring} ${
        labelOnly ? "flex min-h-14 items-center justify-center" : o.image ? "flex flex-col items-stretch gap-2 p-2" : "flex min-h-14 items-center gap-3 px-3 py-2"
      }`}
    >
      {labelOnly ? (
        <span className="text-[18px] font-medium">{o.label}</span>
      ) : o.image ? (
        <>
          <span className="flex items-center justify-between">
            {label}
            {reveal && correct && <span className="label text-good">Correct</span>}
          </span>
          <span className="paper flex justify-center p-1">
            <img src={o.image.src} alt="" width={o.image.w} height={o.image.h} loading="lazy" style={{ width: `min(100%, ${Math.round((o.image.w / 3) * 1.4)}px)`, height: "auto", maxHeight: 260, objectFit: "contain" }} />
          </span>
        </>
      ) : (
        <>
          {label}
          <span className="sr-only">Option {o.label}: </span>
          <span className="min-w-0 flex-1 text-[17px] leading-snug">
            <MathText text={o.text ?? ""} />
          </span>
          {srState && <span className="sr-only">{srState}</span>}
        </>
      )}
    </button>
  );
}
