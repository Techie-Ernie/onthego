// Slim client-side syllabus (names/sections/outcome texts) generated from syllabus/<subject>.json.
import fs from "node:fs";
const s = JSON.parse(fs.readFileSync("syllabus/h2-physics.json", "utf8"));
const out = {
  sections: s.sections.map(({ id, name, topicIds }) => ({ id, name, topicIds })),
  topics: s.topics.map(({ id, number, name, sectionId, outcomes }) => ({ id, number, name, sectionId, outcomes: Object.fromEntries(outcomes.map((o) => [o.id, o.text])) })),
};
fs.writeFileSync("src/subjects/h2-physics.topics.json", JSON.stringify(out));
console.log("topics:", out.topics.length);
