// Content pillars: what the channel makes, and how much of each, learned from real results.
//
// Score per pillar and format = median over its videos of (views in the first 7 days / the channel's median for
// that format). Allocation: (1 - explore) of next week's episodes go to pillars by score (an optimistic bonus for
// pillars with few videos, so one unlucky video doesn't bury a topic), the rest rotate through the least-tested
// pillars. Shorts and long videos are learned separately: a topic can win on one and lose on the other.

import { readFile } from "node:fs/promises";

export interface Pillar { id: string; name: string; mood?: string; footage: string[]; seeds: string[]; wiki: string[] }
export interface PillarFile { explore: number; pillars: Pillar[] }
export type Perf = Record<string, Record<"short" | "long", { n: number; score: number }>>;

export const loadPillars = async (): Promise<PillarFile> => JSON.parse(await readFile("channel/pillars.json", "utf8"));
export interface StoryFormat { id: string; name: string; recipe: string }
export const loadFormats = async (): Promise<{ explore: number; formats: StoryFormat[] }> => JSON.parse(await readFile("channel/formats.json", "utf8"));

const median = (a: number[]) => { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y), m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

/** rows: one per published video with its first-7-day views. Pure. */
export function scorePillars(rows: { pillar: string; format: "short" | "long"; views: number }[]): Perf {
  const out: Perf = {};
  for (const f of ["short", "long"] as const) {
    const fr = rows.filter(r => r.format === f), base = median(fr.map(r => r.views)) || 1;
    for (const id of new Set(fr.map(r => r.pillar))) {
      const rel = fr.filter(r => r.pillar === id).map(r => r.views / base);
      (out[id] ??= { short: { n: 0, score: 0 }, long: { n: 0, score: 0 } })[f] = { n: rel.length, score: +median(rel).toFixed(3) };
    }
  }
  return out;
}

/** Weight per pillar for one format: score + an optimism bonus that shrinks with more videos. Untested = 1.2. Pure. */
export function pillarWeights(ids: string[], perf: Perf, format: "short" | "long"): Record<string, number> {
  return Object.fromEntries(ids.map(id => { const p = perf[id]?.[format]; return [id, p?.n ? +(p.score + 0.6 / Math.sqrt(p.n)).toFixed(3) : 1.2]; }));
}

/** Which pillars next week's `count` episodes come from. Deterministic given `seed`. Pure.
 *  Variety rules (the channel must never turn into "only space"):
 *  - a pillar counts as proven only after 2+ videos AND a weight of 1 or more (doing at least as well as the channel);
 *  - no pillar gets more than a third of the week (rounded up), however well it does;
 *  - the same pillar never sits in two slots in a row. */
export function allocate(ids: string[], perf: Perf, count: number, explore: number, seed = 1): string[] {
  const w = pillarWeights(ids, perf, "short"), wl = pillarWeights(ids, perf, "long");
  const tested = (id: string) => (perf[id]?.short.n ?? 0) + (perf[id]?.long.n ?? 0);
  const both = ids.map(id => ({ id, w: (w[id] + wl[id]) / 2 })).sort((a, b) => b.w - a.w);
  const cap = Math.max(1, Math.ceil(count / 3)), used = (id: string) => out.filter(x => x === id).length;
  const nExplore = Math.min(count, Math.max(count > 1 ? 1 : 0, Math.round(count * explore)));
  const out: string[] = [];
  const proven = both.filter(b => tested(b.id) >= 2 && b.w >= 1).slice(0, 3);
  for (let i = 0, guard = 0; proven.length && out.length < count - nExplore && guard < count * 4; i++, guard++) {
    const id = proven[i % proven.length].id; if (used(id) < cap) out.push(id);
  }
  const rest = [...ids].sort((a, b) => tested(a) - tested(b) || ((a.charCodeAt(0) * 31 + a.length * 7 + seed) % 97) - ((b.charCodeAt(0) * 31 + b.length * 7 + seed) % 97));
  for (const id of rest) { if (out.length >= count) break; if (!out.includes(id)) out.push(id); }
  for (let i = 0; out.length < count; i++) out.push(rest[i % rest.length]);   // more slots than pillars: repeat in order
  // spread repeats apart: never the same pillar twice in a row
  for (let i = 1; i < out.length; i++) if (out[i] === out[i - 1]) {
    const j = out.findIndex((x, k) => k > i && x !== out[i - 1] && (k + 1 >= out.length || out[k + 1] !== out[i]) && out[i - 2] !== x);
    if (j > 0) [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** Which pillar an extra episode should come from: the one least used lately (ties: list order). Pure. */
export function nextPillar(ids: string[], recentTopics: string[]): string {
  const last = (id: string) => { const i = recentTopics.lastIndexOf(id); return i < 0 ? -1 : i; };
  const count = (id: string) => recentTopics.filter(t => t === id).length;
  return [...ids].sort((a, b) => count(a) - count(b) || last(a) - last(b))[0];
}

/** Order unused episodes so today's Short is a different topic from the last ones posted. Pure. */
export function varietyOrder<T extends { topic?: string }>(eps: T[], recentTopics: string[]): T[] {
  const age = (t?: string) => { const i = recentTopics.lastIndexOf(t ?? ""); return i < 0 ? -1 : i; };   // -1 = not posted lately
  return eps.map((e, k) => ({ e, k })).sort((a, b) => age(a.e.topic) - age(b.e.topic) || a.k - b.k).map(x => x.e);
}
