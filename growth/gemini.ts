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
const workingFor = new Map<string, string>();   // per model list: the first model that answered
const exhausted = new Set<string>();   // models whose free daily quota is used up in this run
/** "You exceeded your current quota": the per-day free limit (move to the next model; each has its own quota), or a
 *  per-minute one (wait the few seconds Google asks for). Returns seconds to wait, or "day". */
export function quotaKind(status: number, raw: string): number | "day" | null {
  if (status !== 429 && !/exceeded your current quota|RESOURCE_EXHAUSTED/i.test(raw)) return null;
  if (/per.?day|PerDay|daily/i.test(raw)) return "day";
  const m = raw.match(/retry in ([\d.]+)s|"retryDelay":\s*"(\d+)s"/i), secs = m ? Number(m[1] ?? m[2]) : NaN;
  if (Number.isFinite(secs) && secs <= 90) return secs;
  return /exceeded your current quota/i.test(raw) ? "day" : 20;
}
export class GeminiQuotaError extends Error {}
export const MODEL = () => workingFor.get(MODELS().join(",")) ?? MODELS()[0];
/** Footage picking needs many small requests: it uses the lighter models first (bigger free daily limits), so the
 *  writer keeps the strongest model's quota. GEMINI_CURATE_MODEL overrides. */
export const CURATE_MODELS = () => (process.env.GEMINI_CURATE_MODEL ?? "gemini-3.5-flash-lite,gemini-3.1-flash-lite,gemini-flash-lite-latest,gemini-3.5-flash,gemini-3.8-flash").split(",").map(m => m.trim()).filter(Boolean);
/** A refusal that means "this model is not for you" (retired, renamed, not on your tier), so the next model may work. */
export const modelUnavailable = (status: number, msg: string) =>
  status === 404 || (status === 403 && /model|permission/i.test(msg)) || /no longer available|not found|not supported|is not available|limit: 0|free.?tier/i.test(msg);

/** A Gemini reply as one object: plain JSON, or a server-sent-event stream whose chunks are merged (text parts joined). */
export function readGemini(body: string): any {
  const t = body.trim();
  if (!t.startsWith("data:")) { try { return JSON.parse(t); } catch { return {}; } }
  const chunks = t.split(/\r?\n/).filter(l => l.startsWith("data:")).map(l => { try { return JSON.parse(l.slice(5).trim()); } catch { return {}; } });
  const err = chunks.find(c => c.error); if (err) return err;
  const text = chunks.flatMap(c => c.candidates?.[0]?.content?.parts ?? []).map((p: any) => p.text ?? "").join("");
  return { candidates: [{ content: { parts: [{ text }] } }] };
}

export type Part = { text: string } | { inline_data: { mime_type: string; data: string } };

/** One JSON answer. Retries on rate limits (free tier: a few requests a minute); moves to the next model when one is
 *  retired or not available on this key. */
export async function askJson<T>(parts: Part[], opts: { temperature?: number; tries?: number; models?: string[] } = {}): Promise<T> {
  const key = process.env.GEMINI_API_KEY; if (!key) throw new Error("GEMINI_API_KEY is not set");
  const list = opts.models ?? MODELS(), lk = list.join(","), working = workingFor.get(lk);
  const all = list.filter(m => !exhausted.has(m));
  const models = working && !exhausted.has(working) ? [working, ...all.filter(m => m !== working)] : all;
  let last = "";
  for (const model of models) {
    let skip = false;
    for (let i = 0; i < (opts.tries ?? 4) && !skip; i++) {
      // streamed: the first bytes arrive at once, so a model that "thinks" for minutes never hits Node's 5-minute
      // wait-for-headers limit ("fetch failed"); network drops are retried like rate limits
      let r: Response;
      try {
        r = await fetch(`${BASE()}/v1beta/models/${model}:streamGenerateContent?alt=sse&key=${key}`, { method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ contents: [{ role: "user", parts }], generationConfig: { responseMimeType: "application/json", temperature: opts.temperature ?? 0.4 } }) });
      } catch (e: any) { last = `${model}: network ${e.cause?.code ?? e.message}`; await new Promise(res => setTimeout(res, Number(process.env.GEMINI_RETRY_MS ?? 20000) * (i + 1))); continue; }
      let body = "";
      try { body = await r.text(); } catch (e: any) { last = `${model}: stream cut ${e.cause?.code ?? e.message}`; await new Promise(res => setTimeout(res, Number(process.env.GEMINI_RETRY_MS ?? 20000) * (i + 1))); continue; }
      const j: any = readGemini(body), msg = String(j.error?.message ?? ""), raw = JSON.stringify(j.error ?? {});
      const q = r.ok ? null : quotaKind(r.status, raw);
      if (q === "day") { exhausted.add(model); if (workingFor.get(lk) === model) workingFor.delete(lk); last = `${model}: free daily limit used up`; skip = true; break; }
      if (typeof q === "number") { last = `${model}: per-minute limit`; await new Promise(res => setTimeout(res, Math.min(q * 1000 + 1000, Number(process.env.GEMINI_RETRY_MS ?? 90_000)))); continue; }
      if (!r.ok && modelUnavailable(r.status, msg)) { last = `${model}: ${msg.slice(0, 160)}`; skip = true; break; }
      if (r.status === 429 || r.status >= 500) { last = `${model}: ${r.status} ${msg.slice(0, 120)}`; await new Promise(res => setTimeout(res, Number(process.env.GEMINI_RETRY_MS ?? 20000) * (i + 1))); continue; }
      if (!r.ok) throw new Error(`gemini ${model} ${r.status}: ${msg}`);
      workingFor.set(lk, model);
      const text = (j.candidates?.[0]?.content?.parts ?? []).map((p: any) => p.text ?? "").join("");
      try { return JSON.parse(text.replace(/^```(json)?|```$/g, "").trim()) as T; } catch { last = `bad JSON: ${text.slice(0, 200)}`; }
    }
  }
  if (list.every(m => exhausted.has(m))) throw new GeminiQuotaError("Gemini free daily limit is used up on every model; it resets at midnight Pacific time (13:30 IST), and the next review carries on");
  throw new Error(`gemini failed: ${last}`);
}
