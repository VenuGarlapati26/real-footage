// The music bank: free, original tracks per mood (made weekly by tools/musicbank.py with ACE-Step 1.5, or any track
// you add with a licence note), fitted to each cut like a music editor would:
//   1. pick a track of the episode's mood that hasn't been used recently
//   2. find the track's big lift (where the climax hits)
//   3. back-time it so that lift lands exactly on the video's reveal
//   4. for long videos, chain more tracks of the same mood with long crossfades
//
// Your own tracks: music/bank/<mood>/<name>.mp3 + <name>.json with at least {"licence": "..."}.
// Only add music you have the rights to (CC0, or your own). Avoid tracks that are registered in Content ID.

import { existsSync } from "node:fs";
import { readdir, readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { Mood } from "./types";

const run = promisify(execFile);
const BANK = () => process.env.MUSIC_BANK ?? "music/bank";
const USAGE = () => process.env.MUSIC_USAGE ?? "channel/music-usage.json";
const NEAR: Record<Mood, Mood[]> = {
  awe: ["melancholy", "triumph"], mystery: ["tension", "investigate"], tension: ["mystery", "investigate"], triumph: ["awe", "upbeat"],
  upbeat: ["triumph", "investigate"], investigate: ["mystery", "upbeat"], melancholy: ["awe", "mystery"],
};
const ENV_HZ = 10; // envelope resolution: 10 values a second

export interface Track { file: string; mood: Mood; seconds: number; licence: string; meta: any }

export async function listBank(mood: Mood): Promise<Track[]> {
  const out: Track[] = [];
  for (const m of [mood, ...NEAR[mood]]) {
    const dir = path.join(BANK(), m); if (!existsSync(dir)) continue;
    for (const f of (await readdir(dir)).filter(f => /\.(mp3|wav|flac|m4a|ogg)$/i.test(f)).sort()) {
      const file = path.join(dir, f), side = file.replace(/\.[^.]+$/, ".json");
      if (!existsSync(side)) continue; // no licence note, never used
      const meta = JSON.parse(await readFile(side, "utf8")); if (!meta.licence) continue;
      out.push({ file, mood: m, seconds: await seconds(file), licence: meta.licence, meta });
    }
    if (out.length) break; // closest mood that has tracks
  }
  return out;
}

async function seconds(file: string) {
  const { stdout } = await run("ffprobe", ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file]);
  return Number(stdout.trim());
}

/** Loudness envelope (RMS, 10 values a second) from a mono 4 kHz decode. */
export async function envelope(file: string): Promise<number[]> {
  const { stdout } = await run("ffmpeg", ["-v", "error", "-i", file, "-ac", "1", "-ar", "4000", "-f", "f32le", "-"], { encoding: "buffer", maxBuffer: 1 << 28 }) as any;
  const buf: Buffer = stdout, n = buf.length / 4, hop = 4000 / ENV_HZ, env: number[] = [];
  for (let i = 0; i + hop <= n; i += hop) { let s = 0; for (let k = 0; k < hop; k++) { const v = buf.readFloatLE((i + k) * 4); s += v * v; } env.push(Math.sqrt(s / hop)); }
  return env;
}

/** Where the track lifts hardest: the biggest jump from the 4 s before to the 2 s after. Seconds. */
export function liftPoint(env: number[], minAt = 4, tailRoom = 6) {
  const mean = (a: number, b: number) => { let s = 0, c = 0; for (let i = Math.max(0, a); i < Math.min(env.length, b); i++) { s += env[i]; c++; } return c ? s / c : 0; };
  let best = -Infinity, at = Math.min(env.length / ENV_HZ / 2, minAt);
  for (let i = minAt * ENV_HZ; i < env.length - tailRoom * ENV_HZ; i++) {
    const after = mean(i, i + 2 * ENV_HZ), before = mean(i - 4 * ENV_HZ, i);
    const score = (after - before) / (before + 0.02); // relative jump, so quiet tracks count too
    if (score > best) { best = score; at = i / ENV_HZ; }
  }
  return { at, strength: +best.toFixed(3) };
}

/** Offset into the track so the lift lands on `peakAt`, and the track still covers the cut (or as much as it can). */
export function fitOffset(trackSeconds: number, lift: number, peakAt: number | undefined, duration: number) {
  if (peakAt == null) return Math.max(0, Math.min(trackSeconds - duration, lift - duration * 0.6)); // no reveal: climax ~60% in
  return Math.max(0, Math.min(lift - peakAt, Math.max(0, trackSeconds - duration)));
}

async function usage(): Promise<Record<string, string>> { try { return JSON.parse(await readFile(USAGE(), "utf8")); } catch { return {}; } }

/** Least recently used first, never-used first of all; ties broken by how strongly the track lifts. */
export function pickOrder(tracks: { file: string; strength?: number }[], used: Record<string, string>) {
  return [...tracks].sort((a, b) => (used[a.file] ?? "").localeCompare(used[b.file] ?? "") || (b.strength ?? 0) - (a.strength ?? 0));
}

/** Build the music bed for one cut from the bank. Null if the bank has nothing for this mood. */
export async function bankBed(mood: Mood, duration: number, peakAt: number | undefined, out: string, opts: { record?: boolean } = {}) {
  const tracks = await listBank(mood); if (!tracks.length) return null;
  const scored = await Promise.all(tracks.map(async t => ({ ...t, ...liftPoint(await envelope(t.file)) })));
  const used = await usage(), order = pickOrder(scored.map(t => ({ ...t, strength: t.strength })), used) as typeof scored;
  // first track: the one whose lift can land on the reveal (enough music before it), least recently used
  const first = order.find(t => peakAt == null || t.at >= peakAt) ?? order[0];
  const offset = fitOffset(first.seconds, first.at, peakAt, duration);
  const parts = [{ t: first, from: offset, len: Math.min(first.seconds - offset, duration + 0.5) }];
  let covered = parts[0].len, X = 4; // crossfade seconds between chained tracks
  for (const t of order.filter(x => x !== first)) { if (covered >= duration) break; parts.push({ t, from: 0, len: Math.min(t.seconds, duration - covered + X + 0.5) }); covered += parts.at(-1)!.len - X; }
  while (covered < duration && parts.length < 200) { const t = parts[parts.length % Math.max(1, parts.length)].t; parts.push({ t, from: 0, len: Math.min(t.seconds, duration - covered + X + 0.5) }); covered += parts.at(-1)!.len - X; } // tiny bank: reuse
  const inputs = parts.flatMap(p => ["-ss", p.from.toFixed(2), "-t", p.len.toFixed(2), "-i", p.t.file]);
  const chain = parts.map((_, i) => `[${i}:a]aresample=48000,aformat=channel_layouts=stereo[a${i}]`);
  let last = "a0";
  for (let i = 1; i < parts.length; i++) { chain.push(`[${last}][a${i}]acrossfade=d=${X}:c1=tri:c2=tri[x${i}]`); last = `x${i}`; }
  const fadeIn = offset > 0 ? 1.2 : 0.05, D = duration.toFixed(3);
  chain.push(`[${last}]afade=t=in:d=${fadeIn},afade=t=out:st=${Math.max(0, duration - 1.2).toFixed(2)}:d=1.2,apad=whole_dur=${D},atrim=0:${D},volume=0.6[out]`);
  await mkdir(path.dirname(out), { recursive: true });
  await run("ffmpeg", ["-y", "-v", "error", ...inputs, "-filter_complex", chain.join(";"), "-map", "[out]", "-ar", "48000", out]);
  if (opts.record !== false) { const u = await usage(); const now = new Date().toISOString(); for (const p of parts) u[p.t.file] = now; await writeFile(USAGE(), JSON.stringify(u, null, 2)); }
  return { file: out, tracks: parts.map(p => ({ file: p.t.file, from: +p.from.toFixed(2), licence: p.t.licence })), liftAt: first.at, offset };
}
