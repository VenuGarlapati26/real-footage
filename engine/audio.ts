// Score + mix.
//
// The main score comes from engine/music.ts (ElevenLabs Eleven Music, composed to the edit). This file is the
// fallback that always works offline: a score synthesised per episode, shaped by the episode's mood and by an
// energy curve that follows the scenes (quiet under the setup, building into the peak scene, landing, resolving).
// Nothing in it is sampled, so there is nothing to claim.

import { writeFile } from "node:fs/promises";
import type { Mood } from "./types";

const SR = 48000, TAU = Math.PI * 2;
const hz = (midi: number) => 440 * Math.pow(2, (midi - 69) / 12);

/** Synth character per mood: chord (MIDI), tempo, and which layers play once the energy allows. */
export const SYNTH: Record<Mood, { chord: number[]; bass: number; bpm: number; arp: boolean; tick: boolean; bright: number }> = {
  awe:         { chord: [45, 52, 57, 59, 64, 71], bass: 33, bpm: 72,  arp: true,  tick: false, bright: 0.6 },  // A sus/add9, open
  mystery:     { chord: [45, 52, 56, 60, 63],     bass: 33, bpm: 66,  arp: false, tick: true,  bright: 0.3 },  // A minor(maj7)/b5 colour
  tension:     { chord: [40, 47, 52, 53, 58],     bass: 28, bpm: 96,  arp: false, tick: true,  bright: 0.35 }, // E with b2 rub
  triumph:     { chord: [41, 48, 53, 57, 60, 65], bass: 29, bpm: 84,  arp: true,  tick: false, bright: 0.8 },  // F major, wide
  upbeat:      { chord: [43, 50, 55, 59, 62, 66], bass: 31, bpm: 110, arp: true,  tick: true,  bright: 0.9 },  // G maj7
  investigate: { chord: [38, 45, 50, 53, 57],     bass: 26, bpm: 90,  arp: false, tick: true,  bright: 0.45 }, // D minor
  melancholy:  { chord: [44, 51, 56, 59, 63],     bass: 32, bpm: 64,  arp: true,  tick: false, bright: 0.4 },  // G# minor
};

export interface ScoreOpts { mood?: Mood; bpm?: number; energy?: { at: number; level: number }[]; peakAt?: number; accentsSoft?: boolean }

/** Energy (0..1) at time t from the scene curve. */
function energyAt(curve: { at: number; level: number }[], t: number) {
  let e = curve[0]?.level ?? 2;
  for (const c of curve) if (c.at <= t) e = c.level;
  return Math.max(0, Math.min(1, (e - 1) / 4));
}

export function score(duration: number, accents: number[], sceneStarts: number[], seed = 1, o: ScoreOpts = {}) {
  const m = SYNTH[o.mood ?? "awe"], bpm = o.bpm ?? m.bpm, beat = 60 / bpm;
  const curve = o.energy?.length ? o.energy : sceneStarts.map((at, i) => ({ at, level: Math.min(5, 2 + i) }));
  const n = Math.ceil((duration + 0.5) * SR), L = new Float32Array(n), R = new Float32Array(n);
  let s = seed >>> 0 || 1; const rnd = () => (((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296) * 2 - 1);
  const add = (at: number, len: number, fn: (t: number, abs: number) => [number, number]) => {
    const a = Math.max(0, Math.floor(at * SR)), k = Math.min(n - a, Math.floor(len * SR));
    for (let i = 0; i < k; i++) { const [l, r] = fn(i / SR, at + i / SR); L[a + i] += l; R[a + i] += r; }
  };
  const E = (t: number) => energyAt(curve, t);

  // pad: the mood's chord, slow breathing, wide stereo; opens up (more upper partials) as the energy rises
  const pad = m.chord.map(hz);
  add(0, duration, (t, abs) => {
    const env = Math.min(1, t / 2.2) * Math.min(1, (duration - t) / 1.4), br = 0.72 + 0.28 * Math.sin(TAU * t / 9), e = E(abs);
    let l = 0, r = 0;
    pad.forEach((f, i) => {
      const a = (i < 3 ? 0.42 - i * 0.1 : (0.1 + 0.12 * e) * m.bright) * br;
      l += a * (Math.sin(TAU * f * t + i) + 0.18 * e * Math.sin(TAU * f * 2 * t));
      r += a * (Math.sin(TAU * f * 1.0025 * t + i * 1.9) + 0.18 * e * Math.sin(TAU * f * 2.004 * t));
    });
    const g = 0.045 * env * (0.75 + 0.5 * e);
    return [l * g, r * g];
  });

  // bass on the bar from the second scene, once there is some energy
  const from = sceneStarts[1] ?? Math.min(2, duration / 3);
  for (let k = from; k < duration - 0.8; k += beat * 2) {
    const e = E(k); if (e < 0.2) continue;
    add(k, beat * 2, t => { const v = Math.sin(TAU * hz(m.bass) * t) * Math.exp(-t * 1.6) * 0.16 * e; return [v, v]; });
  }
  // felt kick on each beat at mid energy and above
  for (let k = from; k < duration - 0.8; k += beat) {
    const e = E(k); if (e < 0.4) continue;
    add(k, 0.4, t => { const v = Math.sin(TAU * (40 + 32 * Math.exp(-t * 26)) * t) * Math.exp(-t * 9) * 0.24 * e; return [v, v]; });
  }
  // ticking (tension / investigation / upbeat): short filtered-noise ticks on 8ths
  if (m.tick) for (let k = from, i = 0; k < duration - 0.6; k += beat / 2, i++) {
    const e = E(k); if (e < 0.35) continue;
    let hp = 0, prev = 0; const pan = i % 2 ? 0.7 : 1;
    add(k, 0.06, t => { const x = rnd(); hp = 0.6 * (hp + x - prev); prev = x; const v = hp * Math.exp(-t * 90) * 0.09 * e; return [v * pan, v * (1.7 - pan)]; });
  }
  // arpeggio (awe / triumph / upbeat / melancholy): soft plucks walking up the chord's upper notes
  if (m.arp) { const up = m.chord.slice(2).map(x => hz(x + 12)); for (let k = from, i = 0; k < duration - 0.6; k += beat / 2, i++) {
    const e = E(k); if (e < 0.45) continue;
    const f = up[i % up.length], pan = 0.5 + 0.35 * Math.sin(i * 1.3);
    add(k, 0.9, t => { const v = (Math.sin(TAU * f * t) + 0.25 * Math.sin(TAU * f * 2 * t)) * Math.exp(-t * 4.5) * 0.055 * e; return [v * (1 - pan) * 2, v * pan * 2]; });
  } }
  // a riser into the peak, then an impact on it
  if (o.peakAt && o.peakAt > 1.2) {
    let lp = 0; const len = Math.min(2.4, o.peakAt);
    add(o.peakAt - len, len, t => { lp += 0.15 * (rnd() - lp); const e = Math.pow(t / len, 2.4); const tone = Math.sin(TAU * (200 + 500 * e) * t) * 0.03 * e; return [lp * e * 0.4 + tone, lp * e * 0.36 + tone]; });
    let lp2 = 0;
    add(o.peakAt, 2.2, t => { lp2 += 0.06 * (rnd() - lp2); const v = Math.sin(TAU * (44 + 36 * Math.exp(-t * 6)) * t) * Math.exp(-t * 2.4) * 0.42 + lp2 * Math.exp(-t * 3) * 0.3; return [v, v * 0.96]; });
  }
  // accents: a low "thump + air" when a title or number appears (softer when real SFX are layered on top)
  const ag = o.accentsSoft ? 0.4 : 1;
  for (const a of accents) { let lp = 0; add(a, 1.6, t => { lp += 0.08 * (rnd() - lp); const v = (Math.sin(TAU * (48 + 30 * Math.exp(-t * 7)) * t) * Math.exp(-t * 3.2) * 0.3 + lp * Math.exp(-t * 5) * 0.25) * ag; return [v, v * 0.95]; }); }
  // a short reverse-air swell into each scene change
  for (const c of sceneStarts.slice(1)) { let lp = 0; add(c - 0.6, 0.65, t => { lp += 0.12 * (rnd() - lp); const e = Math.pow(t / 0.65, 2.2); return [lp * e * 0.35, lp * e * 0.3]; }); }
  return { L, R, n };
}

/** Free sound effects, synthesised (no samples, nothing to claim): the hook/title hit, a whoosh into a cut,
 *  the big reveal impact, a clock tick. Written once to assets/sfx/<name>.wav and reused. */
export function synthSfx(name: "hit" | "whoosh" | "reveal" | "tick", seed = 7) {
  const len = { hit: 2.2, whoosh: 0.9, reveal: 3.2, tick: 0.3 }[name], n = Math.ceil(len * SR), L = new Float32Array(n), R = new Float32Array(n);
  let s = seed; const rnd = () => (((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296) * 2 - 1);
  let lp = 0, lp2 = 0, bp = 0, ph = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR, x = rnd(); let l = 0, r = 0;
    if (name === "hit" || name === "reveal") {
      const big = name === "reveal" ? 1 : 0.7;
      ph += TAU * (38 + 70 * Math.exp(-t * 9)) / SR;                       // pitched-down sub drop
      const sub = Math.sin(ph) * Math.exp(-t * (name === "reveal" ? 1.6 : 2.6));
      lp += 0.04 * (x - lp); lp2 += 0.25 * (x - lp2);
      const body = lp * 3 * Math.exp(-t * 4), crack = lp2 * Math.exp(-t * 60) * 0.6; // low rumble + transient
      const shimmer = name === "reveal" ? Math.sin(TAU * 1760 * t + 3 * Math.sin(TAU * 3 * t)) * 0.03 * Math.exp(-t * 1.2) * Math.min(1, t * 20) : 0;
      l = (sub * 0.75 + body * 0.5 + crack) * big + shimmer; r = (sub * 0.75 + body * 0.47 + crack * 0.9) * big - shimmer;
    } else if (name === "whoosh") {
      const e = Math.pow(t / len, 2.4) * (t < len - 0.05 ? 1 : (len - t) / 0.05); // reverse swell, cut on the edit
      bp += (0.02 + 0.3 * (t / len)) * (x - bp);                          // filter opens as it rises
      const pan = t / len; l = bp * e * 1.6 * (1.2 - pan); r = bp * e * 1.6 * (0.2 + pan);
    } else {
      lp2 += 0.7 * (x - lp2); const v = (x - lp2) * Math.exp(-t * 160) * 0.8 + Math.sin(TAU * 2400 * t) * Math.exp(-t * 90) * 0.25; l = v; r = v * 0.9;
    }
    L[i] = l * 0.8; R[i] = r * 0.8;
  }
  return { L, R, n };
}

export async function writeWav(file: string, b: { L: Float32Array; R: Float32Array; n: number }) {
  const buf = Buffer.alloc(44 + b.n * 4);
  buf.write("RIFF", 0); buf.writeUInt32LE(36 + b.n * 4, 4); buf.write("WAVEfmt ", 8); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(2, 22);
  buf.writeUInt32LE(SR, 24); buf.writeUInt32LE(SR * 4, 28); buf.writeUInt16LE(4, 32); buf.writeUInt16LE(16, 34); buf.write("data", 36); buf.writeUInt32LE(b.n * 4, 40);
  for (let i = 0; i < b.n; i++) { buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, b.L[i])) * 32767), 44 + i * 4); buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, b.R[i])) * 32767), 46 + i * 4); }
  await writeFile(file, buf);
}

/** Voice lines at their times + music ducked under the voice + sound effects on top (ducked less), mastered to
 *  -14 LUFS, cut to `duration`. */
export function mixArgs(scoreWav: string, voice: { file: string; at: number }[], out: string, duration: number,
                        fx: { file: string; at: number; gain?: number }[] = []): string[] {
  const D = duration.toFixed(3);
  const inputs = ["-i", scoreWav, ...voice.flatMap(v => ["-i", v.file]), ...fx.flatMap(f => ["-i", f.file])];
  const ms = (t: number) => Math.max(0, Math.round(t * 1000));
  const vparts = voice.map((v, i) => `[${i + 1}:a]aresample=48000,pan=stereo|c0=c0|c1=c0,adelay=${ms(v.at)}|${ms(v.at)}[v${i}]`);
  const fparts = fx.map((f, i) => `[${voice.length + 1 + i}:a]aresample=48000,aformat=channel_layouts=stereo,volume=${(f.gain ?? 0.8).toFixed(2)},adelay=${ms(f.at)}|${ms(f.at)}[f${i}]`);
  const fxBus = fx.length ? `${fx.map((_, i) => `[f${i}]`).join("")}amix=inputs=${fx.length}:normalize=0,apad=whole_dur=${D}[fx]` : "";
  const chain: string[] = [];
  if (voice.length) {
    chain.push(...vparts, `${voice.map((_, i) => `[v${i}]`).join("")}amix=inputs=${voice.length}:normalize=0,apad=whole_dur=${D},asplit=2[voice][key]`,
      `[0:a]apad=whole_dur=${D}[music]`, `[music][key]sidechaincompress=threshold=0.03:ratio=7:attack=12:release=380[bed]`);
  } else chain.push(`[0:a]apad=whole_dur=${D}[bed]`);
  if (fx.length) chain.push(...fparts, fxBus);
  const ins = ["[bed]", ...(voice.length ? ["[voice]"] : []), ...(fx.length ? ["[fx]"] : [])];
  chain.push(`${ins.join("")}amix=inputs=${ins.length}:normalize=0,alimiter=limit=0.89,loudnorm=I=-14:TP=-1.5:LRA=11,atrim=0:${D}[out]`);
  return ["-y", "-v", "error", ...inputs, "-filter_complex", chain.join(";"), "-map", "[out]", "-ar", "48000", "-c:a", "pcm_s16le", out];
}
