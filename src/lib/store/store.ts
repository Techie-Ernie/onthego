import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import { DEFAULT_SETTINGS, USER_SCHEMA_VERSION, type Attempt, type Bookmark, type Preset, type Quiz, type Report, type Settings, type SrsCard, type UserDataExport } from "./schema";

/**
 * UserDataStore: the only way the app touches user data. v1 = IndexedDB on this device.
 * A sync backend (docs/FUTURE.md) implements the same interface; records carry updatedAt/deviceId for LWW merge.
 */
export interface UserDataStore {
  getSettings(): Promise<Settings>;
  saveSettings(s: Partial<Settings>): Promise<Settings>;

  getQuiz(id: string): Promise<Quiz | undefined>;
  putQuiz(q: Quiz): Promise<void>;
  listQuizzes(): Promise<Quiz[]>;
  activeQuiz(): Promise<Quiz | undefined>;

  addAttempts(a: Attempt[]): Promise<void>;
  listAttempts(): Promise<Attempt[]>;

  listSrs(): Promise<SrsCard[]>;
  putSrs(c: SrsCard[]): Promise<void>;

  listBookmarks(): Promise<Bookmark[]>;
  setBookmark(qid: string, on: boolean): Promise<void>;

  listPresets(): Promise<Preset[]>;
  putPreset(p: Preset): Promise<void>;
  deletePreset(id: string): Promise<void>;

  addReport(r: Report): Promise<void>;
  listReports(): Promise<Report[]>;

  exportAll(): Promise<UserDataExport>;
  importAll(data: UserDataExport, mode: "merge" | "replace"): Promise<{ added: number; updated: number }>;
  clearAll(): Promise<void>;
  deviceId(): string;
}

interface Db extends DBSchema {
  quizzes: { key: string; value: Quiz; indexes: { status: string } };
  attempts: { key: string; value: Attempt; indexes: { qid: string; at: number } };
  srs: { key: string; value: SrsCard };
  bookmarks: { key: string; value: Bookmark };
  presets: { key: string; value: Preset };
  reports: { key: string; value: Report };
  meta: { key: string; value: Settings };
}
type StoreName = "quizzes" | "attempts" | "srs" | "bookmarks" | "presets" | "reports";
const STORES: StoreName[] = ["quizzes", "attempts", "srs", "bookmarks", "presets", "reports"];

const uid = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`);
export const newId = uid;

function getDeviceId(): string {
  try {
    let id = localStorage.getItem("otg-device");
    if (!id) localStorage.setItem("otg-device", (id = uid()));
    return id;
  } catch {
    return "device-unknown";
  }
}

export class IdbStore implements UserDataStore {
  private db: Promise<IDBPDatabase<Db>>;
  private device = getDeviceId();
  constructor(name = "onthego") {
    this.db = openDB<Db>(name, USER_SCHEMA_VERSION, {
      upgrade(db) {
        db.createObjectStore("quizzes", { keyPath: "id" }).createIndex("status", "status");
        const at = db.createObjectStore("attempts", { keyPath: "id" });
        at.createIndex("qid", "qid");
        at.createIndex("at", "at");
        db.createObjectStore("srs", { keyPath: "id" });
        db.createObjectStore("bookmarks", { keyPath: "id" });
        db.createObjectStore("presets", { keyPath: "id" });
        db.createObjectStore("reports", { keyPath: "id" });
        db.createObjectStore("meta");
      },
    });
  }
  deviceId() {
    return this.device;
  }
  private stamp<T extends object>(r: T): T & { updatedAt: number; deviceId: string } {
    return { ...r, updatedAt: Date.now(), deviceId: this.device };
  }

  async getSettings() {
    const s = await (await this.db).get("meta", "settings");
    return s ?? { id: "settings", updatedAt: 0, deviceId: this.device, ...DEFAULT_SETTINGS };
  }
  async saveSettings(p: Partial<Settings>) {
    const s = this.stamp({ ...(await this.getSettings()), ...p, id: "settings" });
    await (await this.db).put("meta", s, "settings");
    return s;
  }

  async getQuiz(id: string) {
    return (await this.db).get("quizzes", id);
  }
  async putQuiz(q: Quiz) {
    await (await this.db).put("quizzes", this.stamp(q));
  }
  async listQuizzes() {
    return (await (await this.db).getAll("quizzes")).sort((a, b) => b.createdAt - a.createdAt);
  }
  async activeQuiz() {
    const all = await (await this.db).getAllFromIndex("quizzes", "status", "active");
    return all.sort((a, b) => b.updatedAt - a.updatedAt)[0];
  }

  async addAttempts(a: Attempt[]) {
    const tx = (await this.db).transaction("attempts", "readwrite");
    await Promise.all([...a.map((x) => tx.store.put(this.stamp(x))), tx.done]);
  }
  async listAttempts() {
    return (await this.db).getAllFromIndex("attempts", "at");
  }

  async listSrs() {
    return (await this.db).getAll("srs");
  }
  async putSrs(c: SrsCard[]) {
    const tx = (await this.db).transaction("srs", "readwrite");
    await Promise.all([...c.map((x) => tx.store.put(this.stamp(x))), tx.done]);
  }

  async listBookmarks() {
    return (await this.db).getAll("bookmarks");
  }
  async setBookmark(qid: string, on: boolean) {
    const db = await this.db;
    if (on) await db.put("bookmarks", this.stamp({ id: qid, qid }));
    else await db.delete("bookmarks", qid);
  }

  async listPresets() {
    return (await (await this.db).getAll("presets")).sort((a, b) => a.name.localeCompare(b.name));
  }
  async putPreset(p: Preset) {
    await (await this.db).put("presets", this.stamp(p));
  }
  async deletePreset(id: string) {
    await (await this.db).delete("presets", id);
  }

  async addReport(r: Report) {
    await (await this.db).put("reports", this.stamp(r));
  }
  async listReports() {
    return (await this.db).getAll("reports");
  }

  async exportAll(): Promise<UserDataExport> {
    const db = await this.db;
    const [quizzes, attempts, srs, bookmarks, presets, reports, settings] = await Promise.all([
      db.getAll("quizzes"), db.getAll("attempts"), db.getAll("srs"), db.getAll("bookmarks"), db.getAll("presets"), db.getAll("reports"), db.get("meta", "settings"),
    ]);
    return { app: "onthego", schemaVersion: USER_SCHEMA_VERSION, exportedAt: new Date().toISOString(), deviceId: this.device, quizzes, attempts, srs, bookmarks, presets, reports, settings: settings ?? null };
  }

  /** merge = last-writer-wins per record id (by updatedAt); replace = wipe then load. */
  async importAll(data: UserDataExport, mode: "merge" | "replace") {
    if (data?.app !== "onthego" || typeof data.schemaVersion !== "number") throw new Error("Not an onthego export file.");
    if (data.schemaVersion > USER_SCHEMA_VERSION) throw new Error("This export is from a newer version of onthego. Update the app first.");
    if (mode === "replace") await this.clearAll();
    const db = await this.db;
    let added = 0;
    let updated = 0;
    for (const name of STORES) {
      const rows = (data[name] ?? []) as { id: string; updatedAt: number }[];
      const tx = db.transaction(name, "readwrite");
      for (const r of rows) {
        if (!r?.id) continue;
        const cur = (await tx.store.get(r.id)) as { updatedAt: number } | undefined;
        if (!cur) {
          added++;
          await tx.store.put(r as never);
        } else if ((r.updatedAt ?? 0) > (cur.updatedAt ?? 0)) {
          updated++;
          await tx.store.put(r as never);
        }
      }
      await tx.done;
    }
    if (data.settings) {
      const cur = await db.get("meta", "settings");
      if (!cur || data.settings.updatedAt > cur.updatedAt) await db.put("meta", data.settings, "settings");
    }
    return { added, updated };
  }

  async clearAll() {
    const db = await this.db;
    await Promise.all([...STORES.map((s) => db.clear(s)), db.clear("meta")]);
  }
}

let singleton: UserDataStore | null = null;
export function store(): UserDataStore {
  if (!singleton) singleton = new IdbStore();
  return singleton;
}
