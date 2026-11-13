// Offline tests: every platform released at the same moment (publish times, Facebook scheduling, Instagram
// prepare + release, TikTok/Snapchat through Zernio), against local mock servers.
import assert from "node:assert/strict";
import http from "node:http";
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";

// --- mock Meta + Zernio
const calls: { m: string; u: string; b: string }[] = [];
const srv = http.createServer((req, res) => {
  let b = ""; req.on("data", d => (b += d)); req.on("end", () => {
    const u = req.url!.split("?")[0]; calls.push({ m: req.method!, u, b: b.length > 500 ? `<${b.length} bytes>` : b });
    const j = (o: any, code = 200) => { res.writeHead(code, { "content-type": "application/json" }); res.end(JSON.stringify(o)); };
    const port = (srv.address() as any).port;
    if (u === "/IG1/media") return j({ id: "C9", uri: `http://127.0.0.1:${port}/ig-api-upload/v25.0/C9` });
    if (u.startsWith("/ig-api-upload/") || u.startsWith("/video-upload/")) return j({ success: true });
    if (u === "/C9") return j({ status_code: "FINISHED" });
    if (u === "/IG1/media_publish") return b.includes("C1") ? j({ id: "M1" }) : j({ error: { message: "The media container has expired" } }, 400);
    if (u === "/P1") return j({ access_token: "page" });
    if (u === "/P1/video_reels") return b.includes("start") ? j({ video_id: "V1", upload_url: `http://127.0.0.1:${port}/video-upload/v25.0/V1` }) : j({ success: true });
    if (u === "/api/v1/media/presign") return j({ uploadUrl: `http://127.0.0.1:${port}/put/x.mp4`, publicUrl: "https://media.example/x.mp4" });
    if (u === "/put/x.mp4") { res.writeHead(200); return res.end(); }
    if (u === "/api/v1/posts") return b.includes('"snapchat"') ? j({ code: "PLATFORM_BETA_RESTRICTED", error: "Snapchat is not available yet" }, 403) : j({ post: { _id: "Z1" } }, 201);
    j({}, 404);
  });
});
await new Promise<void>(r => srv.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${(srv.address() as any).port}`;
Object.assign(process.env, { META_POLL_MS: "5", META_GRAPH: base, META_RUPLOAD: base, META_ACCESS_TOKEN: "t", IG_USER_ID: "IG1", FB_PAGE_ID: "P1",
  ZERNIO_API: `${base}/api/v1`, ZERNIO_API_KEY: "k", ZERNIO_TIKTOK_ID: "T1", ZERNIO_SNAPCHAT_ID: "S1", NTFY_TOPIC: "" });
writeFileSync("/tmp/p2-rel.mp4", Buffer.alloc(2000));
const { releaseAt } = await import("../autopilot/daily"), { spotlightCaption } = await import("../autopilot/zernio"), { due } = await import("../autopilot/release");

// --- publish times: a slot already past today (run starts 18:30 IST) rolls to tomorrow; a later slot stays today
const now = Date.parse("2026-11-12T13:05:00Z");   // 18:35 IST
assert.equal(releaseAt("2026-11-12", "07:30", "Asia/Kolkata", now), "2026-11-13T02:00:00.000Z");
assert.equal(releaseAt("2026-11-12", "19:30", "Asia/Kolkata", now), "2026-11-12T14:00:00.000Z");
assert.equal(releaseAt("2026-11-12", "18:50", "Asia/Kolkata", now), "2026-11-13T13:20:00.000Z", "less than 25 min ahead -> tomorrow");

// --- Snapchat Spotlight caption: <= 160 characters including hashtags
const long = "Before your day ends, astronauts above you will see sixteen sunrises, and almost nobody knows why it happens or what it feels like up there. Watch to the end. #space #ISS #science #shorts #nasa";
const sc = spotlightCaption(long); assert.ok(sc.length <= 160 && sc.endsWith("#space #ISS #science"), sc);
assert.equal(spotlightCaption("Short one #a"), "Short one #a");

// --- which Instagram Reels are due
const L = [{ episode: "E1", job: "short", publishAt: "2026-11-12T14:00:00Z", igContainer: "C1" }, { episode: "E2", job: "short", publishAt: "2026-11-13T02:00:00Z", igContainer: "C2" }, { episode: "E3", job: "short", publishAt: "2026-11-12T14:00:00Z", igContainer: "C3" }];
assert.deepEqual(due(L, { C3: "M3" }, Date.parse("2026-11-12T13:56:00Z")).map(r => r.episode), ["E1"], "due within 6 min, not twice, not tomorrow's");

const meta = await import("../autopilot/meta"), zernio = await import("../autopilot/zernio");

const later = new Date(Date.now() + 3 * 3_600_000).toISOString();
assert.equal(await meta.prepareInstagramReel("/tmp/p2-rel.mp4", "cap", { aiGenerated: true }), "C9");
assert.ok(!calls.some(c => c.u === "/IG1/media_publish"), "prepared, not published");
await meta.facebookReel("/tmp/p2-rel.mp4", "desc", later);
const fin = calls.find(c => c.u === "/P1/video_reels" && c.b.includes("finish"))!.b;
assert.ok(fin.includes("video_state=SCHEDULED") && fin.includes(`scheduled_publish_time=${Math.floor(Date.parse(later) / 1000)}`), fin);

const url = await zernio.uploadVideo("/tmp/p2-rel.mp4"); assert.equal(url, "https://media.example/x.mp4");
assert.equal(await zernio.tiktok(url, "caption #a", { publishAt: later, aiGenerated: true }), "Z1");
const tt = JSON.parse(calls.filter(c => c.u === "/api/v1/posts")[0].b);
assert.equal(tt.scheduledFor, later); assert.equal(tt.platforms[0].platformSpecificData.videoMadeWithAi, true); assert.equal(tt.platforms[0].accountId, "T1");
await assert.rejects(zernio.snapchat(url, "caption", { publishAt: later }), /PLATFORM_BETA_RESTRICTED/, "Snapchat closed: a clear error, the run carries on");

// --- release run: publishes the due Reel, records it, marks an expired one so it is not retried
const dir = mkdtempSync(path.join(os.tmpdir(), "p2rel-")); mkdirSync(path.join(dir, "channel"));
writeFileSync(path.join(dir, "channel/ledger.json"), JSON.stringify([{ episode: "E1", job: "short", title: "t", publishAt: new Date(Date.now() - 60_000).toISOString(), igContainer: "C1" }, { episode: "E2", job: "short", publishAt: new Date(Date.now() - 120_000).toISOString(), igContainer: "C2" }]));
const cwd = process.cwd(); process.chdir(dir);
const { release } = await import("../autopilot/release");
const out = await release(); process.exitCode = 0;
assert.deepEqual(out.published, ['E1 "t"']); assert.equal(out.errors.length, 1);
assert.deepEqual(JSON.parse(readFileSync("channel/released.json", "utf8")), { C1: "M1", C2: "expired" });
process.chdir(cwd); srv.close();
console.log("release tests: all passed");
