// Notion as the channel's control room (optional: NOTION_TOKEN + NOTION_DATABASE_ID).
//
// Weekly, one Notion database gets:
//   - every idea from the trend radar (channel/ideas.json), with its score and why
//   - every published video from the ledger, with its link and views
// and you steer from Notion: set an idea's Status to "Make next" and it lands in channel/requests.json, which the
// weekly report puts at the top of "Make next". Nothing else reads Notion, so the channel still runs if it is down.
//
// Setup: notion.so/my-integrations -> new internal integration -> copy the token. Make an empty full-page database,
// "..." -> Connections -> add the integration, copy the database id from its URL. The columns are created for you.

const API = () => process.env.NOTION_BASE ?? "https://api.notion.com";
const VERSION = "2022-06-28";

export const notionReady = () => !!(process.env.NOTION_TOKEN && process.env.NOTION_DATABASE_ID);

async function call(method: string, p: string, body?: unknown) {
  const r = await fetch(`${API()}${p}`, { method, headers: { authorization: `Bearer ${process.env.NOTION_TOKEN}`, "notion-version": VERSION, "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
  const j: any = await r.json(); if (!r.ok) throw new Error(`notion ${r.status}: ${j.message ?? ""}`); return j;
}

const SCHEMA = {
  Kind: { select: { options: [{ name: "Idea", color: "blue" }, { name: "Video", color: "green" }] } },
  Status: { select: { options: [{ name: "New", color: "gray" }, { name: "Make next", color: "orange" }, { name: "Skip", color: "red" }, { name: "Scheduled", color: "yellow" }, { name: "Published", color: "green" }] } },
  Topic: { select: {} }, Score: { number: {} }, Why: { rich_text: {} }, Link: { url: {} }, Views: { number: {} }, Date: { date: {} }, Key: { rich_text: {} },
};

/** Rows as Notion properties. Pure, so it is tested offline. `Key` is a stable id, so re-syncing updates, never duplicates. */
export function ideaProps(i: { idea: string; topic: string; score: number; why: string[] }, title: string) {
  return { [title]: { title: [{ text: { content: i.idea.slice(0, 200) } }] }, Kind: { select: { name: "Idea" } }, Topic: { select: { name: i.topic } },
    Score: { number: i.score }, Why: { rich_text: [{ text: { content: i.why.slice(0, 3).join(" | ").slice(0, 1900) } }] }, Key: { rich_text: [{ text: { content: `idea:${i.idea.toLowerCase()}`.slice(0, 200) } }] } };
}
export function videoProps(r: { date: string; episode: string; job: string; title: string; topic: string; url?: string; videoId?: string; publishAt?: string; status: string }, views: number | undefined, title: string) {
  return { [title]: { title: [{ text: { content: r.title.slice(0, 200) } }] }, Kind: { select: { name: "Video" } }, Topic: { select: { name: r.topic } },
    Status: { select: { name: r.videoId ? (r.publishAt && Date.parse(r.publishAt) > Date.now() ? "Scheduled" : "Published") : "New" } },
    ...(r.url ? { Link: { url: r.url } } : {}), ...(views != null ? { Views: { number: views } } : {}), Date: { date: { start: (r.publishAt ?? r.date).slice(0, 10) } },
    Key: { rich_text: [{ text: { content: `video:${r.episode}:${r.job}:${r.date}` } }] } };
}

/** Sync ideas + videos; returns the ideas you marked "Make next" in Notion. */
export async function syncNotion(ideas: { idea: string; topic: string; score: number; why: string[] }[], ledger: any[], views: Record<string, number> = {}) {
  const db = process.env.NOTION_DATABASE_ID!;
  const meta = await call("GET", `/v1/databases/${db}`);
  const title = Object.entries<any>(meta.properties).find(([, v]) => v.type === "title")![0];
  const missing = Object.fromEntries(Object.entries(SCHEMA).filter(([k]) => !meta.properties[k]));
  if (Object.keys(missing).length) await call("PATCH", `/v1/databases/${db}`, { properties: missing });
  // existing rows by Key (+ their Status, which is yours to set)
  const existing = new Map<string, { id: string; status?: string; name: string }>();
  let cursor: string | undefined;
  do {
    const q = await call("POST", `/v1/databases/${db}/query`, { page_size: 100, ...(cursor ? { start_cursor: cursor } : {}) });
    for (const p of q.results) { const k = p.properties.Key?.rich_text?.[0]?.plain_text; if (k) existing.set(k, { id: p.id, status: p.properties.Status?.select?.name, name: p.properties[title]?.title?.[0]?.plain_text ?? "" }); }
    cursor = q.has_more ? q.next_cursor : undefined;
  } while (cursor);
  let created = 0, updated = 0;
  const upsert = async (key: string, props: any, defaultStatus?: string) => {
    const e = existing.get(key);
    if (e) { await call("PATCH", `/v1/pages/${e.id}`, { properties: props }); updated++; }
    else { await call("POST", "/v1/pages", { parent: { database_id: db }, properties: { ...props, ...(defaultStatus && !props.Status ? { Status: { select: { name: defaultStatus } } } : {}) } }); created++; }
  };
  for (const i of ideas.slice(0, 25)) await upsert(`idea:${i.idea.toLowerCase()}`.slice(0, 200), ideaProps(i, title), "New");
  for (const r of ledger.filter(r => r.status !== "failed")) await upsert(`video:${r.episode}:${r.job}:${r.date}`, videoProps(r, r.videoId ? views[r.videoId] : undefined, title));
  const requested = [...existing.entries()].filter(([k, v]) => k.startsWith("idea:") && v.status === "Make next").map(([, v]) => v.name);
  return { created, updated, requested };
}
