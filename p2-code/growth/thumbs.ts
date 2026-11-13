// Thumbnails from the real footage: the sharpest, most colourful frame of the video, three typographic styles.
// daily.ts uploads the style the learner picks; the weekly job scores styles by views in their first 3 days
// (YouTube's API does not expose thumbnail click-through rate).

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { writeFile } from "node:fs/promises";
import path from "node:path";

const run = promisify(execFile);
export const THUMB_STYLES = ["stat", "center", "frame"] as const;

/** Score candidate times: sharp (low blur), colourful, not too dark or blown out. */
export async function bestFrame(video: string, times: number[]): Promise<{ t: number; score: number }> {
  let best = { t: times[0] ?? 1, score: -1e9 };
  for (const t of times) {
    const { stderr } = await run("ffmpeg", ["-hide_banner", "-ss", t.toFixed(2), "-i", video, "-frames:v", "1", "-vf", "scale=640:-2,blurdetect=block_pct=80,signalstats,metadata=print", "-f", "null", "-"], { maxBuffer: 1 << 24 });
    const num = (k: string) => Number(new RegExp(`${k}=([\\d.]+)`).exec(stderr)?.[1] ?? NaN);
    const blur = num("lavfi.blur"), sat = num("lavfi.signalstats.SATAVG"), y = num("lavfi.signalstats.YAVG");
    const score = -2 * (isNaN(blur) ? 5 : blur) + 0.08 * (isNaN(sat) ? 0 : sat) - Math.abs((isNaN(y) ? 110 : y) - 110) * 0.03;
    if (score > best.score) best = { t, score };
  }
  return best;
}

const esc = (s: string) => s.replace(/[{}\\]/g, "");

export function thumbAss(style: typeof THUMB_STYLES[number], text: string, lang: "hi" | "en", tag: string): string {
  const big = lang === "hi" ? "Mukta" : "Inter", serif = lang === "hi" ? "Noto Serif Devanagari" : "Playfair Display";
  const [l1, l2] = text.split(/(?<=[.!?।])\s+/).concat([""]);
  const head = ["[Script Info]", "ScriptType: v4.00+", "PlayResX: 1280", "PlayResY: 720", "ScaledBorderAndShadow: yes", "", "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    `Style: Big,${big},${lang === "hi" ? 176 : 128},&H00FFFFFF,&H00FFFFFF,&H00101010,&H96000000,-1,0,0,0,100,100,0,0,1,7,4,7,60,60,60,1`,
    `Style: Accent,${big},${lang === "hi" ? 176 : 128},&H003DB9F5,&H003DB9F5,&H00101010,&H96000000,-1,0,0,0,100,100,0,0,1,7,4,7,60,60,60,1`,
    `Style: Serif,${serif},${lang === "hi" ? 168 : 120},&H00F3EDE4,&H00F3EDE4,&H00101010,&H96000000,-1,0,0,0,100,100,0,0,1,0,3,7,60,60,60,1`,
    `Style: Tag,${big},${lang === "hi" ? 40 : 30},&H40F3EDE4,&H40F3EDE4,&H00000000,&H00000000,-1,0,0,0,100,100,0,0,1,0,0,7,40,40,30,1`,
    `Style: Shade,Inter,10,&H00000000,&H00000000,&H00000000,&H00000000,0,0,0,0,100,100,0,0,1,0,0,7,0,0,0,1`,
    "", "[Events]", "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text"];
  const ev = (layer: number, st: string, t: string) => `Dialogue: ${layer},0:00:00.00,0:00:05.00,${st},,0,0,0,,${t}`;
  const shade = (a: string, x1: number) => ev(0, "Shade", `{\\pos(0,0)\\1a&H${a}&\\blur60\\p1}m 0 0 l ${x1} 0 l ${x1} 720 l 0 720{\\p0}`);
  const lines = [ev(3, "Tag", `{\\pos(40,30)}${esc(tag)}`)];
  if (style === "stat") lines.push(shade("40", 760), ev(2, "Big", `{\\pos(60,190)}${esc(l1)}`), ev(2, "Accent", `{\\pos(60,350)}${esc(l2)}`));
  if (style === "center") lines.push(ev(0, "Shade", `{\\pos(0,0)\\1a&H70&\\p1}m 0 420 l 1280 420 l 1280 720 l 0 720{\\p0}`),
    ev(2, "Big", `{\\an2\\pos(640,600)}${esc(l1)}`), ev(2, "Accent", `{\\an2\\pos(640,690)\\fs96}${esc(l2)}`));
  if (style === "frame") lines.push(shade("60", 640), ev(2, "Serif", `{\\pos(60,420)}${esc(l1)}`), ev(2, "Accent", `{\\pos(60,540)\\fs84}${esc(l2)}`),
    ev(1, "Accent", `{\\pos(60,400)\\p1}m 0 0 l 140 0 l 140 8 l 0 8{\\p0}`));
  return [...head, ...lines, ""].join("\n");
}

export async function renderThumbs(video: string, t: number, text: string, lang: "hi" | "en", tag: string, outDir: string, fontsDir: string, lut: string) {
  const files: string[] = [];
  for (const style of THUMB_STYLES) {
    const ass = path.join(outDir, `thumb-${style}.ass`), out = path.join(outDir, `thumb-${style}.jpg`);
    await writeFile(ass, thumbAss(style, text, lang, tag));
    const crop = style === "center" ? "scale=1408:792,crop=1280:720" : "scale=1280:720";
    await run("ffmpeg", ["-y", "-v", "error", "-ss", t.toFixed(2), "-i", video, "-frames:v", "1", "-vf",
      `${crop},lut3d=file='${lut}',eq=contrast=1.12:saturation=1.18,unsharp=5:5:0.8,ass='${ass}':fontsdir='${fontsDir}':shaping=complex`, "-q:v", "2", out]);
    files.push(out);
  }
  return files;
}
