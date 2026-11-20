import type { SrsCard } from "@/lib/store/schema";

/**
 * SM-2 (SuperMemo 2) with a grade derived from the attempt:
 *   5 confident & correct · 4 correct but slow (> 2× pace) · 3 correct but marked unsure · 2 correct but guessed
 *   1 wrong (and not guessed) · 0 wrong after a guess
 * grade < 3 resets reps (lapse) and shows the card again tomorrow.
 */
export const DAY = 86_400_000;
export const MIN_EF = 1.3;

export function gradeAttempt(a: { correct: boolean; guessed: boolean; unsure: boolean; timeMs: number }, paceMs = 90_000): number {
  if (!a.correct) return a.guessed ? 0 : 1;
  if (a.guessed) return 2;
  if (a.unsure) return 3;
  return a.timeMs > paceMs * 2 ? 4 : 5;
}

export function newCard(qid: string, now: number): Omit<SrsCard, "updatedAt" | "deviceId"> {
  return { id: qid, qid, ef: 2.5, interval: 0, reps: 0, lapses: 0, due: now, lastGrade: -1 };
}

export function review<T extends Pick<SrsCard, "ef" | "interval" | "reps" | "lapses" | "due" | "lastGrade">>(card: T, grade: number, now: number): T {
  const g = Math.max(0, Math.min(5, Math.round(grade)));
  let { ef, interval, reps, lapses } = card;
  if (g < 3) {
    reps = 0;
    interval = 1;
    lapses += 1;
  } else {
    reps += 1;
    interval = reps === 1 ? 1 : reps === 2 ? 6 : Math.round(interval * ef);
  }
  ef = Math.max(MIN_EF, ef + (0.1 - (5 - g) * (0.08 + (5 - g) * 0.02)));
  return { ...card, ef: Math.round(ef * 1000) / 1000, interval, reps, lapses, lastGrade: g, due: startOfDay(now) + interval * DAY };
}

/** Due "today" means due before the end of the local day, so a card due at 09:00 shows up in the morning session. */
export const startOfDay = (t: number) => {
  const d = new Date(t);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
};
export const isDue = (c: Pick<SrsCard, "due">, now: number) => c.due < startOfDay(now) + DAY;

/** Should an attempt create/advance an SRS card? Only questions you missed, guessed or were unsure on enter the deck. */
export const entersDeck = (a: { correct: boolean; guessed: boolean; unsure: boolean }) => !a.correct || a.guessed || a.unsure;
