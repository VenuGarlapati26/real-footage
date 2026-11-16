// The YouTube description reads like a real channel's: hook, what you'll learn, the question, chapters, then credits.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { description, discoveries, chapterLines } from "../growth/description";

const ep = JSON.parse(readFileSync("episodes/E001-iss-16-sunrises.json", "utf8"));
const rights = [{ credit: "NASA / JSC, 2019", license: "Public domain (NASA media guidelines)", page: "https://images.nasa.gov/details/x" }];
const d = description(ep, "en", { format: "short", rights, synthetic: true, subtitles: ["en", "hi", "es", "pt"] });
console.log(d + "\n---");
const lines = d.split("\n");
assert.equal(lines[0], ep.title.en);
assert.ok(lines.indexOf("In under a minute:") > 0 && lines.indexOf("In under a minute:") < lines.findIndex(l => l.startsWith("— ")), "what you learn comes before the credits");
assert.ok(discoveries(ep, "en").includes("28,000 km per hour"));
assert.match(d, /Subtitles: हिन्दी, Español, Português/);
assert.match(d, /#Shorts/);
assert.ok(d.length < 5000);
// chapters: shown only when YouTube would accept them
assert.deepEqual(chapterLines([{ at: 20, title: "How fast" }, { at: 70, title: "Night side" }], "en"), ["0:00 Intro", "0:20 How fast", "1:10 Night side"]);
assert.deepEqual(chapterLines([{ at: 20, title: "A" }], "en"), []);
const long = description(ep, "en", { format: "long", rights, synthetic: true, chapters: [{ at: 15, title: "Speed" }, { at: 75, title: "Night" }] });
assert.match(long, /Chapters:\n0:00 Intro\n0:15 Speed\n1:15 Night/); assert.match(long, /In this video you'll discover:/); assert.doesNotMatch(long, /#Shorts/);
assert.match(description(ep, "hi", { format: "short", rights, synthetic: true }), /एक मिनट से कम में:/);
console.log("description tests: all passed");
