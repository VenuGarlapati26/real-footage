// The YouTube description, written like a channel that cares (the way Project 1's are): the hook, what the viewer will
// learn as a scannable list, the question, chapters on long videos, the channel line, and only then the credits.
// Pure: everything comes from the episode and the render, so it works in every language the episode has.
import type { Episode, Lang } from "../engine/types";
import { LANGS, tx, ui } from "../engine/langs";

export interface Chapter { at: number; title: string }

const clock = (s: number) => { const t = Math.max(0, Math.floor(s)), m = Math.floor(t / 60), h = Math.floor(m / 60);
  return h ? `${h}:${String(m % 60).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}` : `${m}:${String(t % 60).padStart(2, "0")}`; };
const firstSentence = (t: string) => (t.match(/^[^.!?]+[.!?]/)?.[0] ?? t).trim();
const clip = (t: string, n = 90) => t.length <= n ? t : t.slice(0, n - 1).replace(/\s+\S*$/, "") + "…";

/** "28,000 km per hour", "One day. 16 sunrises." ... from the on-screen graphics, then the narration. Pure. */
export function discoveries(ep: Episode, lang: Lang, max = 5): string[] {
  const out: string[] = [];
  const add = (x: string) => { const v = clip(x.replace(/\s+/g, " ").trim()); if (v.length > 3 && !out.some(o => o.toLowerCase() === v.toLowerCase())) out.push(v); };
  for (const sc of ep.scenes) for (const o of sc.overlays ?? []) {
    const text = tx(o.text, lang), sub = o.sub ? tx(o.sub, lang) : "";
    if (o.kind === "stat" || o.kind === "orbit") add(`${text} ${sub}`);
    else if (o.kind === "kicker" || o.kind === "chapter") add(text);
  }
  // the narration only fills in when the graphics give fewer than 3 points (spelled-out numbers read badly in a list)
  for (const sc of ep.scenes.slice(1)) { if (out.length >= 3) break; add(firstSentence(tx(sc.vo, lang))); }
  return out.slice(0, max);
}

/** YouTube chapters need 0:00 first, at least 3, each 10 s or longer; otherwise none are shown. Pure. */
export function chapterLines(chapters: Chapter[], lang: Lang, intro = "Intro"): string[] {
  const list = [...chapters].sort((a, b) => a.at - b.at);
  if (!list.length || list[0].at > 0.5) list.unshift({ at: 0, title: intro });
  const ok = list.filter((c, i) => i === 0 || c.at - list[i - 1].at >= 10);
  return ok.length >= 3 ? ok.map(c => `${clock(c.at)} ${c.title}`) : [];
}

export function hashtags(ep: Episode, format: "short" | "long"): string {
  const words = [ep.topic, ...((ep as any).tags ?? [])].filter(Boolean).map(t => "#" + String(t).replace(/[^\p{L}\p{N}]+/gu, "")).filter(t => t.length > 2);
  return [...new Set([...words, "#realfootage", ...(format === "short" ? ["#Shorts"] : [])])].slice(0, 4).join(" ");
}

export function description(ep: Episode, lang: Lang, o: { format: "short" | "long"; rights: { credit: string; license: string; page?: string }[]; synthetic: boolean;
  longUrl?: string; chapters?: Chapter[]; subtitles?: Lang[] }): string {
  const hook = tx(ep.scenes[0].vo, lang).trim();
  const learn = discoveries(ep, lang);
  const chapters = o.format === "long" ? chapterLines(o.chapters ?? [], lang) : [];
  const subs = (o.subtitles ?? []).filter(l => l !== lang && LANGS[l]).map(l => LANGS[l].native);
  return [
    tx(ep.title, lang), "",
    hook, "",
    ...(learn.length ? [o.format === "short" ? ui(lang, "quick") : ui(lang, "discover"), ...learn.map(x => `• ${x}`), ""] : []),
    `${tx(ep.engage.ask, lang)} ${ui(lang, "comments")} 👇`, "",
    ...(o.longUrl ? [`▶ ${ui(lang, "full")}: ${o.longUrl}`, ""] : []),
    ...(chapters.length ? [`${ui(lang, "chapters")}:`, ...chapters, ""] : []),
    ui(lang, "channel"), ui(lang, "promise"), ui(lang, "subscribe"),
    ...(subs.length ? [`${ui(lang, "subs")}: ${subs.join(", ")}`] : []), "",
    `— ${ui(lang, "credits")} —`,
    ...o.rights.map(r => `• ${r.credit} (${r.license})${r.page ? ` ${r.page}` : ""}`),
    ...ep.sources.map(s => `• ${s.title}: ${s.url}`),
    ...(o.synthetic ? [ui(lang, "synthetic")] : []),
    ui(lang, "nasa"), "",
    hashtags(ep, o.format),
  ].join("\n").replace(/\n{3,}/g, "\n\n").slice(0, 4900);
}
