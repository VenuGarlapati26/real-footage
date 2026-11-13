// RELEASE: Instagram's API cannot schedule, so the daily run uploads each Reel and leaves it processed but unpublished
// (a "container", valid 24 h). This runs at each Short time (.github/workflows/release.yml, ~20 seconds) and publishes
// whatever is due, so Instagram goes live with YouTube, Facebook and TikTok.
// No npm install needed: Node builtins only (run with `node --experimental-strip-types autopilot/release.ts`).
// Published ids go to channel/released.json (the daily run never writes that file, so the two never conflict).

import { readFile, writeFile } from "node:fs/promises";

const G = process.env.META_GRAPH ?? "https://graph.facebook.com/v25.0";
type Row = { episode: string; job: string; title?: string; publishAt?: string; igContainer?: string; igId?: string };
const read = async <T>(f: string, d: T): Promise<T> => { try { return JSON.parse(await readFile(f, "utf8")); } catch { return d; } };

/** Rows whose Instagram Reel is waiting and due (a few minutes early is fine; older than 25 h has expired). Pure. */
export function due(ledger: Row[], released: Record<string, string>, now = Date.now(), earlyMs = 6 * 60_000) {
  return ledger.filter(r => r.igContainer && !r.igId && !released[r.igContainer] && r.publishAt && Date.parse(r.publishAt) <= now + earlyMs);
}

export async function release(now = Date.now()) {
  const token = process.env.META_ACCESS_TOKEN, ig = process.env.IG_USER_ID;
  if (!token || !ig) { console.log("Instagram is not set up (META_ACCESS_TOKEN, IG_USER_ID)."); return { published: [], errors: [] }; }
  const ledger = await read<Row[]>("channel/ledger.json", []), released = await read<Record<string, string>>("channel/released.json", {});
  const published: string[] = [], errors: string[] = [];
  for (const r of due(ledger, released, now)) {
    const c = r.igContainer!;
    if (now - Date.parse(r.publishAt!) > 25 * 3_600_000) { released[c] = "expired"; errors.push(`${r.episode}: Instagram upload expired; post it from the platform-pack`); continue; }
    try {
      const res = await fetch(`${G}/${ig}/media_publish`, { method: "POST", headers: { authorization: `OAuth ${token}`, "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ creation_id: c }) });
      const j: any = await res.json().catch(() => ({}));
      if (!res.ok || j.error) throw new Error(JSON.stringify(j.error ?? j).slice(0, 300));
      released[c] = j.id; published.push(`${r.episode} "${r.title ?? ""}"`);
    } catch (e: any) { errors.push(`${r.episode}: Instagram: ${e.message ?? e}`); if (/expired|does not exist/i.test(String(e.message))) released[c] = "expired"; }
  }
  if (published.length || errors.length) {
    await writeFile("channel/released.json", JSON.stringify(released, null, 2) + "\n");
    const topic = process.env.NTFY_TOPIC, msg = [...published.map(p => `- Instagram live: ${p}`), ...errors].join("\n");
    console.log(msg);
    if (topic) await fetch(`https://ntfy.sh/${encodeURIComponent(topic)}`, { method: "POST", body: msg, headers: { Title: errors.length ? "Project 2 release problem" : "Project 2: Instagram is live", Priority: errors.length ? "high" : "low", Tags: "tv" } }).catch(() => {});
  } else console.log("Nothing due.");
  if (errors.length) process.exitCode = 1;
  return { published, errors };
}

if (process.argv[1]?.endsWith("release.ts")) await release();
