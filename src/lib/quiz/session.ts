"use client";
import type { BankIndex, OptionLabel, Question } from "@/lib/types";
import { store, newId } from "@/lib/store/store";
import type { Attempt, Quiz, QuizAnswer, QuizConfig, SrsCard } from "@/lib/store/schema";
import { candidatePool, effectiveLength, pickQuestions } from "./build";
import { entersDeck, gradeAttempt, newCard, review } from "./srs";
import type { UserData } from "@/lib/hooks";
import { activeSubject } from "@/subjects";

export const PACE_MS = activeSubject.mcqPaper.minutesPerQuestion * 60_000;

export function blankAnswer(): QuizAnswer {
  return { chosen: null, guessed: false, unsure: false, flagged: false, timeMs: 0 };
}

export function poolFor(index: BankIndex, config: QuizConfig, user: UserData | null) {
  return candidatePool(index.questions, config, user?.stats ?? {}, user?.chapters ?? {});
}

export async function createQuiz(index: BankIndex, config: QuizConfig, user: UserData | null): Promise<Quiz | null> {
  const pool = poolFor(index, config, user);
  const n = config.ids?.length ? config.ids.length : effectiveLength(config, activeSubject.mcqPaper.minutesPerQuestion);
  let qids = pickQuestions(pool, n, user?.stats ?? {}, Math.random, !!config.ids?.length);
  if (config.ids?.length) {
    const order = new Map(config.ids.map((id, i) => [id, i]));
    qids = qids.sort((a, b) => order.get(a)! - order.get(b)!);
  }
  if (!qids.length) return null;
  const now = Date.now();
  const timeLimitMs =
    config.timer === "overall" ? (config.minutes ? config.minutes * 60_000 : Math.round(qids.length * PACE_MS)) : undefined;
  const quiz: Quiz = {
    id: newId(),
    createdAt: now,
    updatedAt: now,
    deviceId: "",
    config,
    qids,
    answers: Object.fromEntries(qids.map((id) => [id, blankAnswer()])),
    current: 0,
    status: "active",
    elapsedMs: 0,
    timeLimitMs,
  };
  // only one active quiz at a time: abandon others
  const s = store();
  const prev = await s.activeQuiz();
  if (prev) await s.putQuiz({ ...prev, status: "abandoned" });
  await s.putQuiz(quiz);
  return quiz;
}

const finishing = new Map<string, Promise<Quiz>>();
const reviewed = new Map<string, Quiz>();

/** Share concurrent submissions and resume a failed final write without grading the deck twice. */
export function finishQuiz(quiz: Quiz, questions: Question[]): Promise<Quiz> {
  const pending = finishing.get(quiz.id);
  if (pending) return pending;
  const task = persistFinishedQuiz(quiz, questions).finally(() => finishing.delete(quiz.id));
  finishing.set(quiz.id, task);
  return task;
}

async function persistFinishedQuiz(quiz: Quiz, questions: Question[]): Promise<Quiz> {
  const s = store();
  const saved = await s.getQuiz(quiz.id);
  if (saved?.status === "finished") {
    reviewed.delete(quiz.id);
    return saved;
  }
  if (saved?.status === "abandoned") throw new Error("Quiz was abandoned");
  const previous = reviewed.get(quiz.id);
  if (previous) {
    await s.putQuiz(previous);
    reviewed.delete(quiz.id);
    return previous;
  }
  const now = Date.now();
  const byId = new Map(questions.map((q) => [q.id, q]));
  const attempts: Attempt[] = [];
  for (const qid of quiz.qids) {
    const q = byId.get(qid);
    const a = quiz.answers[qid] ?? blankAnswer();
    if (!q?.answer) continue;
    attempts.push({
      id: `${quiz.id}:${qid}`,
      quizId: quiz.id,
      qid,
      chosen: a.chosen,
      answer: q.answer,
      correct: a.chosen === q.answer,
      guessed: a.guessed,
      unsure: a.unsure,
      timeMs: a.timeMs,
      at: a.answeredAt ?? now,
      chapter: q.chapter,
      primaryType: q.primaryType,
      updatedAt: now,
      deviceId: "",
    });
  }
  await s.addAttempts(attempts);

  const cards = new Map((await s.listSrs()).map((c) => [c.qid, c]));
  const updates: SrsCard[] = [];
  for (const a of attempts) {
    const existing = cards.get(a.qid);
    if (!existing && !entersDeck(a)) continue; // only missed/guessed/unsure questions enter the deck
    const base = existing ?? ({ ...newCard(a.qid, now), updatedAt: now, deviceId: "" } as SrsCard);
    updates.push(review(base, gradeAttempt(a, PACE_MS), now));
  }
  await s.putSrs(updates);

  const done: Quiz = { ...quiz, status: "finished", finishedAt: now };
  reviewed.set(quiz.id, done);
  await s.putQuiz(done);
  reviewed.delete(quiz.id);
  return done;
}

export function scoreQuiz(quiz: Quiz, questions: Question[], attempts: Attempt[] = []) {
  const keys = new Map(questions.map((q) => [q.id, q.answer]));
  for (const attempt of attempts) {
    if (attempt.quizId === quiz.id) keys.set(attempt.qid, attempt.answer);
  }
  let correct = 0;
  let answered = 0;
  let total = 0;
  for (const qid of quiz.qids) {
    const answer = keys.get(qid);
    if (!answer) continue;
    total++;
    const chosen = quiz.answers[qid]?.chosen;
    if (chosen) answered++;
    if (chosen === answer) correct++;
  }
  return { correct, answered, total, timeMs: quiz.elapsedMs };
}

export function setAnswer(quiz: Quiz, qid: string, patch: Partial<QuizAnswer>): Quiz {
  return { ...quiz, answers: { ...quiz.answers, [qid]: { ...(quiz.answers[qid] ?? blankAnswer()), ...patch } } };
}

export const DEFAULT_CONFIG: QuizConfig = {
  subject: activeSubject.id,
  chapters: [],
  types: [],
  difficulty: [1, 5],
  schools: [],
  years: [],
  figure: "any",
  pool: "all",
  length: 10,
  timer: "off",
  examPace: false,
  feedback: "immediate",
};

export type { OptionLabel };
