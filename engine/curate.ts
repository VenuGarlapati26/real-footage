// The footage editor: for every scene, look at the real footage and choose the takes that show what is being said.
//
// For each scene: search NASA / Wikimedia / Pexels / Pixabay with the scene's queries, download the best candidates, build a contact
// sheet per clip (one frame every 2 s, time-stamped), and ask Gemini (vision, free tier) to pick clean takes:
// the subject of the line, no talking heads, no on-screen text or logos, no dissolves inside a take. The picks are
// checked (inside the clip, long enough, no overlaps) and written into the episode as pinned takes, which the
// build then cuts exactly (engine/footage.ts pickIn). Without a key the build falls back to automatic picking.
//
//   npx tsx engine/curate.ts episodes/E002.json [--force]

import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import type { Episode, FootageQuery, Scene, Take } from "./types";
import { download, isUsable, search, type Candidate } from "./footage";
import { askJson, geminiReady, type Part } from "../growth/gemini";

const run = promisify(execFile);
const STEP = 2;               // seconds between contact-sheet frames
const MAX_SCAN = 240;         // look at the first 4 minutes of a clip at most

/** One time-stamped contact sheet (JPEG) of a clip: frames every STEP seconds, 8 per row. */
export async function sheet(file: string, duration: number, out: string) {
  const n = Math.min(Math.floor(Math.min(duration, MAX_SCAN) / STEP), 96), rows = Math.ceil(n / 8);
  const font = path.resolve("assets/fonts/JetBrainsMono.ttf").replace(/:/g, "\\:");
  await run("ffmpeg", ["-y", "-v", "error", "-i", file, "-vf",
    `fps=1/${STEP},scale=240:-2,drawtext=fontfile='${font}':text='%{eif\\:n*${STEP}\\:d}s':x=4:y=4:fontsize=16:fontcolor=yellow:box=1:boxcolor=black@0.6,tile=8x${rows}`,
    "-frames:v", "1", "-q:v", "4", out]);
  return { file: out, frames: n };
}

export interface Pick { clip: number; from: number; to: number; why?: string }

/** Validate picks against the clips: inside the clip, at least `need` seconds, no overlaps, in order. Pure. */
export function validPicks(picks: Pick[], clips: { duration: number }[], need: number, max: number): { clip: number; take: Take }[] {
  const out: { clip: number; take: Take }[] = [];
  for (const p of picks ?? []) {
    const c = clips[p.clip]; if (!c) continue;
    const from = Math.max(0, +p.from), to = Math.min(c.duration, +p.to);
    if (!(to - from >= need)) continue;
    if (out.some(o => o.clip === p.clip && from < o.take[1] && to > o.take[0])) continue;
    out.push({ clip: p.clip, take: [+from.toFixed(2), +to.toFixed(2)] });
    if (out.length >= max) break;
  }
  return out;
}

const PROMPT = (sc: Scene, shots: number, need: number, n: number) => `You are the picture editor and cinematographer of a premium documentary channel (think BBC Earth, Netflix docs).
Scene narration: "${sc.vo.en}"
${sc.overlays?.length ? `On-screen graphics in this scene: ${sc.overlays.map(o => o.text.en).join("; ")}` : ""}
You get ${n} contact sheet(s), one per clip (clip index = order given). Each frame is labelled with its time in seconds.
Choose ${shots} take(s), in the order they should appear, each a continuous window of at least ${need.toFixed(1)} s that:
- shows what the narration is about, as literally and as beautifully as possible; the FIRST take must be the single most striking image
- looks expensive: strong composition (depth, leading lines, a clear subject), beautiful light (golden hour, dramatic sky, rim light,
  glowing night), smooth camera motion (drone, gimbal, slider) or a perfectly still frame, sharp focus, rich natural colour
- has NO talking heads, presenters, on-screen text, captions, logos, watermarks, title cards or graphics
- is NOT shaky handheld, blurry, noisy in the dark, a phone video, or a cheap stock cliche (people pointing at screens,
  handshakes, smiling at the camera, obvious CGI)
- does NOT contain a cut or dissolve inside the window (frames inside must be one continuous shot)
- different takes look different from each other (wide, then detail; ground, then aerial)
If no clip is good enough, return fewer picks rather than a weak one.
Answer JSON only: {"picks":[{"clip":0,"from":12,"to":18,"why":"..."}]}. Use times from the labels.`;

export async function curateScene(sc: Scene, shots: number, need: number, work: string, portrait = false) {
  const clips: (Candidate & { file: string; duration: number; q: FootageQuery })[] = [];
  // real-footage scenes (authentic) only ever look at NASA and Wikimedia; others also at the stock libraries
  const ok = (f: FootageQuery) => !(f as any).takes && f.provider !== "local" && (!sc.authentic || f.provider === "nasa" || f.provider === "wikimedia");
  for (const q of sc.footage.filter(ok)) {
    for (const cand of (await search(q, portrait, "preview").catch(() => [])).slice(0, q.provider === "pexels" || q.provider === "pixabay" ? 4 : 3)) {
      if (clips.some(c => c.id === cand.id)) continue;
      try {
        const c = await download(cand), stock = cand.provider === "pexels" || cand.provider === "pixabay";
        // stock clips are judged from a small preview (the build downloads the 1080p/4K file of the same video)
        if (stock ? c.duration >= 4 : await isUsable(c, portrait)) clips.push({ ...cand, file: c.file, duration: c.duration, q });
      } catch { /* skip */ }
      if (clips.length >= 6) break;
    }
    if (clips.length >= 6) break;
  }
  if (!clips.length) return null;
  const parts: Part[] = [{ text: PROMPT(sc, shots, need, clips.length) }];
  for (let i = 0; i < clips.length; i++) {
    const s = await sheet(clips[i].file, clips[i].duration, path.join(work, `${sc.id}-clip${i}.jpg`));
    parts.push({ text: `Clip ${i}: "${clips[i].title}" (${clips[i].duration.toFixed(0)} s)` }, { inline_data: { mime_type: "image/jpeg", data: (await readFile(s.file)).toString("base64") } });
  }
  const ans = await askJson<{ picks: Pick[] }>(parts, { temperature: 0.2 });
  const picks = validPicks(ans.picks, clips, need + 0.2, shots);
  return picks.map(p => {
    const c = clips[p.clip];
    const q: FootageQuery = c.provider === "nasa" ? { provider: "nasa", q: (c.q as any).q, nasaId: c.id, takes: [p.take] }
      : c.provider === "pexels" || c.provider === "pixabay" ? { provider: c.provider, q: (c.q as any).q, id: c.id, takes: [p.take] }
      : { provider: "wikimedia", q: (c.q as any).q, file: c.title.replace(/^File:/, ""), credit: c.credit, license: c.license, takes: [p.take] };
    return q;
  });
}

/** Curate every scene that has no pinned takes yet. Seconds per shot come from the voice length estimate. */
export async function curate(epFile: string, opts: { force?: boolean; shotSeconds?: number } = {}) {
  if (!geminiReady()) throw new Error("GEMINI_API_KEY is not set: the build will pick takes automatically instead");
  const ep = JSON.parse(await readFile(epFile, "utf8")) as Episode;
  const work = path.join(".cache", "curate", ep.id); await mkdir(work, { recursive: true });
  const report: string[] = [];
  for (const sc of ep.scenes) {
    if (!opts.force && sc.footage.some(f => (f as any).takes)) { report.push(`${sc.id}: already curated`); continue; }
    const secs = sc.vo.en.split(/\s+/).length / 2.6 + 0.8, shots = sc.shots ?? Math.max(1, Math.round(secs / (opts.shotSeconds ?? 3.2))), need = secs / shots;
    const pinned = await curateScene(sc, shots, need, work).catch(e => { report.push(`${sc.id}: ${e.message}`); return null; });
    if (!pinned?.length) { report.push(`${sc.id}: no picks (automatic picking at build time)`); continue; }
    sc.footage = [...sc.footage.filter(f => f.provider === "local"), ...pinned, ...sc.footage.filter(f => f.provider !== "local" && !(f as any).takes)];
    sc.shots = pinned.length; report.push(`${sc.id}: ${pinned.length} take(s)`);
  }
  await writeFile(epFile, JSON.stringify(ep, null, 2) + "\n");
  return report;
}

if (process.argv[1]?.endsWith("curate.ts")) {
  const f = process.argv.slice(2).find(x => x.endsWith(".json"));
  if (!f) { console.error("usage: tsx engine/curate.ts <episode.json> [--force]"); process.exit(1); }
  console.log((await curate(f, { force: process.argv.includes("--force") })).join("\n"));
}
