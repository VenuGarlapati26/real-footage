// YouTube Data API v3 + Analytics v2 with plain fetch. Adapted from Project 1 (autopilot/youtube.ts) for a
// general-audience channel: NOT made for kids, honest synthetic-media disclosure, and subtitle tracks (hi + en).
// Credentials: YT_CLIENT_ID, YT_CLIENT_SECRET, YT_REFRESH_TOKEN (get the token once with `npm run auth`).

import { stat, readFile } from "node:fs/promises";
import { createReadStream } from "node:fs";

const OAUTH = process.env.YT_OAUTH_URL ?? "https://oauth2.googleapis.com/token";
const API = process.env.YT_API_BASE ?? "https://www.googleapis.com/youtube/v3";
const UPLOAD = process.env.YT_UPLOAD_BASE ?? "https://www.googleapis.com/upload/youtube/v3";
const ANALYTICS = process.env.YT_ANALYTICS_BASE ?? "https://youtubeanalytics.googleapis.com/v2";

export const SCOPES = [
  "https://www.googleapis.com/auth/youtube.upload",
  "https://www.googleapis.com/auth/youtube.force-ssl",   // needed for captions.insert
  "https://www.googleapis.com/auth/yt-analytics.readonly",
];

let cached: { token: string; exp: number } | null = null;
export const hasCredentials = () => !!(process.env.YT_CLIENT_ID && process.env.YT_CLIENT_SECRET && process.env.YT_REFRESH_TOKEN);

async function token(): Promise<string> {
  if (cached && cached.exp > Date.now() + 60_000) return cached.token;
  if (!hasCredentials()) throw new Error("YouTube is not connected: set YT_CLIENT_ID, YT_CLIENT_SECRET and YT_REFRESH_TOKEN (see docs/SETUP.md).");
  const r = await fetch(OAUTH, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: process.env.YT_CLIENT_ID!, client_secret: process.env.YT_CLIENT_SECRET!, refresh_token: process.env.YT_REFRESH_TOKEN!, grant_type: "refresh_token" }) });
  const j: any = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`YouTube sign-in failed: ${j.error ?? r.status} ${j.error_description ?? ""}${j.error === "invalid_grant" ? " (publish the Google consent screen to 'In production' and run `npm run auth` again)" : ""}`);
  cached = { token: j.access_token, exp: Date.now() + (j.expires_in ?? 3600) * 1000 };
  return cached.token;
}

async function api<T = any>(method: string, url: string, body?: unknown, tries = 3): Promise<T> {
  for (let i = 0; ; i++) {
    const r = await fetch(url, { method, headers: { authorization: `Bearer ${await token()}`, ...(body ? { "content-type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined });
    if (r.ok) return (r.status === 204 ? {} : await r.json()) as T;
    const text = await r.text();
    if (i < tries - 1 && (r.status >= 500 || r.status === 429)) { await new Promise(res => setTimeout(res, 3000 * (i + 1))); continue; }
    throw new Error(`YouTube API ${method} ${url.split("?")[0]} -> ${r.status}: ${text.slice(0, 400)}`);
  }
}

export interface UploadMeta {
  title: string; description: string; tags: string[]; categoryId: string; language: string;
  privacy: "private" | "public" | "unlisted"; publishAt?: string;
  /** true when the video uses a synthetic voice or realistic generated imagery. YouTube says the label does not affect reach or monetisation. */
  syntheticMedia: boolean;
}

export async function uploadVideo(file: string, meta: UploadMeta, onProgress: (p: number) => void = () => {}): Promise<string> {
  const size = (await stat(file)).size;
  const body = {
    snippet: { title: meta.title.slice(0, 100), description: meta.description.slice(0, 4900), tags: meta.tags, categoryId: meta.categoryId, defaultLanguage: meta.language, defaultAudioLanguage: meta.language },
    status: { privacyStatus: meta.privacy, ...(meta.publishAt ? { publishAt: meta.publishAt } : {}), selfDeclaredMadeForKids: false, containsSyntheticMedia: meta.syntheticMedia, license: "youtube", embeddable: true },
  };
  const init = await fetch(`${UPLOAD}/videos?uploadType=resumable&part=snippet,status`, {
    method: "POST", headers: { authorization: `Bearer ${await token()}`, "content-type": "application/json; charset=UTF-8", "x-upload-content-length": String(size), "x-upload-content-type": "video/mp4" },
    body: JSON.stringify(body),
  });
  if (!init.ok) throw new Error(`upload start failed ${init.status}: ${(await init.text()).slice(0, 400)}`);
  const session = init.headers.get("location"); if (!session) throw new Error("upload start returned no session URL");
  const CHUNK = 16 * 1024 * 1024; let offset = 0, fails = 0;
  while (offset < size) {
    const end = Math.min(size, offset + CHUNK), chunk = await readRange(file, offset, end);
    const r = await fetch(session, { method: "PUT", headers: { authorization: `Bearer ${await token()}`, "content-length": String(end - offset), "content-range": `bytes ${offset}-${end - 1}/${size}` }, body: chunk as unknown as BodyInit });
    if (r.status === 200 || r.status === 201) { onProgress(1); return ((await r.json()) as any).id; }
    if (r.status === 308) { const range = r.headers.get("range"); offset = range ? Number(range.split("-")[1]) + 1 : end; fails = 0; onProgress(offset / size); continue; }
    if (++fails > 5) throw new Error(`upload failed at byte ${offset}: ${r.status} ${(await r.text()).slice(0, 300)}`);
    await new Promise(res => setTimeout(res, 2000 * fails));
    const q = await fetch(session, { method: "PUT", headers: { authorization: `Bearer ${await token()}`, "content-length": "0", "content-range": `bytes */${size}` } });
    if (q.status === 308) { const range = q.headers.get("range"); offset = range ? Number(range.split("-")[1]) + 1 : 0; }
    else if (q.status === 200 || q.status === 201) return ((await q.json()) as any).id;
  }
  throw new Error("upload ended without a video id");
}

async function readRange(file: string, start: number, end: number): Promise<Uint8Array> {
  const parts: Buffer[] = []; for await (const c of createReadStream(file, { start, end: end - 1 })) parts.push(c as Buffer);
  return new Uint8Array(Buffer.concat(parts));
}

/** Subtitle track (SRT). Hindi + English subtitles let non-Hindi speakers follow along. */
export async function uploadCaption(videoId: string, language: string, name: string, srtFile: string): Promise<void> {
  const boundary = `odds${Date.now()}`;
  const meta = JSON.stringify({ snippet: { videoId, language, name, isDraft: false } });
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\ncontent-type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n--${boundary}\r\ncontent-type: application/octet-stream\r\n\r\n`),
    await readFile(srtFile), Buffer.from(`\r\n--${boundary}--`),
  ]);
  const r = await fetch(`${UPLOAD}/captions?uploadType=multipart&part=snippet`, { method: "POST", headers: { authorization: `Bearer ${await token()}`, "content-type": `multipart/related; boundary=${boundary}` }, body });
  if (!r.ok) throw new Error(`caption ${language} failed ${r.status}: ${(await r.text()).slice(0, 300)}`);
}

export async function setThumbnail(videoId: string, png: string): Promise<void> {
  const r = await fetch(`${UPLOAD}/thumbnails/set?videoId=${videoId}&uploadType=media`, { method: "POST", headers: { authorization: `Bearer ${await token()}`, "content-type": "image/png" }, body: new Uint8Array(await readFile(png)) });
  if (!r.ok) throw new Error(`thumbnail failed ${r.status}: ${(await r.text()).slice(0, 300)}${r.status === 403 ? " (verify the channel by phone at youtube.com/verify)" : ""}`);
}

export async function ensurePlaylist(title: string, description: string): Promise<string> {
  const list = await api<any>("GET", `${API}/playlists?part=snippet&mine=true&maxResults=50`);
  const hit = (list.items ?? []).find((p: any) => p.snippet?.title === title); if (hit) return hit.id;
  return (await api<any>("POST", `${API}/playlists?part=snippet,status`, { snippet: { title, description }, status: { privacyStatus: "public" } })).id;
}
export async function addToPlaylist(playlistId: string, videoId: string) { await api("POST", `${API}/playlistItems?part=snippet`, { snippet: { playlistId, resourceId: { kind: "youtube#video", videoId } } }); }

export async function myChannel() {
  const r = await api<any>("GET", `${API}/channels?part=snippet,statistics&mine=true`); const c = r.items?.[0];
  if (!c) throw new Error("No YouTube channel on this Google account");
  return { id: c.id as string, title: c.snippet.title as string, handle: String(c.snippet.customUrl ?? ""), subscribers: Number(c.statistics.subscriberCount ?? 0) };
}

/** Safety lock: refuse to upload unless signed in to the expected channel (never Project 1's or a personal one). */
/** Channels Project 2 must NEVER upload to (Project 1's kids' channel). */
export const BLOCKED_HANDLES = ["@hoppadooo"];
const normHandle = (h: string) => h.trim().toLowerCase().replace(/^@?/, "@");
/** Pure: is this the right channel? Locked to channelHandle when set; while it is empty, any channel except the blocked ones. */
export function channelProblem(handle: string, title: string, expected: string): string | null {
  if (BLOCKED_HANDLES.includes(normHandle(handle))) return `WRONG CHANNEL: signed in to "${title}" (${handle}), which is Project 1's channel. Project 2 never uploads there. Run npm run auth again and pick the new channel.`;
  if (expected && normHandle(handle) !== normHandle(expected)) return `WRONG CHANNEL: signed in to "${title}" (${handle}) but this autopilot is locked to ${expected}. Nothing was uploaded.`;
  return null;
}
export async function assertChannel(expectedHandle: string) {
  const ch = await myChannel(), bad = channelProblem(ch.handle, ch.title, expectedHandle ?? "");
  if (bad) throw new Error(bad);
  return ch;
}

/** Top-level comments: used to count A / B / C votes for the next episode's scorecard. */
export async function commentTexts(videoId: string, max = 500): Promise<string[]> {
  const out: string[] = []; let page = "";
  while (out.length < max) {
    const r = await api<any>("GET", `${API}/commentThreads?part=snippet&videoId=${videoId}&maxResults=100&textFormat=plainText${page ? `&pageToken=${page}` : ""}`);
    for (const it of r.items ?? []) out.push(String(it.snippet?.topLevelComment?.snippet?.textDisplay ?? ""));
    if (!r.nextPageToken) break; page = r.nextPageToken;
  }
  return out;
}

async function report(params: Record<string, string>) {
  const r = await api<any>("GET", `${ANALYTICS}/reports?${new URLSearchParams({ ids: "channel==MINE", ...params })}`);
  const headers: string[] = (r.columnHeaders ?? []).map((h: any) => h.name);
  return (r.rows ?? []).map((row: any[]) => Object.fromEntries(headers.map((h, i) => [h, row[i]])));
}
export const videoStats = (startDate: string, endDate: string) => report({ startDate, endDate, dimensions: "video", sort: "-views", maxResults: "200",
  metrics: "views,estimatedMinutesWatched,averageViewDuration,averageViewPercentage,subscribersGained,likes,comments,shares" });
export const retentionCurve = async (videoId: string, startDate: string, endDate: string): Promise<[number, number][]> =>
  (await report({ startDate, endDate, dimensions: "elapsedVideoTimeRatio", metrics: "audienceWatchRatio", filters: `video==${videoId}` })).map((r: any) => [Number(r.elapsedVideoTimeRatio), Number(r.audienceWatchRatio) * 100]);

// ---------------------------------------------------------------- growth helpers
export const ytGet = <T = any>(pathAndQuery: string) => api<T>("GET", `${API}/${pathAndQuery}`);

/** Post the channel's first comment on a video (the question viewers are asked). The API cannot pin it, so the
 *  run notification asks you to pin it (one tap in the YouTube app). */
export async function postComment(videoId: string, text: string): Promise<string> {
  const r = await api<any>("POST", `${API}/commentThreads?part=snippet`, { snippet: { videoId, topLevelComment: { snippet: { textOriginal: text } } } });
  return r.id;
}

/** Views per day for one video (to score thumbnail styles and publish slots). */
export const videoDaily = async (videoId: string, startDate: string, endDate: string) => {
  const r = await api<any>("GET", `${ANALYTICS}/reports?${new URLSearchParams({ ids: "channel==MINE", startDate, endDate, dimensions: "day", metrics: "views", filters: `video==${videoId}`, sort: "day" })}`);
  return (r.rows ?? []).map((x: any[]) => ({ day: String(x[0]), views: Number(x[1]) }));
};
