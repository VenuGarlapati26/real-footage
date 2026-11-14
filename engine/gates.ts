// Quality gates: an episode is only built for publishing when every gate passes.
// Writing gates use the tools from Jake Schincariol's youtube-agent-skill and instagram-agent-skill (MIT,
// vendor/skills/). They score English, so they run on the English line; the Hindi line carries the same idea.
//
//   npx tsx engine/gates.ts episodes/E001-iss-16-sunrises.json

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import type { Episode } from "./types";
import { instagramCaption, facebookCaption } from "../growth/captions";

const V = "vendor/skills";
/** Run a vendored tool and read its JSON. Some tools exit 1 to mean "review" - the JSON is still the answer. */
const py = (script: string, args: string[], input?: string) => {
  try { return JSON.parse(execFileSync("python3", ["-I", `${V}/${script}`, ...args], { input, encoding: "utf8" })); }
  catch (e: any) { if (e.stdout) return JSON.parse(String(e.stdout)); throw e; }
};

export interface Gate { name: string; pass: boolean; score?: number; detail: string }
export const THRESHOLDS = { ytHook: 60, igHook: 45, title: 70, humanCaption: 60 };

const BLOCK = /\b(mr\.? ?beast|kurzgesagt|vox|vsauce|veritasium|discovery channel|nat ?geo|national geographic|netflix|bbc|history channel|disney|marvel|coca-?cola|pepsi|nike|adidas|samsung|iphone)\b/i;

/** Both hook scores for one line (used by the writer to pick the best of several hooks). */
export function hookScores(hook: string): { yt: number; ig: number } {
  return { yt: py("yt-script/hookscore.py", ["--json", "--hook", hook])[0].verdict, ig: py("ig-reel/hookscore.py", ["--json", "--hook", hook]).score };
}
/** How human the caption reads, 0-100. */
export const captionHuman = (caption: string): number => py("ig-human/detect.py", ["--json", "-"], caption).human_score;

export function runGates(ep: Episode, caption?: string, hookMin = THRESHOLDS.ytHook): Gate[] {
  const g: Gate[] = [];
  const hook = ep.scenes[0].vo.en;
  const yt = py("yt-script/hookscore.py", ["--json", "--hook", hook])[0];
  g.push({ name: "hook (YouTube)", pass: yt.verdict >= hookMin, score: yt.verdict, detail: `${yt.band}; weakest ${Object.entries(yt.properties as Record<string, number>).sort((a, b) => a[1] - b[1])[0][0]}` });
  const ig = py("ig-reel/hookscore.py", ["--json", "--hook", hook]);
  g.push({ name: "hook (Reels/Shorts)", pass: ig.score >= THRESHOLDS.igHook, score: ig.score, detail: `${ig.verdict}; weakest ${ig.weakest}` });
  const t = py("yt-package/title.py", ["--json", "--title", ep.title.en, "--thumb", ep.thumb.en])[0];
  g.push({ name: "title + thumbnail", pass: t.score >= THRESHOLDS.title, score: t.score, detail: (t.issues as string[][]).map(i => i[0]).join(", ") || "clean" });
  // engagement: a real question, an on-screen hook that is NOT the spoken line, a loop line, a share line
  const e = ep.engage;
  g.push({ name: "engagement pieces", pass: !!e && Object.values(e.ask).every(q => /[?？]\s*$/.test(String(q))) && !!e.loop?.en && !!e.share?.en && !!e.hookText?.en,
    detail: !e ? "no engage block" : !/[?？]\s*$/.test(e.ask.en) ? "the ask must be a question" : "ok" });
  const spoken = ep.scenes[0].vo.en.toLowerCase();
  g.push({ name: "on-screen hook differs from spoken line", pass: !!e && !spoken.includes(e.hookText.en.toLowerCase()), detail: e ? `"${e.hookText.en}"` : "missing" });
  // the real-footage promise: scenes marked authentic may only use NASA, Wikimedia or your own clips, with 2+ online sources
  const weak = ep.scenes.filter(s => s.authentic && (s.footage.some(f => f.provider === "pexels" || f.provider === "pixabay") || s.footage.filter(f => f.provider === "nasa" || f.provider === "wikimedia").length < 2));
  g.push({ name: "real-footage promise", pass: !weak.length, detail: weak.length ? `stock or too few real sources in ${weak.map(s => s.id).join(", ")}` : "ok" });
  if (!caption && e) caption = instagramCaption(ep, "en");
  if (caption) {
    const c = py("ig-caption/caption.py", ["--json", "-"], caption);
    const fails = (c.checks as { check: string; status: string; detail: string }[]).filter(x => x.status === "FAIL");
    g.push({ name: "caption", pass: !fails.length, detail: fails.map(f => `${f.check}: ${f.detail}`).join("; ") || "ok" });
    const d = py("ig-human/detect.py", ["--json", "-"], caption);
    g.push({ name: "caption reads naturally", pass: d.human_score >= THRESHOLDS.humanCaption, score: d.human_score, detail: d.verdict });
  }
  // facts: any scene that states a number must cite a source that exists and lists its claims
  const ids = new Set(ep.sources.filter(s => s.url && s.claims.length).map(s => s.id));
  const numeric = ep.scenes.filter(s => (s.overlays ?? []).some(o => /\d/.test(o.text.en + (o.sub?.en ?? ""))) || /\d/.test(s.vo.en));
  const unsourced = numeric.filter(s => !(s.sources ?? []).length || !(s.sources ?? []).every(id => ids.has(id)));
  g.push({ name: "every number has a source", pass: !unsourced.length, detail: unsourced.length ? `missing on ${unsourced.map(s => s.id).join(", ")}` : `${ids.size} source(s)` });
  // footage: every scene has a fallback, and only allowed providers are used
  const thin = ep.scenes.filter(s => s.footage.filter(f => f.provider !== "local").length < 2);
  g.push({ name: "footage has fallbacks", pass: !thin.length, detail: thin.length ? `fewer than 2 online sources: ${thin.map(s => s.id).join(", ")}` : "ok" });
  const all = JSON.stringify([ep.title, ep.thumb, ep.scenes.map(s => [s.vo, s.overlays]), caption ?? ""]);
  const hit = all.match(BLOCK);
  g.push({ name: "rights (no borrowed names, brands, links)", pass: !hit && !/https?:\/\//.test(JSON.stringify(ep.scenes.map(s => s.vo))), detail: hit ? `names "${hit[0]}"` : "clean" });
  // English is required everywhere; every other language the episode starts must be finished too (or it can't be voiced/subtitled)
  const started = [...new Set(ep.scenes.flatMap(s => Object.keys(s.vo)))] as (keyof typeof ep.scenes[0]["vo"])[];
  const missing = ep.scenes.filter(s => !s.vo.en || (s.overlays ?? []).some(o => !o.text.en)).map(s => `${s.id} (English)`);
  const partial = started.filter(l => l !== "en" && ep.scenes.some(s => !s.vo[l]));
  g.push({ name: "languages complete", pass: !missing.length, detail: missing.length ? missing.join(", ") : `English${started.length > 1 ? ` + ${started.filter(l => l !== "en" && !partial.includes(l)).join(", ")}` : ""}${partial.length ? `; unfinished (subtitles skipped): ${partial.join(", ")}` : ""}` });
  return g;
}

if (process.argv[1]?.endsWith("gates.ts")) {
  const res = runGates(JSON.parse(readFileSync(process.argv[2], "utf8")) as Episode);
  for (const r of res) console.log(`${r.pass ? "PASS" : "FAIL"}  ${r.name}${r.score !== undefined ? ` (${r.score})` : ""}: ${r.detail}`);
  process.exitCode = res.every(r => r.pass) ? 0 : 1;
}
