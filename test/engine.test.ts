// Offline engine tests: segment picking, the film look, titles, timing.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { pickIn } from "../engine/footage";
import { filmLook } from "../engine/grade";
import { buildAss } from "../engine/titles";
import { timeline, scenesFor } from "../engine/build";
import type { Episode, Shot } from "../engine/types";

// a shot never straddles a cut, avoids slates at the start, and avoids segments already used
assert.equal(pickIn(30, [10, 20], 12), null, "no 12 s take exists between cuts");
const a = pickIn(30, [10, 20], 3)!; assert.ok(a >= 3 && !(a < 10 && a + 3 > 10) && !(a < 20 && a + 3 > 20));
const b = pickIn(30, [], 3, [[a, a + 3]])!; assert.ok(b + 3 <= a || b >= a + 3, "reused clip gets a different segment");
// film look stays in range, keeps black near black and white near white, and is monotonic on grey
for (const v of [0, 0.25, 0.5, 0.75, 1]) filmLook(v, v, v).forEach(c => assert.ok(c >= 0 && c <= 1));
assert.ok(filmLook(0, 0, 0)[1] < 0.06 && filmLook(1, 1, 1)[1] > 0.9);
let prev = -1; for (let v = 0; v <= 1; v += 0.05) { const y = filmLook(v, v, v)[1]; assert.ok(y >= prev - 1e-6); prev = y; }
// titles: Hindi text passes through intact; captions only in Shorts; a credit per shot
const ep = JSON.parse(readFileSync("episodes/E001-iss-16-sunrises.json", "utf8")) as Episode;
const fake = scenesFor(ep, "short").map(s => ({ id: s.id, seconds: 4 }));
const t = timeline(scenesFor(ep, "short"), fake);
assert.ok(Math.abs(t[1].start - t[0].dur) < 1e-9, "scenes are back to back");
const clip = { provider: "nasa", id: "x", file: "x.mp4", width: 1920, height: 1080, duration: 30, title: "", credit: "NASA / JSC, 2015", license: "Public domain", page: "" };
const shots: Shot[] = [{ scene: "s1", clip, inPoint: 5, dur: 4, start: 0 }];
const ts = t.map(x => ({ start: x.start, dur: x.dur, overlays: x.scene.overlays ?? [], vo: { at: x.voAt, dur: x.voDur, text: x.scene.vo.hi ?? x.scene.vo.en } }));
const short = buildAss({ W: 1080, H: 1920, format: "short", lang: "hi", scenes: ts, shots, duration: 8, brandTag: "असली फुटेज" });
const long = buildAss({ W: 1920, H: 1080, format: "long", lang: "hi", scenes: ts, shots, duration: 8, brandTag: "असली फुटेज" });
assert.ok(short.includes("एक दिन, 16 सूर्योदय") && short.includes("फुटेज: NASA / JSC, 2015"));
assert.ok(/,Cap,/.test(short) && !/,Cap,/.test(long), "captions only in Shorts");
assert.ok(short.includes("\\k"), "karaoke timing present");
console.log("engine tests: all passed");
