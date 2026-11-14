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
