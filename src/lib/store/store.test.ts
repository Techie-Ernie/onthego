import "fake-indexeddb/auto";
import { describe, expect, it } from "vitest";
import { IdbStore } from "./store";
import type { Attempt } from "./schema";

const att = (id: string, o: Partial<Attempt> = {}): Attempt => ({
  id, quizId: "z", qid: "q1", chosen: "A", answer: "A", correct: true, guessed: false, unsure: false, timeMs: 1000, at: 1, chapter: null, primaryType: null, updatedAt: 0, deviceId: "d", ...o,
});

describe("IdbStore", () => {
  it("round-trips export → import (replace) and merges last-writer-wins", async () => {
    const a = new IdbStore("t1");
    await a.addAttempts([att("x1"), att("x2")]);
    await a.setBookmark("q9", true);
    await a.saveSettings({ defaultLength: 20 });
    const dump = await a.exportAll();
    expect(dump.attempts).toHaveLength(2);

    const b = new IdbStore("t2");
    await b.addAttempts([att("x3")]);
    const r = await b.importAll(dump, "merge");
    expect(r.added).toBe(3);
    expect(await b.listAttempts()).toHaveLength(3);
    expect((await b.getSettings()).defaultLength).toBe(20);

    // older record does not overwrite newer
    const older = { ...dump, attempts: [{ ...dump.attempts[0], correct: false, updatedAt: 1 }] };
    await b.importAll(older, "merge");
    expect((await b.listAttempts()).find((x) => x.id === "x1")!.correct).toBe(true);

    await b.importAll(dump, "replace");
    expect((await b.listAttempts()).map((x) => x.id).sort()).toEqual(["x1", "x2"]);
  });
  it("rejects foreign or newer files", async () => {
    const s = new IdbStore("t3");
    await expect(s.importAll({ app: "other" } as never, "merge")).rejects.toThrow();
    await expect(s.importAll({ app: "onthego", schemaVersion: 99 } as never, "merge")).rejects.toThrow(/newer/);
  });
});
