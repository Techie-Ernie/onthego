// Copies the committed bank (data/bank) into public/bank so it is served statically and cached by the SW.
import fs from "node:fs";
const src = "data/bank";
const dst = "public/bank";
fs.rmSync(dst, { recursive: true, force: true });
if (fs.existsSync(src)) fs.cpSync(src, dst, { recursive: true });
console.log(fs.existsSync(src) ? "bank copied to public/bank" : "no bank yet (run the pipeline)");
