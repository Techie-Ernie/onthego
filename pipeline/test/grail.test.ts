import { describe, expect, it } from "vitest";
import { selectEntries, examOf } from "../src/grail";

const e = (o: Record<string, unknown>) => ({ subject: "H2 Physics", doc_type: "Exam Papers", year_resolved: "2024", school: "NJC", paper_number: 1, inline_url: "https://document.grail.moe/abc123.pdf", ...o }) as never;

describe("grail selectEntries", () => {
  it("re-derives the answer role from the filename (paper_info_role is unreliable)", () => {
    const { sittings } = selectEntries([e({ id: "1", original_name: "NJC_2024_H2_Physics_Prelim_P1_Ans", paper_info: "Prelim P1" }), e({ id: "2", original_name: "NJC_2024_H2_Physics_Prelim_P1_QP", paper_info: "Prelim P1" })]);
    expect(sittings).toHaveLength(1);
    expect(sittings[0].key).toBe("NJC|2024|Prelim|P1");
    expect(sittings[0].qp.map((f) => f.entryId)).toEqual(["2"]);
    expect(sittings[0].key_.map((f) => f.entryId)).toEqual(["1"]);
  });
  it("drops other papers, old syllabus years and schoolless rows", () => {
    const { sittings, skipped } = selectEntries([
      e({ id: "1", original_name: "X P2", paper_number: 2 }),
      e({ id: "2", original_name: "X P1", year_resolved: "2015" }),
      e({ id: "3", original_name: "X P1", school: "" }),
    ]);
    expect(sittings).toHaveLength(0);
    expect(Object.keys(skipped)).toHaveLength(3);
  });
  it("maps Drive entries to manual downloads and normalises school aliases", () => {
    const { sittings } = selectEntries([e({ id: "gdrive:XYZ", source: "drive", school: "RJC", original_name: "RJC 2018 Prelim P1", paper_info: "Prelim P1" })]);
    expect(sittings[0].school).toBe("RI");
    expect(sittings[0].qp[0]).toMatchObject({ host: "drive" });
    expect(sittings[0].qp[0].file).toMatch(/manual\/XYZ\.pdf$/);
  });
  it("classifies exam types", () => {
    expect(examOf("ACJC 2019 Promo P1")).toBe("Promo");
    expect(examOf("Prelim P1")).toBe("Prelim");
    expect(examOf("CT2 P1")).toBe("CT");
  });
});
