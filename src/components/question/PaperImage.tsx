"use client";
import { useEffect, useRef, useState } from "react";
import type { ImageRef } from "@/lib/types";

/** Crops are rendered at 3 px per PDF point. 1.4 CSS px per point makes printed 11pt text read like our 16px body. */
const PX_PER_PT = 3;
const CSS_PER_PT = 1.4;

/**
 * An exam figure on a light "paper" card (never inverted in dark mode).
 * Shown at the size that matches the surrounding text, never upscaled, never squashed; tap to open full-screen
 * where it can be pinch-zoomed and panned.
 */
export function PaperImage({ img, className = "", zoomable = true, fill = false }: { img: ImageRef; className?: string; zoomable?: boolean; fill?: boolean }) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const natural = (img.w / PX_PER_PT) * CSS_PER_PT;
  const content = (
    <img
      src={img.src}
      alt={img.alt}
      width={img.w}
      height={img.h}
      loading="lazy"
      decoding="async"
      draggable={false}
      style={{ width: fill ? "100%" : `min(100%, ${Math.round(natural)}px)`, height: "auto" }}
    />
  );
  return (
    <>
      {zoomable ? (
        <button
          ref={trigger}
          type="button"
          aria-haspopup="dialog"
          onClick={() => setOpen(true)}
          className={`paper group relative block min-h-11 w-full cursor-zoom-in overflow-hidden p-2 text-left ${className}`}
          aria-label={`Enlarge: ${img.alt}`}
        >
          <span className="flex justify-center">{content}</span>
          <span aria-hidden="true" className="absolute right-2 bottom-2 rounded-full border border-[var(--paper-line)] bg-white/90 p-1.5 text-black opacity-70 transition-opacity group-hover:opacity-100">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3M11 8v6M8 11h6" /></svg>
          </span>
        </button>
      ) : (
        <div className={`paper flex justify-center p-2 ${className}`}>{content}</div>
      )}
      {open && <ZoomDialog img={img} onClose={() => {
        setOpen(false);
        trigger.current?.focus();
      }} />}
    </>
  );
}

function ZoomDialog({ img, onClose }: { img: ImageRef; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [scale, setScale] = useState(1);
  useEffect(() => {
    const d = ref.current;
    if (d && !d.open) d.showModal();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "+" || e.key === "=") setScale((s) => Math.min(4, s * 1.25));
      if (e.key === "-") setScale((s) => Math.max(0.5, s / 1.25));
    };
    d?.addEventListener("keydown", onKey);
    return () => d?.removeEventListener("keydown", onKey);
  }, []);
  const base = (img.w / PX_PER_PT) * CSS_PER_PT;
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => e.target === ref.current && ref.current?.close()}
      className="m-0 h-dvh max-h-none w-screen max-w-none bg-black/85 p-0 backdrop:bg-black/60"
      aria-label={img.alt}
    >
      <div className="flex h-full flex-col">
        <div className="flex items-center justify-between gap-2 px-3 pb-3 pt-[max(12px,env(safe-area-inset-top))] text-white">
          <span className="text-[13px] opacity-80">Pinch or use the buttons to zoom</span>
          <div className="flex gap-2">
            <button type="button" className="btn btn--secondary !min-h-11 !px-3" onClick={() => setScale((s) => Math.max(0.5, s / 1.25))} aria-label="Zoom out">−</button>
            <button type="button" className="btn btn--secondary !min-h-11 !px-3" onClick={() => setScale((s) => Math.min(4, s * 1.25))} aria-label="Zoom in">+</button>
            <button type="button" className="btn btn--secondary !min-h-11" onClick={() => ref.current?.close()} autoFocus>Close</button>
          </div>
        </div>
        <div className="flex-1 overflow-auto overscroll-contain" style={{ touchAction: "pan-x pan-y pinch-zoom" }}>
          <div className="grid min-h-full w-max min-w-full place-items-center p-4 pb-[calc(16px+var(--safe-b))]">
            <div className="paper p-3" style={{ width: base * scale, maxWidth: "none" }}>
              <img src={img.src} alt={img.alt} width={img.w} height={img.h} style={{ width: "100%", height: "auto" }} />
            </div>
          </div>
        </div>
      </div>
    </dialog>
  );
}
