# Project 2: Real Footage, Explained

Every video is built from **real camera footage** (NASA, Wikimedia Commons, Pexels, Pixabay, or your own phone
clips) and explains what you are seeing, with premium motion graphics on top. **English first**, with Hindi, Spanish
and Portuguese subtitle tracks on the same video (and full dubs possible). Every number sourced, footage credited on
screen. No generated video. The channel's promise is on screen in every video: "REAL FOOTAGE".

| | |
| --- | --- |
| Cost | **Free.** Paid tools (ElevenLabs, Semrush) are wired in but off; see `docs/STACK.md` |
| Formats | Long video 16:9 (YouTube) and a Short 9:16 (YouTube Shorts, Instagram Reels, Facebook Reels, Snapchat Spotlight) |
| **Development mode** | **On.** Every render is capped at 8 seconds, in both formats (`channel/settings.json` -> `dev`). Nothing publishes until `dev.fullRenders` is true |
| Footage | `engine/footage.ts`: searches each provider, downloads, checks resolution, finds the scene cuts inside a clip and picks a clean take, never reuses the same segment, records licence + credit for every clip |
| Edit | `engine/edit.ts`: supersampled slow camera moves, level matching, one film look (`engine/grade.ts`, a generated 3D LUT), hard cuts, fine grain, vignette |
| Graphics | `engine/mograph/`: a motion-graphics layer drawn by Chromium over the footage: hook card with masked word reveals, serif headlines that type and slide in, numbers that count up, an animated orbit diagram, 3-word captions with the spoken word lit, a progress line, flash cuts on scene changes, the question card. Variable fonts (Inter, Playfair Display, JetBrains Mono; Mukta + Noto Serif Devanagari for Hindi). libass titles remain as fallback |
| Languages | `engine/langs.ts`: English master + `hi`, `es`, `pt`, `fr`, `it` (voices, UI strings, fonts). `channel/settings.json` -> `lang`, `subtitles` |
| Writer | `growth/writer.ts`: the trend radar's best idea -> a full episode (Short + long scenes, all languages), facts quoted word for word from the source, every gate must pass (free Gemini key) |
| Footage editor | `engine/curate.ts`: looks at contact sheets of the real footage and picks the takes that show what is being said (free Gemini vision); the build cuts exactly those takes |
| Voice | `engine/voice.py`: your recording -> Google neural Hindi voice -> Gemini TTS -> Kokoro (all free) |
| Music | `engine/music.ts`: a mood per episode and an energy curve from the scenes, original tracks from the free music bank (ACE-Step 1.5, composed weekly by `music-bank.yml`) with the climax lined up on the reveal, synth fallback, free sound effects on the hook, numbers and the reveal, ducked under the voice, mastered to -14 LUFS |
| Gates | `engine/gates.ts`: hook scores (YouTube + Reels), title/thumbnail, caption, every number sourced, footage fallbacks, rights, both languages. Uses the MIT tools from youtube-agent-skill and instagram-agent-skill |

## What the channel makes: 11 content pillars, chosen by results

`channel/pillars.json`: space, extreme Earth, the deep ocean, wild animals, mega engineering, cities & places,
history in real footage, future tech, money explained, food & culture, the human body. Each brings its own trend
seeds, Wikipedia pages to watch, footage sources and music mood. Every week (`autopilot/weekly.ts` + `growth/pillars.ts`)
each pillar is scored on how its videos actually did in their first 7 days on **YouTube + Instagram Reels +
Facebook Reels**, against the channel's median, Shorts and long videos separately. Next week's episodes then come
mostly from the winners, with about 30% kept for testing the others, so a new audience is never missed.

## Picture: 4K long videos
`channel/settings.json` -> `output`: long videos in **2160p (4K UHD)**, Shorts in 1080x1920 (the most Shorts/Reels
play). 4K sources are preferred; HD sources are upscaled with lanczos, de-blocked and re-sharpened. Graphics are drawn
at the output's pixel density (razor-sharp type at 4K). Film halation on highlights, gentle colour-safe level matching,
one film LUT, fine grain, vignette.

## Growth engine (built in, runs by itself)

| Lever | How | Where |
| --- | --- | --- |
| Hooks that stop the scroll | Every opening scored on YouTube + Reels scales; the bar rises automatically if viewers leave early. Shorts open with on-screen words different from the spoken line | `engine/gates.ts`, `engine/titles.ts` |
| Comments | A real question on the end card + posted as the channel's first comment (you pin it with one tap) | `growth/captions.ts`, `autopilot/daily.ts` |
| Re-watches | Shorts end on a loop line and the last frame dissolves into the first, no fade to black | `engine/edit.ts` |
| Shares (Instagram) | "Send this to..." line in the Reels caption; cover = the best real frame | `growth/captions.ts`, `autopilot/meta.ts` |
| Clicks | 3 thumbnail styles from the sharpest, most colourful real frame; the winner learned from first-3-day views | `growth/thumbs.ts`, `growth/learn.ts` |
| Timing | Publish slots tried, scored and picked (mostly the winner, 20% exploring) | `growth/learn.ts` |
| Pacing | Retention drop-offs mapped to the shots on screen; shot length tightens when long shots lose people | `growth/learn.ts`, `autopilot/weekly.ts` |
| What to make | Trend radar: outliers vs their own channel's median (your yt-viral tool), Wikipedia attention spikes, YouTube search demand | `growth/trends.ts` -> `channel/ideas.json` |
| More platforms | Instagram Reels + Facebook Reels posted automatically (resumable upload, honest AI flag) | `autopilot/meta.ts` |
| Picture quality | Candidates ranked by sharpness, colour, exposure and resolution, not first-found | `engine/footage.ts` |
| Planning | Ideas and published videos synced to a Notion board weekly; your "Make next" picks come back. Optional Google search volumes (Semrush or DataForSEO) | `growth/notion.ts`, `growth/keywords.ts` |
| Honesty | Scenes promising "real footage" may only use NASA, Wikimedia or your clips (stock "earth from space" is often CGI) | `engine/gates.ts` |

## Going to GitHub
See [`docs/GO-LIVE.md`](docs/GO-LIVE.md): repo, secrets, the separate Google Cloud project, and the Actions-minutes guard.

## Run

```bash
npm install && pip install kokoro-onnx soundfile
npx tsx engine/gates.ts episodes/E001-iss-16-sunrises.json
npx tsx engine/build.ts episodes/E001-iss-16-sunrises.json --formats long,short   # 8-second samples -> out/E001/
npx tsx engine/build.ts episodes/E001-iss-16-sunrises.json --formats short --from s4   # 8 s starting at a later scene (to review graphics)
npx tsx growth/writer.ts --idea "Why the Moon is drifting away" --approve           # write an episode (GEMINI_API_KEY)
npx tsx engine/curate.ts episodes/E002-....json                                      # pick its shots
npm test
npx tsx growth/trends.ts      # trend radar now (needs YouTube secrets for outliers)
```

On GitHub, the **Samples (8 s, real footage)** workflow does the same with real footage whenever an episode changes,
and keeps the results as a downloadable artifact.

## Layout
```
episodes/   scripts: narration (hi + en), footage queries per scene, overlays, sources with exact claims
engine/     footage, grade, titles, edit, audio, voice.py, build, gates, types
autopilot/  daily (publish), weekly (self-revision), youtube, auth, notify, qa
footage/    your own clips (optional, most authentic)      narration/  your recordings (optional)
assets/fonts/  Mukta, Noto Serif Devanagari, Inter, Playfair Display, JetBrains Mono (SIL Open Font License)
vendor/skills/ the two MIT skill repos' tools               docs/       SETUP.md, TOOLS.md, STACK.md (every tool, cost, decision)
```
