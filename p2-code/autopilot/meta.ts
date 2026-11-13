// Instagram Reels + Facebook Reels, posted automatically with Meta's resumable upload (the file goes straight to
// Meta; no public hosting needed). Needs an Instagram professional account linked to a Facebook Page and a Meta app.
// Secrets: META_ACCESS_TOKEN (a system-user token: never expires), IG_USER_ID, FB_PAGE_ID. The Page token is fetched
// automatically (or set FB_PAGE_TOKEN). Setup: docs/PLATFORMS.md.
//
// Everything goes out at the same moment as YouTube: Facebook is scheduled natively; Instagram has no scheduling
// in its API, so the Reel is uploaded and processed in the daily run and published by autopilot/release.ts.
//
// Each platform gets its own caption (written for that feed and checked by the gates), and the cover frame is the
// best frame the thumbnail picker found. `is_ai_generated` is set honestly when the narration is synthetic.

import { readFile, stat } from "node:fs/promises";

// v25.0 is supported until July 2028 (Meta retires each version ~2 years after release; v21.0 ended Jan 2027)
export const META_VERSION = "v25.0";
const G = process.env.META_GRAPH ?? `https://graph.facebook.com/${META_VERSION}`;
const RUP = process.env.META_RUPLOAD ?? "https://rupload.facebook.com";
export const hasInstagram = () => !!(process.env.META_ACCESS_TOKEN && process.env.IG_USER_ID);
export const hasFacebook = () => !!((process.env.FB_PAGE_TOKEN || process.env.META_ACCESS_TOKEN) && process.env.FB_PAGE_ID);

async function form(url: string, params: Record<string, string>, token: string) {
  const r = await fetch(url, { method: "POST", headers: { authorization: `OAuth ${token}`, "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(params) });
  const j: any = await r.json().catch(() => ({})); if (!r.ok || j.error) throw new Error(`Meta ${url.split("?")[0]}: ${JSON.stringify(j.error ?? j).slice(0, 300)}`); return j;
}
async function uploadBytes(uri: string, file: string, token: string) {
  const size = (await stat(file)).size;
  const r = await fetch(uri, { method: "POST", headers: { authorization: `OAuth ${token}`, offset: "0", file_size: String(size) }, body: new Uint8Array(await readFile(file)) });
  const j: any = await r.json().catch(() => ({})); if (!r.ok || j.success === false) throw new Error(`upload to Meta failed ${r.status}: ${JSON.stringify(j).slice(0, 300)}`);
}
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

/** Upload a Reel and let Meta process it, WITHOUT publishing (Instagram's API cannot schedule). Returns the
 *  container id; publish it within 24 h with publishInstagram (autopilot/release.ts does that at the Short's time). */
export async function prepareInstagramReel(file: string, caption: string, o: { coverMs?: number; aiGenerated: boolean }): Promise<string> {
  const token = process.env.META_ACCESS_TOKEN!, ig = process.env.IG_USER_ID!;
  const c = await form(`${G}/${ig}/media`, { media_type: "REELS", upload_type: "resumable", caption, ...(o.coverMs !== undefined ? { thumb_offset: String(Math.round(o.coverMs)) } : {}), is_ai_generated: String(o.aiGenerated) }, token);
  await uploadBytes(c.uri ?? `${RUP}/ig-api-upload/${META_VERSION}/${c.id}`, file, token);
  for (let i = 0; i < 60; i++) {   // wait for Meta to finish processing (up to ~10 minutes)
    const s: any = await fetch(`${G}/${c.id}?fields=status_code,status`, { headers: { authorization: `OAuth ${token}` } }).then(r => r.json());
    if (s.status_code === "FINISHED") return c.id;
    if (s.status_code === "ERROR" || s.status_code === "EXPIRED") throw new Error(`Instagram processing failed: ${s.status}`);
    await sleep(Number(process.env.META_POLL_MS ?? 10_000));
  }
  throw new Error("Instagram is still processing the Reel after 10 minutes");
}
export async function publishInstagram(containerId: string): Promise<string> {
  return (await form(`${G}/${process.env.IG_USER_ID!}/media_publish`, { creation_id: containerId }, process.env.META_ACCESS_TOKEN!)).id;
}
/** Upload and publish right away. */
export async function instagramReel(file: string, caption: string, o: { coverMs?: number; aiGenerated: boolean }): Promise<string> {
  return publishInstagram(await prepareInstagramReel(file, caption, o));
}

/** The Page's own token: FB_PAGE_TOKEN if set, otherwise asked from Meta with the system-user token (never expires). */
let pageToken: string | undefined;
export async function facebookPageToken(): Promise<string> {
  if (process.env.FB_PAGE_TOKEN) return process.env.FB_PAGE_TOKEN;
  if (pageToken) return pageToken;
  const r: any = await fetch(`${G}/${process.env.FB_PAGE_ID}?fields=access_token`, { headers: { authorization: `OAuth ${process.env.META_ACCESS_TOKEN}` } }).then(x => x.json()).catch(() => ({}));
  return (pageToken = r.access_token ?? process.env.META_ACCESS_TOKEN!);
}

/** Facebook Reel: published now, or scheduled natively for `publishAt` (Meta needs it 10 min to 29 days ahead). */
export async function facebookReel(file: string, description: string, publishAt?: string): Promise<string> {
  const token = await facebookPageToken(), page = process.env.FB_PAGE_ID!;
  const s = await form(`${G}/${page}/video_reels`, { upload_phase: "start" }, token);
  await uploadBytes(s.upload_url ?? `${RUP}/video-upload/${META_VERSION}/${s.video_id}`, file, token);
  const when = publishAt ? Math.floor(Date.parse(publishAt) / 1000) : 0, later = when - Date.now() / 1000 > 11 * 60;
  await form(`${G}/${page}/video_reels`, { upload_phase: "finish", video_id: s.video_id, description,
    ...(later ? { video_state: "SCHEDULED", scheduled_publish_time: String(when) } : { video_state: "PUBLISHED" }) }, token);
  return s.video_id;
}

/** Views of a published Instagram Reel (insights "views"; older API versions call it "plays"). 0 if unavailable. */
export async function instagramViews(mediaId: string): Promise<number> {
  const token = process.env.META_ACCESS_TOKEN; if (!token) return 0;
  for (const metric of ["views", "plays"]) {
    const r = await fetch(`${G}/${mediaId}/insights?metric=${metric}`, { headers: { authorization: `OAuth ${token}` } });
    const j: any = await r.json().catch(() => ({}));
    const v = j.data?.[0]?.values?.[0]?.value ?? j.data?.[0]?.total_value?.value; if (typeof v === "number") return v;
  }
  return 0;
}

/** Views of a published Facebook Reel (video insights "total_video_views"). 0 if unavailable. */
export async function facebookViews(videoId: string): Promise<number> {
  if (!process.env.FB_PAGE_TOKEN && !process.env.META_ACCESS_TOKEN) return 0;
  const token = await facebookPageToken();
  const r = await fetch(`${G}/${videoId}/video_insights?metric=total_video_views`, { headers: { authorization: `OAuth ${token}` } });
  const j: any = await r.json().catch(() => ({})); const v = j.data?.[0]?.values?.[0]?.value;
  return typeof v === "number" ? v : 0;
}
