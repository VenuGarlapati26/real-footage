// One polite HTTP client for every outside source (Wikipedia, Wikimedia Commons, NASA, trend APIs).
// - A user agent that names the project and a contact page, as Wikimedia's policy requires: requests without one are
//   throttled hard from shared cloud computers like GitHub's ("You are making too many requests...").
// - Every reply is checked: a 429/5xx is retried after the time the server asks for (Retry-After) or a growing pause,
//   and a reply that is not JSON fails with a clear message instead of "Unexpected token".
export const UA = process.env.HTTP_UA ?? "LumoraBot/1.0 (https://venugarlapati26.github.io/lumora/; real-footage documentary research)";

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
const PAUSES = (process.env.HTTP_RETRY_MS ?? "3000,8000,20000,45000").split(",").map(Number);

/** fetch with the project user agent, retrying 429 and 5xx. Returns the final Response (ok or not). */
export async function politeFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const headers = { "user-agent": UA, "api-user-agent": UA, ...(init.headers as Record<string, string> ?? {}) };
  for (let i = 0; ; i++) {
    const r = await fetch(url, { ...init, headers });
    if ((r.status !== 429 && r.status < 500) || i >= PAUSES.length) return r;
    const ra = Number(r.headers.get("retry-after"));
    await r.body?.cancel().catch(() => {});
    await sleep(Number.isFinite(ra) && ra > 0 ? Math.min(ra * 1000, 120_000) : PAUSES[i]);
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
