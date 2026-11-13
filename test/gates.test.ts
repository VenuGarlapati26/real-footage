import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runGates } from "../engine/gates";
import { tally, weights } from "../autopilot/weekly";
import type { Episode } from "../engine/types";

const ep = JSON.parse(readFileSync("episodes/E001-iss-16-sunrises.json", "utf8")) as Episode;
const ok = runGates(ep); assert.ok(ok.every(g => g.pass), ok.filter(g => !g.pass).map(g => g.name).join(", "));
const weak = structuredClone(ep); weak.scenes[0].vo.en = "Today we look at space.";
assert.ok(!runGates(weak).find(g => g.name === "hook (YouTube)")!.pass, "flat hook fails");
const unsourced = structuredClone(ep); unsourced.scenes[1].sources = [];
assert.ok(!runGates(unsourced).find(g => g.name === "every number has a source")!.pass, "unsourced number fails");
const thin = structuredClone(ep); thin.scenes[0].footage = [{ provider: "nasa", q: "x" }];
assert.ok(!runGates(thin).find(g => g.name === "footage has fallbacks")!.pass, "no fallback footage fails");
const borrowed = structuredClone(ep); borrowed.title.en = "Better than Kurzgesagt";
assert.ok(!runGates(borrowed).find(g => g.name.startsWith("rights"))!.pass, "borrowed name fails");
assert.deepEqual(tally(["B", "I'd pick b", "A!", "great video"]), { A: 1, B: 2, C: 0, total: 3 });
assert.deepEqual(weights([{ topic: "space", avgPct: 60, views: 1 }, { topic: "earth", avgPct: 40, views: 1 }]), { space: 1.5, earth: 0.5 });
console.log("gates tests: all passed");
