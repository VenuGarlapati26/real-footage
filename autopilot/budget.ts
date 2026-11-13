// GitHub Actions minutes guard. Private repos get a fixed monthly allowance (here: GitHub Pro via the Student Pack,
// $18 = ~3,000 Linux minutes, shared with Project 1; a $0 budget blocks overage, so going over = failed runs).
//
// Every render records how long it took per second of video, per format and resolution (channel/usage.json).
// Before a long video is rendered, the highest resolution is chosen that still lets the rest of the month's planned
// videos fit in what is left: 4K when there is room, 1440p or 1080p when there is not. Nothing is ever skipped.

import { readFile, writeFile } from "node:fs/promises";

export type Res = "2160p" | "1440p" | "1080p";
export interface Usage { month: string; minutes: number; rate: Record<string, number> }

// compute seconds per second of finished video on a 2-core runner (measured; updated from every real run)
export const DEFAULT_RATE: Record<string, number> = { "short-1080p": 11, "long-1080p": 8, "long-1440p": 15, "long-2160p": 32 };
const OVERHEAD_MIN = 6;   // checkout, installs, footage download, voice, upload per run

export async function loadUsage(file = "channel/usage.json", now = new Date()): Promise<Usage> {
  const month = now.toISOString().slice(0, 7);
  try { const u = JSON.parse(await readFile(file, "utf8")) as Usage; return u.month === month ? u : { month, minutes: 0, rate: u.rate ?? {} }; }
  catch { return { month, minutes: 0, rate: {} }; }
}

export const rate = (u: Usage, key: string) => u.rate[key] ?? DEFAULT_RATE[key] ?? 30;

/** After a render: add the minutes, and blend the measured speed into the rate (70% old, 30% new). Pure. */
export function record(u: Usage, key: string, videoSeconds: number, wallSeconds: number): Usage {
  const r = wallSeconds / Math.max(1, videoSeconds);
  return { ...u, minutes: +(u.minutes + wallSeconds / 60).toFixed(1), rate: { ...u.rate, [key]: +(u.rate[key] ? u.rate[key] * 0.7 + r * 0.3 : r).toFixed(2) } };
}

/** The best long-video resolution that keeps the rest of the month inside the allowance. Pure. */
export function chooseLongRes(o: { wanted: Res; usage: Usage; budgetMinutes: number; longSeconds: number; shortSeconds: number;
  daysLeft: number; longDaysLeft: number; shortsPerDay: number }): { res: Res; projected: number } {
  const order: Res[] = ["2160p", "1440p", "1080p"];
  const options = order.slice(order.indexOf(o.wanted));
  const shortCost = (o.shortSeconds * rate(o.usage, "short-1080p")) / 60 + OVERHEAD_MIN;
  for (const res of options) {
    const longCost = (o.longSeconds * rate(o.usage, `long-${res}`)) / 60 + OVERHEAD_MIN;
    const projected = o.usage.minutes + o.daysLeft * o.shortsPerDay * shortCost + o.longDaysLeft * longCost;
    if (projected <= o.budgetMinutes || res === "1080p") return { res, projected: Math.round(projected) };
  }
  return { res: "1080p", projected: 0 };
}

export async function saveUsage(u: Usage, file = "channel/usage.json") { await writeFile(file, JSON.stringify(u, null, 2)); }
