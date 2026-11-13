// Offline tests for the growth engine.
import assert from "node:assert/strict";
import http from "node:http";
import { writeFileSync, readFileSync } from "node:fs";
import { pick, record, tunePacing, analyseCurve, DEFAULT_LEARNING, type Arm } from "../growth/learn";
import { rank, countFormulas } from "../growth/trends";
import { thumbAss } from "../growth/thumbs";
import { instagramCaption, facebookCaption, firstComment } from "../growth/captions";
import type { Episode } from "../engine/types";

// --- learner: tries every option 3 times, then exploits the winner, still exploring sometimes
const stats: Record<string, Arm> = {};
const firsts = Array.from({ length: 9 }, (_, d) => pick(["a", "b", "c"], stats, d)); assert.deepEqual(new Set(firsts), new Set(["a", "b", "c"]));
for (const [arm, v] of [["a", 100], ["b", 900], ["c", 300]] as const) for (let i = 0; i < 3; i++) record(stats, arm, v);
const picks = Array.from({ length: 100 }, (_, d) => pick(["a", "b", "c"], stats, d, 0.2));
assert.ok(picks.filter(p => p === "b").length >= 70 && picks.some(p => p !== "b"), "mostly the winner, sometimes explore");

// --- retention: the vendored tool finds the cliff, and pacing tightens when cliffs sit in long shots
const curve: [number, number][] = Array.from({ length: 50 }, (_, i) => [i / 49, i < 20 ? 100 - i * 0.5 : i === 20 ? 80 : 78 - (i - 20) * 0.3]);
const a = analyseCurve(curve, 300);
assert.ok(a.cliffs.length && a.cliffs[0].at_seconds! > 115 && a.cliffs[0].at_seconds! < 130, `cliff near 122s, got ${JSON.stringify(a.cliffs[0])}`);
const longShots = [{ start: 110, dur: 6, scene: "s4" }, { start: 200, dur: 6, scene: "s6" }, { start: 50, dur: 6, scene: "s2" }];
const tuned = tunePacing(DEFAULT_LEARNING, [1, 2, 3].map(() => ({ cliffs: [{ at_seconds: 112, lost: 5 }, { at_seconds: 205, lost: 3 }], shots: longShots, hookLeak: 40 })));
assert.ok(tuned.shotSeconds < DEFAULT_LEARNING.shotSeconds && tuned.hookMin > DEFAULT_LEARNING.hookMin && tuned.notes.length === 2);
assert.equal(tunePacing(DEFAULT_LEARNING, []).shotSeconds, DEFAULT_LEARNING.shotSeconds, "no data, no change");

// --- trend ranking combines signals and honours topic weights
const ideas = rank({ outliers: [{ title: "ISRO launch real footage", multiple: 6, formula: "Curiosity gap", url: "u", views: 1 }],
  wiki: [{ title: "Aurora", lang: "en", topic: "earth", lift: 3, week: 1000 }, { title: "Flat", lang: "en", topic: "space", lift: 1.1, week: 10 }],
  suggest: { "ISRO launch": ["isro launch today", "isro launch live"] }, seeds: [{ q: "ISRO launch", topic: "space" }], weights: { space: 1.5, earth: 0.5 } });
assert.equal(ideas[0].idea, "ISRO launch real footage"); assert.ok(!ideas.some(i => i.idea === "Flat"), "flat Wikipedia interest ignored");
assert.deepEqual(countFormulas([{ formula: "x" }, { formula: "x" }, { formula: "y" }]), [{ formula: "x", n: 2 }, { formula: "y", n: 1 }]);

// --- thumbnails, captions
for (const st of ["stat", "center", "frame"] as const) assert.ok(thumbAss(st, "हर 92 मिनट", "hi", "असली फुटेज").includes("हर 92 मिनट"));
const ep = JSON.parse(readFileSync("episodes/E001-iss-16-sunrises.json", "utf8")) as Episode;
assert.ok(instagramCaption(ep, "hi").includes(ep.engage.share.hi!) && instagramCaption(ep, "hi").includes("#"));
assert.ok(facebookCaption(ep, "en").startsWith(ep.engage.ask.en) && firstComment(ep, "hi").startsWith(ep.engage.ask.hi!));

// --- Meta: full Instagram + Facebook resumable flow against a local mock
const calls: string[] = []; let status = 0;
const srv = http.createServer((req, res) => {
  let body = ""; req.on("data", d => (body += d)); req.on("end", () => {
    calls.push(`${req.method} ${req.url?.split("?")[0]} ${req.headers.offset ?? ""}`);
    const j = (o: any) => { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify(o)); };
    if (req.url!.includes("/IG1/media_publish")) return j({ id: "PUB1" });
    if (req.url!.includes("/IG1/media")) return j({ id: "C1", uri: `http://127.0.0.1:${(srv.address() as any).port}/ig-api-upload/v25.0/C1` });
    if (req.url!.includes("/ig-api-upload/")) return j({ success: true });
    if (req.url!.startsWith("/C1")) return j({ status_code: ++status > 1 ? "FINISHED" : "IN_PROGRESS" });
    if (req.url!.includes("/P1/video_reels")) return body.includes("start") ? j({ video_id: "V1", upload_url: `http://127.0.0.1:${(srv.address() as any).port}/video-upload/v25.0/V1` }) : j({ success: true });
    if (req.url!.includes("/video-upload/")) return j({ success: true });
    res.writeHead(404); res.end("{}");
  });
});
await new Promise<void>(r => srv.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${(srv.address() as any).port}`;
Object.assign(process.env, { META_POLL_MS: "5", META_GRAPH: base, META_RUPLOAD: base, META_ACCESS_TOKEN: "t", IG_USER_ID: "IG1", FB_PAGE_ID: "P1" });
writeFileSync("/tmp/p2-test.mp4", Buffer.alloc(1000));
const meta = await import("../autopilot/meta");
assert.equal(await meta.instagramReel("/tmp/p2-test.mp4", "caption", { coverMs: 1200, aiGenerated: true }), "PUB1");
assert.equal(await meta.facebookReel("/tmp/p2-test.mp4", "desc"), "V1");
srv.close();
assert.ok(calls.some(c => c.startsWith("POST /ig-api-upload/v25.0/C1 0")) && calls.some(c => c.includes("/video-upload/")), calls.join(" | "));
console.log("growth tests: all passed");
