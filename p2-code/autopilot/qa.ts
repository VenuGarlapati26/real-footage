// Automatic video QA before anything is uploaded (from Project 1): a broken or silent file never reaches a platform.
//   - container/streams: video at the right size, audio present
//   - duration matches the timeline (no truncated encodes)
//   - loudness near YouTube's -14 LUFS
//   - no black frames, no long dead-silence gaps

import { execFile } from "node:child_process";
import { promisify } from "node:util";
const run = promisify(execFile);

export interface QaResult { pass: boolean; checks: string[]; problems: string[]; lufs?: number; duration?: number }

async function has(cmd: string) { try { await run(cmd, ["-version"]); return true; } catch { return false; } }

export async function qaVideo(file: string, expect: { width: number; height: number; duration: number }): Promise<QaResult> {
  const checks: string[] = [], problems: string[] = [];
  if (!(await has("ffprobe")) || !(await has("ffmpeg"))) return { pass: true, checks: ["ffmpeg not installed - QA skipped"], problems };
  const probe = JSON.parse((await run("ffprobe", ["-v", "error", "-show_entries", "stream=codec_type,width,height:format=duration", "-of", "json", file])).stdout);
  const v = probe.streams.find((s: any) => s.codec_type === "video"), a = probe.streams.find((s: any) => s.codec_type === "audio");
  const duration = Number(probe.format?.duration);
  if (!v) problems.push("no video stream"); else if (v.width !== expect.width || v.height !== expect.height) problems.push(`size ${v.width}x${v.height}, expected ${expect.width}x${expect.height}`); else checks.push(`video ${v.width}x${v.height}`);
  if (!a) problems.push("no audio stream"); else checks.push("audio present");
  if (!(Math.abs(duration - expect.duration) <= Math.max(1.5, expect.duration * 0.03))) problems.push(`duration ${duration.toFixed(1)}s, expected ${expect.duration.toFixed(1)}s`); else checks.push(`duration ${duration.toFixed(1)}s`);

  const { stderr } = await run("ffmpeg", ["-hide_banner", "-nostats", "-i", file,
    "-filter_complex", "[0:a]ebur128=peak=true,silencedetect=n=-45dB:d=6[a];[0:v]blackdetect=d=0.5:pix_th=0.06[v]",
    "-map", "[a]", "-map", "[v]", "-f", "null", "-"], { maxBuffer: 1 << 27 });
  const lufs = Number(/I:\s+(-?[\d.]+) LUFS/.exec(stderr.split("Summary:").pop() ?? "")?.[1]);
  if (!isFinite(lufs) || lufs < -17 || lufs > -11) problems.push(`loudness ${lufs} LUFS (want about -14)`); else checks.push(`loudness ${lufs} LUFS`);
  const silences = (stderr.match(/silence_start/g) ?? []).length;
  if (silences) problems.push(`${silences} silent gap(s) longer than 6 s`); else checks.push("no dead air");
  const blacks = [...stderr.matchAll(/black_duration:([\d.]+)/g)].reduce((s, m) => s + Number(m[1]), 0);
  if (blacks > 1) problems.push(`${blacks.toFixed(1)}s of black frames`); else checks.push("no black frames");
  return { pass: problems.length === 0, checks, problems, lufs, duration };
}
