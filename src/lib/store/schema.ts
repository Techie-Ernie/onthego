import type { OptionLabel } from "@/lib/types";

/**
 * User-data schema (v1). Stable and versioned so a server sync (docs/FUTURE.md) can merge records:
 * every record has `id`, `updatedAt` (ms) and `deviceId`; merge = last-writer-wins per record id.
 */
export const USER_SCHEMA_VERSION = 1;

export interface Rec {
  id: string;
  updatedAt: number;
  deviceId: string;
}

export type PoolMode = "all" | "unseen" | "wrong" | "bookmarked" | "weak" | "due";
export type FeedbackMode = "immediate" | "exam";

export interface QuizConfig {
  subject: string;
  chapters: string[]; // empty = all
  types: string[]; // empty = all
  difficulty: [number, number];
  schools: string[];
  years: number[];
  figure: "any" | "with" | "without";
  pool: PoolMode;
  /** number of questions; ignored when minutes is set */
  length: number;
  /** time-boxed: questions = floor(minutes / pace) */
  minutes?: number;
  timer: "off" | "overall" | "per-question";
  examPace: boolean;
  feedback: FeedbackMode;
  /** explicit question ids (retry-wrong, insight drills) */
  ids?: string[];
  label?: string;
}

export interface QuizAnswer {
  chosen: OptionLabel | null;
  guessed: boolean;
  unsure: boolean;
  flagged: boolean;
  timeMs: number;
  answeredAt?: number;
}

export interface Quiz extends Rec {
  createdAt: number;
  config: QuizConfig;
  qids: string[];
  answers: Record<string, QuizAnswer>;
  current: number;
  status: "active" | "finished" | "abandoned";
  finishedAt?: number;
  /** ms limit for an overall timer */
  timeLimitMs?: number;
  /** ms elapsed while the quiz screen was visible */
  elapsedMs: number;
}

export interface Attempt extends Rec {
  quizId: string;
  qid: string;
  chosen: OptionLabel | null;
  answer: OptionLabel;
  correct: boolean;
  guessed: boolean;
  unsure: boolean;
  timeMs: number;
  at: number;
  chapter: string | null;
  primaryType: string | null;
}

/** SM-2 state per question (only for questions ever missed / guessed / unsure). */
export interface SrsCard extends Rec {
  qid: string;
  ef: number;
  interval: number; // days
  reps: number;
  lapses: number;
  due: number; // ms epoch
  lastGrade: number;
}

export interface Bookmark extends Rec {
  qid: string;
}
export interface Preset extends Rec {
  name: string;
  config: QuizConfig;
}
export interface Report extends Rec {
  qid: string;
  kind: "wrong-answer" | "bad-crop" | "typo" | "bad-explanation" | "other";
  note: string;
  at: number;
  sent: boolean;
}
export interface Settings extends Rec {
  defaultLength: number;
  feedback: FeedbackMode;
  theme: "system" | "light" | "dark";
  examPace: boolean;
  timer: QuizConfig["timer"];
}

export interface UserDataExport {
  app: "onthego";
  schemaVersion: number;
  exportedAt: string;
  deviceId: string;
  quizzes: Quiz[];
  attempts: Attempt[];
  srs: SrsCard[];
  bookmarks: Bookmark[];
  presets: Preset[];
  reports: Report[];
  settings: Settings | null;
}

export const DEFAULT_SETTINGS: Omit<Settings, keyof Rec> = {
  defaultLength: 10,
  feedback: "immediate",
  theme: "system",
  examPace: false,
  timer: "off",
};
