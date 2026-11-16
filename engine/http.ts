// One polite HTTP client for every outside source (Wikipedia, Wikimedia Commons, NASA, trend APIs).
// - A user agent that names the project and a contact page, as Wikimedia's policy requires: requests without one are
//   throttled hard from shared cloud computers like GitHub's ("You are making too many requests...").
// - Every reply is checked: a 429/5xx is retried after the time the server asks for (Retry-After) or a growing pause,
//   and a reply that is not JSON fails with a clear message instead of "Unexpected token".
export const UA = process.env.HTTP_UA ?? "LumoraBot/1.0 (https://venugarlapati26.github.io/lumora/; real-footage documentary research)";

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const PAUSES = (process.env.HTTP_RETRY_MS ?? "3000,8000,20000,45000").split(",").map(Number);

// A site that still refuses after all retries is left alone for a while (circuit breaker): otherwise every following
// file on it waits the full retry ladder again, and one rate-limited site can stall a whole run.
const cooling = new Map<string, number>();
const COOL_MS = () => Number(process.env.HTTP_COOL_MS ?? 15 * 60_000);

/** fetch with the project user agent, retrying 429 and 5xx. Returns the final Response (ok or not). */
export async function politeFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const headers = { "user-agent": UA, "api-user-agent": UA, ...(init.headers as Record<string, string> ?? {}) };
  const host = new URL(url).host;
  if ((cooling.get(host) ?? 0) > Date.now()) return new Response(`${host} is rate-limiting this run; skipped`, { status: 429 });
  for (let i = 0; ; i++) {
    let r: Response;
    try { r = await fetch(url, { ...init, headers }); }
    catch (e) { if (i >= PAUSES.length) throw e; await sleep(PAUSES[i]); continue; }   // network drop: wait and retry
    if (r.status !== 429 && r.status < 500) return r;
    if (i >= PAUSES.length) { if (r.status === 429) cooling.set(host, Date.now() + COOL_MS()); return r; }
    const ra = Number(r.headers.get("retry-after"));
    await r.body?.cancel().catch(() => {});
    await sleep(Number.isFinite(ra) && ra > 0 ? Math.min(ra * 1000, 30_000) : PAUSES[i]);
  }
}

/** GET JSON politely; throws a readable error when the server refuses or answers with something that is not JSON. */
export async function getJson<T = any>(url: string, init: RequestInit = {}): Promise<T> {
  const r = await politeFetch(url, init);
  const text = await r.text();
  if (!r.ok) throw new Error(`${new URL(url).host} answered ${r.status}: ${text.slice(0, 120).replace(/\s+/g, " ")}`);
  try { return JSON.parse(text) as T; }
  catch { throw new Error(`${new URL(url).host} did not answer with JSON: ${text.slice(0, 120).replace(/\s+/g, " ")}`); }
}
