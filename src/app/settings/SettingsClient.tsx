"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useBank, useSettings } from "@/lib/hooks";
import { store } from "@/lib/store/store";
import type { Report, Settings, UserDataExport } from "@/lib/store/schema";
import { cachedTopics, downloadTopic, dropTopic } from "@/lib/offline";
import { Section, Segmented, Skeleton } from "@/components/ui/controls";
import { topicName } from "@/subjects/topics";
import { schoolName } from "@/subjects/schools";
import { activeSubject } from "@/subjects";

const mb = (b: number) => `${(b / 1e6).toFixed(b < 1e6 ? 2 : 1)} MB`;

export function SettingsClient() {
  const { settings, save, error: settingsError } = useSettings();
  const { index, error: bankError } = useBank();
  const [cached, setCached] = useState<Set<string>>(new Set());
  const [progress, setProgress] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<string | null>(null);
  const [reports, setReports] = useState<Report[]>([]);
  const downloads = useRef(new Set<string>());
  const file = useRef<HTMLInputElement>(null);

  useEffect(() => {
    cachedTopics().then(setCached).catch(() => {});
    store().listReports().then(setReports).catch(() => {});
  }, []);

  if (settingsError) return <p role="alert">{settingsError}</p>;
  if (!settings) return <Skeleton lines={6} />;

  const setTheme = (theme: Settings["theme"]) => {
    save({ theme });
    try {
      if (theme === "system") {
        localStorage.removeItem("otg-theme");
        delete document.documentElement.dataset.theme;
      } else {
        localStorage.setItem("otg-theme", theme);
        document.documentElement.dataset.theme = theme;
      }
    } catch {}
  };

  const exportData = async () => {
    const data = await store().exportAll();
    const blob = new Blob([JSON.stringify(data, null, 1)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `onthego-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };
  const importData = async (f: File, mode: "merge" | "replace") => {
    try {
      const data = JSON.parse(await f.text()) as UserDataExport;
      if (mode === "replace" && !confirm("Replace ALL progress on this device with the file's contents?")) return;
      const r = await store().importAll(data, mode);
      setMsg(`Imported: ${r.added} new, ${r.updated} updated records.`);
    } catch (e) {
      setMsg(`Import failed: ${(e as Error).message}`);
    }
  };

  const download = async (shard: string) => {
    if (downloads.current.has(shard)) return;
    downloads.current.add(shard);
    setProgress((p) => ({ ...p, [shard]: "Starting…" }));
    try {
      const r = await downloadTopic(shard, (d, t) => setProgress((p) => ({ ...p, [shard]: `${d}/${t}` })));
      setProgress((p) => ({ ...p, [shard]: r.failed ? `${r.failed} files failed. Try again.` : "" }));
      setCached(await cachedTopics());
    } catch (e) {
      setProgress((p) => ({ ...p, [shard]: (e as Error).message }));
    } finally {
      downloads.current.delete(shard);
    }
  };

  const credits = new Map<string, Set<string>>();
  for (const q of index?.questions ?? []) {
    for (const school of q.schools) {
      const name = schoolName(school);
      const papers = credits.get(name) ?? new Set<string>();
      for (const year of q.years) {
        for (const exam of q.exams) {
          papers.add(`${year} ${exam === "Prelim" ? "Preliminary Examination" : exam}, Paper 1`);
        }
      }
      credits.set(name, papers);
    }
  }

  return (
    <div className="flex flex-col gap-8 pb-24">
      <h1 className="text-[28px] leading-tight">Settings</h1>

      <Section title="Appearance">
        <Segmented
          label="Theme"
          value={settings.theme}
          onChange={setTheme}
          options={[
            { value: "system", label: "System" },
            { value: "light", label: "Light" },
            { value: "dark", label: "Dark" },
          ]}
        />
      </Section>

      <Section title="Quiz defaults">
        <Segmented label="Default length" value={settings.defaultLength} onChange={(defaultLength) => save({ defaultLength })} options={[5, 10, 15, 20, 30].map((v) => ({ value: v, label: `${v} questions` }))} />
        <Segmented
          label="Feedback"
          value={settings.feedback}
          onChange={(feedback) => save({ feedback })}
          options={[
            { value: "immediate", label: "After each question" },
            { value: "exam", label: "At the end" },
          ]}
        />
        <Segmented
          label="Timer"
          value={settings.timer}
          onChange={(timer) => save({ timer })}
          options={[
            { value: "off", label: "No timer" },
            { value: "overall", label: "Countdown" },
            { value: "per-question", label: "Pace bar" },
          ]}
        />
      </Section>

      <Section title="Offline" aside={<span className="label">{cached.size} downloaded</span>}>
        <p className="m-0 text-[14px] text-muted measure">Download a topic to practise it with no signal. The questions you&apos;re currently doing are always kept offline.</p>
        {bankError ? <p role="alert">Couldn’t load the topic list. Reconnect and try again.</p> : !index ? (
          <Skeleton />
        ) : (
          <ul className="m-0 flex list-none flex-col divide-y divide-[var(--line)] p-0">
            {index.shards
              .filter((s) => s.count > 0)
              .sort((a, b) => topicName(a.id).localeCompare(topicName(b.id)))
              .map((s) => {
                const on = cached.has(s.id) && !progress[s.id];
                const p = progress[s.id];
                return (
                  <li key={s.id} className="flex min-h-14 items-center gap-3 py-2">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[15px]">{topicName(s.id === "_unclassified" ? null : s.id)}</span>
                      <span className="block wrap-break-word text-[13px] text-muted" aria-live="polite">
                        {s.count} questions · {mb(s.jsonBytes + s.assetBytes)}
                        {p ? ` · ${p}` : ""}
                      </span>
                    </span>
                    {on ? (
                      <button
                        type="button"
                        className="chip"
                        onClick={async () => {
                          await dropTopic(s.id);
                          setCached(await cachedTopics());
                        }}
                      >
                        Remove
                      </button>
                    ) : (
                      <button type="button" className="chip" disabled={downloads.current.has(s.id)} onClick={() => download(s.id)}>
                        Download
                      </button>
                    )}
                  </li>
                );
              })}
          </ul>
        )}
      </Section>

      <Section title="Your data">
        <p className="m-0 text-[14px] text-muted measure">Progress is stored on this device only. There&apos;s no account. Export a backup to move it to another phone or browser.</p>
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn btn--secondary" onClick={exportData}>Export backup</button>
          <button type="button" className="btn btn--secondary" onClick={() => {
            if (file.current) {
              file.current.dataset.mode = "merge";
              file.current.click();
            }
          }}>Import (merge)</button>
          <button
            type="button"
            className="btn btn--secondary"
            onClick={() => {
              if (file.current) {
                file.current.dataset.mode = "replace";
                file.current.click();
              }
            }}
          >
            Import (replace)
          </button>
          <input
            ref={file}
            type="file"
            accept="application/json,.json"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              const mode = e.target.dataset.mode;
              e.target.dataset.mode = "";
              e.target.value = "";
              if (f) importData(f, mode === "replace" ? "replace" : "merge");
            }}
          />
        </div>
        {msg && <p className="m-0 text-[14px]" role="status">{msg}</p>}
        <button
          type="button"
          className="tap-target self-start text-[14px] text-bad underline underline-offset-4"
          onClick={async () => {
            if (!confirm("Delete all progress, bookmarks and presets on this device? Export a backup first if you want to keep them.")) return;
            await store().clearAll();
            setMsg("All local data deleted.");
          }}
        >
          Delete all my data
        </button>
      </Section>

      {reports.length > 0 && (
        <Section title={`Your reports (${reports.length})`}>
          <p className="m-0 text-[14px] text-muted">Reports are saved on this device and included in your backup file. Send the file to whoever maintains your copy of onthego.</p>
          <ul className="m-0 flex list-none flex-col gap-1 p-0 text-[14px]">
            {reports.map((r) => (
              <li key={r.id}>
                <Link href={`/q?id=${r.qid}`} className="tap-target underline underline-offset-4">{r.qid}</Link> · {r.kind.replace("-", " ")}
                {r.note ? ` · ${r.note}` : ""}
              </li>
            ))}
          </ul>
        </Section>
      )}

      <Section title="More">
        <div className="flex flex-col gap-3 text-[15px]">
          <Link href="/insights" className="tap-target underline underline-offset-4">Insights</Link>
          <Link href="/trends" className="tap-target underline underline-offset-4">Bank trends: what the papers test</Link>
          <Link href="/search" className="tap-target underline underline-offset-4">Search questions</Link>
        </div>
      </Section>

      <Section title="Credits">
        {bankError ? <p role="alert">Couldn’t load school credits. Reconnect and try again.</p> : !index ? <Skeleton /> : (
          <ul className="m-0 list-none space-y-2 p-0 text-[14px] text-muted">
            {[...credits].sort(([a], [b]) => a.localeCompare(b)).map(([school, papers]) => (
              <li key={school}><span className="font-medium text-ink">{school}</span>{papers.size ? `: ${[...papers].sort().join(" · ")}` : ""}</li>
            ))}
          </ul>
        )}
        <p className="m-0 text-[14px] text-muted measure">Questions, answers and worked solutions are reproduced from these schools&apos; papers and answer keys for personal revision. All rights remain with the schools.</p>
      </Section>

      <Section title="About">
        <p className="m-0 text-[14px] text-muted measure">
          onthego · {activeSubject.name} ({activeSubject.code}).
          {index && ` Bank built ${new Date(index.builtAt).toLocaleDateString()}.`}
        </p>
      </Section>
    </div>
  );
}
