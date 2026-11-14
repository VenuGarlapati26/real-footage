// Gemini (free tier, GEMINI_API_KEY from aistudio.google.com). Used for two jobs only:
//   - writing episode scripts from a source text (growth/writer.ts)
//   - choosing the best takes from contact sheets of real footage (engine/curate.ts)
// Free-tier prompts may be used by Google to improve its products; nothing private is sent (public sources and
// public-domain footage only).

const BASE = () => process.env.GEMINI_BASE ?? "https://generativelanguage.googleapis.com";
export const geminiReady = () => !!process.env.GEMINI_API_KEY;
/** Models to try, newest first. Google retires and renames models often (gemini-2.5-flash is closed to new keys since
 *  late 2026), so the client walks this list and keeps the first one this key may use. GEMINI_MODEL forces one. */
export const MODELS = () => (process.env.GEMINI_MODEL ?? "gemini-3.8-flash,gemini-3.5-flash,gemini-3.5-flash-lite,gemini-3.1-flash-lite,gemini-flash-latest,gemini-2.5-flash").split(",").map(m => m.trim()).filter(Boolean);
let working: string | undefined;
export const MODEL = () => working ?? MODELS()[0];
/** A refusal that means "this model is not for you" (retired, renamed, not on your tier), so the next model may work. */
export const modelUnavailable = (status: number, msg: string) =>
  status === 404 || (status === 403 && /model|permission/i.test(msg)) || /no longer available|not found|not supported|is not available|limit: 0|free.?tier/i.test(msg);

export type Part = { text: string } | { inline_data: { mime_type: string; data: string } };

/** One JSON answer. Retries on rate limits (free tier: a few requests a minute); moves to the next model when one is
 *  retired or not available on this key. */
export async function askJson<T>(parts: Part[], opts: { temperature?: number; tries?: number } = {}): Promise<T> {
  const key = process.env.GEMINI_API_KEY; if (!key) throw new Error("GEMINI_API_KEY is not set");
  const models = working ? [working] : MODELS();
  let last = "";
  for (const model of models) {
    let skip = false;
    for (let i = 0; i < (opts.tries ?? 4) && !skip; i++) {
      const r = await fetch(`${BASE()}/v1beta/models/${model}:generateContent?key=${key}`, { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ contents: [{ role: "user", parts }], generationConfig: { responseMimeType: "application/json", temperature: opts.temperature ?? 0.4 } }) });
      const j: any = await r.json().catch(() => ({})), msg = String(j.error?.message ?? "");
      if (!r.ok && modelUnavailable(r.status, msg)) { last = `${model}: ${msg.slice(0, 160)}`; skip = true; break; }
      if (r.status === 429 || r.status >= 500) { last = `${model}: ${r.status} ${msg.slice(0, 120)}`; await new Promise(res => setTimeout(res, Number(process.env.GEMINI_RETRY_MS ?? 20000) * (i + 1))); continue; }
      if (!r.ok) throw new Error(`gemini ${model} ${r.status}: ${msg}`);
      working = model;
      const text = (j.candidates?.[0]?.content?.parts ?? []).map((p: any) => p.text ?? "").join("");
      try { return JSON.parse(text.replace(/^```(json)?|```$/g, "").trim()) as T; } catch { last = `bad JSON: ${text.slice(0, 200)}`; }
    }
  }
  throw new Error(`gemini failed: ${last}`);
}
