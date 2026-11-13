# Setup

## To get real 8-second samples (about 10 minutes, all free)

1. **Connect GitHub to Claude** (claude.ai -> Settings -> Connectors -> GitHub). Claude can then push this code,
   run the sample workflow and check the results itself.
2. **Create an empty private repo** in your account (e.g. `real-footage`) and tell Claude its name.
3. **Pexels key** (free, instant): pexels.com/api -> "Get started" -> copy the key. In the repo: Settings -> Secrets and
   variables -> Actions -> New secret `PEXELS_API_KEY`.
4. Optional, more footage: **Pixabay key** (pixabay.com/api/docs, free) -> secret `PIXABAY_API_KEY`.
5. Optional, a natural Hindi voice: **Google Cloud Text-to-Speech** (free tier, 1 million characters a month for
   neural voices). In the same Google Cloud project you use for YouTube: enable "Cloud Text-to-Speech API", create
   an API key restricted to that API -> secret `GOOGLE_TTS_API_KEY`. Or a **Gemini API key** (aistudio.google.com)
   -> secret `GEMINI_API_KEY`.

6. Music: nothing to set up. After the repo exists, run the **Music bank (free, ACE-Step)** workflow once by hand
   (Actions tab -> Run workflow); it then runs itself on Saturdays until the bank is full. Until the first tracks
   arrive, videos use the synthesised score.

7. **Gemini key** (free, aistudio.google.com -> Get API key) -> secret `GEMINI_API_KEY`. It switches on the weekly
   writer (3 new episodes a week from the trend radar, `channel/settings.json` -> `writer`) and the footage editor that
   picks every shot. New episodes stay drafts until you set `"status": "approved"` (or `autoApprove: true`).

NASA footage needs no key.

## Notion board (optional, free)
notion.so/my-integrations -> New integration -> copy the token -> secret `NOTION_TOKEN`. Create an empty full-page
database, "..." -> Connections -> add your integration, copy the id from its link -> secret `NOTION_DATABASE_ID`.
The weekly run creates the columns and fills it. Search volumes (optional): `SEMRUSH_API_KEY`, or
`DATAFORSEO_LOGIN` + `DATAFORSEO_PASSWORD`. See `docs/STACK.md` for what each costs.

## Your own footage and voice (the most "real" option)
- Clips: put them in `footage/E001/s1.mp4` etc. (the scene ids in the episode file). They are used before any
  online source and credited as your own footage.
- Narration: record each line on your phone into `narration/E001/hi/s1.m4a` etc. It is cleaned automatically and
  used instead of any synthetic voice, and the AI-voice disclosure switches off.

## Instagram + Facebook (automatic Reels)
1. Make the Instagram account Professional (Creator or Business) and link it to a Facebook Page.
2. developers.facebook.com -> create an app (type Business) -> add "Instagram" and "Facebook Login for Business".
3. Get a long-lived access token with `instagram_basic`, `instagram_content_publish`, `pages_show_list`,
   `pages_read_engagement`, `pages_manage_posts`. Secrets: `META_ACCESS_TOKEN`, `IG_USER_ID`, `FB_PAGE_ID`
   (and `FB_PAGE_TOKEN` if the Page token differs).
Until then, each day's Short and its Instagram caption are saved in the `platform-pack` artifact.

## Going live (after you approve the 8-second samples)
In `channel/settings.json`: `dev.fullRenders: true`, then `fullVideosConfirmed: true`, `enabled: true`, set
`channelHandle` to the new channel, and `mode: "live"`. YouTube sign-in: `npm run auth` (see the comments in
`autopilot/auth.ts`). Secrets: `YT_CLIENT_ID`, `YT_CLIENT_SECRET`, `YT_REFRESH_TOKEN`.
