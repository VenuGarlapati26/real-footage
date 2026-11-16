// The polite HTTP client and the trend filter: Wikipedia's "You are making too many requests" (plain-text 429) must be
// waited out and retried, and news/war/politics never become episode ideas.
import assert from "node:assert/strict";
import http from "node:http";

process.env.HTTP_RETRY_MS = "20,40,60";
let calls = 0, mode = "busy-then-ok";
const seenUA: string[] = [];
const srv = http.createServer((req, res) => {
  calls++; seenUA.push(String(req.headers["user-agent"]));
  const busy = () => { res.writeHead(429, { "content-type": "text/plain", "retry-after": "0" }); res.end("You are making too many requests. Please slow down."); };
  if (mode === "always-busy") return busy();
  if (mode === "busy-then-ok" && calls <= 2) return busy();
  const u = new URL(req.url!, "http://x");
  res.writeHead(200, { "content-type": "application/json" });
  if (u.searchParams.get("list") === "search") return res.end(JSON.stringify({ query: { search: [{ title: "Deep sea" }] } }));
  res.end(JSON.stringify({ query: { pages: { 1: { title: "Deep sea", extract: "The deep sea is the lowest layer in the ocean, below 200 metres." } } } }));
});
await new Promise<void>(r => srv.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${(srv.address() as any).port}`;
process.env.WIKI_API = `${base}/w/api.php`;

const { getJson, UA } = await import("../engine/http");
const { sourceText } = await import("../growth/writer");
const { allowedIdea, rank } = await import("../growth/trends");

// 1. two "too many requests" replies, then the article: the writer still gets its source text
const src = await sourceText("Deep sea");
assert.equal(src.title, "Deep sea"); assert.match(src.text, /lowest layer/);
assert.ok(calls >= 3, "retried after the 429s");
assert.ok(seenUA.every(u => u === UA) && /https?:\/\//.test(UA), "every request names the project and a contact URL");

// 2. still refusing after all retries: a readable error, never "Unexpected token 'Y'"
mode = "always-busy";
await assert.rejects(getJson(`${base}/x`), (e: Error) => /answered 429: You are making too many requests/.test(e.message) && !/Unexpected token/.test(e.message));

// 3. the trend radar never turns news, war, politics or clickbait into ideas
for (const bad of ["LIVE: Iran Launches Retaliatory Strike on US Radar in Bahrain", "We Filmed The US Military During an ISIS Conflict in Iraq",
  "SpaceX Just Made Rocket History! #shorts #viral", "Election results explained"]) assert.equal(allowedIdea(bad), false, bad);
for (const ok of ["Deep sea creatures that glow", "Why Tata bought 470 planes for Air India", "Watch 6% illuminated Moon, Venus and Jupiter"]) assert.equal(allowedIdea(ok), true, ok);
const ideas = rank({ outliers: [{ title: "LIVE: missile strike", multiple: 30, formula: "", url: "u", views: 1 }, { title: "The deepest hole on Earth", multiple: 5, formula: "", url: "u", views: 1 }],
  wiki: [], suggest: {}, seeds: [], weights: {} });
assert.deepEqual(ideas.map(i => i.idea), ["The deepest hole on Earth"]);

srv.close();
console.log("http + trend filter tests: all passed");

// 4. Gemini: a retired model ("no longer available to new users", 404) -> the next model in the list, then remembered
{
  const hits: string[] = [];
  const g = http.createServer((req, res) => {
    const model = req.url!.split("/models/")[1].split(":")[0]; hits.push(model);
    res.setHeader("content-type", "application/json");
    if (model === "old-model") { res.writeHead(404); return res.end(JSON.stringify({ error: { code: 404, message: "This model models/old-model is no longer available to new users. Please update your code." } })); }
    res.end(JSON.stringify({ candidates: [{ content: { parts: [{ text: '{"ok":true}' }] } }] }));
  });
  await new Promise<void>(r => g.listen(0, "127.0.0.1", r));
  Object.assign(process.env, { GEMINI_BASE: `http://127.0.0.1:${(g.address() as any).port}`, GEMINI_API_KEY: "k", GEMINI_MODEL: "old-model,new-model" });
  const { askJson, MODEL } = await import("../growth/gemini");
  assert.deepEqual(await askJson<any>([{ text: "hi" }]), { ok: true });
  assert.deepEqual(hits, ["old-model", "new-model"]); assert.equal(MODEL(), "new-model");
  await askJson([{ text: "again" }]); assert.deepEqual(hits.slice(2), ["new-model"], "the working model is remembered");
  g.close();
  console.log("gemini model fallback tests: all passed");
}

// 5. streamed Gemini replies (server-sent events) are merged into one answer; errors inside the stream are surfaced
{
  const { readGemini } = await import("../growth/gemini");
  const sse = 'data: {"candidates":[{"content":{"parts":[{"text":"{\\"a\\":"}]}}]}\r\n\r\ndata: {"candidates":[{"content":{"parts":[{"text":"1}"}]}}]}\r\n\r\n';
  assert.equal(readGemini(sse).candidates[0].content.parts[0].text, '{"a":1}');
  assert.equal(readGemini('data: {"error":{"code":404,"message":"no longer available"}}\n\n').error.code, 404);
  assert.equal(readGemini('{"candidates":[{"content":{"parts":[{"text":"x"}]}}]}').candidates[0].content.parts[0].text, "x");
  console.log("gemini stream tests: all passed");
}

// 6. free daily quota: that model is set aside for the run and the next one answers; per-minute limits are waited out
{
  const { quotaKind } = await import("../growth/gemini");
  assert.equal(quotaKind(429, '{"message":"You exceeded your current quota, please check your plan and billing details.","details":[{"quotaId":"GenerateRequestsPerDayPerProjectPerModel-FreeTier"}]}'), "day");
  assert.equal(quotaKind(429, '{"message":"You exceeded your current quota. Please retry in 31.2s.","details":[{"quotaId":"GenerateRequestsPerMinutePerProjectPerModel-FreeTier"}]}'), 31.2);
  assert.equal(quotaKind(429, '{"message":"You exceeded your current quota, please check your plan and billing details."}'), "day");
  assert.equal(quotaKind(500, '{"message":"internal"}'), null);
  const hits: string[] = [];
  const g = http.createServer((req, res) => {
    const model = req.url!.split("/models/")[1].split(":")[0]; hits.push(model);
    res.setHeader("content-type", "application/json");
    if (model === "big") { res.writeHead(429); return res.end(JSON.stringify({ error: { code: 429, message: "You exceeded your current quota, please check your plan and billing details." } })); }
    res.end(JSON.stringify({ candidates: [{ content: { parts: [{ text: '{"ok":2}' }] } }] }));
  });
  await new Promise<void>(r => g.listen(0, "127.0.0.1", r));
  process.env.GEMINI_BASE = `http://127.0.0.1:${(g.address() as any).port}`;
  const { askJson, GeminiQuotaError } = await import("../growth/gemini");
  assert.deepEqual(await askJson<any>([{ text: "x" }], { models: ["big", "lite"] }), { ok: 2 });
  assert.deepEqual(hits, ["big", "lite"], "one try on the used-up model, then the next");
  await askJson([{ text: "y" }], { models: ["big", "lite"] }); assert.deepEqual(hits.slice(2), ["lite"], "the used-up model is not asked again");
  await assert.rejects(askJson([{ text: "z" }], { models: ["big"] }), (e: any) => e instanceof GeminiQuotaError && /resets/.test(e.message));
  g.close();
  console.log("gemini quota tests: all passed");
}

// 7. footage downloads have a size cap (the runner's disk), and a missing Commons transcode falls back
{
  process.env.FOOTAGE_MAX_MB = "0.001"; process.env.FOOTAGE_CACHE = (await import("node:os")).tmpdir() + "/p2-cap-" + Date.now();
  const f = http.createServer((req, res) => {
    if (req.url === "/big.mp4") { res.writeHead(200, { "content-length": "5000" }); return res.end(Buffer.alloc(5000)); }
    res.writeHead(404); res.end("no");
  });
  await new Promise<void>(r => f.listen(0, "127.0.0.1", r));
  const b = `http://127.0.0.1:${(f.address() as any).port}`;
  const { download } = await import("../engine/footage");
  const c = { provider: "wikimedia" as const, id: "x", title: "x", credit: "c", license: "PD", page: "" };
  await assert.rejects(download({ ...c, url: `${b}/big.mp4` }), /too big/);
  await assert.rejects(download({ ...c, url: `${b}/missing.webm`, fallback: `${b}/big.mp4` }), /too big/, "fell back to the second address");
  f.close(); delete process.env.FOOTAGE_MAX_MB;
  console.log("footage size cap tests: all passed");
}
