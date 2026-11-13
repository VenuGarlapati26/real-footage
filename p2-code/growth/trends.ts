// TREND RADAR (weekly). Answers: "what should the next episodes be about, and what kind of title wins right now?"
//
// Three signals, all free and official or public:
//   1. YouTube outliers   search.list (last 30 days, India, Hindi) -> each video scored as a multiple of ITS OWN
//                         channel's median (vendor/skills/yt-viral/swipe.py), so we copy ideas, not channel size.
//                         swipe.py also names the title formula that worked.
//   2. Wikipedia attention Wikimedia pageviews API: articles in our topics whose daily views jumped this week
//                         (hi + en Wikipedia) -> people are curious about it right now.
//   3. Search demand      YouTube autocomplete phrases for each seed (what people type), Hindi + English.
// Output: channel/ideas.json (ranked) + a short note in the weekly report. Episodes are still written and approved
// by you; this only decides WHAT to write next. Quota: ~600 of 10,000 daily YouTube units.

import { loadPillars, type Pillar } from "./pillars";
import { keywordProvider, volumes, withDemand } from "./keywords";
import { execFileSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import * as yt from "../autopilot/youtube";

const UA = "real-footage-channel/1.0 (weekly trend radar)";
const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : 0; };

export interface Idea { idea: string; topic: string; score: number; why: string[] }

/** 1. outliers: videos that beat their own channel's median by 2x or more */
export async function outliers(seed: string, topic: string): Promise<{ title: string; multiple: number; formula: string; url: string; views: number }[]> {
  const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
  const s = await yt.ytGet(`search?part=snippet&type=video&maxResults=25&order=viewCount&regionCode=IN&relevanceLanguage=hi&publishedAfter=${since}&q=${encodeURIComponent(seed)}`);
  const channels = [...new Set<string>((s.items ?? []).map((i: any) => i.snippet.channelId))].slice(0, 15);
  const rows: any[] = [];
  for (const ch of channels) {
    const c = await yt.ytGet(`channels?part=contentDetails&id=${ch}`);
    const uploads = c.items?.[0]?.contentDetails?.relatedPlaylists?.uploads; if (!uploads) continue;
    const pl = await yt.ytGet(`playlistItems?part=contentDetails&maxResults=12&playlistId=${uploads}`);
    const ids = (pl.items ?? []).map((i: any) => i.contentDetails.videoId).join(","); if (!ids) continue;
    const v = await yt.ytGet(`videos?part=snippet,statistics,contentDetails&id=${ids}`);
    for (const x of v.items ?? []) rows.push({ channel: x.snippet.channelTitle, title: x.snippet.title, views: Number(x.statistics.viewCount ?? 0), url: `https://youtu.be/${x.id}`, seed });
  }
  if (!rows.length) return [];
  const tmp = `/tmp/swipe-${process.pid}.json`; await writeFile(tmp, JSON.stringify(rows));
  const out = JSON.parse(execFileSync("python3", ["-I", "vendor/skills/yt-viral/swipe.py", tmp, "--min", "2.0", "--json"], { encoding: "utf8" }));
  return (out.outliers ?? []).map((o: any) => ({ title: o.title, multiple: o.multiple ?? o.x ?? 0, formula: o.formula ?? o.hook ?? "", url: o.url, views: o.views }));
}

/** 2. Wikipedia: articles whose views this week are well above the previous weeks (per-article daily pageviews). */
export async function wikiRising(articles: { lang: "hi" | "en"; title: string; topic: string }[]): Promise<{ title: string; lang: string; topic: string; lift: number; week: number }[]> {
  const fmt = (d: Date) => d.toISOString().slice(0, 10).replace(/-/g, "");
  const end = new Date(Date.now() - 86_400_000), start = new Date(end.getTime() - 35 * 86_400_000);
  const out = [];
  for (const a of articles) {
    const url = `https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/${a.lang}.wikipedia/all-access/user/${encodeURIComponent(a.title.replace(/ /g, "_"))}/daily/${fmt(start)}/${fmt(end)}`;
    const j: any = await fetch(url, { headers: { "user-agent": UA } }).then(r => r.json()).catch(() => ({}));
    const v: number[] = (j.items ?? []).map((i: any) => i.views); if (v.length < 14) continue;
    const week = v.slice(-7).reduce((s, x) => s + x, 0), base = median(v.slice(0, -7)) * 7 || 1;
    out.push({ title: a.title, lang: a.lang, topic: a.topic, lift: +(week / base).toFixed(2), week });
  }
  return out.sort((a, b) => b.lift - a.lift);
}

/** 3. what people type into YouTube search */
export async function suggestions(seed: string, hl: "hi" | "en"): Promise<string[]> {
  const j = await fetch(`https://suggestqueries.google.com/complete/search?client=firefox&ds=yt&hl=${hl}&q=${encodeURIComponent(seed)}`, { headers: { "user-agent": UA } }).then(r => r.json()).catch(() => null);
  return Array.isArray(j?.[1]) ? j[1].slice(0, 10) : [];
}

/** Combine the signals into ranked ideas. Pure function so it can be tested offline. */
export function rank(input: { outliers: Awaited<ReturnType<typeof outliers>>; wiki: Awaited<ReturnType<typeof wikiRising>>; suggest: Record<string, string[]>; seeds: { q: string; topic: string }[]; weights: Record<string, number> }): Idea[] {
  const ideas = new Map<string, Idea>();
  const bump = (idea: string, topic: string, s: number, why: string) => { const k = idea.toLowerCase(); const i = ideas.get(k) ?? { idea, topic, score: 0, why: [] }; i.score += s * (input.weights[topic] ?? 1); i.why.push(why); ideas.set(k, i); };
  for (const o of input.outliers) bump(o.title, input.seeds.find(s => o.title.toLowerCase().includes(s.q.split(" ")[0].toLowerCase()))?.topic ?? "general", Math.min(10, o.multiple) * 2, `outlier ${o.multiple}x its channel (${o.formula || "formula unclear"}): ${o.url}`);
  for (const w of input.wiki) if (w.lift >= 1.5) bump(w.title, w.topic, Math.min(8, w.lift) * 1.5, `Wikipedia (${w.lang}) views ${w.lift}x usual this week`);
  for (const [seed, list] of Object.entries(input.suggest)) list.forEach((q, i) => bump(q, input.seeds.find(s => s.q === seed)?.topic ?? "general", Math.max(0.5, 3 - i * 0.3), `people search "${q}"`));
  return [...ideas.values()].sort((a, b) => b.score - a.score).slice(0, 25).map(i => ({ ...i, score: +i.score.toFixed(1) }));
}

export async function radar() {
  const cfg = JSON.parse(await readFile("channel/growth.json", "utf8"));
  // every content pillar brings its own search seeds and Wikipedia pages to watch (channel/pillars.json)
  const { pillars } = await loadPillars().catch(() => ({ pillars: [] as Pillar[] }));
  cfg.seeds = [...cfg.seeds, ...pillars.flatMap(p => p.seeds.slice(0, 2).map(q => ({ q, topic: p.id })))];
  cfg.wikiWatch = [...cfg.wikiWatch, ...pillars.flatMap(p => p.wiki.slice(0, 2).map(title => ({ lang: "en", title, topic: p.id })))];
  const strategy = JSON.parse(await readFile("channel/strategy.json", "utf8"));
  const outs = [], suggest: Record<string, string[]> = {};
  for (const s of cfg.seeds) {
    if (yt.hasCredentials()) outs.push(...await outliers(s.q, s.topic).catch(e => { console.warn(`outliers ${s.q}: ${e.message}`); return []; }));
    suggest[s.q] = [...await suggestions(s.qEn ?? s.q, "en"), ...(s.qEn ? await suggestions(s.q, "hi") : [])];
  }
  const wiki = await wikiRising(cfg.wikiWatch);
  let ideas = rank({ outliers: outs, wiki, suggest, seeds: cfg.seeds, weights: strategy.topicWeights ?? {} });
  if (keywordProvider()) ideas = withDemand(ideas, await volumes(ideas.map(i => i.idea)).catch(e => { console.warn(`keyword volumes: ${e.message}`); return []; }));
  await writeFile("channel/ideas.json", JSON.stringify({ updated: new Date().toISOString(), ideas, winningFormulas: countFormulas(outs) }, null, 2));
  return ideas;
}

export function countFormulas(o: { formula: string }[]) {
  const c: Record<string, number> = {}; for (const x of o) if (x.formula) c[x.formula] = (c[x.formula] ?? 0) + 1;
  return Object.entries(c).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([formula, n]) => ({ formula, n }));
}

if (process.argv[1]?.endsWith("trends.ts")) { const ideas = await radar(); ideas.slice(0, 10).forEach((i, n) => console.log(`${n + 1}. [${i.score}] ${i.idea}  (${i.topic})\n   ${i.why.slice(0, 2).join("\n   ")}`)); }
