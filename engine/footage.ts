// Real footage: search -> download -> probe -> pick a clean segment (no hidden cut inside it).
// Every clip carries its licence and credit; build.ts writes them to the rights log and the description.
//
// Providers (all free):
//   local      footage/<file>                      your own phone/camera clips (the most "real" of all)
//   nasa       images-api.nasa.gov                 public domain (no key). Never implies NASA endorsement.
//   pexels     api.pexels.com    PEXELS_API_KEY    Pexels licence: free commercial use, no attribution required
//   pixabay    pixabay.com/api   PIXABAY_API_KEY   Pixabay content licence: free commercial use
//   wikimedia  commons.wikimedia.org               only Public domain, CC0 or CC BY (credited); never BY-SA/NC/ND

import { createHash } from "node:crypto";
import { createWriteStream, existsSync } from "node:fs";
import { mkdir, readFile, writeFile, stat } from "node:fs/promises";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import type { Clip, FootageQuery } from "./types";

const run = promisify(execFile);
const CACHE = process.env.FOOTAGE_CACHE ?? ".cache/footage";
const UA = "the-real-footage-channel/1.0 (video pipeline; contact via repository)";

export type Candidate = Omit<Clip, "file" | "duration" | "width" | "height"> & { url: string; width?: number; height?: number; duration?: number };

// ---------------------------------------------------------------- providers
const NOT_FOOTAGE = /visuali[sz]ation|animation|animated|simulation|illustration|artist'?s (concept|rendering)|conceptual|infographic|radar data|data visual|interview|news conference|briefing|webinar|lecture|panel discussion|talking head|explainer graphic/i;

async function nasa(q: string, nasaId?: string): Promise<Candidate[]> {
  const url = nasaId ? `https://images-api.nasa.gov/search?nasa_id=${encodeURIComponent(nasaId)}` : `https://images-api.nasa.gov/search?media_type=video&q=${encodeURIComponent(q)}`;
  const j: any = await (await fetch(url, { headers: { "user-agent": UA } })).json();
  const out: Candidate[] = [];
  for (const it of (j.collection?.items ?? []).slice(0, 8)) {
    const d = it.data?.[0]; if (!d || d.media_type !== "video") continue;
    // searches only: skip what is not camera footage (visualisations, animations, talks), it breaks the look and the promise
    if (!nasaId && NOT_FOOTAGE.test(`${d.title} ${d.description ?? ""} ${(d.keywords ?? []).join(" ")}`)) continue;
    const assets: string[] = await (await fetch(it.href, { headers: { "user-agent": UA } })).json().catch(() => []);
    const pick = (suffix: string) => assets.find(a => a.endsWith(suffix));
    let file = pick("~orig.mp4");
    if (file) { const h = await fetch(file.replace("http://", "https://"), { method: "HEAD" }).catch(() => null); if (Number(h?.headers.get("content-length") ?? 0) > 350e6) file = undefined; }
    file ??= pick("~large.mp4") ?? pick("~medium.mp4");
    if (!file) continue;
    out.push({ provider: "nasa", id: d.nasa_id, url: file.replace("http://", "https://"), title: d.title, credit: `NASA${d.center ? ` / ${d.center}` : ""}${d.date_created ? `, ${d.date_created.slice(0, 4)}` : ""}`,
      license: "Public domain (NASA media guidelines)", page: `https://images.nasa.gov/details/${encodeURIComponent(d.nasa_id)}` });
  }
  return out;
}

async function pexels(q: string, portrait: boolean, uhd: Size = false, id?: string): Promise<Candidate[]> {
  const key = process.env.PEXELS_API_KEY; if (!key) return [];
  const base = process.env.PEXELS_API ?? "https://api.pexels.com";
  const j: any = id ? { videos: [await (await fetch(`${base}/videos/videos/${encodeURIComponent(id)}`, { headers: { authorization: key } })).json()] }
    : await (await fetch(`${base}/videos/search?${new URLSearchParams({ query: q, per_page: "15", size: uhd === true ? "large" : "medium", min_duration: "5", orientation: portrait ? "portrait" : "landscape" })}`, { headers: { authorization: key } })).json();
  return (j.videos ?? []).filter((v: any) => v?.id).map((v: any) => {
    const f = bestPexelsFile(v.video_files ?? [], portrait, uhd);
    return f && { provider: "pexels", id: String(v.id), url: f.link, width: f.width, height: f.height, duration: v.duration, fps: f.fps, title: q, credit: `${v.user?.name ?? "Pexels"} / Pexels`, license: "Pexels License", page: v.url };
  }).filter(Boolean);
}

/** Which file size to fetch: true = 4K master, false = 1080p, "preview" = small file for Gemini's contact sheets. */
export type Size = boolean | "preview";

/** The file to download: big enough for the frame (4K for 4K masters, else the smallest file >= 1080p, so downloads stay
 *  quick; previews: the smallest >= 540p), and among equal sizes the higher frame rate (50/60 fps allows slow motion). Pure. */
export function bestPexelsFile(files: { file_type?: string; width?: number; height?: number; fps?: number; link: string }[], portrait: boolean, uhd: Size) {
  const ok = files.filter(x => x.file_type === "video/mp4" && x.width && x.height);
  const long = (x: any) => portrait ? x.height : x.width, need = uhd === "preview" ? 540 : uhd ? 3840 : 1920;
  const big = ok.filter(x => long(x) >= need * 0.98).sort((a, b) => long(a)! - long(b)! || (b.fps ?? 0) - (a.fps ?? 0));
  return big[0] ?? ok.sort((a, b) => long(b)! - long(a)! || (b.fps ?? 0) - (a.fps ?? 0))[0];
}

async function pixabay(q: string, id?: string, size: Size = false): Promise<Candidate[]> {
  const key = process.env.PIXABAY_API_KEY; if (!key) return [];
  const j: any = await (await fetch(`https://pixabay.com/api/videos/?key=${key}&${id ? `id=${encodeURIComponent(id)}` : `q=${encodeURIComponent(q)}`}&per_page=20&safesearch=true`)).json();
  return (j.hits ?? []).map((h: any) => {
    const v = size === "preview" ? (h.videos?.tiny?.url ? h.videos.tiny : h.videos?.small) : h.videos?.large?.url ? h.videos.large : h.videos?.medium;
    return v?.url && { provider: "pixabay", id: String(h.id), url: v.url, width: v.width, height: v.height, duration: h.duration, title: h.tags, credit: `${h.user} / Pixabay`, license: "Pixabay Content License", page: h.pageURL };
  }).filter(Boolean);
}

async function wikimedia(q: string): Promise<Candidate[]> {
  const api = "https://commons.wikimedia.org/w/api.php";
  const p = new URLSearchParams({ action: "query", format: "json", generator: "search", gsrsearch: `${q} filetype:video`, gsrnamespace: "6", gsrlimit: "15",
    prop: "imageinfo", iiprop: "url|extmetadata|size", iiurlwidth: "1920" });
  const j: any = await (await fetch(`${api}?${p}`, { headers: { "user-agent": UA } })).json();
  const ok = /^(public domain|pd|cc0|cc by( \d\.\d)?)$/i;
  return Object.values<any>(j.query?.pages ?? []).map(pg => {
    const ii = pg.imageinfo?.[0]; const lic = String(ii?.extmetadata?.LicenseShortName?.value ?? "");
    if (!ii || !ok.test(lic.trim())) return null;
    const artist = String(ii.extmetadata?.Artist?.value ?? "").replace(/<[^>]+>/g, "").trim() || "Wikimedia Commons";
    return { provider: "wikimedia", id: String(pg.pageid), url: ii.url, width: ii.width, height: ii.height, title: pg.title, credit: `${artist} / Wikimedia Commons`, license: lic, page: ii.descriptionurl };
  }).filter(Boolean) as Candidate[];
}

/** A pinned Commons file: no API call (it rate-limits), the file's own transcode URL, licence stated in the episode. */
function pinnedCommons(q: Extract<FootageQuery, { provider: "wikimedia" }>): Candidate[] {
  const name = q.file!.replace(/^File:/, "").replace(/ /g, "_"), h = createHash("md5").update(name).digest("hex");
  const base = `https://upload.wikimedia.org/wikipedia/commons`, h2 = `${h[0]}/${h.slice(0, 2)}`;
  const url = name.endsWith(".webm") || name.endsWith(".ogv") ? `${base}/transcoded/${h2}/${encodeURIComponent(name)}/${encodeURIComponent(name)}.${q.height ?? 1080}p.vp9.webm` : `${base}/${h2}/${encodeURIComponent(name)}`;
  return [{ provider: "wikimedia", id: name, url, title: name.replace(/_/g, " "), credit: q.credit ?? "Wikimedia Commons", license: q.license ?? "Public domain", page: `https://commons.wikimedia.org/wiki/File:${encodeURIComponent(name)}` }];
}

export async function search(q: FootageQuery, portrait: boolean, uhd: Size = false): Promise<Candidate[]> {
  try {
    switch (q.provider) {
      case "local": return existsSync(path.join("footage", q.file)) ? [{ provider: "local", id: q.file, url: `file:${path.join("footage", q.file)}`, title: q.file, credit: "OWN", license: "Own footage", page: "" }] : [];
      case "nasa": return await nasa(q.q, q.nasaId);
      case "pexels": return await pexels(q.q, portrait, uhd, q.id);
      case "pixabay": return await pixabay(q.q, q.id, uhd);
      case "wikimedia": return q.file ? pinnedCommons(q) : await wikimedia(q.q);
    }
  } catch (e) { console.warn(`  footage search ${q.provider} failed: ${String(e).slice(0, 160)}`); return []; }
}

// ---------------------------------------------------------------- download + probe
export async function probe(file: string) {
  const { stdout } = await run("ffprobe", ["-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height,r_frame_rate:format=duration", "-of", "json", file]);
  const j = JSON.parse(stdout); const s = j.streams?.[0] ?? {};
  return { width: Number(s.width), height: Number(s.height), duration: Number(j.format?.duration), fps: (([a, b]) => b ? a / b : a)(String(s.r_frame_rate ?? "30").split("/").map(Number)) };
}

export async function download(c: Candidate): Promise<Clip> {
  await mkdir(CACHE, { recursive: true });
  const ext = path.extname(new URL(c.url).pathname).toLowerCase() || ".mp4";
  // the size is part of the name: the same stock video in 4K (long), 1080p (Short) and preview (curation) are 3 files
  const dims = (c.provider === "pexels" || c.provider === "pixabay") && c.width && c.height ? `-${c.width}x${c.height}` : "";
  const file = c.url.startsWith("file:") ? c.url.slice(5) : path.join(CACHE, `${c.provider}-${c.id.replace(/[^\w.-]+/g, "_")}${dims}${ext}`);
  if (!c.url.startsWith("file:") && !existsSync(file)) {
    const r = await fetch(c.url, { headers: { "user-agent": UA } });
    if (!r.ok || !r.body) throw new Error(`download ${c.provider} ${c.id}: ${r.status}`);
    await pipeline(Readable.fromWeb(r.body as any), createWriteStream(file + ".part"));
    await run("mv", [file + ".part", file]);
  }
  const p = await probe(file);
  const clip: Clip = { provider: c.provider, id: c.id, file, width: p.width, height: p.height, duration: p.duration, fps: Number.isFinite(p.fps) ? +p.fps.toFixed(2) : undefined, title: c.title, credit: c.credit, license: c.license, page: c.page };
  await writeFile(file + ".json", JSON.stringify(clip, null, 2));
  return clip;
}

/** Letterbox bars baked into a clip (e.g. 1920x1012 inside 1920x1080). Measured at 12 points across the whole clip and
 *  the LEAST crop is kept, so a dark night shot is never mistaken for bars. Cached. Returns w:h:x:y or null. */
export async function letterbox(file: string, duration: number): Promise<string | null> {
  const cacheFile = file + ".letterbox.json";
  if (existsSync(cacheFile)) return JSON.parse(await readFile(cacheFile, "utf8")).crop;
  let best: [number, number, number, number] | null = null;
  for (let i = 1; i <= 12; i++) {
    const t = (duration * i) / 13;
    const { stderr } = await run("ffmpeg", ["-hide_banner", "-ss", t.toFixed(2), "-t", "1", "-i", file, "-vf", "cropdetect=limit=24:round=2:reset=0", "-an", "-f", "null", "-"], { maxBuffer: 1 << 24 }).catch(e => ({ stderr: String(e.stderr ?? "") }));
    const m = [...stderr.matchAll(/crop=(\d+):(\d+):(\d+):(\d+)/g)].pop(); if (!m) continue;
    const c = m.slice(1, 5).map(Number) as [number, number, number, number];
    if (!best || c[0] * c[1] > best[0] * best[1]) best = c;
  }
  const p = await probe(file);
  // only symmetric bars of a meaningful size count
  const crop = best && (best[0] < p.width - 8 || best[1] < p.height - 8) && Math.abs(best[3] * 2 + best[1] - p.height) <= 6 && Math.abs(best[2] * 2 + best[0] - p.width) <= 6
    ? `${best[0]}:${best[1]}:${best[2]}:${best[3]}` : null;
  await writeFile(cacheFile, JSON.stringify({ crop }));
  return crop;
}

// ---------------------------------------------------------------- clean segment
/** Times (s) where the picture cuts inside a clip, so a shot never contains someone else's edit. */
export async function cutsIn(file: string, maxSeconds = 180): Promise<number[]> {
  const cacheFile = file + ".cuts.json", st = await stat(file), sig = `${st.size}:${st.mtimeMs}`;
  if (existsSync(cacheFile)) { const c = JSON.parse(await readFile(cacheFile, "utf8")); if (c.sig === sig && (c.max ?? 180) >= maxSeconds) return c.cuts; }
  const { stderr } = await run("ffmpeg", ["-hide_banner", "-nostats", "-t", String(maxSeconds), "-i", file, "-vf", "scale=256:-2,scdet=threshold=10,metadata=print", "-an", "-f", "null", "-"], { maxBuffer: 1 << 26 });
  const cuts = [...stderr.matchAll(/lavfi\.scd\.time[=:]\s*([\d.]+)/g)].map(m => Number(m[1]));
  await writeFile(cacheFile, JSON.stringify({ sig, cuts, max: maxSeconds }));
  return cuts;
}

/** Best start time for a `dur`-second shot: inside one continuous take, away from slates at the start and end. */
export function pickIn(duration: number, cuts: number[], dur: number, avoid: [number, number][] = [], takes?: [number, number][], win?: [number, number]): number | null {
  if (takes?.length) { // hand-picked windows, in order: the first one that still fits wins
    // each take is one shot: a take already cut from is skipped, so the next shot moves on to the next select
    for (const [x, y] of takes) { if (avoid.some(([a, b]) => a < y && b > x)) continue; const p = pickIn(duration, cuts, dur, avoid, undefined, [Math.max(0, x), Math.min(duration, y)]); if (p !== null) return p; }
    return null;
  }
  const lo = win ? win[0] : Math.min(3, duration * 0.1), hi = win ? win[1] : duration - Math.min(2, duration * 0.05);
  const inner = cuts.filter(c => c > lo && c < hi);
  const bounds = [lo, ...inner, hi];
  let best: { start: number; score: number } | null = null;
  for (let i = 0; i < bounds.length - 1; i++) {
    // a cut needs a safety margin (never show a frame of someone else's edit); a hand-picked window edge barely does
    const a = bounds[i] + (i === 0 && win ? 0.04 : 0.25), b = bounds[i + 1] - (i === bounds.length - 2 && win ? 0.04 : 0.25);
    if (b - a < dur) continue;
    // preferred: a little before the middle of the take; otherwise slide clear of segments already used
    const tries = [a + (b - a - dur) * 0.4, a, b - dur, ...avoid.flatMap(([x, y]) => [y + 0.05, x - dur - 0.05])].filter(t => t >= a - 1e-6 && t + dur <= b + 1e-6);
    for (const start of tries) {
      if (avoid.some(([x, y]) => start < y && start + dur > x)) continue;
      const score = (b - a) - Math.abs(start - (a + (b - a - dur) * 0.4)) * 0.5;
      if (!best || score > best.score) best = { start, score };
    }
  }
  return best ? +best.start.toFixed(3) : null;
}

export async function isUsable(c: Clip, portrait: boolean) {
  const long = portrait ? c.height : c.width, short = portrait ? c.width : c.height;
  return c.duration >= 4 && Math.max(c.width, c.height) >= 1280 && short >= 720 && long > 0 && (await stat(c.file)).size > 100_000;
}

/** Picture quality of a clip (cached): sharp, well exposed, colourful, at least 1080p. Higher is better. */
export async function quality(c: Clip): Promise<number> {
  const cacheFile = c.file + ".quality.json";
  if (existsSync(cacheFile)) return JSON.parse(await readFile(cacheFile, "utf8")).score;
  const n = 6, step = Math.max(0.5, c.duration / (n + 1));
  const { stderr } = await run("ffmpeg", ["-hide_banner", "-t", String(Math.min(c.duration, 600)), "-i", c.file, "-vf",
    `fps=1/${step.toFixed(3)},scale=640:-2,blurdetect=block_pct=80,signalstats,metadata=print`, "-an", "-f", "null", "-"], { maxBuffer: 1 << 26 });
  const all = (k: string) => [...stderr.matchAll(new RegExp(`${k}=([\\d.]+)`, "g"))].map(m => Number(m[1]));
  const avg = (xs: number[], d: number) => xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : d;
  const blur = avg(all("lavfi\\.blur"), 5), sat = avg(all("lavfi\\.signalstats\\.SATAVG"), 30), y = avg(all("lavfi\\.signalstats\\.YAVG"), 110);
  const res = Math.min(Math.max(c.width, c.height), 3840) / 1920;
  const score = +(res * 3 - blur * 1.5 + sat * 0.04 - Math.abs(y - 110) * 0.02).toFixed(3);
  await writeFile(cacheFile, JSON.stringify({ score, blur, sat, y }));
  return score;
}
