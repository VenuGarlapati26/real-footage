// DAILY RUN: long video on longDays, Shorts every day. Only "approved" episodes; every job passes the gates,
// builds, passes QA, then publishes:
//   YouTube   at the learned best slot, with the learned thumbnail style, subtitles, and the channel's first
//             comment (the question). The notification asks you to pin it (the API cannot pin).
//   Instagram Reels + Facebook Reels + TikTok (+ Snapchat Spotlight when available), Shorts only: their own
//             captions, cover = the best real frame, all released at the SAME moment as the YouTube Short
//             (Facebook and TikTok scheduled natively, Instagram published by release.yml at that time).
// Refuses to publish while development mode is on (8-second renders).
//
//   npx tsx autopilot/daily.ts [--dry] [--force]

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { existsSync } from "node:fs";
const execFileP = promisify(execFile);
import path from "node:path";
import { readFile, writeFile, readdir, mkdir, copyFile } from "node:fs/promises";
import { build } from "../engine/build";
import { chooseLongRes, loadUsage, record, saveUsage, type Res } from "./budget";
import { runGates } from "../engine/gates";
import type { Episode, Lang } from "../engine/types";
import { LANGS, tx, ui } from "../engine/langs";
import { loadLearning, pick } from "../growth/learn";
import { THUMB_STYLES } from "../growth/thumbs";
import { instagramCaption, facebookCaption, firstComment } from "../growth/captions";
import { notify } from "./notify";

/** About how long the long cut of an episode runs, from its narration (2.6 words per second plus pauses). Pure. */
export const longSeconds = (ep: Episode) => ep.scenes.filter(sc => !sc.shortOnly).reduce((t, sc) => t + sc.vo.en.split(/\s+/).filter(Boolean).length / 2.6 + 0.8, 0);
import * as yt from "./youtube";
import * as meta from "./meta";
import * as zernio from "./zernio";

const args = new Set(process.argv.slice(2)), DRY = args.has("--dry");
const log = (s: string) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${s}`);
const readJson = async <T>(f: string): Promise<T> => JSON.parse(await readFile(f, "utf8"));
const localDate = (tz: string) => new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date());
const weekday = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", timeZone: "UTC" });
/** `date` + `hh:mm` on the wall clock of `tz`, as a UTC ISO time (independent of the machine's own time zone). */
export function zoned(date: string, hhmm: string, tz: string) {
  const g = Date.parse(`${date}T${hhmm}:00Z`);
  const offset = (t: number) => { const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(t).map(x => [x.type, x.value]));
    return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second) - t; };
  return new Date(g - offset(g - offset(g))).toISOString();
}
/** The next time this slot comes round at least `leadMin` minutes from now (the run starts 18:30 IST, so a 07:30
 *  slot means tomorrow morning, not this morning, which YouTube would reject as a time in the past). */
export function releaseAt(date: string, hhmm: string, tz: string, now = Date.now(), leadMin = 25) {
  let at = zoned(date, hhmm, tz);
  for (let i = 0; i < 3 && Date.parse(at) < now + leadMin * 60_000; i++) { const d = new Date(`${date}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + i + 1); at = zoned(d.toISOString().slice(0, 10), hhmm, tz); }
  return at;
}
/** In GitHub Actions: push the ledger now, so the release run can publish Instagram at the Short's time. */
async function checkpoint(msg: string) {
  if (!process.env.GITHUB_ACTIONS || DRY) return;
  const g = (...a: string[]) => execFileP("git", ["-c", "user.name=p2-autopilot", "-c", "user.email=autopilot@users.noreply.github.com", ...a]);
  try { await g("add", "channel/ledger.json"); await g("commit", "-m", msg); for (let i = 0; i < 3; i++) { try { await g("pull", "--rebase"); await g("push"); break; } catch { await new Promise(r => setTimeout(r, 4000)); } } }
  catch (e: any) { log(`  note: checkpoint push: ${e.message ?? e}`); }
}
export interface Row { date: string; episode: string; job: "long" | "short"; title: string; status: string; topic: string; voice: string;
  videoId?: string; url?: string; publishAt?: string; slot: string; thumbStyle?: string; igId?: string; igContainer?: string; fbId?: string; ttId?: string; snapId?: string; scored?: boolean; angle?: string }

function description(ep: Episode, lang: Lang, rights: any[], synthetic: boolean, longUrl?: string) {
  return [
    tx(ep.title, lang), "", tx(ep.engage.ask, lang), "",
    ui(lang, "promise"),
    ...(longUrl ? ["", `${ui(lang, "full")}: ${longUrl}`] : []),
    "", `${ui(lang, "footage")}:`, ...rights.map(r => `- ${r.credit} (${r.license})${r.page ? ` ${r.page}` : ""}`),
    "", `${ui(lang, "sources")}:`, ...ep.sources.map(s => `- ${s.title}: ${s.url}`),
    ...(synthetic ? ["", ui(lang, "synthetic")] : []),
    "", ui(lang, "nasa"),
  ].join("\n");
}

const daysInMonth = (d: string) => new Date(Number(d.slice(0, 4)), Number(d.slice(5, 7)), 0).getDate();

async function main() {
  const s = await readJson<any>("channel/settings.json"), lang = s.lang as Lang;
  if (!s.dev?.fullRenders) { log("DEVELOPMENT MODE: renders are capped at 8 seconds, so nothing is published. Set dev.fullRenders: true once the samples are approved."); return; }
  if (!s.fullVideosConfirmed) { log("Publishing locked until you approve (channel/settings.json -> fullVideosConfirmed)."); return; }
  if (!s.enabled && !args.has("--force")) { log("Autopilot is off."); return; }
  if (!DRY) { if (!yt.hasCredentials()) { await notify("Project 2 waiting for YouTube sign-in", "Add the YouTube secrets.", { topic: s.notify?.ntfyTopic }); return; } await yt.assertChannel(s.channelHandle); }
  const learning = await loadLearning();
  const date = process.env.RUN_DATE ?? localDate(s.timezone), dayIndex = Math.floor(Date.parse(date) / 86_400_000);
  const ledger = await readJson<Row[]>("channel/ledger.json");
  const files = (await readdir("episodes")).filter(f => f.endsWith(".json")).sort();
  const eps = (await Promise.all(files.map(async f => ({ file: path.join("episodes", f), ep: await readJson<Episode>(path.join("episodes", f)) })))).filter(x => x.ep.status === "approved");
  const done = (id: string, job: string) => ledger.some(r => r.episode === id && r.job === job && r.status !== "failed");
  const jobs: { file: string; ep: Episode; job: "long" | "short"; slot: string }[] = [];
  // what today's earlier run already made (the 16:00 UTC catch-up only fills what is missing, never doubles up)
  const today = (job: string) => ledger.filter(r => r.date === date && r.job === job && r.status !== "failed").length;
  const shortsLeft = Math.max(0, (s.shortsPerDay ?? 1) - today("short"));
  // a long video only from an episode that really has a long cut (3+ min of story): the hand-made samples are Shorts only
  const minLong = s.minLongSeconds ?? 150;
  if (s.longDays.includes(weekday(date)) && !today("long")) { const n = eps.find(x => !done(x.ep.id, "long") && longSeconds(x.ep) >= minLong);
    if (!n) log(`Long day, but no approved episode has a long cut of ${minLong}+ s yet; only Shorts today.`);
    if (n) jobs.push({ ...n, job: "long", slot: pick([s.longTime, ...(s.longAltTimes ?? [])], learning.slots, dayIndex, s.explore) }); }
  const shortSlots = s.shortTimes as string[], best = pick(shortSlots, learning.slots, dayIndex, s.explore);
  eps.filter(x => !done(x.ep.id, "short")).sort((a, b) => Number(done(b.ep.id, "long")) - Number(done(a.ep.id, "long")))
    .slice(0, shortsLeft).forEach((x, i) => jobs.push({ ...x, job: "short", slot: i === 0 ? best : shortSlots.filter(t => t !== best)[(i - 1) % Math.max(1, shortSlots.length - 1)] ?? best }));
  if (!jobs.length && (today("short") || today("long"))) { log("Today's videos are already made."); return; }
  if (!jobs.length) {
    log("Nothing to make today: no approved episode left.");
    if (!DRY) await notify("Project 2: out of episodes", "No approved episode is left, so nothing was published today. Check the last Weekly run (is GEMINI_API_KEY set?) or approve drafts in episodes/.", { topic: s.notify?.ntfyTopic });
    return;
  }

  const errors: string[] = [], made: Row[] = [], pins: string[] = [];
  let usage = await loadUsage();
  // Shorts first: they take minutes, so the evening slot is still reachable today; the long video takes hours
  jobs.sort((a, b) => (a.job === "short" ? 0 : 1) - (b.job === "short" ? 0 : 1));
  for (const j of jobs) {
    try {
      const bad = runGates(j.ep, undefined, learning.hookMin).filter(g => !g.pass); if (bad.length) throw new Error(`gates: ${bad.map(g => `${g.name} (${g.detail})`).join("; ")}`);
      // long videos: the highest resolution the month's Actions minutes can still afford (4K when there is room)
      let res: string | undefined;
      if (j.job === "long") {
        const days = daysInMonth(date), today = Number(date.slice(8, 10)), left = days - today + 1;
        const c = chooseLongRes({ wanted: (s.output?.long ?? "2160p") as Res, usage, budgetMinutes: s.budget?.minutesPerMonth ?? 1800, longSeconds: s.budget?.longSeconds ?? 240,
          shortSeconds: s.budget?.shortSeconds ?? 35, daysLeft: left, longDaysLeft: Math.ceil(left * s.longDays.length / 7), shortsPerDay: s.shortsPerDay ?? 1 });
        res = c.res; log(`  long video at ${res} (month so far ${usage.minutes} min, projected ${c.projected} of ${s.budget?.minutesPerMonth ?? 1800})`);
      }
      const t0 = Date.now();
      const r: any = (await build(j.file, [j.job], lang, { res: res ? { long: res } : undefined }))[j.job];
      usage = record(usage, `${j.job}-${r.resolution}`, r.duration, (Date.now() - t0) / 1000); await saveUsage(usage);
      if (!r.qa.pass) throw new Error(`QA: ${r.qa.problems.join("; ")}`);
      const synthetic = r.voice.some((v: string) => v !== "human"), at = releaseAt(date, j.slot, s.timezone);
      const longUrl = j.job === "short" ? ledger.find(x => x.episode === j.ep.id && x.job === "long")?.url : undefined;
      const title = j.job === "long" ? tx(j.ep.title, lang) : `${tx(j.ep.title, lang).split(":")[0]} #Shorts`;
      const thumbStyle = j.job === "long" ? pick([...THUMB_STYLES], learning.thumbStyles, dayIndex, s.explore) : undefined;
      const row: Row = { date, episode: j.ep.id, job: j.job, title, status: "rendered", topic: j.ep.topic, angle: j.ep.angle, voice: synthetic ? "synthetic" : "human", slot: j.slot, thumbStyle };
      // keep what the weekly learner needs: shot timings + subtitles of what was said
      await mkdir("channel/renders", { recursive: true });
      await writeFile(`channel/renders/${j.ep.id}-${j.job}.json`, JSON.stringify({ duration: r.duration, shots: r.shots }, null, 2));
      await copyFile(r.file.replace(/\.mp4$/, `.${lang}.srt`), `channel/renders/${j.ep.id}-${j.job}.${lang}.srt`).catch(() => {});
      if (!DRY) {
        const id = await yt.uploadVideo(r.file, { title, description: description(j.ep, lang, r.rights, synthetic, longUrl), tags: [j.ep.topic, "real footage", "space", "earth from space", "documentary"],
          categoryId: s.categoryId, language: lang, privacy: "private", publishAt: s.mode === "live" ? at : undefined, syntheticMedia: synthetic });
        row.videoId = id; row.url = j.job === "long" ? `https://youtu.be/${id}` : `https://youtube.com/shorts/${id}`; row.status = s.mode === "live" ? "scheduled" : "private"; row.publishAt = s.mode === "live" ? at : undefined;
        for (const l of (r.subtitles ?? [lang]) as Lang[]) await yt.uploadCaption(id, l, LANGS[l].native, r.file.replace(/\.mp4$/, `.${l}.srt`)).catch(e => log(`  note: subtitles ${l}: ${e.message}`));
        if (thumbStyle) await yt.setThumbnail(id, r.thumbs.find((t: string) => t.includes(thumbStyle))).catch(e => log(`  note: thumbnail: ${e.message}`));
        await yt.postComment(id, firstComment(j.ep, lang)).then(() => pins.push(`${row.url}`)).catch(e => log(`  note: comment: ${e.message}`));
        if (j.job === "short" && s.mode === "live") {
          // Instagram/Facebook Reels top out at 1080x1920: give them a clean 1080p copy of the 4K master
          const reel = r.file.replace(/\.mp4$/, ".reels1080.mp4");
          await execFileP("ffmpeg", ["-y", "-v", "error", "-i", r.file, "-vf", "scale=1080:1920:flags=lanczos", "-c:v", "libx264", "-preset", "medium", "-crf", "18", "-c:a", "copy", "-movflags", "+faststart", reel]).catch(() => {});
          r.file = existsSync(reel) ? reel : r.file;
          // every platform goes out at the same moment as YouTube (`at`)
          const hoursAhead = (Date.parse(at) - Date.now()) / 3_600_000, cap = facebookCaption(j.ep, lang);
          if (meta.hasInstagram()) await (hoursAhead > 0.3 && hoursAhead < 23
            ? meta.prepareInstagramReel(r.file, instagramCaption(j.ep, lang), { coverMs: r.coverMs, aiGenerated: synthetic }).then(c => { row.igContainer = c; })   // published by release.yml at `at`
            : meta.instagramReel(r.file, instagramCaption(j.ep, lang), { coverMs: r.coverMs, aiGenerated: synthetic }).then(id => { row.igId = id; })
          ).catch(e => log(`  note: Instagram: ${e.message}`));
          if (meta.hasFacebook()) row.fbId = await meta.facebookReel(r.file, cap, at).catch(e => { log(`  note: Facebook: ${e.message}`); return undefined; });
          if (zernio.hasTikTok() || zernio.hasSnapchat()) {
            const url = await zernio.uploadVideo(r.file).catch(e => { log(`  note: TikTok/Snapchat upload: ${e.message}`); return ""; });
            if (url && zernio.hasTikTok() && s.social?.tiktok !== false) row.ttId = await zernio.tiktok(url, cap, { publishAt: at, aiGenerated: synthetic, coverMs: r.coverMs }).catch(e => { log(`  note: ${e.message}`); return undefined; });
            if (url && zernio.hasSnapchat() && s.social?.snapchat !== false) row.snapId = await zernio.snapchat(url, cap, { publishAt: at, contentType: s.social?.snapchatType }).catch(e => { log(`  note: ${e.message} (post it from the platform-pack)`); return undefined; });
          }
        }
      }
      if (j.job === "short") { const pack = path.resolve(process.env.PACK_DIR ?? "platform-pack", date); await mkdir(pack, { recursive: true });
        await copyFile(r.file, path.join(pack, `${j.ep.id}-short.mp4`)); await writeFile(path.join(pack, `${j.ep.id}-instagram.txt`), instagramCaption(j.ep, lang));
        // TikTok / Snapchat Spotlight / anything else without a free posting API: ready-to-post caption
        await writeFile(path.join(pack, `${j.ep.id}-tiktok-snapchat.txt`), facebookCaption(j.ep, lang)); }
      // a dry run never touches the ledger: otherwise its episodes would count as published and be skipped for real
      made.push(row); if (!DRY) { ledger.push(row); await writeFile("channel/ledger.json", JSON.stringify(ledger, null, 2)); }
      if (row.igContainer) await checkpoint(`autopilot: ${j.ep.id} short ready for ${at}`);
    } catch (e: any) { errors.push(`${j.ep.id} ${j.job}: ${e.message ?? e}`); }
  }
  const lines = made.map(r => `- ${r.job} "${r.title}" ${r.status} at ${r.slot}${r.thumbStyle ? `, thumbnail "${r.thumbStyle}"` : ""}${r.url ? ` ${r.url}` : ""}${r.igId || r.igContainer ? " + Instagram" : ""}${r.fbId ? " + Facebook" : ""}${r.ttId ? " + TikTok" : ""}${r.snapId ? " + Snapchat" : ""}${r.publishAt ? ` (all go live ${new Date(r.publishAt).toLocaleString("en-IN", { timeZone: s.timezone, dateStyle: "medium", timeStyle: "short" })})` : ""}`);
  const pinNote = pins.length ? ["", "Pin the first comment (1 tap in the YouTube app) on:", ...pins.map(p => `- ${p}`)] : [];
  await notify(errors.length ? `Project 2 FAILED for ${date}` : `Project 2: ${made.length} video(s) for ${date}`, [...lines, ...pinNote, ...errors].join("\n"), { topic: s.notify?.ntfyTopic, priority: errors.length ? "high" : "default" });
  if (errors.length) process.exitCode = 1;
}
if (process.argv[1]?.endsWith("daily.ts")) await main();
