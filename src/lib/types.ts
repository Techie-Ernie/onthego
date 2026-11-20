/**
 * Shared data model. Imported by the app AND by the offline pipeline (pipeline/ imports via relative path).
 * Bump BANK_SCHEMA_VERSION when the bank JSON shape changes.
 */
export const BANK_SCHEMA_VERSION = 1;

export type SubjectId = "h2-physics" | "h2-chemistry" | "h2-biology";
export type OptionLabel = "A" | "B" | "C" | "D";
export const OPTION_LABELS: OptionLabel[] = ["A", "B", "C", "D"];

export type RenderMode = "text" | "mixed" | "image";

export interface ImageRef {
  /** path under /public, e.g. /q-assets/h2-physics/kinematics/abc123-fig1.webp */
  src: string;
  w: number;
  h: number;
  alt: string;
  /** byte size of the webp, for offline download estimates */
  bytes?: number;
}

export interface Figure extends ImageRef {
  /** where the figure sits relative to the stem text */
  position: "stem-top" | "stem-inline" | "before-options";
  /** for stem-inline: index of the stem paragraph it follows */
  afterParagraph?: number;
}

export interface QuestionOption {
  label: OptionLabel;
  /** text with $…$ inline LaTeX */
  text?: string;
  image?: ImageRef;
}

export type ExamType = "Prelim" | "Promo" | "MYE" | "CT" | "BT" | "A-Level" | "Other";

export interface Provenance {
  source: "local" | "grail";
  school: string;
  year: number;
  exam: ExamType;
  /** e.g. "H2 Paper 1" */
  paper: string;
  questionNumber: number;
  originalFile: string;
  /** 1-based page in originalFile */
  page: number;
}

export interface Explanation {
  /** markdown-ish text with $…$ LaTeX */
  body: string;
  perOption: Partial<Record<OptionLabel, string>>;
  model: string;
  /** true when the model's derived answer matched the key */
  verified: boolean;
}

export interface Question {
  id: string;
  subject: SubjectId;
  /** stem text with $…$ LaTeX, paragraphs separated by \n\n. Empty in image mode. */
  stem: string;
  /** plain extracted text (always present, may be imperfect) for search / dedupe / classification */
  stemText: string;
  textQuality: "high" | "low";
  renderMode: RenderMode;
  hasFigure: boolean;
  figures: Figure[];
  /** whole-question crop (stem + any figures, excluding image options) — used in image mode, and as the review "original" */
  stemImage?: ImageRef;
  options: QuestionOption[];
  optionLayout: "list" | "grid";
  answer: OptionLabel;

  chapter: string | null;
  secondaryChapters: string[];
  outcomes: string[];
  types: string[];
  primaryType: string | null;
  difficulty?: number;
  difficultyReason?: string;
  misconception?: string;
  explanation?: Explanation;

  /** all appearances across papers (dedupe cluster). appearances[0] is the canonical source. */
  appearances: Provenance[];
  /** review reasons, e.g. "low-text-confidence", "answer-mismatch", "unclassified" */
  flags: string[];
  status: "published" | "needs-review";
  /** set when a human approved it in /admin/review */
  reviewedAt?: string;
}

/** Slim per-question record for the always-loaded index (filtering, counts, search). */
export interface QuestionIndexEntry {
  id: string;
  chapter: string | null;
  secondaryChapters: string[];
  primaryType: string | null;
  types: string[];
  difficulty?: number;
  hasFigure: boolean;
  renderMode: RenderMode;
  /** shard (topic id or "_unclassified") the full record lives in */
  shard: string;
  schools: string[];
  years: number[];
  exams: ExamType[];
  appearances: number;
  /** lower-cased search text */
  text: string;
  status: Question["status"];
}

export interface BankIndex {
  schemaVersion: number;
  subject: SubjectId;
  builtAt: string;
  count: number;
  shards: { id: string; count: number; jsonBytes: number; assetBytes: number }[];
  questions: QuestionIndexEntry[];
}

export interface BankShard {
  schemaVersion: number;
  subject: SubjectId;
  shard: string;
  questions: Question[];
}

/* ---------- syllabus ---------- */
export interface SyllabusOutcome {
  id: string;
  text: string;
}
export interface SyllabusTopic {
  id: string;
  number: number;
  name: string;
  sectionId: string;
  order: number;
  keywords: string[];
  outcomes: SyllabusOutcome[];
}
export interface SyllabusSection {
  id: string;
  name: string;
  order: number;
  topicIds: string[];
}
export interface Syllabus {
  subject: SubjectId;
  syllabusCode: string;
  year: number;
  source: string;
  sections: SyllabusSection[];
  topics: SyllabusTopic[];
  notes?: string[];
}
