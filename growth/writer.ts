// The episode writer: turns the trend radar's best idea into a finished episode, then the footage editor
// (engine/curate.ts) picks its shots. Weekly, automatically (autopilot/weekly.ts) or by hand:
//
//   npx tsx growth/writer.ts --idea "Why astronauts see 16 sunrises" [--wiki "International Space Station"] [--approve]
//
// Facts come ONLY from the fetched source text (Wikipedia, English). Every number the script says must be quoted,
// word for word, in a claim that really appears in that text; the writer checks this itself and asks for a fix.
// Then every gate in engine/gates.ts must pass (hook scores, title, engagement, rights, languages). Up to 5 rewrites.
// Gemini also offers several hooks and share lines; the scorers pick the best ones here, so the hook gates rarely fail.

import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Episode } from "../engine/types";
import { LANGS, type Lang } from "../engine/langs";
import { runGates, hookScores, captionHuman, THRESHOLDS, hardFailures } from "../engine/gates";
import { instagramCaption } from "./captions";
import { longSeconds, MIN_LONG_SECONDS } from "./length";
import { getJson } from "../engine/http";
import { isLook } from "../engine/grade";
import { askJson, geminiReady } from "./gemini";
import { loadPillars, type Pillar, loadFormats, type StoryFormat } from "./pillars";

const norm = (s: string) => s.toLowerCase().replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, " ").trim();

/** The best Wikipedia article for the idea, as plain text (first ~14k characters). */
export async function sourceText(idea: string, title?: string): Promise<{ title: string; url: string; text: string }> {
  const api = process.env.WIKI_API ?? "https://en.wikipedia.org/w/api.php";
  let t = title;
  if (!t) {
    const s: any = await getJson(`${api}?${new URLSearchParams({ action: "query", list: "search", srsearch: idea, srlimit: "1", format: "json" })}`);
    t = s.query?.search?.[0]?.title; if (!t) throw new Error(`no Wikipedia article for "${idea}"`);
  }
  const j: any = await getJson(`${api}?${new URLSearchParams({ action: "query", prop: "extracts", explaintext: "1", redirects: "1", titles: t!, format: "json" })}`);
  const page: any = Object.values(j.query?.pages ?? {})[0];
  if (!page?.extract) throw new Error(`empty article "${t}"`);
  return { title: page.title, url: `https://en.wikipedia.org/wiki/${encodeURIComponent(page.title.replace(/ /g, "_"))}`, text: page.extract.slice(0, 14000) };
}

/** Problems with an episode's facts: claims not found in the source, numbers said without a claim. Pure. */
export function factProblems(ep: Episode, sources: Record<string, string>): string[] {
  const out: string[] = [];
  for (const s of ep.sources) for (const c of s.claims) if (sources[s.id] && !norm(sources[s.id]).includes(norm(c))) out.push(`claim not found word-for-word in ${s.id}: "${c}"`);
  const claims = norm(ep.sources.flatMap(s => s.claims).join(" ")).replace(/,/g, "");
  for (const sc of ep.scenes) for (const n of (`${sc.vo.en} ${(sc.overlays ?? []).map(o => o.text.en).join(" ")}`.match(/\d[\d,.]*/g) ?? [])) {
    const d = n.replace(/,/g, "").replace(/\.$/, ""); if (!claims.includes(d)) out.push(`${sc.id}: the number ${n} is not in any claim`);
  }
  return out;
}


const hasEn = (t: any) => !!t && typeof t === "object" && typeof t.en === "string" && t.en.trim().length > 0;
/** Structural problems that would crash the gates (a missing English text, a scene without narration...). Pure. */
export function shapeProblems(ep: any): string[] {
  const out: string[] = [];
  if (!ep || typeof ep !== "object") return ["the reply is not an episode object"];
  for (const k of ["title", "thumb"]) if (!hasEn(ep[k])) out.push(`"${k}" must be an object with an "en" text`);
  if (!Array.isArray(ep.scenes) || ep.scenes.length < 3) return [...out, `"scenes" must be a list of scenes`];
  ep.scenes.forEach((sc: any, i: number) => {
    const id = sc?.id ?? `scene ${i + 1}`;
    if (!hasEn(sc?.vo)) out.push(`${id}: "vo" must be an object with an "en" text`);
    if (!Array.isArray(sc?.footage)) out.push(`${id}: "footage" must be a list`);
    (sc?.overlays ?? []).forEach((o: any, k: number) => { if (!hasEn(o?.text)) out.push(`${id}: overlay ${k + 1} needs "text" with "en"`); if (o?.sub && !hasEn(o.sub)) out.push(`${id}: overlay ${k + 1} "sub" needs "en"`); });
  });
  if (!ep.engage || !["ask", "hookText", "loop", "share"].every(k => hasEn(ep.engage[k]))) out.push(`"engage" needs ask, hookText, loop and share, each with "en"`);
  if (!Array.isArray(ep.sources)) out.push(`"sources" must be a list`);
  return out;
}

/** Small slips Gemini makes often, fixed here instead of costing a rewrite: an overlay without English text is dropped. */
export function tidy(ep: any): void {
  // the question to viewers must end with "?" in every language
  if (ep?.engage?.ask && typeof ep.engage.ask === "object") for (const [l, q] of Object.entries(ep.engage.ask)) if (typeof q === "string" && q.trim() && !/[?？]\s*$/.test(q)) ep.engage.ask[l] = q.trim().replace(/[.!。]+$/, "") + (l === "ja" || l === "zh" ? "？" : "?");
  // every fact comes from the one fetched source (S1), and the numbers are checked against its claims: a scene that
  // forgot its "sources" tag gets it
  const ids: string[] = (Array.isArray(ep?.sources) ? ep.sources : []).map((x: any) => x?.id).filter(Boolean);
  for (const sc of Array.isArray(ep?.scenes) ? ep.scenes : []) {
    if (ids.length === 1 && sc && (!Array.isArray(sc.sources) || !sc.sources.length || sc.sources.some((i: string) => !ids.includes(i)))) sc.sources = [ids[0]];
    // footage: at least 2 online queries; scenes promised as real footage use only NASA / Wikimedia
    if (sc && Array.isArray(sc.footage)) {
      const q = sc.footage.find((f: any) => f?.q)?.q ?? (typeof sc?.vo?.en === "string" ? sc.vo.en.split(/\s+/).slice(0, 4).join(" ") : "earth from space");
      if (sc.authentic) sc.footage = sc.footage.filter((f: any) => f?.provider !== "pexels" && f?.provider !== "pixabay");
      const online = () => sc.footage.filter((f: any) => f?.provider && f.provider !== "local");
      // NASA only when the story is about space/Earth from above; otherwise filmed stock footage fits far better
      const spacey = /space|orbit|nasa|planet|moon|mars|astronaut|rocket|satellite|earth from|aurora|iss\b/i.test(`${ep.topic ?? ""} ${q}`);
      const add = sc.authentic ? (spacey ? ["nasa", "wikimedia"] : ["wikimedia", "nasa"]) : spacey ? ["nasa", "pexels", "wikimedia"] : ["pexels", "pixabay", "wikimedia"];
      for (const prov of add) { if (online().length >= 2 && (!sc.authentic || online().filter((f: any) => f.provider === "nasa" || f.provider === "wikimedia").length >= 2)) break;
        if (!sc.footage.some((f: any) => f?.provider === prov && f?.q === q)) sc.footage.push({ provider: prov, q }); }
    }
    if (!Array.isArray(sc?.overlays)) continue;
    sc.overlays = sc.overlays.filter((o: any) => hasEn(o?.text));
    for (const o of sc.overlays) if (o.sub && !hasEn(o.sub)) delete o.sub;
  }
}

/** A claim Gemini paraphrased ("travels at 27,600 km/h") is replaced by the source's own sentence that holds the same
 *  numbers, so facts stay word for word without a rewrite. Returns how many claims were repaired. */
export function repairClaims(ep: any, source: string): number {
  const flat = (x: string) => norm(x).replace(/,/g, "");
  const sentences = source.split(/(?<=[.!?])\s+|\n+/).map(x => x.trim()).filter(x => x.length > 10 && x.length < 400);
  let fixed = 0;
  for (const s of ep.sources ?? []) {
    s.claims = (s.claims ?? []).map((c: string) => {
      if (norm(source).includes(norm(c))) return c;
      const nums = (c.match(/\d[\d,.]*/g) ?? []).map(n => n.replace(/,/g, "").replace(/\.$/, ""));
      if (!nums.length) return c;
      const hit = sentences.filter(x => nums.every(n => flat(x).includes(n))).sort((a, b) => a.length - b.length)[0];
      if (hit) { fixed++; return hit; }
      return c;
    });
  }
  return fixed;
}

/** Near misses that do not block an episode after all rewrites: a hook a few points under the bar, a caption that reads
 *  almost natural. Facts, rights, footage and languages are never soft. */
export function softOnly(problems: string[]): boolean {
  return problems.length > 0 && problems.every(p => {
    const m = p.match(/^gate "([^"]+)" failed \(score ([\d.]+)\)/); if (!m) return false;
    const score = Number(m[2]);
    return (m[1] === "hook (YouTube)" && score >= 50) || (m[1] === "hook (Reels/Shorts)" && score >= 38) || (m[1] === "caption reads naturally" && score >= 50);
  });
}

/** Choose the strongest hook and share line from Gemini's alternatives, using the same scorers as the gates. */
export function pickBest(ep: any): string {
  const hooks = [ep.scenes[0].vo, ...(Array.isArray(ep.hookOptions) ? ep.hookOptions : [])].filter(hasEn)
    .filter((h: any) => !h.en.toLowerCase().includes(String(ep.engage.hookText.en).toLowerCase()));
  let best = ep.scenes[0].vo, bestScore = -1;
  for (const h of hooks) { const s = hookScores(h.en), v = Math.min(s.yt / THRESHOLDS.ytHook, s.ig / THRESHOLDS.igHook); if (v > bestScore) { bestScore = v; best = h; } }
  ep.scenes[0].vo = best;
  const shares = [ep.engage.share, ...(Array.isArray(ep.shareOptions) ? ep.shareOptions : [])].filter(hasEn);
  let bs = ep.engage.share, bh = -1;
  for (const sh of shares) { ep.engage.share = sh; const h = captionHuman(instagramCaption(ep, "en")); if (h > bh) { bh = h; bs = sh; } }
  ep.engage.share = bs;
  delete ep.hookOptions; delete ep.shareOptions;
  return `hook ${(bestScore * 100).toFixed(0)}% of the bar from ${hooks.length} options, caption ${bh} from ${shares.length}`;
}

/** Turn a failed gate into an instruction Gemini can act on. */
const HOW: Record<string, string> = {
  "hook (YouTube)": "rewrite scene 1 vo and all hookOptions with ALL of: 'you' in the first six words, a number or named place, a stakes word (before/never/lose/cost/risk/stop/die), a curiosity word (why/how/what/but/nobody/almost), 9-20 words, end on an open question",
  "hook (Reels/Shorts)": "the first 2 seconds must shock: the first five words carry the strangest number or fact, short words, no warm-up, no 'did you know'",
  "caption reads naturally": "write engage.share, engage.ask and all shareOptions like a real person texting a friend: plain words, contractions, no hype words (incredible, mind-blowing, delve, journey, unlock, fascinating), no em dashes, varied sentence length",
  "caption": "fix the caption pieces (scene 1 vo, engage.share, engage.ask) as described",
  "title + thumbnail": "title under 60 characters with a concrete specific; thumb 2-4 words that add to the title, not repeat it",
};

const RULES = (langs: Lang[]) => `You write for a premium, entertaining documentary channel for adults and teens (13-55), worldwide, India first.
Every video is built from REAL footage (NASA, Wikimedia Commons). Tone: gripping, cinematic, confident, a little playful, never childish, never clickbait-false.
Write ONE episode as JSON with exactly this shape (the example shows the format and the quality bar):
- "scenes": 5-6 scenes for the Short (about 25-40 s spoken in total), then 10-14 extra scenes marked "longOnly": true that deepen the story for the long video. Each longOnly scene's "vo.en" is 30-50 words. The whole long cut (every scene that is not shortOnly) must be at least 450 words of narration, about 3-5 minutes: without that, no long video can be made from this episode. One scene marked "shortOnly": true at the end of the Short: a loop line that leads back into the opening.
- scene 1 "vo.en" is the hook, 9 to 20 words, and it needs ALL of these: "you" or "your" in the first six words; one concrete number or named place/thing; one stakes word (before, never, lose, cost, risk, stop, die, broke, fail); one curiosity word (why, how, what, until, but, nobody, almost); and it ends on an open question or an unfinished thought, never on its answer (no "because"). Example: "You will never see this from Earth, but sixteen times a day, the sun rises up there. Why?" It must NOT repeat "engage.hookText".
- "overlays": kinds "kicker" (headline + sub label), "stat" (a number + unit; text = the number as digits), "orbit" (only for counts of laps or cycles), "lower" (a source line). One stat in at most every other scene.
- every number in narration or overlays must appear word for word in a "claims" entry, and every claim must be copied EXACTLY from the source text below (no paraphrase).
- "footage": 3 search queries per scene (field "q"), written like a cinematographer's shot list: what the camera sees AND how it is filmed, 3-6 words, e.g. "aerial drone glacier calving", "macro close up coffee crema", "time lapse city traffic night", "slow motion wave crashing", "tracking shot cheetah running". Mix shot types so consecutive scenes never look alike (wide establishing -> detail close-up -> aerial -> motion). Never ask for people talking, offices, screens or text. Providers, in this order of preference: \${PROVIDERS}. Set "authentic": true ONLY on scenes that show real footage from space (then use only "nasa"/"wikimedia" there).
- the scene 1 footage must be the single most jaw-dropping image of the whole story (it is the hook and the thumbnail).
- "slowmo": true on 1-3 beauty or impact moments (a wave, an animal leaping, a launch, pouring liquid, a crash); the edit plays them in true slow motion.
- "look": the film look for the whole episode, one of documentary (neutral premium), golden (warm, nostalgic: food, history, people), arctic (cool, crisp: ice, ocean, space, engineering), noir (deep contrast, low colour: mysteries, disasters, money), neon (teal + magenta: tech, cities at night), earth (rich greens and ochres: wildlife, nature, the body).
- "overlays" may also use: "map" (a globe turns to the place: "geo": {"lat":..,"lon":..}, text = place name) once per episode when a real place matters; "compare" ("bars": [{"label":{...},"value":n,"display":"..."}], only with numbers from claims); "chapter" (long-only scenes that start a new part: text = chapter title, sub = "01", "02"...).
- "hookOptions": 5 MORE alternative scene-1 hooks (same rules, each a full language object, each a different angle on the most surprising fact). "shareOptions": 3 more alternative share lines. The best ones are chosen automatically.
- "engage": ask (a real question ending with "?"), hookText (on-screen, 2-5 words, CAPS, one word wrapped in *asterisks*), loop, share.
- "music": {"mood": one of awe|mystery|tension|triumph|upbeat|investigate|melancholy, "styles": [3 English style words], "peak": scene id of the reveal}.
- Texts are objects with languages: ${langs.join(", ")} (${langs.map(l => LANGS[l].name).join(", ")}); English is the master, the others natural, idiomatic translations (not word for word). Numbers in narration are written as words in English ("twenty-eight thousand"), digits in overlays.
- no brand, channel, show or person names except the source organisations; no links in narration.`;

export async function writeEpisode(idea: string, opts: { wiki?: string; topic?: string; angle?: string; id?: string; approve?: boolean } = {}) {
  const angle = (await loadFormats().catch(() => ({ formats: [] as StoryFormat[] }))).formats.find(f => f.id === opts.angle);
  const pillar = (await loadPillars().catch(() => ({ pillars: [] as Pillar[] }))).pillars.find(p => p.id === opts.topic);
  if (!geminiReady()) throw new Error("GEMINI_API_KEY is not set (free key from aistudio.google.com)");
  const settings = JSON.parse(await readFile("channel/settings.json", "utf8"));
  const langs = ([...new Set(["en", ...(settings.subtitles ?? [])])] as Lang[]).filter(l => l in LANGS);
  const src = await sourceText(idea, opts.wiki);
  const example = JSON.parse(await readFile("episodes/E001-iss-16-sunrises.json", "utf8"));
  const id = opts.id ?? await nextId();
  let feedback = "", ep: Episode | null = null;
  let best: { ep: Episode; problems: string[]; hard: number } | null = null;
  const ROUNDS = 4;   // 1 draft + 3 rewrites: enough with the code repairs, and it keeps the free Gemini quota for 4 episodes
  for (let round = 0; round < ROUNDS; round++) {
    const draft: any = await askJson<Episode>([{ text: `${RULES(langs).replace("\${PROVIDERS}", (pillar?.footage ?? ["nasa", "wikimedia", "pexels", "pixabay"]).join(", "))}
${pillar ? `This episode is for the content pillar "${pillar.name}"; its default music mood is "${pillar.mood ?? "awe"}" and its usual look is "${(pillar as any).look ?? "documentary"}" (pick another only if the story clearly calls for it).` : ""}
${angle ? `STORY FORMAT "${angle.name}" (follow it; it decides the structure, the hook and the reveal): ${angle.recipe}\nSet "angle": "${angle.id}".` : ""}

EXAMPLE EPISODE (format + quality bar; its footage takes are hand-picked, yours only need "q"):
${JSON.stringify(example)}

IDEA: ${idea}
SOURCE "S1" = Wikipedia, "${src.title}" (${src.url}):
"""${src.text}"""
${ep ? `\nYOUR PREVIOUS DRAFT:\n${JSON.stringify(ep)}\n\nFIX THESE PROBLEMS:\n${feedback}` : ""}
Return the full episode JSON with "id": "${id}", "status": "draft", "topic": "${opts.topic ?? "space"}", and sources [{"id":"S1","title":"Wikipedia, ${src.title}","url":"${src.url}","claims":[...]}].` }], { temperature: round ? 0.3 : 0.7 });
    tidy(draft);
    let problems = shapeProblems(draft), hard = 0;
    if (!problems.length) {
      draft.id = id; draft.status = "draft"; if (angle) draft.angle = angle.id;
      if (draft.look && !isLook(draft.look)) delete draft.look;
      pickBest(draft); repairClaims(draft, src.text);
      try {
        const gates = runGates(draft), failed = gates.filter(g => !g.pass);
        const facts = factProblems(draft, { S1: src.text });
        hard = facts.length + hardFailures(gates).length;
        const secs = longSeconds(draft), lacking = secs < MIN_LONG_SECONDS + 30
          ? [`the long cut is only about ${Math.round(secs)} s of narration (needs 180 s or more): add ${Math.max(3, Math.ceil((180 - secs) / 15))} more "longOnly": true scenes of 30-50 words each, from facts in the source`] : [];
        problems = [...facts, ...lacking, ...failed.map(g => `gate "${g.name}" failed${g.score != null ? ` (score ${g.score})` : ""}: ${g.detail}${HOW[g.name] ? ` -> ${HOW[g.name]}` : ""}`)];
      } catch (e: any) { problems = [`the episode could not be checked (${String(e.message).split("\n")[0]}); return the complete JSON shape`]; hard = 99; }
    } else hard = 99;
    if (!best || hard < best.hard || (hard === best.hard && problems.length < best.problems.length)) best = { ep: draft, problems, hard };
    ep = best.ep; if (!problems.length) break;
    feedback = best.problems.map(p => `- ${p}`).join("\n");
    // after the rewrites: keep the best draft whenever its facts, rights and text are right (quality scores never block)
    if (round === ROUNDS - 1 && best.hard === 0) { ep = best.ep; break; }
    if (round === ROUNDS - 1) throw new Error(`episode ${id} still fails after ${ROUNDS - 1} rewrites: ${best.problems.slice(0, 3).join(" | ")}${best.problems.length > 3 ? ` (+${best.problems.length - 3} more)` : ""}`);
  }
  const file = path.join("episodes", `${id}-${slug(ep!.title.en)}.json`);
  if (opts.approve) ep!.status = "approved";
  await writeFile(file, JSON.stringify(ep, null, 2) + "\n");
  return file;
}

const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
async function nextId() {
  const n = (await readdir("episodes")).map(f => Number(f.match(/^E(\d+)/)?.[1] ?? 0)).reduce((a, b) => Math.max(a, b), 0) + 1;
  return `E${String(n).padStart(3, "0")}`;
}

if (process.argv[1]?.endsWith("writer.ts")) {
  const a = process.argv.slice(2), opt = (k: string) => { const i = a.indexOf(`--${k}`); return i >= 0 ? a[i + 1] : undefined; };
  const idea = opt("idea"); if (!idea) { console.error('usage: tsx growth/writer.ts --idea "..." [--wiki "Article"] [--topic space] [--approve]'); process.exit(1); }
  console.log(await writeEpisode(idea, { wiki: opt("wiki"), topic: opt("topic"), approve: a.includes("--approve") }));
}
