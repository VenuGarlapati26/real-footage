# One video, every platform: setup

Every day GitHub makes one Short (and a long video on Mon/Wed/Fri/Sun) and releases it on every platform **at the
same moment**, with nobody touching anything:

| Platform | How it gets there | What you set up once |
| --- | --- | --- |
| **YouTube** (long + Shorts) | Automatic: upload, schedule, 4 subtitle languages, thumbnail, first comment | Part A (20 min) |
| **Instagram Reels** | Automatic: uploaded in the daily run, published at the Short's time by `release.yml` | Part B (30 min, shared with Facebook) |
| **Facebook Reels** | Automatic: scheduled natively for the Short's time | Part B |
| **TikTok** | Automatic through Zernio (free for 2 accounts), scheduled for the Short's time | Part C (10 min) |
| **Snapchat Spotlight** | Automatic through Zernio **as soon as Snap opens it** (not yet, Nov 2026); until then the platform-pack has it ready | Part C |
| **All of them** | Views come back every week and decide what gets made next | nothing extra |

Order: do Part A, run a rehearsal (private uploads), then Part B, then Part C. Every secret goes in the GitHub repo:
**Settings -> Secrets and variables -> Actions -> New repository secret**. Nothing goes in the code.

---

## Part A: YouTube (new channel)

**1. The channel.** On YouTube, switch to your Google account -> profile picture -> Settings -> **Add or manage your
channel(s)** -> Create a channel (a Brand Account, so it is separate from your other channels). Pick the name and handle.
Then: Studio -> Settings -> Channel -> Advanced: "No, it's not made for kids". Studio -> Settings -> Upload defaults:
category Science & Technology, language English. Verify the channel with a phone number (needed for custom
thumbnails and videos over 15 minutes).

**2. A Google Cloud project just for this channel** (YouTube's free quota is 10,000 units a day *per Cloud project*;
Project 1 already uses ~6,800, this channel needs up to ~6,600):
1. console.cloud.google.com -> project menu -> **New project** -> name it `real-footage`.
2. APIs & Services -> Library -> enable **YouTube Data API v3** and **YouTube Analytics API**.
3. APIs & Services -> OAuth consent screen: External, app name, your email; add yourself as a test user.
   Then **Publish app -> In production**. (In "Testing" mode the sign-in expires after 7 days and uploads stop.
   It stays unverified, which is fine for your own account: you just click through a warning once.)
4. Credentials -> Create credentials -> **OAuth client ID** -> Desktop app. Copy the client ID and secret.

**3. Sign in once, on your computer** (in the repo folder):
```bash
# .env (never commit it)
YT_CLIENT_ID=...apps.googleusercontent.com
YT_CLIENT_SECRET=...
```
Then `npm install && npm run auth`. A browser opens: pick **the new channel** (Project 1's channel is always refused). It prints
`YT_REFRESH_TOKEN` and writes the channel's handle into `channel/settings.json` -> `channelHandle`, which locks the
autopilot to that channel. **Commit and push `channel/settings.json`.**

**4. Secrets:** `YT_CLIENT_ID`, `YT_CLIENT_SECRET`, `YT_REFRESH_TOKEN`.

**5. That's it.** The autopilot is already switched on (`enabled: true`, `mode: "live"`, full renders). From the next
daily run (18:30 IST) videos are scheduled public at the learned best time. Until the YouTube secrets exist, each run
just sends a "waiting for YouTube sign-in" alert and stops. Want a private trial first? Set `"mode": "rehearsal"`: videos
arrive in Studio as private.

---

## Part B: Instagram + Facebook (one Meta setup for both)

**1. Accounts**
1. Create a **Facebook Page** for the channel (facebook.com/pages/create), same name and picture.
2. Create the **Instagram** account, then: Settings -> Account type and tools -> **Switch to professional account**
   -> Creator (or Business).
3. Link them: on the Page, Settings -> Linked accounts -> Instagram -> connect. (Or in Meta Business Suite.)

**2. A Business portfolio** (free): business.facebook.com -> create one -> Settings -> Accounts: add the **Page**
and the **Instagram account** to it.

**3. The Meta app**
1. developers.facebook.com -> My apps -> **Create app** -> use case "Other" -> type **Business** -> attach it to
   your Business portfolio.
2. Add products: **Instagram** (choose "API setup with Facebook login") and **Facebook Login for Business**.
3. The app can stay in development mode: you are an admin of the app and own the accounts, so publishing to your
   own Page and Instagram works without App Review.

**4. A token that never expires** (a system user, so nothing breaks after 60 days):
1. business.facebook.com -> Settings -> Users -> **System users** -> Add -> name `autopilot`, role **Admin**.
2. **Assign assets** -> the Page (full control) and the Instagram account (full control). Also Apps -> your app.
3. **Generate token** -> pick your app -> expiry **Never** -> tick these permissions:
   `instagram_basic`, `instagram_content_publish`, `instagram_manage_insights`, `pages_show_list`,
   `pages_read_engagement`, `pages_manage_posts`, `read_insights`, `business_management`.
   Copy the token (it is shown once).

**5. The two IDs** (Graph API Explorer at developers.facebook.com/tools/explorer, paste the token):
- `me/accounts` -> your Page's `id` = **FB_PAGE_ID**
- `<FB_PAGE_ID>?fields=instagram_business_account` -> that `id` = **IG_USER_ID**

**6. Secrets:** `META_ACCESS_TOKEN` (the system-user token), `IG_USER_ID`, `FB_PAGE_ID`.
(`FB_PAGE_TOKEN` is not needed: the robot asks Meta for the Page's token itself.)

**7. Check:** if the Page asks for "Page Publishing Authorization" (Settings -> Page setup), complete it, or
publishing is blocked. Then the next live run posts the Short as a Reel on both, with its own captions and the AI
label set honestly (`is_ai_generated` when the voice is synthetic). Limits: up to 100 API posts per 24 h on
Instagram; we use 1.

---

## Part C: TikTok and Snapchat (Zernio, free)

TikTok and Snap only let approved apps post. Zernio is an approved posting service; its free tier is 2 connected
accounts with unlimited posts, which is exactly TikTok + Snapchat.

1. Create the **TikTok** account (same name and picture). In TikTok: Profile -> menu -> Settings -> Account ->
   **Switch to Business account**.
2. Sign up at **zernio.com** (no card needed). Create a profile, then **Connect account -> TikTok** and log in with
   the channel's TikTok account.
3. Zernio -> Settings -> **API keys -> Create** -> copy the key. Zernio -> Accounts -> copy the TikTok account's **id**.
4. Secrets: `ZERNIO_API_KEY`, `ZERNIO_TIKTOK_ID`.
5. **Snapchat:** create a **Public Profile** in the Snapchat app (Profile -> Create Public Profile). In Zernio try
   **Connect account -> Snapchat**. Today this returns "PLATFORM_BETA_RESTRICTED" (Snap has not approved Zernio yet).
   When it works, copy that account's id into the secret `ZERNIO_SNAPCHAT_ID`; the next run starts posting Spotlight.
   Until then: Actions -> the Daily run -> **platform-pack** has `E00x-short.mp4` + `E00x-tiktok-snapchat.txt`.

Videos made with the synthetic voice are labelled honestly on TikTok ("AI-generated content"), as on YouTube and
Instagram. Switch a platform off without removing secrets: `channel/settings.json` -> `social.tiktok` / `social.snapchat`.

## How "all at the same moment" works
- The daily run (18:30 IST) renders the Short **first**, picks its time (07:30, 12:30 or 19:30 IST, learned from views;
  a time already past today means tomorrow), and then:
  YouTube `publishAt` -> that time; Facebook `SCHEDULED` -> that time; TikTok/Snapchat `scheduledFor` -> that time;
  Instagram: uploaded and processed now, published by **release.yml** at that time (Instagram's API cannot schedule).
- `release.yml` runs at 07:31, 12:31 and 19:31 IST, takes ~20 seconds, about 90 Actions minutes a month. If you
  change `shortTimes` in `channel/settings.json`, change its three times too.
- Long videos go to YouTube only (the other platforms take the Short).

---

## What comes back

The weekly review (Mon + Thu) reads each video's first 7 days on **YouTube + Instagram + Facebook**, scores every
content pillar and story format against the channel's median, and shifts next week's episodes towards what works
(~30% keeps testing). TikTok/Snapchat views aren't read yet; if one of them takes off, tell Claude and they can be added.

## Phone alerts (optional)
Install the **ntfy** app, subscribe to a long random topic name, and add it as the secret `NTFY_TOPIC`. You get a
message after every run: what went out, links, and what to pin.
