// One-time YouTube sign-in for the NEW channel (run on your computer): npm run auth
// Needs YT_CLIENT_ID and YT_CLIENT_SECRET in .env (a Google Cloud "Desktop app" OAuth client, ideally its own
// Cloud project so Project 2 has its own 10,000-unit daily quota). Prints YT_REFRESH_TOKEN for GitHub Secrets.
// Refuses Project 1's channel (Hoppadooo), and any channel other than channel/settings.json -> channelHandle when that
// is set. When channelHandle is empty, it fills it in with the channel you picked: commit + push channel/settings.json.
import http from "node:http";
import { readFileSync, writeFileSync } from "node:fs";
import { exec } from "node:child_process";
import { SCOPES, channelProblem } from "./youtube";

try { process.loadEnvFile(".env"); } catch { /* optional */ }
const id = process.env.YT_CLIENT_ID, secret = process.env.YT_CLIENT_SECRET;
if (!id || !secret) { console.error("Put YT_CLIENT_ID and YT_CLIENT_SECRET in .env first (docs/SETUP.md)."); process.exit(1); }
const port = 53682, redirect = `http://127.0.0.1:${port}/callback`;
const url = "https://accounts.google.com/o/oauth2/v2/auth?" + new URLSearchParams({ client_id: id, redirect_uri: redirect, response_type: "code", scope: SCOPES.join(" "), access_type: "offline", prompt: "consent" });
const server = http.createServer(async (req, res) => {
  const u = new URL(req.url ?? "/", redirect); if (u.pathname !== "/callback") { res.writeHead(404); res.end(); return; }
  const code = u.searchParams.get("code"); if (!code) { res.end("Sign-in cancelled."); server.close(); return; }
  const j: any = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ code, client_id: id, client_secret: secret, redirect_uri: redirect, grant_type: "authorization_code" }) }).then(r => r.json());
  if (!j.refresh_token) { res.end(`No refresh token: ${JSON.stringify(j)}`); server.close(); return; }
  const ch: any = await fetch("https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true", { headers: { authorization: `Bearer ${j.access_token}` } }).then(x => x.json()).catch(() => ({}));
  const title = ch.items?.[0]?.snippet?.title ?? "(unknown)", handle = String(ch.items?.[0]?.snippet?.customUrl ?? "");
  const settings = JSON.parse(readFileSync("channel/settings.json", "utf8")), expected = settings.channelHandle ?? "";
  const bad = channelProblem(handle, title, expected);
  if (bad || !handle) {
    res.end(bad ?? `"${title}" has no @handle yet. Give it one in YouTube Studio -> Customisation -> Basic info, then run npm run auth again.`);
    console.error(`\nNOT CONNECTED: ${bad ?? `"${title}" has no @handle yet`}. No keys printed.`); server.close(); process.exitCode = 1; return;
  }
  if (!expected) {   // first sign-in: lock the autopilot to this channel from now on
    settings.channelHandle = handle; writeFileSync("channel/settings.json", JSON.stringify(settings, null, 2) + "\n");
    console.log(`\nchannel/settings.json -> channelHandle is now ${handle}. Commit and push that file.`);
  }
  res.end(`Connected to "${title}" ${handle}. Close this tab.`);
  console.log(`\nConnected to "${title}" ${handle}\nAdd to GitHub -> Settings -> Secrets -> Actions:\nYT_CLIENT_ID     = ${id}\nYT_CLIENT_SECRET = ${secret}\nYT_REFRESH_TOKEN = ${j.refresh_token}\n`);
  server.close();
});
server.listen(port, "127.0.0.1", () => { console.log(`\nOpen this to sign in:\n${url}\n`); exec(process.platform === "win32" ? `start "" "${url}"` : process.platform === "darwin" ? `open "${url}"` : `xdg-open "${url}"`, () => {}); });
