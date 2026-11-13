// The editor. Each shot: trim a clean take -> supersampled slow camera drift (pan or push) -> match levels ->
// film LUT. Then hard cuts between shots (how documentaries are cut), libass titles, fine grain, soft vignette,
// fade in/out, and the mixed audio. Intermediates are high quality so the final encode is the only lossy step.

import { letterbox } from "./footage";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import type { Shot } from "./types";

const run = promisify(execFile);
const FPS = 30;

/** Camera moves, chosen per shot so consecutive shots never move the same way. */
const MOVES = [
  { x: [0.15, 0.85], y: [0.5, 0.5] },   // drift right
  { x: [0.85, 0.15], y: [0.5, 0.5] },   // drift left
  { x: [0.5, 0.5], y: [0.75, 0.25] },   // tilt up
  { x: [0.3, 0.7], y: [0.6, 0.4] },     // diagonal
];

export function shotFilter(sh: Shot, W: number, H: number, lut: string, index: number, headroom = 1.12, bars?: string | null): string {
  // supersample: render moves at 1.5x then scale down = no stair-stepping (at 4K the source is the limit, so 1x)
  const SS = Math.max(W, H) >= 3000 ? 1 : 1.5;
  // a source smaller than the frame is upscaled with lanczos and then gently re-sharpened (contrast-adaptive)
  const srcShort = Math.min(sh.clip.width || W, sh.clip.height || H), up = srcShort < Math.min(W, H) * 0.95;
  // big upscales (a 1080p source cropped to a 4K vertical frame) first lose their compression blocks and noise,
  // and skies get debanded after scaling, so the enlargement stays smooth instead of blocky
  const big = srcShort * SS < Math.min(W, H) / 1.8;
  const cw = Math.round(W * SS / 2) * 2, ch = Math.round(H * SS / 2) * 2;
  const sw = Math.round(cw * headroom / 2) * 2, shh = Math.round(ch * headroom / 2) * 2;
  const m = MOVES[index % MOVES.length], D = sh.dur.toFixed(3);
  const ease = `(0.5-0.5*cos(PI*min(t/${D},1)))`;     // ease in-out across the shot
  const px = `(iw-ow)*(${m.x[0]}+(${m.x[1] - m.x[0]})*${ease})`, py = `(ih-oh)*(${m.y[0]}+(${m.y[1] - m.y[0]})*${ease})`;
  // slow motion: 50/60 fps footage played at half speed keeps every frame real (no interpolation, no judder)
  const sp = sh.speed && sh.speed < 1 ? sh.speed : 1;
  // whip pan: the cut happens inside a fast horizontal smear (last 4 frames out, first 4 frames in), like a camera
  // whipping from one subject to the next; strongest right at the cut
  const blur = (from: number, to: number, frac: number) => `avgblur=sizeX=${Math.max(2, Math.min(1023, Math.round(W * frac)))}:sizeY=1:enable='between(t,${from.toFixed(3)},${to.toFixed(3)})'`;
  const d = sh.dur, f = 1 / FPS;
  const whips = [
    ...(sh.trOut === "whip" ? [blur(d - 4 * f, d - 2 * f, 0.018), blur(d - 2 * f, d + 1, 0.05)] : []),
    ...(sh.trIn === "whip" ? [blur(0, 2 * f - 1e-3, 0.05), blur(2 * f, 4 * f - 1e-3, 0.018)] : []),
  ];
  return [
    ...(sp < 1 ? [`setpts=${(1 / sp).toFixed(4)}*PTS`] : []),
    `fps=${FPS}`,
    ...(bars ? [`crop=${bars}`] : []),     // remove letterbox bars baked into the source
    ...(big ? ["hqdn3d=2:1.5:5:4"] : []),
    `scale=${sw}:${shh}:force_original_aspect_ratio=increase:flags=lanczos`,
    `crop=${cw}:${ch}:x='${px}':y='${py}'`,
    `scale=${W}:${H}:flags=lanczos`, "setsar=1", ...(big ? ["gradfun=strength=1.1:radius=20"] : []), ...(up ? ["cas=strength=0.55"] : []),
    // gentle, colour-safe level matching (strong stretching of a flat white ice field blew noise up into artefacts)
    "normalize=blackpt=black:whitept=white:smoothing=45:independence=0:strength=0.3",
    `lut3d=file='${lut.replace(/'/g, "\\'")}':interp=tetrahedral`,
    ...whips,
    "format=yuv420p",
  ].join(",");
}

export async function renderShot(sh: Shot, W: number, H: number, lut: string, index: number, out: string) {
  const bars = await letterbox(sh.clip.file, sh.clip.duration);
  await run("ffmpeg", ["-y", "-v", "error", "-ss", sh.inPoint.toFixed(3), "-t", (sh.dur * (sh.speed ?? 1) + 0.1).toFixed(3), "-i", sh.clip.file,
    "-vf", shotFilter(sh, W, H, lut, index, 1.12, bars), "-frames:v", String(Math.round(sh.dur * FPS)), "-an",
    "-c:v", "libx264", "-preset", "veryfast", "-crf", "12", "-r", String(FPS), out], { maxBuffer: 1 << 26 });
}

/** Join shots, burn titles, finish, add audio. */
/** Join shots, burn titles, finish, add audio.
 *  loop (Shorts): no fade to black; the last 0.4 s dissolves into the opening frame, so the end flows straight
 *  back into the start and viewers drift into a second watch (replays are a strong Shorts/Reels signal). */
export async function assemble(o: { shots: string[]; ass?: string; fontsDir: string; audio: string; duration: number; out: string; work: string; loop?: boolean;
  overlay?: string; progress?: boolean; W?: number; H?: number }) {
  const list = path.join(o.work, "shots.txt");
  await writeFile(list, o.shots.map(f => `file '${path.resolve(f)}'`).join("\n"));
  const D = o.duration, Ds = D.toFixed(3);
  // 4K masters use x264 "faster" (about 1.5x quicker than "medium" for the same look at this bitrate; YouTube re-encodes anyway)
  const big4k = Math.max(o.W ?? 0, o.H ?? 0) >= 3000;
  // footage look: fine moving grain (footage from many sources reads as one stock) + a soft vignette
  const look = ["noise=alls=5:allf=t", "vignette=angle=PI/5.5:mode=forward"];
  // halation: highlights bloom softly into the frame, like light on film (the "expensive camera" look)
  const glowSigma = Math.round((o.W ?? 1920) / 90);
  // titles: the motion-graphics layer (browser-rendered, preferred) or the libass fallback
  const titles = o.overlay ? [] : o.ass ? [`ass='${o.ass.replace(/'/g, "\\'")}':fontsdir='${o.fontsDir}':shaping=complex`] : [];
  const fades = o.loop ? [] : [`fade=t=in:st=0:d=0.4,fade=t=out:st=${Math.max(0, D - 0.5).toFixed(2)}:d=0.5`];
  const inputs = ["-f", "concat", "-safe", "0", "-i", list, "-i", o.audio];
  const parts: string[] = [];
  let v = "[0:v]";
  if (o.loop) { // Shorts: the last 0.4 s dissolves into the first shot, so the replay is seamless
    inputs.push("-i", path.resolve(o.shots[0])); const X = 0.4;
    parts.push(`[0:v]trim=0:${Ds},setpts=PTS-STARTPTS[a]`, `[2:v]trim=0:${(X + 0.1).toFixed(3)},setpts=PTS-STARTPTS[b]`, `[a][b]xfade=transition=fade:duration=${X}:offset=${(D - X).toFixed(3)},trim=0:${Ds}[lp]`);
    v = "[lp]";
  }
  // (done in RGB: screen-blending YUV planes would also "brighten" the colour planes and tint everything purple)
  // The glow is computed at quarter size and scaled back up (a wide blur looks the same, at a fraction of the cost)
  const qw = Math.round((o.W ?? 1920) / 8) * 2, qh = Math.round((o.H ?? 1080) / 8) * 2;
  parts.push(`${v}split[s0][s1]`, `[s1]scale=${qw}:${qh},format=gbrp,curves=all='0/0 0.62/0 1/0.9',gblur=sigma=${Math.max(2, Math.round(glowSigma / 4))},scale=${o.W ?? 1920}:${o.H ?? 1080}:flags=bilinear[hl]`,
    `[s0]format=gbrp[b0]`, `[b0][hl]blend=all_mode=screen:all_opacity=0.3,format=yuv420p[bl]`);
  parts.push(`[bl]${[...look, ...titles].join(",")}[base]`); v = "[base]";
  if (o.overlay) {
    const idx = inputs.filter(x => x === "-i").length; inputs.push("-i", path.resolve(o.overlay));
    parts.push(`[${idx}:v]format=rgba${o.W && o.H ? `,scale=${o.W}:${o.H}:flags=lanczos` : ""}[ov]`, `${v}[ov]overlay=0:0:format=auto:shortest=0:eof_action=pass[g]`); v = "[g]";
  }
  if (o.progress && o.W) { // a thin progress line along the top (Shorts): people stay to see it finish
    const h = Math.round((o.W / 1080) * 7);
    parts.push(`color=c=0xFFC94A:s=${o.W}x${h}:r=30:d=${Ds}[pb]`, `${v}[pb]overlay=x='-W+W*t/${Ds}':y=0:shortest=1[p]`); v = "[p]";
  }
  parts.push(`${v}${fades.length ? fades.join(",") + "," : ""}format=yuv420p[v]`);
  await run("ffmpeg", ["-y", "-v", "error", ...inputs, "-filter_complex", parts.join(";"), "-map", "[v]", "-map", "1:a",
    "-c:v", "libx264", "-preset", big4k ? "faster" : "medium", "-crf", big4k ? "18" : "16", "-profile:v", "high", "-x264-params", "aq-mode=3:deblock=-1,-1", "-pix_fmt", "yuv420p", "-c:a", "aac", "-b:a", "192k", "-t", Ds, "-movflags", "+faststart", o.out], { maxBuffer: 1 << 26 });
}

/** One image of evenly spaced frames, for checking a render at a glance. */
export async function contactSheet(video: string, duration: number, out: string, portrait: boolean, n = 6) {
  const cols = portrait ? n : 3, rows = portrait ? 1 : Math.ceil(n / 3), w = portrait ? 270 : 480;
  await run("ffmpeg", ["-y", "-v", "error", "-i", video, "-vf", `fps=${(n / duration).toFixed(4)},scale=${w}:-2,tile=${cols}x${rows}`, "-frames:v", "1", out]);
}
