// Premium layer tests: film looks, Pexels file choice, transition plan, slow motion and whip pans (real ffmpeg renders).
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { LOOKS, filmLook, lookFor, writeCube, type LookName } from "../engine/grade";
import { bestPexelsFile, probe } from "../engine/footage";
import { planTransitions } from "../engine/build";
import { renderShot } from "../engine/edit";
import { makeSpec } from "../engine/mograph/render";
import type { Shot } from "../engine/types";

// --- looks: every look stays in range, keeps tone order, and they really differ
for (const name of Object.keys(LOOKS) as LookName[]) {
  let prev = -1;
  for (let v = 0; v <= 1.0001; v += 0.05) { const c = filmLook(v, v, v, LOOKS[name]); c.forEach(x => assert.ok(x >= 0 && x <= 1)); const y = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]; assert.ok(y >= prev - 1e-6, `${name} tone order`); prev = y; }
}
const sky: [number, number, number] = [0.35, 0.55, 0.75];
assert.ok(filmLook(...sky, LOOKS.golden)[0] > filmLook(...sky, LOOKS.arctic)[0], "golden is warmer than arctic");
const sat = (c: number[]) => Math.max(...c) - Math.min(...c);
assert.ok(sat(filmLook(0.8, 0.3, 0.2, LOOKS.noir)) < sat(filmLook(0.8, 0.3, 0.2, LOOKS.neon)), "noir is calmer than neon");
const leaf = filmLook(0.25, 0.55, 0.2, LOOKS.earth), leafDoc = filmLook(0.25, 0.55, 0.2, LOOKS.documentary);
assert.ok(leaf[1] - leaf[0] > leafDoc[1] - leafDoc[0], "earth makes greens richer");
assert.equal(lookFor({ look: "noir", topic: "space" }, { space: "arctic" }), "noir");
assert.equal(lookFor({ topic: "space" }, { space: "arctic" }), "arctic");
assert.equal(lookFor({ look: "rainbow" as any }), "documentary");

// --- Pexels: 4K masters get the UHD file, others the smallest file >= 1080p, higher fps wins a tie
const files = [
  { file_type: "video/mp4", width: 1280, height: 720, fps: 25, link: "hd" },
  { file_type: "video/mp4", width: 1920, height: 1080, fps: 25, link: "fhd25" },
  { file_type: "video/mp4", width: 1920, height: 1080, fps: 59.94, link: "fhd60" },
  { file_type: "video/mp4", width: 3840, height: 2160, fps: 59.94, link: "uhd" },
];
assert.equal(bestPexelsFile(files, false, false)!.link, "fhd60");
assert.equal(bestPexelsFile(files, false, true)!.link, "uhd");
assert.equal(bestPexelsFile(files.slice(0, 2), false, true)!.link, "fhd25", "no UHD: the largest there is");

// --- transitions: hard cuts inside a scene; whips spaced >= 4 s; long videos rotate leak/whip/cut; chapters get a leak
const sh = (scene: string, start: number): Shot => ({ scene, start, dur: 2, inPoint: 0, clip: {} as any });
const short = planTransitions([sh("a", 0), sh("a", 2), sh("b", 4), sh("c", 6), sh("d", 9), sh("e", 12), sh("f", 14)], "short");
assert.deepEqual(short.transitions.map(t => t.kind), ["whip", "flash", "flash", "whip", "flash"]);
assert.equal(short.shots[0].trOut, undefined, "same scene: plain cut");
assert.equal(short.shots[1].trOut, "whip"); assert.equal(short.shots[2].trIn, "whip");
const long = planTransitions([sh("a", 0), sh("b", 5), sh("c", 10), sh("d", 15), sh("e", 20)], "long", new Set(["e"]));
assert.deepEqual(long.transitions.map(t => t.kind), ["leak", "whip", "cut", "leak"]);

// --- graphics spec follows the plan; long videos open with cinematic bars, Shorts never
const sc = [{ id: "a", start: 0, dur: 5, overlays: [], vo: { at: 0.3, dur: 4, text: "x" } }, { id: "b", start: 5, dur: 5, overlays: [], vo: { at: 0.3, dur: 4, text: "y" } }];
const specL = makeSpec({ W: 1920, H: 1080, format: "long", lang: "en", duration: 10, scenes: sc, shots: [], tag: "T", transitions: [{ at: 5, kind: "leak" }], coldOpen: 5 });
assert.deepEqual(specL.leaks, [5]); assert.deepEqual(specL.flashes, []); assert.deepEqual(specL.bars, { at: 0, until: 5 });
const specS = makeSpec({ W: 1080, H: 1920, format: "short", lang: "en", duration: 10, scenes: sc, shots: [], tag: "T", transitions: [{ at: 5, kind: "flash" }], coldOpen: 5 });
assert.deepEqual(specS.flashes, [5]); assert.equal(specS.bars, undefined);

// --- real renders: a 60 fps test clip -> a half-speed shot uses half the source; a whip blurs the last frames
const dir = mkdtempSync(path.join(os.tmpdir(), "p2prem-")), src = path.join(dir, "src60.mp4"), lut = path.join(dir, "look.cube");
execFileSync("ffmpeg", ["-v", "error", "-f", "lavfi", "-i", "testsrc2=size=1280x720:rate=60:duration=6", "-c:v", "libx264", "-preset", "ultrafast", "-pix_fmt", "yuv420p", src]);
await writeCube(lut, "arctic"); assert.match(readFileSync(lut, "utf8"), /LUT_3D_SIZE 33/);
const p = await probe(src); assert.ok(Math.abs(p.fps - 60) < 0.01, `fps probed ${p.fps}`);
const clip = { provider: "local", id: "t", file: src, width: 1280, height: 720, duration: 6, fps: 60, title: "t", credit: "OWN", license: "own", page: "" };
const slow = path.join(dir, "slow.mp4");
await renderShot({ scene: "a", clip, inPoint: 1, dur: 2, start: 0, speed: 0.5 }, 640, 360, lut, 0, slow);
const ps = await probe(slow); assert.ok(Math.abs(ps.duration - 2) < 0.1, `slow shot lasts 2 s (${ps.duration})`);
// testsrc2 prints a running timecode: source second ~1.0 -> 2.0 shown over 2 output seconds; check the last frame is ~2.0 s in, not 3.0
const lastTs = execFileSync("ffprobe", ["-v", "error", "-count_frames", "-select_streams", "v:0", "-show_entries", "stream=nb_read_frames", "-of", "csv=p=0", slow]).toString().trim();
assert.equal(Number(lastTs), 60, "2 s at 30 fps");
const whip = path.join(dir, "whip.mp4"), plain = path.join(dir, "plain.mp4");
await renderShot({ scene: "a", clip, inPoint: 0, dur: 1, start: 0, trOut: "whip" }, 640, 360, lut, 0, whip);
await renderShot({ scene: "a", clip, inPoint: 0, dur: 1, start: 0 }, 640, 360, lut, 0, plain);
const sharp = (f: string, t: number) => { const o = execFileSync("ffmpeg", ["-v", "error", "-ss", String(t), "-i", f, "-frames:v", "1", "-vf", "blurdetect,metadata=print", "-f", "null", "-"], { stdio: ["ignore", "pipe", "pipe"] }); return o; };
const blurAt = (f: string, t: number) => { try { sharp(f, t); } catch { /* */ } const r = execFileSync("sh", ["-c", `ffmpeg -v info -ss ${t} -i ${f} -frames:v 1 -vf blurdetect,metadata=print -f null - 2>&1 | grep -o 'lavfi.blur=[0-9.]*' | tail -1`]).toString(); return Number(r.split("=")[1]); };
assert.ok(blurAt(whip, 0.95) > blurAt(plain, 0.95) * 1.5, "whip: the last frame is smeared");
assert.ok(Math.abs(blurAt(whip, 0.3) - blurAt(plain, 0.3)) < 0.5, "whip: the rest of the shot is untouched");
console.log("premium tests: all passed");

// --- Pexels end to end against a mock API: search sends the key, 4K masters get the UHD file, a pinned id is fetched by id
{
  const http = await import("node:http");
  const seen: string[] = [];
  const vid = (id: number) => ({ id, duration: 12, url: `https://pexels.com/video/${id}`, user: { name: "Ann" }, video_files: [
    { file_type: "video/mp4", width: 1920, height: 1080, fps: 25, link: `https://cdn/${id}-fhd.mp4` }, { file_type: "video/mp4", width: 3840, height: 2160, fps: 50, link: `https://cdn/${id}-uhd.mp4` }] });
  const srv = http.createServer((req, res) => { seen.push(`${req.headers.authorization} ${req.url}`); res.setHeader("content-type", "application/json");
    res.end(JSON.stringify(req.url!.startsWith("/videos/videos/") ? vid(Number(req.url!.split("/").pop())) : { videos: [vid(1), vid(2)] })); });
  await new Promise<void>(r => srv.listen(0, "127.0.0.1", r));
  Object.assign(process.env, { PEXELS_API: `http://127.0.0.1:${(srv.address() as any).port}`, PEXELS_API_KEY: "KEY" });
  const { search } = await import("../engine/footage");
  const uhd = await search({ provider: "pexels", q: "aerial glacier" }, false, true);
  assert.equal(uhd.length, 2); assert.equal(uhd[0].url, "https://cdn/1-uhd.mp4"); assert.equal(uhd[0].fps, 50); assert.equal(uhd[0].credit, "Ann / Pexels");
  assert.match(seen[0], /^KEY \/videos\/search\?query=aerial\+glacier.*size=large.*orientation=landscape/);
  assert.equal((await search({ provider: "pexels", q: "x" }, false, false))[0].url, "https://cdn/1-fhd.mp4");
  const pinned = await search({ provider: "pexels", q: "x", id: "77" }, false, true);
  assert.equal(pinned.length, 1); assert.equal(pinned[0].id, "77"); assert.match(seen.at(-1)!, /\/videos\/videos\/77$/);
  delete process.env.PEXELS_API_KEY; assert.deepEqual(await search({ provider: "pexels", q: "x" }, false), [], "no key: skipped quietly");
  srv.close(); console.log("pexels mock tests: all passed");
}

// --- channel lock: Project 1's channel is always refused; empty handle = any other channel; set handle = only that one
{
  const { channelProblem } = await import("../autopilot/youtube");
  assert.match(channelProblem("@Hoppadooo", "Hoppadooo", "")!, /Project 1/);
  assert.match(channelProblem("@hoppadooo", "Hoppadooo", "@hoppadooo")!, /Project 1/, "even if someone types it in");
  assert.equal(channelProblem("@realfootage", "Real Footage", ""), null);
  assert.equal(channelProblem("@RealFootage", "Real Footage", "realfootage"), null);
  assert.match(channelProblem("@other", "Other", "@realfootage")!, /WRONG CHANNEL/);
  console.log("channel lock tests: all passed");
}
