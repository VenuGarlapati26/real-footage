// Search demand for idea phrases (optional; the radar works without it).
//
//   SEMRUSH_API_KEY                       Semrush API (needs a Semrush Business plan + API units; expensive)
//   DATAFORSEO_LOGIN + DATAFORSEO_PASSWORD DataForSEO Google Ads volumes (pay as you go, far cheaper than Semrush)
//
// Both return monthly Google search volume for India. YouTube autocomplete (growth/trends.ts) stays the free signal.

export type Volume = { phrase: string; volume: number; difficulty?: number; source: string };

const SEMRUSH = () => process.env.SEMRUSH_BASE ?? "https://api.semrush.com";
const DFS = () => process.env.DATAFORSEO_BASE ?? "https://api.dataforseo.com";

export function keywordProvider(): "semrush" | "dataforseo" | null {
  if (process.env.SEMRUSH_API_KEY) return "semrush";
  if (process.env.DATAFORSEO_LOGIN && process.env.DATAFORSEO_PASSWORD) return "dataforseo";
  return null;
}

/** Semrush "phrase_these": up to 100 phrases per call, semicolon-separated CSV back. */
async function semrush(phrases: string[], db: string): Promise<Volume[]> {
  const u = `${SEMRUSH()}/?type=phrase_these&key=${process.env.SEMRUSH_API_KEY}&database=${db}&export_columns=Ph,Nq,Kd&phrase=${encodeURIComponent(phrases.slice(0, 100).join(";"))}`;
  const text = await (await fetch(u)).text();
  if (text.startsWith("ERROR")) throw new Error(`semrush: ${text.trim()}`);
  return text.trim().split(/\r?\n/).slice(1).map(l => l.split(";")).filter(c => c.length >= 2)
    .map(([ph, nq, kd]) => ({ phrase: ph, volume: Number(nq) || 0, difficulty: kd ? Number(kd) : undefined, source: "semrush" }));
}

/** DataForSEO Google Ads search volume (India = location 2356). */
async function dataforseo(phrases: string[], lang: string): Promise<Volume[]> {
  const auth = Buffer.from(`${process.env.DATAFORSEO_LOGIN}:${process.env.DATAFORSEO_PASSWORD}`).toString("base64");
  const r = await fetch(`${DFS()}/v3/keywords_data/google_ads/search_volume/live`, { method: "POST", headers: { authorization: `Basic ${auth}`, "content-type": "application/json" },
    body: JSON.stringify([{ keywords: phrases.slice(0, 1000), location_code: 2356, language_code: lang }]) });
  const j: any = await r.json();
  return (j.tasks?.[0]?.result ?? []).map((x: any) => ({ phrase: x.keyword, volume: Number(x.search_volume) || 0, difficulty: x.competition_index ?? undefined, source: "dataforseo" }));
}

export async function volumes(phrases: string[], lang: "hi" | "en" = "hi"): Promise<Volume[]> {
  const p = keywordProvider(); if (!p || !phrases.length) return [];
  return p === "semrush" ? semrush(phrases, "in") : dataforseo(phrases, lang);
}

/** Add demand to ranked ideas: log-scaled, so 10x the searches is a nudge, not a takeover. Pure (tested offline). */
export function withDemand<T extends { idea: string; score: number; why: string[] }>(ideas: T[], vols: Volume[]): T[] {
  const by = new Map(vols.map(v => [v.phrase.toLowerCase(), v]));
  return ideas.map(i => {
    const v = by.get(i.idea.toLowerCase()); if (!v || v.volume <= 0) return i;
    const bump = Math.log10(v.volume) * 1.5;
    return { ...i, score: +(i.score + bump).toFixed(1), why: [...i.why, `${v.volume.toLocaleString("en-IN")} searches/month on Google (${v.source}${v.difficulty != null ? `, difficulty ${v.difficulty}` : ""})`] };
  }).sort((a, b) => b.score - a.score);
}
