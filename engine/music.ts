// Music that fits the video.
//
// Every episode has a mood (episode.music, or guessed from the topic) and every scene an energy level (scene.energy,
// or a curve that builds into the peak scene and then resolves). From that and the real scene timings we write a
// composition plan, one section per scene group, each section exactly as long as the scenes it sits under, so
// the music turns when the picture turns and peaks on the reveal.
//
// Sources, in MUSIC_ORDER (default "bank,synth": everything free):
//   bank   the music bank (engine/bank.ts): original tracks composed weekly with ACE-Step 1.5 (MIT, free, on the
//          GitHub runner), the climax back-timed onto the reveal
//   synth  the synthesised score in engine/audio.ts, same mood and energy curve; always works, offline
//   eleven ElevenLabs Eleven Music, composed to the exact plan. PAID: only used if you add it to MUSIC_ORDER
//
// Sound effects land on the hook, titles, numbers, scene changes and the reveal: synthesised for free
// (assets/sfx/*.wav), or ElevenLabs sound generation if you opt in with SFX_SOURCE=eleven.

import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { Episode, Mood, MusicPlan, Scene } from "./types";
import { score, synthSfx, writeWav } from "./audio";
import { bankBed } from "./bank";

const run = promisify(execFile);
const BASE = () => process.env.ELEVENLABS_BASE ?? "https://api.elevenlabs.io";
const CACHE = () => process.env.MUSIC_CACHE ?? ".cache/music";

/** Style words per mood, written for an adult, cinematic channel (never nursery, never cartoon). */
export const MOODS: Record<Mood, { styles: string[]; energy: string[] }> = {
  awe:         { styles: ["cinematic documentary score", "wonder", "warm analog synth pads", "felt piano", "slow strings", "spacious reverb", "modern film score"], energy: ["sparse ambient intro", "gentle build", "rising strings and pulse", "full emotional swell", "huge cinematic peak"] },
  mystery:     { styles: ["dark documentary score", "mysterious", "low drones", "pizzicato", "muted piano", "subtle ticking", "true crime atmosphere"], energy: ["eerie near-silence", "creeping low drone", "ticking tension", "dark pulse", "revealing hit"] },
  tension:     { styles: ["thriller score", "tense", "driving pulse", "staccato strings", "deep sub hits", "modern trailer sound design"], energy: ["quiet pulse", "tightening", "driving rhythm", "intense strings", "trailer impact"] },
  triumph:     { styles: ["epic cinematic", "triumphant", "brass", "big drums", "strings", "uplifting film score"], energy: ["hopeful intro", "building", "marching drums", "soaring brass", "triumphant climax"] },
  upbeat:      { styles: ["modern upbeat", "confident", "electronic beat", "plucked synths", "crisp percussion", "travel vlog energy without vocals"], energy: ["light groove", "groove building", "full beat", "energetic drop", "big drop"] },
  investigate: { styles: ["investigative documentary", "curious", "minimal electronic", "clean piano motif", "steady pulse", "analytical"], energy: ["minimal motif", "steady pulse", "layered build", "confident full groove", "decisive hit"] },
  melancholy:  { styles: ["emotional documentary", "bittersweet", "solo piano", "cello", "soft strings", "intimate"], energy: ["solo piano", "cello enters", "strings swell gently", "emotional peak", "aching climax"] },
};
const NEVER = ["vocals", "singing", "lyrics", "choir words", "children's music", "nursery rhyme", "cartoon", "ukulele", "whistling", "kazoo", "comedic", "cheesy corporate"];

const GUESS: [RegExp, Mood][] = [
  [/space|orbit|planet|nasa|isro|sky|ocean|nature|earth|universe|sunrise/i, "awe"],
  [/crime|scam|mystery|unsolved|secret|hidden|disappear/i, "mystery"],
  [/war|disaster|danger|crash|collapse|storm/i, "tension"],
  [/record|win|cricket|sport|olympic|achieve|launch/i, "triumph"],
  [/money|price|economy|business|cost|market|rupee/i, "investigate"],
  [/food|travel|city|tech|gadget|car/i, "upbeat"],
];
export function moodFor(ep: Pick<Episode, "topic" | "title"> & { music?: MusicPlan }): Mood {
  if (ep.music?.mood) return ep.music.mood;
  const text = `${ep.topic} ${ep.title?.en ?? ""}`;
  return GUESS.find(([re]) => re.test(text))?.[1] ?? "awe";
}

export interface TimedScene { scene: Scene; start: number; dur: number }

/** Energy 1-5 per scene: explicit values win; otherwise build to the peak scene, hold, resolve on the last one. */
export function energyCurve(timed: TimedScene[], plan?: MusicPlan) {
  const peakIdx = (() => {
    const byId = plan?.peak ? timed.findIndex(t => t.scene.id === plan.peak) : -1;
    if (byId >= 0) return byId;
    const stat = timed.findIndex(t => t.scene.overlays?.some(o => o.kind === "stat"));
    return stat >= 0 ? stat : Math.max(0, Math.floor(timed.length * 0.6));
  })();
  return timed.map((t, i) => {
    let level = t.scene.energy;
    if (level == null) {
      if (i < peakIdx) level = Math.round(1 + (3 * (i + 1)) / (peakIdx + 1));
      else if (i === peakIdx) level = 5;
      else level = i === timed.length - 1 ? 2 : 4;
    }
    return { at: t.start, level: Math.max(1, Math.min(5, level)), id: t.scene.id, peak: i === peakIdx };
  });
}

export interface Chunk { text: string; duration_ms: number; positive_styles: string[]; negative_styles: string[]; context_adherence: "low" | "medium" | "high" }

/** One section per group of scenes. Sections must be 3-120 s, at most 30. The total covers `duration` (+ a short tail). */
export function compositionPlan(timed: TimedScene[], duration: number, mood: Mood, plan?: MusicPlan) {
  const curve = energyCurve(timed, plan).filter(c => c.at < duration);
  const m = MOODS[mood], extra = plan?.styles ?? [], avoid = [...NEVER, ...(plan?.avoid ?? [])];
  // merge neighbouring scenes until each group is at least 3 s
  const groups: { start: number; end: number; level: number; peak: boolean }[] = [];
  curve.forEach((c, i) => {
    const end = Math.min(duration, curve[i + 1]?.at ?? duration);
    const last = groups.at(-1);
    if (last && (last.end - last.start < 3 || end - c.at < 3) && !(c.peak && last.end - last.start >= 3)) {
      last.end = end; last.level = Math.max(last.level, c.level); last.peak ||= c.peak;
    } else groups.push({ start: c.at, end, level: c.level, peak: c.peak });
  });
  if (groups.length > 1 && groups.at(-1)!.end - groups.at(-1)!.start < 3) { const g = groups.pop()!; const p = groups.at(-1)!; p.end = g.end; p.peak ||= g.peak; }
  const tail = 1.0; // a natural ending under the fade instead of a cut-off
  const names = (i: number, g: typeof groups[0]) => i === 0 ? "Intro" : g.peak ? "Climax" : i === groups.length - 1 ? "Outro" : g.level >= 4 ? "Build" : "Verse";
  let total = 0;
  const chunks: Chunk[] = groups.slice(0, 30).map((g, i) => {
    const last = i === Math.min(groups.length, 30) - 1;
    const sec = Math.max(3, g.end - g.start + (last ? tail : 0));
    const ms = Math.round(sec * 1000); total += ms;
    const first = i === 0;
    return {
      text: `[${names(i, g)}]\n{instrumental, ${m.energy[g.level - 1]}${g.peak ? ", the music hits its peak right at the start of this section" : ""}${last ? ", resolve to a clean ending" : ""}}`,
      duration_ms: ms,
      positive_styles: [...(first ? [...m.styles, ...extra] : m.styles.slice(0, 3)), m.energy[g.level - 1], ...(plan?.bpm ? [`${plan.bpm} bpm`] : [])],
      negative_styles: avoid,
      context_adherence: "high",
    };
  });
  return { chunks, totalMs: total, curve };
}

async function hashFile(dir: string, key: unknown, ext: string) {
  const h = createHash("sha1").update(JSON.stringify(key)).digest("hex").slice(0, 16);
  await mkdir(dir, { recursive: true }); return path.join(dir, `${h}.${ext}`);
}

/** Compose with ElevenLabs. Returns an mp3 path, or null (no key, or the request failed). */
export async function elevenCompose(chunks: Chunk[], seed: number): Promise<string | null> {
  const key = process.env.ELEVENLABS_API_KEY; if (!key) return null;
  const model = process.env.ELEVENLABS_MUSIC_MODEL ?? "music_v2_5";
  const body = { model_id: model, composition_plan: { chunks }, seed };
  const file = await hashFile(CACHE(), body, "mp3");
  if (existsSync(file)) return file;
  try {
    const r = await fetch(`${BASE()}/v1/music?output_format=mp3_48000_192`, { method: "POST", headers: { "xi-api-key": key, "content-type": "application/json" }, body: JSON.stringify(body) });
    if (!r.ok) { console.error(`eleven music ${r.status}: ${(await r.text()).slice(0, 300)}`); return null; }
    await writeFile(file, Buffer.from(await r.arrayBuffer()));
    return file;
  } catch (e) { console.error(`eleven music: ${e}`); return null; }
}

/** The channel's sound-effect library: generated once per effect, reused everywhere. */
export const SFX = {
  hit:    { text: "Deep cinematic sub boom with a soft airy tail, documentary title hit, no music", seconds: 2.0 },
  whoosh: { text: "Short smooth reverse whoosh into a cut, subtle, cinematic transition", seconds: 0.9 },
  reveal: { text: "Big low cinematic impact with shimmering tail for a dramatic reveal", seconds: 3.0 },
  tick:   { text: "Single crisp clock tick, close, dry", seconds: 0.5 },
} as const;
export type SfxName = keyof typeof SFX;

export async function sfx(name: SfxName): Promise<string | null> {
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key || process.env.SFX_SOURCE !== "eleven") { // free: synthesised once, then reused
    const file = path.join(process.env.SFX_DIR ?? "assets/sfx", `${name}.wav`);
    if (!existsSync(file)) { await mkdir(path.dirname(file), { recursive: true }); await writeWav(file, synthSfx(name)); }
    return file;
  }
  const s = SFX[name], body = { text: s.text, duration_seconds: s.seconds, prompt_influence: 0.5 };
  const file = path.join(process.env.SFX_DIR ?? "assets/sfx", `${name}.mp3`);
  if (existsSync(file)) return file; // generated earlier (commit assets/sfx so it is never paid for twice)
  try {
    const r = await fetch(`${BASE()}/v1/sound-generation?output_format=mp3_44100_128`, { method: "POST", headers: { "xi-api-key": key, "content-type": "application/json" }, body: JSON.stringify(body) });
    if (!r.ok) { console.error(`eleven sfx ${r.status}`); return null; }
    await mkdir(path.dirname(file), { recursive: true }); await writeFile(file, Buffer.from(await r.arrayBuffer()));
    return file;
  } catch (e) { console.error(`eleven sfx: ${e}`); return null; }
}

/**
 * Make the music bed for one render. `accents` are the moments titles/numbers land; `hookAt` the Short's hook.
 * Returns the bed (wav, 48 kHz stereo), the effects to lay on top, and which source made the music.
 */
export async function musicFor(ep: Episode, timed: TimedScene[], duration: number, accents: number[], work: string, opts: { hookAt?: number; record?: boolean; transitions?: { at: number; kind: string }[] } = {}) {
  const mood = moodFor(ep), { chunks, curve } = compositionPlan(timed, duration, mood, ep.music);
  const peak = curve.find(c => c.peak);
  const bed = path.join(work, "music.wav");
  await writeFile(path.join(work, "music-plan.json"), JSON.stringify({ mood, chunks }, null, 2));
  const seed = [...ep.id].reduce((a, c) => a + c.charCodeAt(0), 0);
  const order = (process.env.MUSIC_ORDER ?? "bank,synth").split(",").map(x => x.trim());

  const fx: { file: string; at: number; gain: number }[] = [];
  const add = async (name: SfxName, at: number, gain: number) => { const f = await sfx(name); if (f && at >= 0 && at < duration - 0.3) fx.push({ file: f, at, gain }); };
  if (opts.hookAt != null) await add("hit", opts.hookAt, 0.7);
  if (peak && peak.at > 0.5) await add("reveal", peak.at, 0.75);
  for (const a of accents) if (!peak || Math.abs(a - peak.at) > 0.6) await add("hit", a, 0.45);
  // transitions: a whip gets a full whoosh into the cut, a light leak a soft swell, a hard cut stays silent (premium
  // edits let the picture cut clean); without a plan, every scene change gets the original soft whoosh
  if (opts.transitions) { for (const t of opts.transitions) if (t.at < duration - 0.5 && t.kind !== "cut") await add("whoosh", t.at - 0.75, t.kind === "whip" ? 0.5 : t.kind === "leak" ? 0.22 : 0.3); }
  else for (const t of timed.slice(1)) if (t.start < duration - 0.5) await add("whoosh", t.start - 0.75, 0.35);

  for (const src of order) {
    if (src === "eleven") {
      const composed = await elevenCompose(chunks, seed); if (!composed) continue;
      const fadeAt = Math.max(0, duration - 0.9);
      await run("ffmpeg", ["-y", "-v", "error", "-i", composed, "-af", `aresample=48000,aformat=channel_layouts=stereo,afade=t=out:st=${fadeAt.toFixed(2)}:d=0.9,atrim=0:${(duration + 0.2).toFixed(2)},volume=0.55`, bed]);
      return { bed, fx, source: "elevenlabs" as const, mood, tracks: [] as { file: string; from: number; licence: string }[] };
    }
    if (src === "bank") {
      const b = await bankBed(mood, duration, peak && peak.at > 0.5 ? peak.at : undefined, bed, { record: opts.record });
      if (b) return { bed, fx, source: "bank" as const, mood, tracks: b.tracks };
    }
    if (src === "synth") break;
  }
  await writeWav(bed, score(duration, fx.length ? [] : accents, timed.map(t => t.start).filter(t => t < duration), seed,
    { mood, bpm: ep.music?.bpm, energy: curve.map(c => ({ at: c.at, level: c.level })), peakAt: peak && peak.at > 0.5 ? peak.at : undefined, accentsSoft: fx.length > 0 }));
  return { bed, fx, source: "synth" as const, mood, tracks: [] as { file: string; from: number; licence: string }[] };
}

if (process.argv[1]?.endsWith("music.ts")) {
  // npx tsx engine/music.ts episodes/E001.json  -> prints the composition plan for the full long video
  const ep = JSON.parse(await readFile(process.argv[2], "utf8")) as Episode;
  let t = 0; const timed = ep.scenes.filter(s => !s.shortOnly).map(s => { const d = Math.max(3, s.vo.en.length / 15); const x = { scene: s, start: t, dur: d }; t += d; return x; });
  console.log(JSON.stringify({ mood: moodFor(ep), ...compositionPlan(timed, t, moodFor(ep), ep.music) }, null, 2));
}
