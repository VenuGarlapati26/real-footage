# Going to GitHub (same way as Project 1)

The code is ready to push: a fresh checkout installs with `npm ci`, type-checks, and passes every test
(engine, gates, growth, music stack, graphics + languages + writer, pillars, Actions budget). About 90 files, 5 MB.
Nothing publishes until you switch it on, so pushing is safe.

## 1. Repo (5 minutes)
1. Create a **private** repo in your own account, e.g. `real-footage` (empty, no README).
2. Push this folder (unzip `p2-code.zip`, then):
   ```bash
   git init && git add -A && git commit -m "Project 2: real footage channel"
   git branch -M main && git remote add origin https://github.com/<you>/real-footage.git && git push -u origin main
   ```
   Or connect GitHub to Claude (claude.ai -> Settings -> Connectors -> GitHub) and Claude pushes it for you.
3. Settings -> Actions -> General -> Workflow permissions: **Read and write** (the robot commits its ledger).

## 2. Secrets for the first samples (all free)
| Secret | Why | Where |
| --- | --- | --- |
| `PEXELS_API_KEY` | Footage for animals, cities, food, tech, body, money (NASA covers space and Earth) | pexels.com/api |
| `GEMINI_API_KEY` | Weekly writer (3 episodes) + the footage editor that picks every shot | aistudio.google.com -> Get API key |

Then: Actions -> **Samples (8 s, real footage)** -> Run workflow. Download the artifact and check both formats.
Also run **Music bank** once by hand; it then fills itself on Saturdays.

## 3. Before going live
- **A separate Google Cloud project for this channel.** YouTube's free quota is 10,000 units a day *per Cloud
  project*. Project 1 already uses ~6,800, and Project 2 needs up to ~6,600 on long-video days (each upload ~1,600,
  each subtitle track ~400 x 4 languages). Sharing one project would make uploads fail. New project -> enable
  "YouTube Data API v3" + "YouTube Analytics API" -> OAuth client -> `npm run auth` signed in as the **new channel**
  -> secrets `YT_CLIENT_ID`, `YT_CLIENT_SECRET`, `YT_REFRESH_TOKEN`.
- Channel lock: `npm run auth` writes the new channel's handle into `channel/settings.json` -> `channelHandle`; commit
  and push it. Uploads are locked to that channel, and Hoppadooo is always refused.
- Already switched on: `enabled: true`, `mode: "live"`, `dev.fullRenders: true`, `fullVideosConfirmed: true`,
  `autoApprove: true`, E001 and E002 approved. (`mode: "rehearsal"` = private uploads, if you ever want a trial.)
  The Samples workflow always makes 8-second previews (`--preview`), whatever these switches say.
- Instagram, Facebook, TikTok, Snapchat: step by step in [`PLATFORMS.md`](PLATFORMS.md).
- TikTok (and Snapchat when Snap opens it): `ZERNIO_API_KEY`, `ZERNIO_TIKTOK_ID` (`ZERNIO_SNAPCHAT_ID`), see PLATFORMS.md Part C.
- Optional: `NTFY_TOPIC` (phone alerts),
  `NOTION_TOKEN` + `NOTION_DATABASE_ID`, `GOOGLE_TTS_API_KEY` (a more natural free voice).

## Actions minutes (why long videos are not always 4K)
GitHub's free runners for private repos have 2 CPU cores. Measured here on the same hardware: Shorts take ~11 s of
compute per second of video, 4K long videos ~32 s (a 4-minute 4K video is ~2 hours). Your allowance is ~3,000
minutes a month ($18, GitHub Pro), shared with Project 1 (~600), and the $0 budget blocks overage. So
`autopilot/budget.ts` picks each long video's resolution from what is left this month (`budget.minutesPerMonth`,
1,800 by default): 4K when it fits, otherwise 1440p, otherwise 1080p. It learns the real speed from every run.
Making the repo **public** would give 4-core runners and unlimited minutes (4K every time); your keys stay secret
either way, but the code becomes visible.
