// LEARNING (all decisions are explainable and stored in channel/learning.json):
//   - publish slots and thumbnail styles: try each a few times, then mostly use the winner, sometimes explore
//   - pacing: retention cliffs are mapped back to the shot lengths and scene types that were on screen;
//     the build reads `shotSeconds` and `maxSceneSeconds` from here, so the edit tightens itself week by week
//   - hook: if viewers leave in the first 30 s too often, the hook gate gets stricter

import { execFileSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { writeFileSync } from "node:fs";

export interface Arm { n: number; score: number }
export interface Learning {
  slots: Record<string, Arm>; thumbStyles: Record<string, Arm>;
  shotSeconds: number; maxSceneSeconds: number; hookMin: number;
  notes: string[]; updated: string | null;
}
export const DEFAULT_LEARNING: Learning = { slots: {}, thumbStyles: {}, shotSeconds: 3.2, maxSceneSeconds: 14, hookMin: 60, notes: [], updated: null };

export async function loadLearning(): Promise<Learning> {
  try { return { ...DEFAULT_LEARNING, ...JSON.parse(await readFile("channel/learning.json", "utf8")) }; } catch { return { ...DEFAULT_LEARNING }; }
}
export const saveLearning = (l: Learning) => writeFile("channel/learning.json", JSON.stringify(l, null, 2));

/** Pick an arm: each tried `minTries` times first, then the best average, exploring `explore` of the time. */
export function pick(arms: string[], stats: Record<string, Arm>, dayIndex: number, explore = 0.2, minTries = 3): string {
  const s = arms.map(a => ({ a, ...(stats[a] ?? { n: 0, score: 0 }) }));
  const untried = s.filter(x => x.n < minTries); if (untried.length) return untried[dayIndex % untried.length].a;
  if (((dayIndex * 0.6180339887) % 1) < explore) return s.sort((x, y) => x.n - y.n)[0].a;
  return s.sort((x, y) => y.score / y.n - x.score / x.n)[0].a;
}
export function record(stats: Record<string, Arm>, arm: string, score: number) { const a = stats[arm] ?? { n: 0, score: 0 }; stats[arm] = { n: a.n + 1, score: a.score + score }; }

// ---------------------------------------------------------------- retention -> pacing
export interface Cliff { at_seconds: number | null; lost: number }
export interface ShotSpan { start: number; dur: number; scene: string; overlay?: string }

/** Run the vendored retention tool on a curve (+ transcript) and return hook leak + cliffs in seconds. */
export function analyseCurve(curve: [number, number][], duration: number, srtFile?: string): { hook_leak: number; cliffs: Cliff[]; slide: number } {
  const csv = `/tmp/ret-${process.pid}.csv`;
  writeFileSync(csv, curve.map(([r, p]) => `${(r * 100).toFixed(2)},${p.toFixed(2)}`).join("\n"));
  const args = ["-I", "vendor/skills/yt-retention/retention.py", csv, "--duration", String(duration), "--json", ...(srtFile ? ["--transcript", srtFile] : [])];
  const j = JSON.parse(execFileSync("python3", args, { encoding: "utf8" }));
  return { hook_leak: j.hook_leak, cliffs: j.cliffs, slide: j.slide_per_unit };
}

/** Which shots were on screen when people left? Long shots and long scenes at cliffs -> shorten them. */
export function tunePacing(l: Learning, cases: { cliffs: Cliff[]; shots: ShotSpan[]; hookLeak: number }[]): Learning {
  const out = { ...l, notes: [...l.notes] };
  let longAtCliff = 0, total = 0, hookBad = 0;
  for (const c of cases) {
    if (c.hookLeak >= 35) hookBad++;
    for (const cl of c.cliffs) {
      if (cl.at_seconds == null) continue; total++;
      const sh = c.shots.find(s => cl.at_seconds! >= s.start && cl.at_seconds! < s.start + s.dur);
      if (sh && sh.dur > out.shotSeconds * 1.15) longAtCliff++;
    }
  }
  if (total >= 3 && longAtCliff / total >= 0.5 && out.shotSeconds > 2.2) {
    out.shotSeconds = +(out.shotSeconds - 0.3).toFixed(1);
    out.notes.push(`${new Date().toISOString().slice(0, 10)}: ${longAtCliff}/${total} drop-offs came during long shots -> shots now ${out.shotSeconds}s`);
  }
  if (cases.length >= 3 && hookBad / cases.length >= 0.5 && out.hookMin < 75) {
    out.hookMin += 5;
    out.notes.push(`${new Date().toISOString().slice(0, 10)}: ${hookBad}/${cases.length} videos lost 35%+ in the first 30 s -> hook gate raised to ${out.hookMin}`);
  }
  return out;
}
