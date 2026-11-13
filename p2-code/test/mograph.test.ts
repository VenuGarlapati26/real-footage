// Motion graphics, languages, writer + footage editor (offline; Gemini and Wikipedia mocked).
import assert from "node:assert/strict";
import http from "node:http";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, copyFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { makeSpec, renderOverlay, wordTimes } from "../engine/mograph/render";
import { LANGS, tx, ui } from "../engine/langs";
import { validPicks, sheet } from "../engine/curate";
import { factProblems } from "../growth/writer";
import { askJson } from "../growth/gemini";
import type { Episode, Shot } from "../engine/types";

const tmp = mkdtempSync(path.join(tmpdir(), "mo-"));
const ep = JSON.parse(readFileSync("episodes/E001-iss-16-sunrises.json", "utf8")) as Episode;

// languages
assert.equal(tx({ en: "Hi" }, "es"), "Hi", "falls back to English"); assert.equal(tx(ep.title, "pt"), ep.title.pt);
assert.equal(ui("es", "comments"), LANGS.es.ui.comments); assert.ok(Object.values(LANGS).every(l => Object.keys(l.ui).length === Object.keys(LANGS.en.ui).length), "every language has every UI string");

// word timing + spec
const w = wordTimes("One two, three.", 1, 3); assert.equal(w.length, 3); assert.ok(Math.abs(w.at(-1)!.until - 4) < 1e-9 && w[1].until - w[1].at > w[0].until - w[0].at, "punctuation holds longer");
const clip = { provider: "nasa", id: "x", file: "x.mp4", width: 1920, height: 1080, duration: 30, title: "", credit: "NASA / JSC, 2021", license: "PD", page: "" };
const shots: Shot[] = [{ scene: "s1", clip, inPoint: 0, dur: 3, start: 0 }, { scene: "s1", clip, inPoint: 5, dur: 3, start: 3 }, { scene: "s2", clip: { ...clip, id: "y", credit: "OWN" }, inPoint: 0, dur: 4, start: 6 }];
const scenes = [
  { id: "s1", start: 0, dur: 6, overlays: ep.scenes[0].overlays ?? [], vo: { at: 0.6, dur: 5, text: tx(ep.scenes[0].vo, "en") } },
  { id: "s2", start: 6, dur: 6, overlays: ep.scenes[1].overlays ?? [], vo: { at: 0.3, dur: 5, text: tx(ep.scenes[1].vo, "en") } },
  { id: "s4", start: 12, dur: 5, overlays: ep.scenes[3].overlays ?? [], vo: { at: 0.3, dur: 4, text: tx(ep.scenes[3].vo, "en") } },
];
const sp = makeSpec({ W: 1080, H: 1920, format: "short", lang: "en", duration: 17, scenes, shots, tag: "REAL FOOTAGE", hook: "THIS IS *NOT* CGI", ask: { text: "Which one?", at: 15 } });
assert.ok(sp.hook && sp.hook.until <= 2.25); assert.ok(sp.kickers[0].at >= sp.hook!.until, "headline waits for the hook");
assert.ok(sp.captions.every(c => c.at >= 2.1 && c.at < 15 && c.words.length <= 3), "captions: 3 words, never under the hook or the question");
assert.equal(sp.stats[0].value, "28,000"); assert.equal(sp.orbits[0].count, 16); assert.ok(sp.orbits[0].until <= 14.95);
assert.equal(sp.credits.length, 2, "same source merged"); assert.equal(sp.credits[1].text, "Our own footage");
assert.deepEqual(sp.flashes, [6, 12]); assert.equal(sp.ask?.label, "Tell us in the comments");
const lg = makeSpec({ W: 1920, H: 1080, format: "long", lang: "hi", duration: 17, scenes, shots, tag: "असली फुटेज", hook: "X" });
assert.ok(!lg.hook && !lg.captions.length && lg.script === "deva", "long: no hook card, no burned captions");

// render a tiny overlay through Chromium: transparent background, graphics present
const small = makeSpec({ W: 360, H: 640, format: "short", lang: "en", duration: 1.2, scenes: [{ ...scenes[1], start: 0, overlays: [{ kind: "stat", text: { en: "92" }, sub: { en: "minutes" }, at: 0.1 }] }], shots: [], tag: "REAL FOOTAGE" });
const mov = path.join(tmp, "g.mov"); const r = await renderOverlay(small, mov);
assert.equal(r.captured + r.reused, 36);
const px = execFileSync("ffmpeg", ["-v", "error", "-ss", "1.0", "-i", mov, "-frames:v", "1", "-vf", "scale=36:64", "-pix_fmt", "rgba", "-f", "rawvideo", "-"]);
const alpha = [...px].filter((_, i) => i % 4 === 3); assert.ok(alpha.some(a => a === 0) && alpha.some(a => a > 200), "transparent where empty, opaque where drawn");

// footage editor: picks are validated against the clips
assert.deepEqual(validPicks([{ clip: 0, from: 2, to: 9 }, { clip: 0, from: 5, to: 12 }, { clip: 1, from: 0, to: 2 }, { clip: 3, from: 0, to: 9 }, { clip: 1, from: 40, to: 60 }], [{ duration: 30 }, { duration: 50 }], 3, 3),
  [{ clip: 0, take: [2, 9] }, { clip: 1, take: [40, 50] }], "overlaps, too-short and unknown clips dropped; clamped to the clip");
const cf = path.join(tmp, "c.mp4"); execFileSync("ffmpeg", ["-y", "-v", "error", "-f", "lavfi", "-i", "testsrc2=s=640x360:d=12", cf]);
const sh = await sheet(cf, 12, path.join(tmp, "c.jpg")); assert.equal(sh.frames, 6);

// writer: facts must be quoted from the source; numbers must have a claim
const bad = structuredClone(ep); bad.scenes[1].overlays![0].text.en = "29,000"; bad.sources[0].claims.push("made-up sentence");
const probs = factProblems(bad, { S1: ep.sources[0].claims.join(". ") });
assert.ok(probs.some(p => p.includes("29,000")) && probs.some(p => p.includes("made-up")) && factProblems(ep, { S1: ep.sources[0].claims.join(". ") }).length === 0);

// Gemini client against a mock: JSON answers, retry on 429
let calls = 0;
const srv = http.createServer(async (q, s) => { let b = ""; for await (const c of q) b += c; calls++;
  if (calls === 1) { s.writeHead(429); return s.end("{}"); }
  s.writeHead(200, { "content-type": "application/json" }); s.end(JSON.stringify({ candidates: [{ content: { parts: [{ text: '```json\n{"picks":[{"clip":0,"from":1,"to":5}]}\n```' }] } }] })); });
await new Promise<void>(res => srv.listen(0, res));
Object.assign(process.env, { GEMINI_API_KEY: "k", GEMINI_BASE: `http://127.0.0.1:${(srv.address() as any).port}`, GEMINI_RETRY_MS: "10" });
const ans = await askJson<{ picks: any[] }>([{ text: "x" }]); assert.equal(ans.picks[0].to, 5); assert.equal(calls, 2);
srv.close(); rmSync(tmp, { recursive: true, force: true });
console.log("mograph + language + writer tests passed");
