// Gemini (free tier, GEMINI_API_KEY from aistudio.google.com). Used for two jobs only:
//   - writing episode scripts from a source text (growth/writer.ts)
//   - choosing the best takes from contact sheets of real footage (engine/curate.ts)
// Free-tier prompts may be used by Google to improve its products; nothing private is sent (public sources and
// public-domain footage only).

const BASE = () => process.env.GEMINI_BASE ?? "https://generativelanguage.googleapis.com";
export const geminiReady = () => !!process.env.GEMINI_API_KEY;
export const MODEL = () => process.env.GEMINI_MODEL ?? "gemini-2.5-flash";

export type Part = { text: string } | { inline_data: { mime_type: string; data: string } };

/** One JSON answer. Retries on rate limits (free tier: a few requests a minute). */
export async function askJson<T>(parts: Part[], opts: { temperature?: number; tries?: number } = {}): Promise<T> {
  const key = process.env.GEMINI_API_KEY; if (!key) throw new Error("GEMINI_API_KEY is not set");
  let last = "";
  for (let i = 0; i < (opts.tries ?? 4); i++) {
    const r = await fetch(`${BASE()}/v1beta/models/${MODEL()}:generateContent?key=${key}`, { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ contents: [{ role: "user", parts }], generationConfig: { responseMimeType: "application/json", temperature: opts.temperature ?? 0.4 } }) });
    if (r.status === 429 || r.status >= 500) { last = `${r.status}`; await new Promise(res => setTimeout(res, Number(process.env.GEMINI_RETRY_MS ?? 20000) * (i + 1))); continue; }
    const j: any = await r.json(); if (!r.ok) throw new Error(`gemini ${r.status}: ${j.error?.message ?? ""}`);
    const text = (j.candidates?.[0]?.content?.parts ?? []).map((p: any) => p.text ?? "").join("");
    try { return JSON.parse(text.replace(/^```(json)?|```$/g, "").trim()) as T; } catch { last = `bad JSON: ${text.slice(0, 200)}`; }
  }
  throw new Error(`gemini failed: ${last}`);
}
