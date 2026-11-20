import type { Provenance } from "@/lib/types";

/** Full names for crediting the schools whose papers the questions come from. */
export const SCHOOL_NAMES: Record<string, string> = {
  ACJC: "Anglo-Chinese Junior College",
  ASRJC: "Anderson Serangoon Junior College",
  CJC: "Catholic Junior College",
  DHS: "Dunman High School",
  EJC: "Eunoia Junior College",
  HCI: "Hwa Chong Institution",
  JPJC: "Jurong Pioneer Junior College",
  MI: "Millennia Institute",
  NJC: "National Junior College",
  NYJC: "Nanyang Junior College",
  RI: "Raffles Institution",
  RVHS: "River Valley High School",
  SAJC: "Saint Andrew's Junior College",
  SRJC: "Serangoon Junior College",
  TJC: "Temasek Junior College",
  TMJC: "Tampines Meridian Junior College",
  VJC: "Victoria Junior College",
  YIJC: "Yishun Innova Junior College",
};

export const schoolName = (code: string) => SCHOOL_NAMES[code] ?? code;

/** "Raffles Institution · 2026 Prelim, Paper 1, Q7" */
export const sourceLine = (p: Pick<Provenance, "school" | "year" | "exam" | "questionNumber">) =>
  `${schoolName(p.school)} · ${p.year} ${p.exam === "Prelim" ? "Preliminary Examination" : p.exam}, Paper 1, Q${p.questionNumber}`;
