// Build an episode from real footage.
//
//   npx tsx engine/build.ts episodes/E001-iss-16-sunrises.json [--formats long,short] [--lang en] [--full]
//
// DEVELOPMENT MODE (default): every render is capped at channel/settings.json -> dev.maxSeconds (8 s), in both
// formats, and only the footage those seconds need is downloaded. Full-length renders happen only with --full or
// when dev.fullRenders is true (switch it once the 8-second samples look right).

import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Clip, Episode, Format, Lang, Scene, Shot, Transition } from "./types";
import { has, isLang, tx } from "./langs";
import { makeSpec, renderOverlay } from "./mograph/render";
import { cutsIn, download, isUsable, pickIn, quality, search } from "./footage";
import { loadLearning } from "../growth/learn";
import { bestFrame, renderThumbs } from "../growth/thumbs";
import { lookFor, writeCube } from "./grade";
import { buildAss, type TitleScene } from "./titles";
import { mixArgs } from "./audio";
import { musicFor } from "./music";
import { assemble, contactSheet, renderShot } from "./edit";
import { qaVideo } from "../autopilot/qa";

const log = (s: string) => console.log(`[${new Date().toISOString().slice(11, 19)}] ${s}`);
const FONTS = path.resolve("assets/fonts");

function run(cmd: string, args: string[], input?: string): Promise<string> {
  return new Promise((res, rej) => {
    const p = spawn(cmd, args); let out = "", err = "";
    p.stdout.on("data", d => (out += d)); p.stderr.on("data", d => (err += d));
    p.on("close", c => (c === 0 ? res(out) : rej(new Error(`${cmd} exited ${c}: ${err.slice(-1200)}`))));
    p.stdin.end(input ?? "");
  });
}

export const scenesFor = (ep: Episode, f: Format) => ep.scenes.filter(s => (f === "short" ? !s.longOnly : !s.shortOnly));

export async function voice(ep: Episode, lang: Lang, dir: string, scenes: Scene[]) {
  const out = await run("python3", ["engine/voice.py"], JSON.stringify({ episode: ep.id, lang, out: path.join(dir, `voice-${lang}`), lines: scenes.map(s => ({ id: s.id, text: tx(s.vo, lang) })) }));
  return JSON.parse(out).lines as { id: string; file: string; seconds: number; source: string }[];
}

/** Scene timing: a breath before each line, a beat after. */
export function timeline(scenes: Scene[], voiced: { id: string; seconds: number }[]) {
  let t = 0;
  return scenes.map((s, i) => {
    const v = voiced.find(x => x.id === s.id)!; const lead = i === 0 ? 0.6 : 0.3, tail = i === scenes.length - 1 ? 1.2 : 0.45;
    const r = { scene: s, start: t, dur: lead + v.seconds + tail, voAt: lead, voDur: v.seconds }; t += r.dur; return r;
  });
}

const STOCK = new Set(["pexels", "pixabay"]);

/** Shots for every scene up to `until`: per query, the best-quality usable clips first (not just the first hit). */
async function findShots(ep: Episode, timed: ReturnType<typeof timeline>, until: number, portrait: boolean, shotSeconds: number, uhd = false): Promise<Shot[]> {
  const shots: Shot[] = [], used = new Map<string, [number, number][]>(), ranked = new Map<string, Clip[]>();
  const candidates = async (q: Scene["footage"][number], authentic: boolean): Promise<Clip[]> => {
    if (authentic && STOCK.has(q.provider)) return [];            // the "real footage" promise: no stock renders
    const key = JSON.stringify([q, portrait, uhd]); if (ranked.has(key)) return ranked.get(key)!;
    const clips: Clip[] = [];
    for (const cand of (await search(q, portrait, uhd)).slice(0, 6)) {
      try { const c = await download(cand); if (await isUsable(c, portrait)) clips.push(c); } catch (e) { log(`  skip ${cand.provider} ${cand.id}: ${String(e).slice(0, 100)}`); }
      if (clips.length >= 4) break;
    }
    const scored = await Promise.all(clips.map(async c => ({ c, q: await quality(c) })));
    const list = scored.sort((a, b) => b.q - a.q).map(x => x.c); ranked.set(key, list); return list;
  };
  for (const tsc of timed) {
    if (tsc.start >= until) break;
    const n = tsc.scene.shots ?? Math.max(1, Math.round(tsc.dur / shotSeconds)), each = tsc.dur / n;
    for (let k = 0; k < n; k++) {
      const start = tsc.start + k * each; if (start >= until) break;
      let placed = false;
      // the scene's own queries first; if every one of them fails (a source down or rate-limited that day), the other
      // scenes' footage of the same story: one weaker shot is better than no video at all
      const backup = ep.scenes.filter(o => o.id !== tsc.scene.id).flatMap(o => o.footage).filter(f => !tsc.scene.authentic || !STOCK.has(f.provider));
      for (const q of [...tsc.scene.footage, ...backup]) {
        for (const clip of await candidates(q, !!tsc.scene.authentic)) {
          const key = `${clip.provider}:${clip.id}`;
          // slow motion only from footage really filmed fast (48+ fps): half speed, every frame real
          const speed = tsc.scene.slowmo && (clip.fps ?? 0) >= 47 ? 0.5 : 1, src = each * speed;
          const inPoint = pickIn(clip.duration, await cutsIn(clip.file, (q as any).takes ? Math.ceil(Math.max(...(q as any).takes.map((t: number[]) => t[1]))) : 180), src, used.get(key) ?? [], (q as any).takes);
          if (inPoint === null) continue;
          used.set(key, [...(used.get(key) ?? []), [inPoint, inPoint + src]]);
          shots.push({ scene: tsc.scene.id, clip, inPoint, dur: each, start, ...(speed < 1 ? { speed } : {}) }); placed = true; break;
        }
        if (placed) break;
      }
      // last resort: real camera footage from stock libraries (Pexels/Pixabay: filmed, never AI) for this one shot, even in
      // a scene promised as space-agency footage. Logged, so the report shows it. A video with one stock shot beats no video.
      if (!placed) {
        const words = (tsc.scene.footage.find(f => (f as any).q) as any)?.q ?? ep.title.en;
        for (const q of [...tsc.scene.footage, ...backup, { provider: "pexels", q: words }, { provider: "pixabay", q: words }, { provider: "pexels", q: ep.topic ?? "earth" }] as Scene["footage"]) {
          if (!STOCK.has(q.provider)) continue;
          for (const clip of await candidates(q, false)) {
            const inPoint = pickIn(clip.duration, await cutsIn(clip.file, 180), each, used.get(`${clip.provider}:${clip.id}`) ?? []);
            if (inPoint === null) continue;
            used.set(`${clip.provider}:${clip.id}`, [...(used.get(`${clip.provider}:${clip.id}`) ?? []), [inPoint, inPoint + each]]);
            shots.push({ scene: tsc.scene.id, clip, inPoint, dur: each, start }); placed = true;
            log(`  ${tsc.scene.id}: no ${tsc.scene.authentic ? "space-agency" : ""} footage found, used ${clip.provider} "${(q as any).q}"`); break;
          }
          if (placed) break;
        }
      }
      if (!placed) throw new Error(`no usable footage for scene ${tsc.scene.id} (shot ${k + 1}/${n})${tsc.scene.authentic ? " from real-footage sources (NASA, Wikimedia, own clips)" : ""}. Add a clip in footage/ or more queries.`);
    }
  }
  return shots;
}

/** How shots meet. Inside a scene: clean hard cuts (how documentaries are cut). Between scenes:
 *  Shorts: whip pans (energy), with a flash every third change; long videos: light leak, whip, hard cut in turn, and a
 *  light leak into every chapter. Whips are never closer than 4 s (one every few seconds reads as a gimmick). Pure. */
export function planTransitions(shots: Shot[], format: Format, chapters: Set<string> = new Set()): { shots: Shot[]; transitions: { at: number; kind: Transition }[] } {
  const out = shots.map(s => ({ ...s })), transitions: { at: number; kind: Transition }[] = [];
  let k = 0, lastWhip = -99;
  for (let i = 1; i < out.length; i++) {
    if (out[i].scene === out[i - 1].scene) continue;
    const at = out[i].start;
    let kind: Transition = format === "short" ? (k % 3 === 2 ? "flash" : "whip") : chapters.has(out[i].scene) ? "leak" : (["leak", "whip", "cut"] as const)[k % 3];
    if (kind === "whip" && at - lastWhip < 4) kind = format === "short" ? "flash" : "cut";
    if (kind === "whip") lastWhip = at;
    out[i - 1].trOut = kind; out[i].trIn = kind; transitions.push({ at, kind }); k++;
  }
  return { shots: out, transitions };
}

function srt(timed: ReturnType<typeof timeline>, lang: Lang, until: number): string {
  const ts = (x: number) => { const ms = Math.round(x * 1000); return `${String(Math.floor(ms / 3600000)).padStart(2, "0")}:${String(Math.floor(ms / 60000) % 60).padStart(2, "0")}:${String(Math.floor(ms / 1000) % 60).padStart(2, "0")},${String(ms % 1000).padStart(3, "0")}`; };
  const cues: string[] = []; let n = 1;
  for (const t of timed) {
    const a = t.start + t.voAt; if (a >= until) break;
    const parts = tx(t.scene.vo, lang).split(/(?<=[।.?!:,])\s+/).filter(Boolean), total = parts.reduce((s, p) => s + p.length, 0);
    let at = a; for (const p of parts) { const d = (p.length / total) * t.voDur; if (at < until) cues.push(`${n++}\n${ts(at)} --> ${ts(Math.min(at + d, until))}\n${p}\n`); at += d; }
  }
  return cues.join("\n");
}

export async function build(epFile: string, formats: Format[], lang: Lang, opts: { full?: boolean; preview?: boolean; from?: string; seconds?: number; res?: Partial<Record<Format, string>> } = {}) {
  const ep = JSON.parse(await readFile(epFile, "utf8")) as Episode;
  const settings = JSON.parse(await readFile("channel/settings.json", "utf8"));
  const learning = await loadLearning();
  const full = !opts.preview && (opts.full || settings.dev?.fullRenders === true), cap = Number(opts.seconds ?? settings.dev?.maxSeconds ?? 8);
  const dir = path.join(process.env.RENDER_DIR ?? "out", ep.id); await mkdir(dir, { recursive: true });   // RENDER_DIR: the workflows upload it on dry runs and failures
  // the film look: the episode's own (chosen by the writer), else its content pillar's default
  const pillarLooks = Object.fromEntries((JSON.parse(await readFile("channel/pillars.json", "utf8").catch(() => "{}")).pillars ?? []).map((p: any) => [p.id, p.look]));
  const look = lookFor(ep, pillarLooks), lut = path.resolve(dir, `film-${look}.cube`); await writeCube(lut, look);
  const tag = settings.brandTag?.[lang] ?? settings.brandTag?.en ?? "REAL FOOTAGE";
  // subtitle tracks: every configured language the episode has text for (English always)
  const subLangs = ([...new Set(["en", lang, ...(settings.subtitles ?? [])])] as string[]).filter(isLang).filter(l => ep.scenes.every(s => has(s.vo, l)));
  const results: Record<string, any> = {};
  for (const format of formats) {
    // output size: channel/settings.json -> output.long / output.short ("2160p" = 4K UHD, "1440p", "1080p"). The graphics are
    // laid out on a 1080p grid and drawn at the output's pixel density, so they look identical and stay sharp.
    // per format: Shorts/Reels play at 1080p at most, so 4K is for the long video (YouTube then streams it at a much
    // higher bitrate, which is where the visible quality jump comes from)
    const res = opts.res?.[format] ?? settings.output?.[format] ?? settings.output?.resolution ?? "1080p";
    const k = ({ "2160p": 2, "1440p": 4 / 3, "1080p": 1 } as Record<string, number>)[res] ?? 1;
    const portrait = format === "short", [LW, LH] = portrait ? [1080, 1920] : [1920, 1080], W = Math.round(LW * k / 2) * 2, H = Math.round(LH * k / 2) * 2;
    // development only: --from <scene> starts the sample at that scene, to review the graphics further in
    const all = scenesFor(ep, format), fromIdx = opts.from && !full ? Math.max(0, all.findIndex(s => s.id === opts.from)) : 0;
    const scenes = all.slice(fromIdx);
    const voiced = await voice(ep, lang, dir, scenes);
    const timed = timeline(scenes, voiced), total = timed.at(-1)!.start + timed.at(-1)!.dur;
    const D = full ? total : Math.min(cap, total);
    log(`${ep.id} ${format}: ${total.toFixed(1)}s full, rendering ${D.toFixed(1)}s${full ? "" : " (development cap)"}; voice: ${[...new Set(voiced.map(v => v.source))].join("+")}; shots ~${learning.shotSeconds}s`);
    const found = (await findShots(ep, timed, D, portrait, learning.shotSeconds, !portrait && W >= 3000)).map(s => ({ ...s, dur: Math.min(s.dur, D - s.start) })).filter(s => s.dur > 0.2);
    const chapterScenes = new Set(scenes.filter(sc => sc.overlays?.some(o => o.kind === "chapter")).map(sc => sc.id));
    const { shots, transitions } = planTransitions(found, format, chapterScenes);
    log(`${format}: look ${look}; ${shots.filter(s => s.speed).length} slow-motion shots; transitions ${transitions.map(t => t.kind).join(" ") || "none"}`);
    const work = path.join(dir, `${format}-${lang}-work`); await mkdir(work, { recursive: true });
    const files: string[] = [];
    for (let i = 0; i < shots.length; i++) { const f = path.join(work, `shot${String(i).padStart(3, "0")}.mp4`); await renderShot(shots[i], W, H, lut, i, f); files.push(f); }
    // titles: overlays, on-screen hook (Shorts), the question end card (in development mode it sits in the last
    // 3.3 s of the 8-second sample so it can be reviewed)
    const ts: TitleScene[] = timed.filter(t => t.start < D).map(t => ({ start: t.start, dur: Math.min(t.dur, D - t.start), overlays: t.scene.overlays ?? [], vo: { at: t.voAt, dur: t.voDur, text: tx(t.scene.vo, lang) } }));
    const askAt = !full && D < 7 ? Infinity : Math.max(0, D - (full ? (portrait ? 3.4 : 4.2) : 2.6));   // development samples: short end card, so the rest can be judged
    const hookText = portrait && !fromIdx ? tx(ep.engage?.hookText, lang) || undefined : undefined, askText = ep.engage?.ask ? { text: tx(ep.engage.ask, lang), at: askAt } : undefined;
    // motion graphics: browser-rendered layer (premium type, counters, diagrams, captions); libass is the fallback
    const overlay = path.join(work, "graphics.mov"); let assFile: string | undefined;
    try {
      const spec = makeSpec({ W: LW, H: LH, format, lang, duration: D, scenes: ts.map((t, i) => ({ id: timed[i].scene.id, ...t })), shots, tag, hook: hookText, ask: askText, transitions, coldOpen: !portrait && !fromIdx ? Math.min(timed[0].dur, D) : 0 });
      await writeFile(path.join(work, "graphics.json"), JSON.stringify(spec, null, 1));
      const r = await renderOverlay(spec, overlay, 30, W / LW); log(`${format}: graphics ${r.captured} frames drawn, ${r.reused} reused`);
    } catch (e) {
      log(`${format}: graphics layer unavailable (${String(e).slice(0, 160)}), using libass titles`);
      assFile = path.join(work, "titles.ass");
      await writeFile(assFile, buildAss({ W, H, format, lang, scenes: ts, shots, duration: D, brandTag: tag, hook: hookText, ask: askText }));
    }
    // audio
    // music composed to this cut (mood + energy curve + real scene timings), sound effects on titles and the reveal
    const accents = ts.flatMap(t => t.overlays.filter(o => o.kind === "stat" || o.kind === "kicker").map(o => t.start + (o.at ?? 0.3)));
    const music = await musicFor(ep, timed, D, accents, work, { hookAt: portrait ? 0.05 : undefined, record: full, transitions });
    log(`${format}: music ${music.source} (${music.mood}), ${music.fx.length} sound effects`);
    const mix = path.join(work, "mix.wav");
    const vo = timed.filter(t => t.start + t.voAt < D).map(t => ({ file: voiced.find(v => v.id === t.scene.id)!.file, at: t.start + t.voAt }));
    await run("ffmpeg", mixArgs(music.bed, vo, mix, D, music.fx));
    // final
    const out = path.join(dir, `${format}-${lang}${full ? "" : "-dev"}${fromIdx ? `-from-${scenes[0].id}` : ""}.mp4`);
    await assemble({ shots: files, ass: assFile && path.resolve(assFile), overlay: assFile ? undefined : overlay, fontsDir: FONTS, audio: mix, duration: D, out, work, loop: portrait, progress: portrait, W, H });
    await contactSheet(out, D, out.replace(/\.mp4$/, ".sheet.jpg"), portrait);
    for (const l of subLangs) await writeFile(out.replace(/\.mp4$/, `.${l}.srt`), srt(timed, l, D));
    // thumbnails (long) and the Reels cover frame (short): the best real frame, picked by sharpness and colour
    const mids = shots.map(s => s.start + s.dur * 0.5).filter(t => t > 0.8 && t < D - 0.8);
    const best = await bestFrame(out, mids.length ? mids : [D / 2]);
    const thumbs = format === "long" ? await renderThumbs(out, best.t, tx(ep.thumb, lang), lang === "hi" ? "hi" : "en", tag, dir, FONTS, lut) : [];
    const qa = await qaVideo(out, { width: W, height: H, duration: D });
    log(`${format}: QA ${qa.pass ? "passed" : "FAILED"} - ${[...qa.checks, ...qa.problems].join(", ")}`);
    const rights = [...new Map(shots.map(s => [`${s.clip.provider}:${s.clip.id}`, { provider: s.clip.provider, id: s.clip.id, title: s.clip.title, credit: s.clip.credit, license: s.clip.license, page: s.clip.page }])).values()];
    // chapter marks for the YouTube description (long videos): where each "chapter" graphic starts
    const chapters = timed.filter(t => t.start < D).flatMap(t => (t.scene.overlays ?? []).filter(o => o.kind === "chapter").map(o => ({ at: +t.start.toFixed(1), title: tx(o.text, lang) })));
    results[format] = { file: out, resolution: res, chapters, subtitles: subLangs, duration: D, fullDuration: total, voice: voiced.map(v => v.source), music: { source: music.source, mood: music.mood, tracks: music.tracks }, coverMs: Math.round(best.t * 1000), thumbs,
      shots: shots.map(s => ({ scene: s.scene, clip: `${s.clip.provider}:${s.clip.id}`, in: s.inPoint, start: +s.start.toFixed(2), dur: +s.dur.toFixed(2) })), rights, qa };
  }
  await writeFile(path.join(dir, `manifest-${lang}.json`), JSON.stringify({ episode: ep.id, lang, full, results }, null, 2));
  return results;
}

if (process.argv[1]?.endsWith("build.ts")) {
  const a = process.argv.slice(2), file = a.find(x => x.endsWith(".json"));
  if (!file) { console.error("usage: tsx engine/build.ts <episode.json> [--formats long,short] [--lang en|hi|es|pt|fr|it] [--full | --preview] [--seconds N]"); process.exit(1); }
  const opt = (k: string) => { const i = a.indexOf(`--${k}`); return i >= 0 ? a[i + 1] : undefined; };
  await build(file, (opt("formats") ?? "long,short").split(",") as Format[], (opt("lang") ?? JSON.parse(await readFile("channel/settings.json", "utf8")).lang ?? "en") as Lang, { full: a.includes("--full"), preview: a.includes("--preview"), from: opt("from"), seconds: opt("seconds") ? Number(opt("seconds")) : undefined });
}
