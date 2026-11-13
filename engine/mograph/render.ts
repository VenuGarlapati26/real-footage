// Render the motion-graphics layer (overlay.html) to a transparent video, frame by frame, in headless Chromium.
// Identical frames (titles holding still) are captured once and repeated, so long videos stay fast.

import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import path from "node:path";
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import type { Format, Lang, Overlay, Shot } from "../types";
import { LANGS, tx, ui } from "../langs";

export interface MoScene { id: string; start: number; dur: number; overlays: Overlay[]; vo: { at: number; dur: number; text: string } }
export interface MoSpec {
  W: number; H: number; format: Format; lang: Lang; script: "latin" | "deva"; duration: number; tag: string;
  hook?: { text: string; at: number; until: number };
  kickers: { at: number; until: number; label: string; title: string }[];
  stats: { at: number; until: number; value: string; unit: string }[];
  orbits: { at: number; until: number; count: number; caption: string; spin?: number }[];
  lowers: { at: number; until: number; text: string }[];
  maps: { at: number; until: number; lat: number; lon: number; label: string; coords: string }[];
  chapters: { at: number; until: number; no: string; title: string }[];
  compares: { at: number; until: number; bars: { label: string; value: number; display: string }[] }[];
  captions: { at: number; until: number; words: { w: string; at: number; until: number }[] }[];
  credits: { at: number; until: number; text: string }[];
  ask?: { at: number; until: number; label: string; text: string };
  flashes: number[];
  leaks?: number[];
  /** cinematic 2.39:1 bars (long videos' cold open): slide in, hold, open up to full frame */
  bars?: { at: number; until: number };
}

const fmtGeo = (g: { lat: number; lon: number }) => `${Math.abs(g.lat).toFixed(2)}°${g.lat < 0 ? "S" : "N"}  ${Math.abs(g.lon).toFixed(2)}°${g.lon < 0 ? "W" : "E"}`;

/** Word timings: spread over the spoken line by word length (+ a little for punctuation pauses). */
export function wordTimes(text: string, at: number, dur: number) {
  const words = text.split(/\s+/).filter(Boolean), weight = words.map(w => w.replace(/[^\p{L}\p{N}]/gu, "").length + 1.6 + (/[,.;:!?।]$/.test(w) ? 2.2 : 0));
  const total = weight.reduce((a, b) => a + b, 0); let t = at;
  return words.map((w, i) => { const d = (weight[i] / total) * dur; const r = { w, at: t, until: t + d }; t += d; return r; });
}

export function makeSpec(o: { W: number; H: number; format: Format; lang: Lang; duration: number; scenes: MoScene[]; shots: Shot[]; tag: string;
  hook?: string; ask?: { text: string; at: number }; flashes?: boolean;
  transitions?: { at: number; kind: string }[]; coldOpen?: number }): MoSpec {
  const P = o.format === "short", D = o.duration, lang = o.lang;
  const sp: MoSpec = { W: o.W, H: o.H, format: o.format, lang, script: LANGS[lang].script, duration: D, tag: o.tag, kickers: [], stats: [], orbits: [], lowers: [], maps: [], chapters: [], compares: [], captions: [], credits: [], flashes: [] };
  const hookEnd = P && o.hook ? 2.2 : 0;
  if (P && o.hook) sp.hook = { text: o.hook, at: 0.04, until: hookEnd };
  const askAt = o.ask?.at ?? Infinity;
  for (const sc of o.scenes) {
    const end = Math.min(sc.start + sc.dur, D);
    for (const ov of sc.overlays) {
      const at = Math.max(sc.start + (ov.at ?? 0.3), ov.kind === "kicker" ? hookEnd + 0.1 : 0);
      const until = Math.min(ov.dur ? at + ov.dur : end - 0.05, askAt - 0.1, D);
      if (until - at < 0.4) continue;
      const text = tx(ov.text, lang), sub = tx(ov.sub, lang);
      if (ov.kind === "kicker") sp.kickers.push({ at, until, label: sub, title: text });
      else if (ov.kind === "stat") sp.stats.push({ at, until, value: text, unit: sub });
      else if (ov.kind === "orbit") sp.orbits.push({ at, until, count: parseInt(text, 10) || 16, caption: sub, spin: Math.min(3.4, (until - at) * 0.7) });
      else if (ov.kind === "map" && ov.geo) sp.maps.push({ at, until, lat: ov.geo.lat, lon: ov.geo.lon, label: text, coords: sub || fmtGeo(ov.geo) });
      else if (ov.kind === "chapter") { if (!P) sp.chapters.push({ at, until: Math.min(until, at + (ov.dur ?? 2.6)), no: sub, title: text }); }
      else if (ov.kind === "compare" && ov.bars?.length) sp.compares.push({ at, until, bars: ov.bars.map(b => ({ label: tx(b.label, lang), value: b.value, display: b.display ?? b.value.toLocaleString("en-US") })) });
      else sp.lowers.push({ at, until, text });
    }
    if (P) { // captions in groups of three words (never while the hook or the question card is up)
      const words = wordTimes(sc.vo.text, sc.start + sc.vo.at, sc.vo.dur);
      for (let i = 0; i < words.length; i += 3) {
        const g = words.slice(i, i + 3), at = g[0].at, until = Math.min(g.at(-1)!.until + 0.08, askAt);
        if (at < hookEnd - 0.05 || at >= askAt || at >= D) continue;
        sp.captions.push({ at, until: Math.min(until, D), words: g });
      }
    }
    if (!o.transitions && o.flashes !== false && sc.start > 0.5 && sc.start < D - 0.3) sp.flashes.push(sc.start);
  }
  // footage credit for each shot (merged while the same source continues)
  for (const sh of o.shots) {
    const text = sh.clip.credit === "OWN" ? ui(lang, "own") : `${ui(lang, "footage")}: ${sh.clip.credit}`;
    const last = sp.credits.at(-1);
    if (last && last.text === text && Math.abs(last.until - sh.start) < 0.3) last.until = Math.min(D, sh.start + sh.dur);
    else sp.credits.push({ at: sh.start + 0.15, until: Math.min(D, sh.start + sh.dur), text });
  }
  if (o.transitions) { // the edit decides: flashes and light leaks exactly where the cut plan put them
    sp.flashes = o.transitions.filter(t => t.kind === "flash" && t.at < D - 0.3).map(t => t.at);
    sp.leaks = o.transitions.filter(t => t.kind === "leak" && t.at < D - 0.3).map(t => t.at);
  }
  if (!P && o.coldOpen && o.coldOpen > 2) sp.bars = { at: 0, until: Math.min(o.coldOpen, D) };
  if (o.ask && o.ask.at < D) sp.ask = { at: o.ask.at, until: D, label: ui(lang, "comments"), text: o.ask.text };
  return sp;
}

/** Playwright from the project (CI installs it) or a global install (require() honours NODE_PATH, import() does not). */
async function loadPlaywright(): Promise<any> {
  const mod = "playwright";
  try { return await import(mod); } catch { return createRequire(import.meta.url)(mod); }
}

/** Render the layer to a transparent .mov (PNG frames, alpha). Returns frames captured vs reused. */
export async function renderOverlay(spec: MoSpec, out: string, fps = 30, scale = 1): Promise<{ captured: number; reused: number }> {
  const { chromium } = await loadPlaywright();
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: spec.W, height: spec.H }, deviceScaleFactor: scale });   // 4K: the same layout drawn at 2x, so type stays razor sharp
    await page.goto(pathToFileURL(path.resolve("engine/mograph/overlay.html")).href);
    await page.waitForFunction("window.ready === true");
    if (spec.maps?.length) await page.evaluate((w: string) => { (window as any).WORLD = JSON.parse(w); }, await readFile(path.resolve("node_modules/world-atlas/countries-50m.json"), "utf8"));
    await page.evaluate((s: unknown) => (window as any).setTimeline(s), spec);
    // fast capture straight from the DevTools protocol (transparent background, speed-optimised PNG encoding)
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Emulation.setDefaultBackgroundColorOverride", { color: { r: 0, g: 0, b: 0, a: 0 } });
    // (the clip's scale = device pixels per CSS pixel: without it CDP returns the 1x layout size, not the 4K frame)
    const clip = { x: 0, y: 0, width: spec.W, height: spec.H, scale };
    const shot = async () => Buffer.from((await cdp.send("Page.captureScreenshot", { format: "png", optimizeForSpeed: true, fromSurface: true, captureBeyondViewport: false, clip })).data, "base64");
    const ff = spawn("ffmpeg", ["-y", "-v", "error", "-f", "image2pipe", "-framerate", String(fps), "-c:v", "png", "-i", "-", "-c:v", "png", "-pix_fmt", "rgba", out], { stdio: ["pipe", "inherit", "inherit"] });
    const done = new Promise<number>(r => ff.on("close", r));
    const N = Math.ceil(spec.duration * fps); let prev = "", img: Buffer | null = null, captured = 0, reused = 0;
    for (let i = 0; i < N; i++) {
      const state = await page.evaluate((t: number) => (window as any).renderAt(t), i / fps) as string;
      if (state !== prev || !img) { img = await shot(); prev = state; captured++; } else reused++;
      if (!ff.stdin.write(img)) await new Promise(r => ff.stdin.once("drain", r));
    }
    ff.stdin.end(); const code = await done; if (code) throw new Error(`ffmpeg overlay encode exited ${code}`);
    return { captured, reused };
  } finally { await browser.close(); }
}
