// The writer never crashes on a malformed Gemini reply, and picks the strongest hook from the options.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const { shapeProblems, pickBest } = await import("../growth/writer");
const ep = JSON.parse(readFileSync("episodes/E001-iss-16-sunrises.json","utf8"));
assert.deepEqual(shapeProblems(ep), []);
const bad = structuredClone(ep); delete bad.title; bad.scenes[1].vo = "text"; delete bad.engage;
console.log(shapeProblems(bad));
assert.ok(shapeProblems(bad).length >= 3);
const e2 = structuredClone(ep); const orig = e2.scenes[0].vo.en;
e2.scenes[0].vo = { en: "Space is nice." }; e2.hookOptions = [{ en: orig }, { en: "Hello there friends." }];
e2.shareOptions = [{ en: "Send this to the friend who never sleeps." }];
console.log(pickBest(e2), e2.scenes[0].vo.en);
assert.equal(e2.scenes[0].vo.en, orig); assert.ok(!("hookOptions" in e2));
console.log("writer shape + best-hook tests: all passed");

// long videos only from episodes with a real long cut (the hand-made samples are ~30 s: Shorts only)
{
  process.env.YT_CLIENT_ID ??= "";
  const { longSeconds } = await import("../autopilot/daily");
  assert.ok(longSeconds(ep) < 150, `sample long cut is ${longSeconds(ep).toFixed(0)} s`);
  const big = structuredClone(ep); for (let i = 0; i < 10; i++) big.scenes.push({ ...ep.scenes[1], id: `x${i}`, longOnly: true, shortOnly: false, vo: { en: "word ".repeat(40) } });
  assert.ok(longSeconds(big) >= 150);
  console.log("long-cut guard tests: all passed");
}
