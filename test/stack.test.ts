// Offline tests for the premium stack: ElevenLabs music/SFX/voice, Notion, keyword data. All against a local mock.
import assert from "node:assert/strict";
import http from "node:http";
import { execFileSync, spawn } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { compositionPlan, energyCurve, moodFor, musicFor, MOODS } from "../engine/music";
import { score, writeWav, mixArgs } from "../engine/audio";
import { syncNotion, ideaProps } from "../growth/notion";
import { volumes, withDemand } from "../growth/keywords";
import type { Episode } from "../engine/types";

const ep = JSON.parse(readFileSync("episodes/E001-iss-16-sunrises.json", "utf8")) as Episode;
const tmp = mkdtempSync(path.join(tmpdir(), "stack-"));
const sine = (f: string, s: number) => execFileSync("ffmpeg", ["-y", "-v", "error", "-f", "lavfi", "-i", `sine=f=440:d=${s}`, "-ac", "2", f]);

// --- mood + energy + plan
assert.equal(moodFor(ep), "awe");
assert.equal(moodFor({ topic: "scam", title: { hi: "", en: "The hidden scam" } }), "mystery");
const timed = ep.scenes.filter(s => !s.shortOnly).map((s, i) => ({ scene: s, start: i * 5, dur: 5 }));
const curve = energyCurve(timed, ep.music);
assert.equal(curve.find(c => c.peak)!.id, "s3"); assert.equal(curve.find(c => c.peak)!.level, 5);
assert.ok(curve[0].level < curve[2].level && curve.at(-1)!.level < 5, "builds to the peak, resolves after");
const plan = compositionPlan(timed, 25, "awe", ep.music);
assert.ok(plan.chunks.every(c => c.duration_ms >= 3000 && c.duration_ms <= 120000) && plan.chunks.length <= 30);
assert.ok(Math.abs(plan.totalMs - 26000) < 5, `plan covers the cut + 1 s tail, got ${plan.totalMs}`);
assert.ok(plan.chunks.some(c => c.text.startsWith("[Climax]")) && plan.chunks.every(c => c.negative_styles.includes("vocals") && c.negative_styles.includes("children's music")));
assert.ok(plan.chunks[0].positive_styles.includes(ep.music!.styles![0]) && plan.chunks[0].positive_styles.length >= 7, "first section sets the genre with 6+ styles");
const short = compositionPlan(timed, 8, "awe", ep.music); // dev cap: 8 s
assert.ok(short.chunks.every(c => c.duration_ms >= 3000) && short.totalMs >= 8000);
for (const m of Object.keys(MOODS)) assert.ok(score(6, [2], [0, 3], 1, { mood: m as any, peakAt: 3 }).n > 0);

// --- mixing: music + voice + sound effects through real ffmpeg
await writeWav(path.join(tmp, "bed.wav"), score(4, [], [0, 2], 3, { mood: "tension" }));
sine(path.join(tmp, "v.wav"), 1.5); sine(path.join(tmp, "fx.mp3"), 0.8);
execFileSync("ffmpeg", mixArgs(path.join(tmp, "bed.wav"), [{ file: path.join(tmp, "v.wav"), at: 0.5 }], path.join(tmp, "mix.wav"), 4, [{ file: path.join(tmp, "fx.mp3"), at: 1, gain: 0.5 }]));
const dur = Number(execFileSync("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", path.join(tmp, "mix.wav")]).toString());
assert.ok(Math.abs(dur - 4) < 0.05, `mix is exactly the cut, got ${dur}`);
execFileSync("ffmpeg", mixArgs(path.join(tmp, "bed.wav"), [], path.join(tmp, "mix2.wav"), 4));

// --- mock server for ElevenLabs, Notion, Semrush, DataForSEO
const seen: Record<string, any[]> = {}; const pages: any[] = [];
let dbProps: any = { Name: { type: "title" } };
const mp3 = path.join(tmp, "fake.mp3"); sine(mp3, 30); const MP3 = readFileSync(mp3);
const srv = http.createServer(async (q, s) => {
  let b = ""; for await (const c of q) b += c; const body = b ? (() => { try { return JSON.parse(b); } catch { return b; } })() : undefined;
  const u = new URL(q.url!, "http://x"); (seen[u.pathname] ??= []).push({ method: q.method, body, headers: q.headers, query: u.search });
  const json = (o: any) => { s.writeHead(200, { "content-type": "application/json" }); s.end(JSON.stringify(o)); };
  if (u.pathname === "/v1/music" || u.pathname === "/v1/sound-generation" || u.pathname.startsWith("/v1/text-to-speech/")) { s.writeHead(200, { "content-type": "audio/mpeg" }); return s.end(MP3); }
  if (u.pathname === "/v1/databases/db1" && q.method === "GET") return json({ properties: dbProps });
  if (u.pathname === "/v1/databases/db1" && q.method === "PATCH") { dbProps = { ...dbProps, ...body.properties }; return json({}); }
  if (u.pathname === "/v1/databases/db1/query") return json({ results: [{ id: "p1", properties: { Name: { title: [{ plain_text: "isro launch live" }] }, Key: { rich_text: [{ plain_text: "idea:isro launch live" }] }, Status: { select: { name: "Make next" } } } }], has_more: false });
  if (u.pathname === "/v1/pages") { pages.push(body); return json({ id: "new" }); }
  if (u.pathname.startsWith("/v1/pages/")) return json({});
  if (u.pathname === "/") { s.writeHead(200); return s.end("Keyword;Search Volume;Keyword Difficulty Index\r\nisro launch live;40500;62\r\n"); }
  if (u.pathname === "/v3/keywords_data/google_ads/search_volume/live") return json({ tasks: [{ result: [{ keyword: "isro launch live", search_volume: 9900, competition_index: 30 }] }] });
  s.writeHead(404); s.end();
});
await new Promise<void>(r => srv.listen(0, r)); const base = `http://127.0.0.1:${(srv.address() as any).port}`;
Object.assign(process.env, { ELEVENLABS_API_KEY: "k", ELEVENLABS_BASE: base, MUSIC_CACHE: path.join(tmp, "music"), SFX_DIR: path.join(tmp, "sfx"),
  NOTION_TOKEN: "t", NOTION_DATABASE_ID: "db1", NOTION_BASE: base, SEMRUSH_API_KEY: "s", SEMRUSH_BASE: base, DATAFORSEO_BASE: base });

// FREE BY DEFAULT: with an ElevenLabs key present but not opted in, nothing paid is called
{
  const bank = path.join(tmp, "bank"), aw = path.join(bank, "awe"); execFileSync("mkdir", ["-p", aw]);
  // two 60 s tracks: quiet, then a big swell at 30 s / 20 s
  for (const [name, at] of [["a", 30], ["b", 20]] as const) {
    execFileSync("ffmpeg", ["-y", "-v", "error", "-f", "lavfi", "-i", `sine=f=220:d=60`, "-af", `volume='if(lt(t,${at}),0.05,0.9)':eval=frame`, "-ac", "2", path.join(aw, `${name}.mp3`)]);
    writeFileSync(path.join(aw, `${name}.json`), JSON.stringify({ licence: "test" }));
  }
  writeFileSync(path.join(aw, "nolicence.mp3"), readFileSync(path.join(aw, "a.mp3"))); // no .json -> never used
  Object.assign(process.env, { MUSIC_BANK: bank, MUSIC_USAGE: path.join(tmp, "usage.json"), SFX_DIR: path.join(tmp, "sfx-free") });
  const { envelope, liftPoint, fitOffset, pickOrder, listBank } = await import("../engine/bank");
  const lift = liftPoint(await envelope(path.join(aw, "a.mp3"))); assert.ok(Math.abs(lift.at - 30) < 0.6, `lift found at ${lift.at}`);
  assert.equal(fitOffset(60, 30, 10, 25), 20, "lift lands on the reveal"); assert.equal(fitOffset(60, 58, 10, 25), 35, "never runs past the track end");
  assert.deepEqual(pickOrder([{ file: "x" }, { file: "y" }], { x: "2026-11-01" }).map(t => t.file), ["y", "x"], "unused first");
  assert.equal((await listBank("awe")).length, 2); assert.equal((await listBank("triumph")).length, 2, "near mood borrowed when empty");
  const before = Object.keys(seen).length;
  const f = await musicFor(ep, timed, 25, [5.3], tmp, { hookAt: 0.05 });
  assert.equal(f.source, "bank"); assert.equal(Object.keys(seen).length, before, "no paid API called");
  assert.ok(f.fx.every(x => x.file.endsWith(".wav")) && f.fx.length >= 4, "free synthesised sound effects");
  // the bed is exactly the cut, and the swell sits on the reveal (s3 at 10 s): quiet before, loud after
  const bedEnv = await envelope(f.bed); assert.ok(Math.abs(bedEnv.length / 10 - 25) < 0.2);
  const avg = (a: number, b: number) => bedEnv.slice(a * 10, b * 10).reduce((x, y) => x + y, 0) / ((b - a) * 10);
  assert.ok(avg(10.3, 12) > avg(7, 9.7) * 4, `swell on the reveal: ${avg(7, 9.7)} -> ${avg(10.3, 12)}`);
  // a 3-minute long video chains tracks with crossfades
  const long = await musicFor(ep, timed.map((t, i) => ({ ...t, start: i * 36, dur: 36 })), 180, [], tmp);
  assert.ok(long.tracks.length >= 3 && Math.abs((await envelope(long.bed)).length / 10 - 180) < 0.3, "long bed covers 180 s");
  assert.ok(JSON.parse(readFileSync(path.join(tmp, "usage.json"), "utf8"))[path.join(aw, "a.mp3")], "usage recorded");
  await musicFor(ep, timed, 8, [], tmp, { record: false });
  delete process.env.MUSIC_BANK; process.env.SFX_DIR = path.join(tmp, "sfx");
}

// PAID, opted in: music composed to the plan, sound effects placed, cached
process.env.MUSIC_ORDER = "eleven,bank,synth"; process.env.SFX_SOURCE = "eleven";
const m = await musicFor(ep, timed, 25, [5.3, 10.3], tmp, { hookAt: 0.05 });
assert.equal(m.source, "elevenlabs"); assert.ok(existsSync(m.bed));
const req = seen["/v1/music"][0];
assert.equal(req.headers["xi-api-key"], "k"); assert.equal(req.body.model_id, "music_v2_5"); assert.ok(req.body.composition_plan.chunks.length >= 3 && !("prompt" in req.body));
assert.ok(m.fx.some(f => f.file.endsWith("reveal.mp3") && f.at === 10) && m.fx.some(f => f.file.endsWith("whoosh.mp3")) && m.fx.some(f => f.at === 0.05));
await musicFor(ep, timed, 25, [5.3, 10.3], tmp); assert.equal(seen["/v1/music"].length, 1, "same plan -> cached, not paid twice");
assert.equal(seen["/v1/sound-generation"].length, 3, "each effect generated once (hit, reveal, whoosh)");
// without a key: the synth score with the same mood and curve
delete process.env.ELEVENLABS_API_KEY; process.env.MUSIC_BANK = path.join(tmp, "empty");
const off = await musicFor(ep, timed, 8, [], tmp); assert.equal(off.source, "synth"); process.env.ELEVENLABS_API_KEY = "k";

// ElevenLabs voice through voice.py
// (async: the mock server lives in this process, a sync call would block it)
const vout = await new Promise<string>((res, rej) => { const c = spawn("python3", ["engine/voice.py"], { env: { ...process.env, ELEVENLABS_VOICE_ID: "voice1", VOICE_ORDER: "human,eleven", NARRATION_DIR: path.join(tmp, "none") } });
  let o = "", e = ""; c.stdout.on("data", d => o += d); c.stderr.on("data", d => e += d); c.on("close", code => code ? rej(new Error(e)) : res(o));
  c.stdin.end(JSON.stringify({ episode: "T", lang: "hi", out: path.join(tmp, "vo"), lines: [{ id: "a", text: "नमस्ते" }, { id: "b", text: "दुनिया" }] })); });
const vj = JSON.parse(vout); assert.deepEqual(vj.lines.map((l: any) => l.source), ["eleven", "eleven"]);
const tts = seen["/v1/text-to-speech/voice1"]; assert.equal(tts[0].body.language_code, "hi"); assert.equal(tts[0].body.next_text, "दुनिया"); assert.equal(tts[1].body.previous_text, "नमस्ते");

// Notion: columns created, ideas/videos upserted by key, your "Make next" picks returned
const n = await syncNotion([{ idea: "isro launch live", topic: "space", score: 9, why: ["x"] }, { idea: "aurora", topic: "earth", score: 4, why: ["y"] }],
  [{ date: "2026-11-01", episode: "E001", job: "long", title: "16 sunrises", status: "uploaded", topic: "space", videoId: "v1", url: "https://youtu.be/v1", publishAt: "2026-11-01T14:00:00Z", slot: "19:30" }], { v1: 1234 });
assert.ok(dbProps.Status && dbProps.Key && dbProps.Views); assert.deepEqual(n.requested, ["isro launch live"]); assert.equal(n.updated, 1); assert.equal(n.created, 2);
const vid = pages.find(p => p.properties.Kind.select.name === "Video"); assert.equal(vid.properties.Views.number, 1234); assert.equal(vid.properties.Status.select.name, "Published");
assert.equal((ideaProps({ idea: "A", topic: "t", score: 1, why: [] }, "Name") as any).Name.title[0].text.content, "A");

// keyword demand: Semrush first, DataForSEO otherwise, log-scaled bump
const v1 = await volumes(["isro launch live"]); assert.equal(v1[0].volume, 40500); assert.equal(v1[0].source, "semrush");
delete process.env.SEMRUSH_API_KEY; Object.assign(process.env, { DATAFORSEO_LOGIN: "l", DATAFORSEO_PASSWORD: "p" });
const v2 = await volumes(["isro launch live"]); assert.equal(v2[0].volume, 9900);
const ranked = withDemand([{ idea: "a", score: 5, why: [] }, { idea: "isro launch live", score: 4, why: [] }], v1);
assert.equal(ranked[0].idea, "isro launch live"); assert.ok(ranked[0].score < 12, "demand nudges, does not take over");

srv.close();
console.log("stack tests passed");
