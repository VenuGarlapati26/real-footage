// TikTok (and Snapchat Spotlight, once available) through Zernio, a posting service whose apps TikTok and Snap have
// already approved. Its free tier covers 2 connected accounts with unlimited posts, which is exactly TikTok + Snapchat.
// Posts are scheduled for the same moment as YouTube, so every platform goes out together.
//
// Secrets: ZERNIO_API_KEY, ZERNIO_TIKTOK_ID, ZERNIO_SNAPCHAT_ID (account ids from zernio.com -> Accounts).
// Setup: docs/PLATFORMS.md (Part C). Without the secrets the daily run just skips these platforms.
//
// Snapchat note (Nov 2026): Snap has not approved Zernio's app yet, so connecting a Snapchat account returns
// "PLATFORM_BETA_RESTRICTED". The code is ready: the day the connection works and ZERNIO_SNAPCHAT_ID is set,
// Spotlight posting starts. Until then the Short and its caption are in the daily platform-pack.

import { readFile, stat } from "node:fs/promises";
import path from "node:path";

const Z = process.env.ZERNIO_API ?? "https://zernio.com/api/v1";
const key = () => process.env.ZERNIO_API_KEY ?? "";
export const hasTikTok = () => !!(key() && process.env.ZERNIO_TIKTOK_ID);
export const hasSnapchat = () => !!(key() && process.env.ZERNIO_SNAPCHAT_ID);

async function api(route: string, body: unknown): Promise<any> {
  const r = await fetch(`${Z}${route}`, { method: "POST", headers: { authorization: `Bearer ${key()}`, "content-type": "application/json" }, body: JSON.stringify(body) });
  const j: any = await r.json().catch(() => ({}));
  if (!r.ok && r.status !== 207) throw new Error(`Zernio ${route} ${r.status}: ${j.code ?? ""} ${j.error ?? JSON.stringify(j).slice(0, 300)}`.trim());
  return j;
}

/** Upload the video once (presigned URL straight to storage); returns the public URL posts refer to. */
export async function uploadVideo(file: string): Promise<string> {
  const size = (await stat(file)).size;
  const p = await api("/media/presign", { filename: path.basename(file), contentType: "video/mp4", size });
  const put = await fetch(p.uploadUrl, { method: "PUT", headers: { "content-type": "video/mp4" }, body: new Uint8Array(await readFile(file)) });
  if (!put.ok) throw new Error(`Zernio upload failed ${put.status}`);
  return p.publicUrl;
}

const when = (publishAt?: string) => publishAt && Date.parse(publishAt) - Date.now() > 2 * 60_000 ? { scheduledFor: publishAt } : { publishNow: true };
const failed = (j: any) => (j.platformResults ?? []).find((x: any) => x.status === "failed" || x.error);

/** Snapchat Spotlight descriptions are capped at 160 characters, hashtags included. Pure. */
export function spotlightCaption(caption: string): string {
  const tags = (caption.match(/#[\p{L}\p{N}_]+/gu) ?? []).slice(0, 3).join(" ");
  const text = caption.replace(/#[\p{L}\p{N}_]+/gu, "").replace(/\s+/g, " ").trim();
  const room = 160 - (tags ? tags.length + 1 : 0);
  const cut = text.length <= room ? text : text.slice(0, room - 1).replace(/\s+\S*$/, "") + "…";
  return (tags ? `${cut} ${tags}` : cut).slice(0, 160);
}

export async function tiktok(videoUrl: string, caption: string, o: { publishAt?: string; aiGenerated: boolean; coverMs?: number }): Promise<string> {
  const settings = { privacyLevel: "PUBLIC_TO_EVERYONE", allowComment: true, allowDuet: true, allowStitch: true,
    contentPreviewConfirmed: true, expressConsentGiven: true, videoMadeWithAi: o.aiGenerated,
    ...(o.coverMs !== undefined ? { videoCoverTimestampMs: Math.round(o.coverMs) } : {}) };
  const j = await api("/posts", { content: caption.slice(0, 2200), mediaItems: [{ type: "video", url: videoUrl }],
    platforms: [{ platform: "tiktok", accountId: process.env.ZERNIO_TIKTOK_ID, platformSpecificData: settings }], ...when(o.publishAt) });
  const f = failed(j); if (f) throw new Error(`TikTok: ${f.error ?? f.status}`);
  return j.post?._id ?? j.post?.id ?? "";
}

export async function snapchat(videoUrl: string, caption: string, o: { publishAt?: string; contentType?: string }): Promise<string> {
  const j = await api("/posts", { content: spotlightCaption(caption), mediaItems: [{ type: "video", url: videoUrl }],
    platforms: [{ platform: "snapchat", accountId: process.env.ZERNIO_SNAPCHAT_ID, platformSpecificData: { contentType: o.contentType ?? "spotlight", description: spotlightCaption(caption) } }], ...when(o.publishAt) });
  const f = failed(j); if (f) throw new Error(`Snapchat: ${f.error ?? f.status}`);
  return j.post?._id ?? j.post?.id ?? "";
}
