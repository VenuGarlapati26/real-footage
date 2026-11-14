// A 10-second check before the daily run installs anything: is there work today? The 21:30 IST backup run (and any
// scheduled run while the autopilot is off) then ends here instead of spending ~7 minutes on installs and tests.
// Node builtins only (node --experimental-strip-types autopilot/precheck.ts). Prints "skip=true|false" for GitHub.
import { readFileSync, appendFileSync } from "node:fs";

type Row = { date: string; job: string; status: string };
const read = <T>(f: string, d: T): T => { try { return JSON.parse(readFileSync(f, "utf8")); } catch { return d; } };

/** Pure: why to skip (or null = there is work). */
export function skipReason(s: any, ledger: Row[], now = new Date()): string | null {
  if (!s.enabled) return "the autopilot is off (channel/settings.json -> enabled)";
  if (!s.dev?.fullRenders) return "development mode (dev.fullRenders is false)";
  const tz = s.timezone ?? "Asia/Kolkata";
  const date = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
  const weekday = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short" }).format(now);
  const done = (job: string) => ledger.filter(r => r.date === date && r.job === job && r.status !== "failed").length;
  const shortsDone = done("short") >= (s.shortsPerDay ?? 1);
  const longDone = !(s.longDays ?? []).includes(weekday) || done("long") > 0;
  return shortsDone && longDone ? `today's videos (${date}) are already made` : null;
}

if (process.argv[1]?.endsWith("precheck.ts")) {
  const manual = process.env.GITHUB_EVENT_NAME === "workflow_dispatch";
  const why = manual ? null : skipReason(read("channel/settings.json", {}), read<Row[]>("channel/ledger.json", []));
  console.log(why ? `Nothing to do: ${why}. Skipping the installs.` : "There is work today.");
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `skip=${why ? "true" : "false"}\n`);
}
