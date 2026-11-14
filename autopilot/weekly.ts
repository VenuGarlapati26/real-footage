// WEEKLY GROWTH REVIEW (Monday + Thursday). The channel improves itself; no daily edits.
//   1. Score what was tried: each video's views in its first 3 days -> its publish slot and thumbnail style
//   2. Retention: every recent long video's curve -> drop-offs mapped to the shots on screen -> pacing + hook gate
//   3. Topics: average % watched per topic -> topic weights (more of what holds viewers)
//   4. Trend radar: outliers, Wikipedia attention, search demand -> channel/ideas.json (what to make next)
//   5. A one-page report to channel/reports/ and your phone

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import * as yt from "./youtube";
import { notify } from "./notify";
import { analyseCurve, loadLearning, record, saveLearning, tunePacing } from "../growth/learn";
import { radar } from "../growth/trends";
import * as meta from "./meta";
import { allocate, loadFormats, loadPillars, scorePillars, type Perf } from "../growth/pillars";
import { writeEpisode } from "../growth/writer";
import { curate } from "../engine/curate";
import { geminiReady } from "../growth/gemini";
import { notionReady, syncNotion } from "../growth/notion";
import type { Row } from "./daily";

const readJson = async <T>(f: string): Promise<T> => JSON.parse(await readFile(f, "utf8"));
const day = (d: Date) => d.toISOString().slice(0, 10);

/** Count votes: a comment counts once, for the first standalone A, B or C it contains. */
export function tally(comments: string[]): { A: number; B: number; C: number; total: number } {
  const t = { A: 0, B: 0, C: 0, total: 0 };
  for (const c of comments) { const m = c.toUpperCase().match(/(?:^|[^A-Z])([ABC])(?![A-Z])/); if (m) { t[m[1] as "A" | "B" | "C"]++; t.total++; } }
  return t;
}

/** Per-topic average view percentage -> weights around 1.0 (best ~1.5, worst ~0.5). */
export function weights(rows: { topic: string; avgPct: number; views: number }[]): Record<string, number> {
  const by = new Map<string, { pct: number; n: number }>();
  for (const r of rows) { const w = by.get(r.topic) ?? { pct: 0, n: 0 }; w.pct += r.avgPct; w.n++; by.set(r.topic, w); }
  const avg = [...by].map(([k, v]) => [k, v.pct / v.n] as const); if (!avg.length) return {};
  const lo = Math.min(...avg.map(a => a[1])), hi = Math.max(...avg.map(a => a[1]));
  return Object.fromEntries(avg.map(([k, v]) => [k, hi === lo ? 1 : +(0.5 + (v - lo) / (hi - lo)).toFixed(2)]));
}

async function main() {
  const notes: string[] = [];
  const learning = await loadLearning();
  const ledger = await readJson<Row[]>("channel/ledger.json"), strategy = await readJson<any>("channel/strategy.json");
  const released: Record<string, string> = existsSync("channel/released.json") ? await readJson("channel/released.json") : {};   // Instagram ids from release.yml
  if (yt.hasCredentials()) {
    const end = new Date(), start = new Date(end.getTime() - 28 * 86_400_000);
    // 1. slots + thumbnails: score each video once, 3 days after it went out
    for (const r of ledger.filter(r => r.videoId && !r.scored && r.publishAt && Date.now() - Date.parse(r.publishAt) > 3 * 86_400_000)) {
      const from = r.publishAt!.slice(0, 10), to = day(new Date(Date.parse(r.publishAt!) + 3 * 86_400_000));
      const v = (await yt.videoDaily(r.videoId!, from, to).catch(() => [])).reduce((s: number, x: any) => s + x.views, 0);
      record(learning.slots, r.slot, v); if (r.thumbStyle) record(learning.thumbStyles, r.thumbStyle, v); r.scored = true;
    }
    await writeFile("channel/ledger.json", JSON.stringify(ledger, null, 2));
    // 2. retention -> pacing
    const cases = [];
    for (const r of ledger.filter(r => r.job === "long" && r.videoId).slice(-6)) {
      const f = `channel/renders/${r.episode}-long.json`; if (!existsSync(f)) continue;
      const m = await readJson<any>(f), curve = await yt.retentionCurve(r.videoId!, day(start), day(end)).catch(() => []);
      if (curve.length < 8) continue;
      const lang = (await readJson<any>("channel/settings.json")).lang ?? "en", srt = `channel/renders/${r.episode}-long.${lang}.srt`;
      const a = analyseCurve(curve, m.duration, existsSync(srt) ? srt : undefined);
      cases.push({ cliffs: a.cliffs, shots: m.shots, hookLeak: a.hook_leak });
      notes.push(`${r.episode}: lost ${a.hook_leak.toFixed(0)}% in the first 30 s; drop-offs at ${a.cliffs.map(c => `${c.at_seconds}s`).join(", ") || "none"}`);
    }
    Object.assign(learning, tunePacing(learning, cases));
    // 3. topics
    const stats = await yt.videoStats(day(start), day(end));
    const byId = new Map(ledger.filter(r => r.videoId).map(r => [r.videoId, r]));
    const rows = stats.filter((x: any) => byId.has(x.video)).map((x: any) => ({ topic: byId.get(x.video)!.topic, avgPct: Number(x.averageViewPercentage), views: Number(x.views) }));
    strategy.topicWeights = { ...strategy.topicWeights, ...weights(rows) };
    // 3b. pillars: how each kind of content really did, first 7 days, all platforms, Shorts and long videos separately
    const prow: { pillar: string; format: "short" | "long"; views: number }[] = [], arow: typeof prow = [];
    for (const r of ledger.filter(r => r.videoId && r.publishAt && Date.now() - Date.parse(r.publishAt) > 7 * 86_400_000)) {
      const from = r.publishAt!.slice(0, 10), to = day(new Date(Date.parse(r.publishAt!) + 7 * 86_400_000));
      const v = (await yt.videoDaily(r.videoId!, from, to).catch(() => [])).reduce((s: number, x: any) => s + x.views, 0);
      // every platform counts: YouTube + Instagram Reels + Facebook Reels (an idea can explode on one and not another)
      const igId = r.igId ?? (r.igContainer && !/^(expired|failed)$/.test(released[r.igContainer] ?? "expired") ? released[r.igContainer] : undefined);
      const ig = igId ? await meta.instagramViews(igId).catch(() => 0) : 0;
      const fb = r.fbId ? await meta.facebookViews(r.fbId).catch(() => 0) : 0;
      prow.push({ pillar: r.topic, format: r.job, views: v + ig + fb }); if (r.angle) arow.push({ pillar: r.angle, format: r.job, views: v + ig + fb });
    }
    if (arow.length) { strategy.angles = scorePillars(arow); notes.push(`story formats: ${Object.entries(strategy.angles as Perf).map(([k, v]) => `${k} short ${v.short.score}x/${v.short.n}`).join("; ")}`); }
    if (prow.length) { strategy.pillars = scorePillars(prow); notes.push(`pillars (7-day views vs channel median): ${Object.entries(strategy.pillars as Perf).map(([k, v]) => `${k} short ${v.short.score}x/${v.short.n}, long ${v.long.score}x/${v.long.n}`).join("; ")}`); }
  }
  // 4. what to make next
  const ideas = await radar().catch(e => { notes.push(`trend radar failed: ${e.message}`); return []; });
  // 5. Notion board (optional): ideas + videos out, your "Make next" picks back in
  let requested: string[] = [];
  if (notionReady()) {
    try {
      const views = Object.fromEntries((await yt.videoStats(day(new Date(Date.now() - 90 * 864e5)), day(new Date())).catch(() => [])).map((x: any) => [x.video, Number(x.views)]));
      const n = await syncNotion(ideas, ledger, views); requested = n.requested;
      await writeFile("channel/requests.json", JSON.stringify({ updated: new Date().toISOString(), requested }, null, 2));
      notes.push(`Notion: ${n.created} new rows, ${n.updated} updated, ${requested.length} marked "Make next"`);
    } catch (e: any) { notes.push(`Notion sync failed: ${e.message}`); }
  }
  // 6. write next week's episodes (free Gemini key): your Notion picks first, then the radar's best ideas
  const settingsW = await readJson<any>("channel/settings.json");
  if (settingsW.writer?.enabled && geminiReady()) {
    const writtenFile = "channel/written-ideas.json", written: string[] = existsSync(writtenFile) ? await readJson<string[]>(writtenFile) : [];
    // which pillars this week's episodes come from: mostly the proven ones, ~30% testing the rest
    const pf = await loadPillars(), ids = pf.pillars.map(p => p.id), n = settingsW.writer.perWeek ?? 3;
    const plan = allocate(ids, strategy.pillars ?? {}, Math.max(0, n - requested.length), pf.explore ?? 0.3, Math.floor(Date.now() / (7 * 86_400_000)));
    // and how each one tells its story: the story formats get the same treatment (winners + ~30% testing)
    const ff = await loadFormats(), angles = allocate(ff.formats.map(f => f.id), strategy.angles ?? {}, n, ff.explore ?? 0.3, Math.floor(Date.now() / (7 * 86_400_000)) + 11);
    notes.push(`writing this week: ${[...requested.map(() => "your Notion pick"), ...plan].map((p, k) => `${p} as "${angles[k]}"`).join(", ")}`);
    const fresh = (x: string) => !written.includes(x.toLowerCase());
    const queue = [...requested.filter(fresh).map(r => ({ idea: r, topic: ideas.find(i => i.idea === r)?.topic ?? plan[0] ?? "space", wiki: undefined as string | undefined })),
      ...plan.map(pid => { const best = ideas.find(i => i.topic === pid && fresh(i.idea)); const p = pf.pillars.find(x => x.id === pid)!;
        const wiki = p.wiki.find(w => fresh(w)); return best ? { idea: best.idea, topic: pid, wiki: undefined } : { idea: wiki ?? p.seeds[0], topic: pid, wiki }; })];
    for (const [k, i] of queue.slice(0, n).entries()) {
      try {
        const file = await writeEpisode(i.idea, { topic: i.topic, wiki: i.wiki, angle: angles[k], approve: false });
        const rep = await curate(file).catch(e => [`curation skipped: ${e.message}`]);
        if (settingsW.autoApprove) { const ep = await readJson<any>(file); ep.status = "approved"; await writeFile(file, JSON.stringify(ep, null, 2) + "\n"); }
        notes.push(`wrote ${file} from "${i.idea}" (${settingsW.autoApprove ? "approved" : "draft: set status to approved"}); footage: ${rep.join("; ")}`);
        written.push(i.idea.toLowerCase());   // only ideas that really became episodes; a failed one is tried again next time
      } catch (e: any) { notes.push(`writer: "${i.idea}" skipped (will retry next review): ${String(e.message).split("\n")[0]}`); }
    }
    await writeFile(writtenFile, JSON.stringify(written, null, 2));
  } else if (settingsW.writer?.enabled) notes.push("episode writer is OFF: add the GEMINI_API_KEY secret (free, aistudio.google.com), or no new episodes get written");
  learning.updated = strategy.updated = new Date().toISOString();
  await saveLearning(learning); await writeFile("channel/strategy.json", JSON.stringify(strategy, null, 2));
  const report = [`# Growth review ${day(new Date())}`, "",
    "## What the channel learned", ...(notes.length ? notes.map(n => `- ${n}`) : ["- not enough data yet"]), ...learning.notes.slice(-3).map(n => `- ${n}`),
    `- Shot length now ${learning.shotSeconds}s, hook gate ${learning.hookMin}`, `- Topic weights: ${JSON.stringify(strategy.topicWeights)}`, "",
    ...(requested.length ? ["## You picked in Notion", ...requested.map(r => `- ${r}`), ""] : []),
    "## Make next (trend radar)", ...ideas.slice(0, 8).map((i, n) => `${n + 1}. ${i.idea} [${i.topic}, ${i.score}]: ${i.why[0]}`)].join("\n");
  await mkdir("channel/reports", { recursive: true }); await writeFile(`channel/reports/${day(new Date())}.md`, report);
  await notify("Project 2 growth review", report.slice(0, 3500), { tags: "chart_with_upwards_trend" });
}

if (process.argv[1]?.endsWith("weekly.ts")) await main();
