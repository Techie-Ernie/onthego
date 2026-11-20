"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import type { BankIndex } from "@/lib/types";
import { loadIndex } from "@/lib/bank";
import { store } from "@/lib/store/store";
import type { Attempt, Bookmark, Settings, SrsCard } from "@/lib/store/schema";
import { isDue } from "@/lib/quiz/srs";
import type { ChapterStat, QStat } from "@/lib/quiz/build";

export function useBank() {
  const [index, setIndex] = useState<BankIndex | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    loadIndex().then(setIndex, (e) => setError(String(e?.message ?? e)));
  }, []);
  return { index, error };
}

export interface UserData {
  attempts: Attempt[];
  srs: SrsCard[];
  bookmarks: Bookmark[];
  stats: Record<string, QStat>;
  chapters: Record<string, ChapterStat>;
  dueCount: number;
}

export function deriveUserData(attempts: Attempt[], srs: SrsCard[], bookmarks: Bookmark[], now = Date.now()): UserData {
  const stats: Record<string, QStat> = {};
  const chapters: Record<string, ChapterStat> = {};
  for (const a of [...attempts].sort((x, y) => x.at - y.at)) {
    const s = (stats[a.qid] ??= { seen: 0, wrong: 0 });
    s.seen++;
    if (!a.correct) s.wrong++;
    s.lastCorrect = a.correct;
    if (a.chapter) {
      const c = (chapters[a.chapter] ??= { attempts: 0, correct: 0 });
      c.attempts++;
      if (a.correct) c.correct++;
    }
  }
  for (const b of bookmarks) (stats[b.qid] ??= { seen: 0, wrong: 0 }).bookmarked = true;
  let dueCount = 0;
  for (const c of srs)
    if (isDue(c, now)) {
      (stats[c.qid] ??= { seen: 0, wrong: 0 }).due = true;
      dueCount++;
    }
  return { attempts, srs, bookmarks, stats, chapters, dueCount };
}

export function useUserData() {
  const [data, setData] = useState<UserData | null>(null);
  const refresh = useCallback(async () => {
    const s = store();
    const [a, c, b] = await Promise.all([s.listAttempts(), s.listSrs(), s.listBookmarks()]);
    setData(deriveUserData(a, c, b));
  }, []);
  useEffect(() => {
    refresh();
  }, [refresh]);
  return { data, refresh };
}

export function useSettings() {
  const [settings, setSettings] = useState<Settings | null>(null);
  useEffect(() => {
    store().getSettings().then(setSettings);
  }, []);
  const save = useCallback(async (p: Partial<Settings>) => setSettings(await store().saveSettings(p)), []);
  return { settings, save };
}

/** Index entries by id, memoised. */
export function useIndexMap(index: BankIndex | null) {
  return useMemo(() => new Map((index?.questions ?? []).map((q) => [q.id, q])), [index]);
}
