# Tool stack: free by default

Everything the channel needs runs at zero cost: free APIs, open-source models on GitHub's free runners, and code.
Paid tools are wired in but **switched off**; they only run if you add their key *and* opt in.

## What runs (all free)

| Job | Tool | Licence / cost | Notes |
| --- | --- | --- | --- |
| Footage | NASA, Wikimedia Commons, Pexels, Pixabay, your own clips | Public domain / CC / free licences | Real camera footage, credited on screen |
| Music | **ACE-Step 1.5** (open-source music model) -> music bank | MIT, free; per the project, trained on royalty-free material | Composed weekly on the GitHub runner's CPU (`music-bank.yml`), two tracks a run until each mood has six, then it stops. Each video takes a track of its mood and the editor lines the track's climax up with the video's reveal |
| Music, fallback | Synthesised score (`engine/audio.ts`) | Code, free | Same mood and energy curve; always works |
| Sound effects | Synthesised hits, whooshes, reveal impact, ticks | Code, free | Made once into `assets/sfx/` |
| Voice | Your recording -> Google Cloud TTS -> Gemini TTS -> Kokoro | Free tiers / Apache-2.0 | Your own voice is the most real and removes the AI-voice note |
| Edit, titles, thumbnails | ffmpeg, libass, our film LUT | Free | All in code, nothing manual |
| Ideas | YouTube outliers + search suggestions, Wikipedia spikes | Free | Trend radar, weekly |
| Planning board | Notion (free plan) | Free | Optional |
| Automation | GitHub Actions | Free minutes on a private repo (2,000/month) | Music bank uses at most ~130 a week while filling |

## Graphics, writing and editing (all free)
| Job | Tool | Notes |
| --- | --- | --- |
| Motion graphics | Headless Chromium (Playwright) + HTML/CSS/SVG, `engine/mograph/` | Counters, headlines, diagrams, captions, cards: the look of a design tool, generated per video in code |
| Scripts | Gemini 2.5 Flash, free tier (`GEMINI_API_KEY`) | Facts only from the source text, checked by code |
| Shot selection | Gemini vision, free tier | Reads contact sheets of real footage and picks the takes |
| Higgsfield | 10 credits on the free plan | Not used in the pipeline: generated video breaks the real-footage promise, and the credits don't cover video upscaling at any volume. Good for one-off channel art if you want it |
| Canva, Adobe Express | Free plans | No free automation API, so they can't run unattended. Use them by hand for the banner and profile picture; every per-video graphic is already made in code |
| From Project 1 | Karaoke captions, sound effect on every beat, -14 LUFS master, hook/title scoring, retention learning, copyright gates | All carried over and adapted for adults |

## The premium layer (what makes it look expensive)
| Feature | Where | What it does |
| --- | --- | --- |
| 6 film looks | `engine/grade.ts` | documentary, golden, arctic, noir, neon, earth. Gemini picks one per episode (pillar default otherwise); every clip gets the same grade so mixed sources cut like one film |
| True slow motion | `engine/edit.ts` | scenes marked `slowmo` play 50/60 fps footage at half speed, every frame real |
| Whip pans | `engine/edit.ts` | the cut happens inside a horizontal smear, with a whoosh |
| Light leaks | `engine/mograph/overlay.*` | a warm film-light streak sweeps across scene changes in long videos and into every chapter |
| Cinematic cold open | `engine/mograph/overlay.*` | long videos open in 2.39:1 widescreen bars that ease open as the story starts |
| Cut plan | `engine/build.ts` planTransitions | hard cuts inside scenes; Shorts: whips + flashes; long: leak / whip / cut in turn; whips at least 4 s apart; hard cuts stay silent |
| 4K-aware stock | `engine/footage.ts` | Pexels gives the UHD file for 4K masters, the smallest >= 1080p file otherwise, and prefers 50/60 fps |
| Shot list writing | `growth/writer.ts` | Gemini writes footage queries like a cinematographer (aerial, macro, time-lapse, tracking, slow motion), varies shot types, picks the look |
| Cinematographer curation | `engine/curate.ts` | Gemini looks at contact sheets from NASA, Wikimedia, Pexels and Pixabay and keeps only the best-lit, best-composed, steady, clean takes; the most striking image opens each scene |

## The 9 "free GitHub alternatives" from the Instagram post

| Paid app | Free alternative named | Verdict for this channel |
| --- | --- | --- |
| Higgsfield | Open Generative AI | **No.** It's a front end for a cloud API (Muapi) that needs its own key, so it isn't free to run. Generated video would also break the real-footage promise |
| ElevenLabs | VoiceStudio | **No.** Built for big GPUs (tested on a 48 GB card) and AGPL-licensed; it can't run on the free runner. Free voices stay Google/Gemini/Kokoro, or your own recording |
| Semrush | OpenSEO | **No.** The software is free but its data comes from DataForSEO, which bills per use. The free trend radar covers this |
| Notion | AppFlowy | **Not needed.** Notion's free plan already costs nothing; AppFlowy would need a server to host |
| Wispr Flow | OpenWhispr | **Yes, for you**: free dictation for writing scripts and ideas. No role inside the automation |
| Asana | OpenProject | Not needed: the Notion board covers it |
| Calendly | Cal.diy | Not relevant |
| Intercom | Chatwoot | Not relevant (it could later collect comments/DMs in one inbox) |
| Loom | Cap | Not relevant |

What the post doesn't mention but this channel uses instead: **ACE-Step 1.5** for music (the one open model that is
MIT-licensed, good enough for cinematic scores, and runs on a CPU).

## Paid, switched off (only if you ever want them)
| Tool | Turn on with |
| --- | --- |
| ElevenLabs voice | secrets `ELEVENLABS_API_KEY`, `ELEVENLABS_VOICE_ID` + env `VOICE_ORDER=human,eleven,google,gemini,kokoro` |
| ElevenLabs music / SFX | env `MUSIC_ORDER=eleven,bank,synth`, `SFX_SOURCE=eleven` |
| Semrush / DataForSEO volumes | `SEMRUSH_API_KEY` or `DATAFORSEO_LOGIN` + `DATAFORSEO_PASSWORD` |

## How the music fits each video
1. **Mood** per episode (`"music": {"mood": "awe"}`, or guessed from the topic): awe, mystery, tension, triumph,
   upbeat, investigate, melancholy. Always cinematic and instrumental: vocals, nursery and cartoon sounds excluded.
2. **Energy curve** from the scenes: quiet setup, building into the reveal, then settling.
3. **Bank track, back-timed**: the track's biggest lift is found from its loudness and lined up exactly on the
   reveal; long videos chain more tracks of the same mood with 4-second crossfades; recently used tracks are rested.
4. **Sound effects** on the hook, titles and numbers, scene changes, and an impact on the reveal.
5. Ducked under the voice and mastered to -14 LUFS.

Never add "free" stock-music tracks to the bank unless you're sure they aren't registered in YouTube Content ID:
many are, and the video gets claimed.

## About AI labels
Real footage carries no AI label. What can trigger one is a synthetic narrator, so the description says when the
voice is synthetic. Record the narration yourself (`narration/<episode>/hi/<scene>.m4a`) and that note switches off.
