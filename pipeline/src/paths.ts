import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
export const CACHE = path.join(ROOT, "pipeline/cache");
export const DATA = path.join(ROOT, "data");
export const PUBLIC = path.join(ROOT, "public");
/** local folder of papers; override with LOCAL_PAPERS=/path */
export const LOCAL_PAPERS = process.env.LOCAL_PAPERS ?? path.join(ROOT, "Other JC Prelim 2026");
