"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useBank, useSettings, useUserData } from "@/lib/hooks";
import { createQuiz, DEFAULT_CONFIG, poolFor } from "@/lib/quiz/session";
import { effectiveLength } from "@/lib/quiz/build";
import { store, newId } from "@/lib/store/store";
import type { PoolMode, Preset, QuizConfig } from "@/lib/store/schema";
import { SECTIONS, TOPIC_BY_ID } from "@/subjects/topics";
import { activeSubject } from "@/subjects";
import { Chip, Section, Segmented, Skeleton } from "@/components/ui/controls";

const POOLS: { value: PoolMode; label: string; hint: string }[] = [
  { value: "all", label: "All", hint: "Any matching question" },
  { value: "unseen", label: "Unseen", hint: "Questions you haven't attempted" },
  { value: "wrong", label: "Got wrong", hint: "Questions you've missed before" },
  { value: "due", label: "Due review", hint: "Spaced-repetition reviews due today" },
  { value: "weak", label: "Weak topics", hint: "Chapters where your accuracy is lowest" },
  { value: "bookmarked", label: "Bookmarked", hint: "Questions you saved" },
];
const LENGTHS = [5, 10, 15, 20, 30];
const MINUTES = [5, 10, 15, 30, 60];

/** Reads ?pool=due&chapter=x&start=1 so Home / Insights can deep-link a ready quiz. */
export function BuildClient() {
  const params = useSearchParams();
  return <BuildForm key={params.toString()} params={params} />;
}

function BuildForm({ params }: { params: URLSearchParams }) {
  const router = useRouter();
  const { index, error } = useBank();
  const { data: user, error: userError } = useUserData();
  const { settings, error: settingsError } = useSettings();
  const [config, setConfig] = useState<QuizConfig | null>(null);
  const [timeBoxed, setTimeBoxed] = useState(false);
  const [more, setMore] = useState(false);
  const [presets, setPresets] = useState<Preset[]>([]);
  const startLock = useRef(false);
  const attemptedAutoStart = useRef(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  // defaults from settings + URL
  useEffect(() => {
    if (!settings) return;
    const pool = params.get("pool") as PoolMode | null;
    const chapters = params.getAll("chapter");
    const types = params.getAll("type");
    const timer = params.get("timer") as QuizConfig["timer"] | null;
    const length = Number(params.get("n"));
    const ids = (params.get("ids") ?? "").split(",").filter(Boolean);
    setConfig({
      ...DEFAULT_CONFIG,
      length: Number.isSafeInteger(length) && length > 0 ? length : settings.defaultLength,
      feedback: settings.feedback,
      timer: timer && ["off", "overall", "per-question"].includes(timer) ? timer : settings.timer,
      examPace: settings.examPace,
      ...(POOLS.some((o) => o.value === pool) && pool ? { pool } : {}),
      ...(ids.length ? { ids } : {}),
      ...(chapters.length ? { chapters } : {}),
      ...(types.length ? { types } : {}),
    });
  }, [settings, params]);
  useEffect(() => {
    store().listPresets().then(setPresets).catch(() => {});
  }, []);

  const cfg = useMemo<QuizConfig>(() => ({ ...DEFAULT_CONFIG, ...config, minutes: timeBoxed ? config?.minutes ?? 15 : undefined }), [config, timeBoxed]);
  const pool = useMemo(() => (index ? poolFor(index, cfg, user) : []), [index, cfg, user]);
  const want = cfg.ids?.length || effectiveLength(cfg, activeSubject.mcqPaper.minutesPerQuestion);
  const n = Math.min(want, pool.length);

  // per-chapter counts under the other filters (so chips show what's available)
  const chapterCounts = useMemo(() => {
    if (!index) return {} as Record<string, number>;
    const all = poolFor(index, { ...cfg, chapters: [] }, user);
    const m: Record<string, number> = {};
    for (const q of all) if (q.chapter) m[q.chapter] = (m[q.chapter] ?? 0) + 1;
    return m;
  }, [index, cfg, user]);
  const unclassified = index?.questions.filter((q) => q.status === "published" && !q.chapter).length ?? 0;
  const schools = useMemo(() => [...new Set(index?.questions.flatMap((q) => q.schools) ?? [])].sort(), [index]);
  const years = useMemo(() => [...new Set(index?.questions.flatMap((q) => q.years) ?? [])].sort((a, b) => b - a), [index]);

  const updateConfig = (update: (c: QuizConfig) => QuizConfig) => setConfig((c) => c && update(c));
  const toggle = <K extends "chapters" | "types" | "schools">(k: K, v: string) =>
    updateConfig((c) => ({ ...c, [k]: c[k].includes(v) ? c[k].filter((x) => x !== v) : [...c[k], v] }));

  const start = useCallback(async (c: QuizConfig = cfg) => {
    if (!index || !user || startLock.current) return;
    startLock.current = true;
    setBusy(true);
    setMsg(null);
    try {
      const quiz = await createQuiz(index, c, user);
      if (quiz) {
        if (params.get("start") === "1") router.replace(`/quiz?id=${quiz.id}`);
        else router.push(`/quiz?id=${quiz.id}`);
        return;
      }
      setMsg("No questions match. Loosen a filter or switch the pool to All.");
    } catch {
      setMsg("Couldn’t start a quiz. Try again.");
    }
    startLock.current = false;
    setBusy(false);
  }, [cfg, index, params, router, user]);

  const autostart = params.get("start") === "1";
  useEffect(() => {
    if (!autostart || !index || !user || !config || attemptedAutoStart.current) return;
    attemptedAutoStart.current = true;
    void start();
  }, [autostart, config, index, start, user]);

  const savePreset = async () => {
    const name = prompt("Name this preset", cfg.chapters.length === 1 ? TOPIC_BY_ID[cfg.chapters[0]]?.name : "My quiz");
    if (!name) return;
    const p: Preset = { id: newId(), name, config: cfg, updatedAt: Date.now(), deviceId: "" };
    await store().putPreset(p);
    setPresets(await store().listPresets());
  };

  if (error || userError || settingsError) return <p role="alert" className="text-bad">{error || userError || settingsError}</p>;
  if (!index || !config || !user || (autostart && !msg)) return <Skeleton lines={6} />;

  return (
    <div className="flex flex-col gap-7 pb-40">
      <header className="flex flex-col gap-1">
        <h1 className="text-[28px] leading-tight">Build a quiz</h1>
        <p className="m-0 text-muted">Pick what to practise. Everything is optional.</p>
      </header>

      {presets.length > 0 && (
        <Section title="Presets">
          <div className="flex flex-wrap gap-2">
            {presets.map((p) => (
              <span key={p.id} className="inline-flex max-w-full items-center">
                <button type="button" className="chip min-w-0 wrap-anywhere text-left" disabled={busy} onClick={() => start(p.config)}>
                  {p.name}
                </button>
                <button
                  type="button"
                  aria-label={`Delete preset ${p.name}`}
                  className="chip shrink-0 px-3 text-muted"
                  onClick={async () => {
                    await store().deletePreset(p.id);
                    setPresets(await store().listPresets());
                  }}
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        </Section>
      )}

      {!!cfg.ids?.length && (
        <Section title="Selected questions">
          <p className="m-0 text-muted">{cfg.ids.length} questions selected from your review list.</p>
          <button type="button" className="chip self-start" onClick={() => updateConfig((c) => ({ ...c, ids: undefined }))}>Clear selection</button>
        </Section>
      )}

      <Section title="From">
        <Segmented label="Question pool" value={cfg.pool} options={POOLS} onChange={(pool) => updateConfig((c) => ({ ...c, pool }))} />
      </Section>

      <Section
        title="Chapters"
        aside={
          cfg.chapters.length > 0 && (
            <button type="button" className="min-h-11 text-[14px] font-medium underline underline-offset-4" onClick={() => updateConfig((c) => ({ ...c, chapters: [] }))}>
              Clear ({cfg.chapters.length})
            </button>
          )
        }
      >
        <div className="flex flex-col gap-4">
          {SECTIONS.map((s) => (
            <div key={s.id} className="flex flex-col gap-2">
              <span className="text-[14px] text-ink-2">{s.name}</span>
              <div className="flex flex-wrap gap-2">
                {s.topicIds.map((t) => (
                  <Chip key={t} on={cfg.chapters.includes(t)} onClick={() => toggle("chapters", t)} count={chapterCounts[t] ?? 0}>
                    {TOPIC_BY_ID[t]?.name ?? t}
                  </Chip>
                ))}
              </div>
            </div>
          ))}
          {unclassified > 0 && <p className="m-0 text-[13px] text-muted">{unclassified} questions aren&apos;t sorted into chapters yet; they appear only when no chapter is selected.</p>}
        </div>
      </Section>

      <Section title="Length">
        <Segmented
          label="Length mode"
          value={timeBoxed ? "time" : "count"}
          options={[
            { value: "count", label: "Questions" },
            { value: "time", label: "Minutes" },
          ]}
          onChange={(v) => setTimeBoxed(v === "time")}
        />
        {timeBoxed ? (
          <Segmented
            label="Minutes"
            value={cfg.minutes ?? 15}
            options={MINUTES.map((m) => ({ value: m, label: `${m} min` }))}
            onChange={(minutes) => updateConfig((c) => ({ ...c, minutes }))}
          />
        ) : (
          <Segmented label="Questions" value={cfg.length} options={LENGTHS.map((l) => ({ value: l, label: String(l) }))} onChange={(length) => updateConfig((c) => ({ ...c, length }))} />
        )}
      </Section>

      <Section title="Feedback">
        <Segmented
          label="Feedback"
          value={cfg.feedback}
          options={[
            { value: "immediate", label: "After each question", hint: "See the answer and explanation straight away" },
            { value: "exam", label: "At the end (exam)", hint: "No feedback until you submit" },
          ]}
          onChange={(feedback) => updateConfig((c) => ({ ...c, feedback }))}
        />
      </Section>

      <Section title="Timer">
        <Segmented
          label="Timer"
          value={cfg.timer}
          options={[
            { value: "off", label: "Off" },
            { value: "overall", label: "Countdown", hint: `${activeSubject.mcqPaper.minutesPerQuestion} min per question (exam pace)` },
            { value: "per-question", label: "Pace per question", hint: "Shows a pace bar for each question" },
          ]}
          onChange={(timer) => updateConfig((c) => ({ ...c, timer }))}
        />
      </Section>

      <div>
        <button type="button" className="min-h-11 text-left text-[15px] font-medium underline underline-offset-4" aria-expanded={more} onClick={() => setMore((m) => !m)}>
          {more ? "Fewer filters" : "More filters: type, difficulty, figures, school, year"}
        </button>
      </div>

      {more && (
        <>
          <Section title="Question type">
            <div className="flex flex-wrap gap-2">
              {activeSubject.questionTypes.map((t) => (
                <Chip key={t.id} on={cfg.types.includes(t.id)} onClick={() => toggle("types", t.id)}>
                  <span title={t.description}>{t.name}</span>
                </Chip>
              ))}
            </div>
          </Section>
          <Section title={`Difficulty ${cfg.difficulty[0]}–${cfg.difficulty[1]}`}>
            <Segmented
              label="Difficulty"
              value={`${cfg.difficulty[0]}-${cfg.difficulty[1]}`}
              options={[
                { value: "1-5", label: "Any" },
                { value: "1-2", label: "Easier" },
                { value: "3-3", label: "Typical" },
                { value: "4-5", label: "Harder" },
              ]}
              onChange={(v) => updateConfig((c) => ({ ...c, difficulty: v.split("-").map(Number) as [number, number] }))}
            />
          </Section>
          <Section title="Figures">
            <Segmented
              label="Figures"
              value={cfg.figure}
              options={[
                { value: "any", label: "Any" },
                { value: "with", label: "With diagrams" },
                { value: "without", label: "Text only" },
              ]}
              onChange={(figure) => updateConfig((c) => ({ ...c, figure }))}
            />
          </Section>
          <Section title="School">
            <div className="flex flex-wrap gap-2">
              {schools.map((s) => (
                <Chip key={s} on={cfg.schools.includes(s)} onClick={() => toggle("schools", s)}>
                  {s}
                </Chip>
              ))}
            </div>
          </Section>
          {years.length > 1 && (
            <Section title="Year">
              <div className="flex flex-wrap gap-2">
                {years.map((y) => (
                  <Chip key={y} on={cfg.years.includes(y)} onClick={() => updateConfig((c) => ({ ...c, years: c.years.includes(y) ? c.years.filter((x) => x !== y) : [...c.years, y] }))}>
                    {y}
                  </Chip>
                ))}
              </div>
            </Section>
          )}
        </>
      )}

      {/* sticky start bar with live count */}
      <div className="build-actions fixed inset-x-0 bottom-[calc(65px+var(--safe-b))] z-10 border-t border-line bg-bg/95 backdrop-blur">
        <div className="mx-auto flex max-w-[720px] flex-wrap items-center gap-2 px-4 py-3">
          <div className="flex min-w-0 flex-1 flex-col" aria-live="polite">
            <span className="font-mono text-[15px] tabular-nums">
              {n} {n === 1 ? "question" : "questions"}
              {timeBoxed ? ` · ${cfg.minutes} min` : ""}
            </span>
            <span className="text-[13px] leading-tight text-muted">{pool.length} match{pool.length < want ? " (fewer than you asked for)" : ""}</span>
          </div>
          <button type="button" className="btn btn--secondary" aria-label="Save quiz preset" onClick={savePreset} disabled={!pool.length}>
            Save
          </button>
          <button type="button" className="btn btn--primary" onClick={() => start()} disabled={busy || !pool.length}>
            {busy ? "Starting…" : "Start"}
          </button>
        </div>
        {msg && <p role="alert" className="mx-auto max-w-[720px] px-4 pb-2 text-[14px] text-bad">{msg}</p>}
      </div>
    </div>
  );
}
