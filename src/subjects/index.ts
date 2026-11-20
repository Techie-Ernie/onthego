import type { SubjectId } from "@/lib/types";

export interface QuestionTypeDef {
  id: string;
  name: string;
  short: string;
  description: string;
}

export interface SubjectConfig {
  id: SubjectId;
  name: string;
  shortName: string;
  code: string;
  tagline: string;
  /** relative to /syllabus; loaded at build time */
  syllabusFile: string;
  questionTypes: QuestionTypeDef[];
  /** typical MCQ paper length, used by pipeline sanity checks */
  mcqPaper: { name: string; questions: number; minutesPerQuestion: number };
}

export const H2_PHYSICS_TYPES: QuestionTypeDef[] = [
  { id: "quantitative", name: "Quantitative", short: "Calc", description: "Direct calculation or formula substitution" },
  { id: "multi-step", name: "Multi-step quantitative", short: "Multi-step", description: "Chained calculations or derivations" },
  { id: "proportionality", name: "Proportionality / ratio", short: "Ratio", description: "What happens to X if Y is doubled" },
  { id: "conceptual", name: "Qualitative / conceptual", short: "Concept", description: "Explain the physics, no numbers" },
  { id: "graph", name: "Graph / data interpretation", short: "Graph", description: "Reading or sketching graphs and data" },
  { id: "diagram", name: "Diagram-based", short: "Diagram", description: "Circuits, ray/wave diagrams, free-body, field lines" },
  { id: "statements", name: "Statement evaluation", short: "Statements", description: "Which of the following are correct (1, 2, 3 style)" },
  { id: "recall", name: "Memorisation / recall", short: "Recall", description: "Definitions, laws, standard facts" },
  { id: "practical", name: "Experimental / practical", short: "Practical", description: "Measurement, uncertainties, apparatus, accuracy" },
  { id: "application", name: "Application / unfamiliar context", short: "Application", description: "Novel scenarios" },
];

export const SUBJECTS: Record<string, SubjectConfig> = {
  "h2-physics": {
    id: "h2-physics",
    name: "H2 Physics",
    shortName: "H2 Physics",
    code: "9478",
    tagline: "Short, targeted H2 Physics MCQ practice from real JC prelim papers. Works offline.",
    syllabusFile: "h2-physics.json",
    questionTypes: H2_PHYSICS_TYPES,
    mcqPaper: { name: "H2 Paper 1", questions: 30, minutesPerQuestion: 1.5 },
  },
  // "h2-chemistry" and "h2-biology": see docs/FUTURE.md
};

export const activeSubject: SubjectConfig = SUBJECTS["h2-physics"];
