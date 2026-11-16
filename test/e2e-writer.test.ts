// END TO END: the weekly writer gets the kind of reply Gemini really sends (every mistake seen in the live runs at once)
// and must still produce an episode that the daily run accepts. Mock Gemini + mock Wikipedia, real gates and repairs.
import assert from "node:assert/strict";
import http from "node:http";
import { cpSync, mkdtempSync, readFileSync, readdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const root = process.cwd();
const sample = JSON.parse(readFileSync("episodes/E001-iss-16-sunrises.json", "utf8"));
const claims: string[] = sample.sources.flatMap((s: any) => s.claims);
const SOURCE = `The International Space Station orbits Earth. ${claims.map(c => c.trim().replace(/[.]?$/, ".")).join(" ")} It is a joint project.`;

// the draft Gemini "writes": a copy of the sample with the live-run mistakes put back in
function sloppy() {
  const d: any = structuredClone(sample);
  d.id = "E999"; d.status = "approved";
  d.sources = [{ id: "S1", title: "Wikipedia, International Space Station", url: "https://en.wikipedia.org/wiki/International_Space_Station", claims: [...claims] }];
  for (const sc of d.scenes) { delete sc.sources; sc.footage = sc.footage.filter((f: any) => f.provider !== "local").slice(0, 1); }   // no source tags, thin footage
  d.scenes[1].overlays = [...(d.scenes[1].overlays ?? []), { kind: "stat", text: "92" }];                                       // overlay without languages
  d.scenes[0].vo = { ...d.scenes[0].vo, en: "Here is a nice fact about space and the station today." };                            // weak hook
  d.hookOptions = [{ en: "Another plain line about the space station." }];
  d.engage.ask = Object.fromEntries(Object.entries(d.engage.ask).map(([k, v]) => [k, String(v).replace(/[?？]\s*$/, ".")]));       // the ask lost its "?"
  return d;
}

let calls = 0;
const srv = http.createServer((req, res) => {
  let b = ""; req.on("data", c => (b += c)); req.on("end", () => {
    res.setHeader("content-type", "application/json");
    if (req.url!.includes("/models/")) { calls++; return res.end(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(sloppy()) }] } }] })); }
    const u = new URL(req.url!, "http://x");
    if (u.searchParams.get("list") === "search") return res.end(JSON.stringify({ query: { search: [{ title: "International Space Station" }] } }));
    res.end(JSON.stringify({ query: { pages: { 1: { title: "International Space Station", extract: SOURCE } } } }));
  });
});
await new Promise<void>(r => srv.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${(srv.address() as any).port}`;
Object.assign(process.env, { GEMINI_API_KEY: "k", GEMINI_BASE: base, GEMINI_MODEL: "m1", WIKI_API: `${base}/w/api.php`, HTTP_RETRY_MS: "10" });

const dir = mkdtempSync(path.join(os.tmpdir(), "p2e2e-"));
for (const d of ["channel", "episodes"]) cpSync(path.join(root, d), path.join(dir, d), { recursive: true });
process.chdir(dir);
const { writeEpisode } = await import(path.join(root, "growth/writer.ts"));
const { runGates, hardFailures } = await import(path.join(root, "engine/gates.ts"));

const file = await writeEpisode("International Space Station", { topic: "space", approve: true });
const ep = JSON.parse(readFileSync(file, "utf8"));
assert.ok(calls <= 4, `at most 4 Gemini calls per episode (was ${calls})`);
assert.deepEqual(hardFailures(runGates(ep)).map((g: any) => g.name), [], "the daily run accepts it");
assert.ok(ep.scenes.every((s: any) => s.footage.filter((f: any) => f.provider !== "local").length >= 2), "footage fallbacks added");
assert.ok(Object.values(ep.engage.ask).every((q: any) => /[?？]$/.test(q)), "ask is a question");
assert.ok(!("hookOptions" in ep));
const before = readdirSync(path.join(root, "episodes")).map(f => Number(f.match(/^E(\d+)/)?.[1] ?? 0)).reduce((a, b) => Math.max(a, b), 0);
assert.equal(Number(path.basename(file).slice(1, 4)), before + 1, "numbered after the existing episodes");
process.chdir(root); srv.close();
console.log(`end-to-end writer test: all passed (${calls} Gemini calls, file ${path.basename(file)})`);
