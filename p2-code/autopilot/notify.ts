// Notifications (from Project 1): GitHub emails on a failed workflow, the workflow opens an Issue, and an optional
// instant phone push via ntfy.sh (free) when NTFY_TOPIC is set.
import { appendFile } from "node:fs/promises";

export async function notify(title: string, message: string, opts: { topic?: string; priority?: "default" | "high"; tags?: string } = {}) {
  console.log(`\n[notify] ${title}\n${message}\n`);
  const topic = process.env.NTFY_TOPIC || opts.topic;
  if (topic) {
    try { await fetch(`https://ntfy.sh/${encodeURIComponent(topic)}`, { method: "POST", body: message.slice(0, 3800), headers: { Title: title.replace(/[^\x20-\x7E]/g, ""), Priority: opts.priority === "high" ? "high" : "default", Tags: opts.tags ?? "tv" } }); }
    catch (e) { console.warn("ntfy failed:", String(e)); }
  }
  if (process.env.GITHUB_STEP_SUMMARY) await appendFile(process.env.GITHUB_STEP_SUMMARY, `### ${title}\n\n${message}\n\n`).catch(() => {});
}
