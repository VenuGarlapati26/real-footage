#!/usr/bin/env python3
"""Voice every narration line, most natural source first.

  1. HUMAN    narration/<episode>/<lang>/<line>.wav|mp3|m4a      your own recording (cleaned + levelled)
  2. ELEVEN   ElevenLabs (PAID, off by default: add "eleven" to VOICE_ORDER to use it)
  3. GOOGLE   Cloud Text-to-Speech, GOOGLE_TTS_API_KEY           natural neural voices (free tier: 1M chars/month)
  4. GEMINI   Gemini TTS, GEMINI_API_KEY                          natural, free tier
  5. KOKORO   Kokoro-82M, local and free                          last resort; sounds the most synthetic

stdin : {"episode": "E001", "lang": "en", "lines": [{"id": "s1", "text": "..."}], "out": "dir"}
stdout: {"lines": [{"id": "s1", "file": "dir/s1.wav", "seconds": 4.2, "source": "human|eleven|google|gemini|kokoro"}]}
"""
import base64, json, os, subprocess, sys, urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
# Per language. English is the channel's main language; the others are for dubbed versions.
GOOGLE_VOICE = {"en": os.environ.get("GOOGLE_TTS_VOICE_EN", "en-US-Chirp3-HD-Charon"), "hi": os.environ.get("GOOGLE_TTS_VOICE_HI", "hi-IN-Chirp3-HD-Charon"),
                "es": "es-US-Chirp3-HD-Charon", "pt": "pt-BR-Chirp3-HD-Charon", "fr": "fr-FR-Chirp3-HD-Charon", "it": "it-IT-Chirp3-HD-Charon"}
GOOGLE_FALLBACK = {"en": "en-US-Neural2-D", "hi": "hi-IN-Neural2-B", "es": "es-US-Neural2-B", "pt": "pt-BR-Neural2-B", "fr": "fr-FR-Neural2-B", "it": "it-IT-Neural2-C"}
LANG_NAME = {"en": "English", "hi": "Hindi", "es": "Spanish", "pt": "Brazilian Portuguese", "fr": "French", "it": "Italian"}
# newest first; the first model this key may use is kept (gemini-2.5-flash-preview-tts shuts down 17 Nov 2026)
GEMINI_MODELS = [m.strip() for m in os.environ.get("GEMINI_TTS_MODEL", "gemini-3.8-flash-tts,gemini-3.8-flash-lite-tts,gemini-3.1-flash-tts-preview,gemini-2.5-flash-preview-tts").split(",") if m.strip()]
_tts_model = None
GEMINI_VOICE = os.environ.get("GEMINI_TTS_VOICE", "Charon")
# ElevenLabs: eleven_multilingual_v2 is the steadiest for long Hindi narration; eleven_v3 is more expressive.
ELEVEN_MODEL = os.environ.get("ELEVENLABS_MODEL", "eleven_multilingual_v2")
ELEVEN_VOICE = {l: os.environ.get(f"ELEVENLABS_VOICE_ID_{l.upper()}") or os.environ.get("ELEVENLABS_VOICE_ID", "") for l in ("en", "hi", "es", "pt", "fr", "it")}
ELEVEN_BASE = os.environ.get("ELEVENLABS_BASE", "https://api.elevenlabs.io")
# Kokoro's best-rated voices per language (af_heart is its top English voice)
KOKORO = {"en": (os.environ.get("KOKORO_VOICE_EN", "af_heart"), "en-us", 0.98), "hi": ("hm_omega", "hi", 0.92), "es": ("em_alex", "es", 0.95),
          "pt": ("pm_alex", "pt-br", 0.95), "fr": ("ff_siwis", "fr-fr", 0.95), "it": ("im_nicola", "it", 0.95)}
_k = None

# Documentary delivery: warm, close, unhurried. Applied to synthetic voices; human recordings get a cleaner chain.
# Synthetic voices sometimes add long silences (Gemini TTS especially): trim the edges and shorten any pause over 0.6 s.
TRIM = ("silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.05,areverse,"
        "silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.1,areverse,"
        "silenceremove=stop_periods=-1:stop_duration=0.6:stop_threshold=-45dB:stop_silence=0.35,")
POLISH = (TRIM + "highpass=f=70,equalizer=f=170:t=q:w=1:g=1.5,equalizer=f=3000:t=q:w=1.4:g=1.5,deesser=i=0.25,"
          "acompressor=threshold=-21dB:ratio=2.4:attack=10:release=140,loudnorm=I=-18:TP=-2")
CLEAN_HUMAN = ("highpass=f=80,afftdn=nf=-25,silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.1,"
               "areverse,silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.15,areverse,"
               "acompressor=threshold=-20dB:ratio=3:attack=5:release=80,loudnorm=I=-18:TP=-2")


def ff(src, dst, af, raw_fmt=None):
    pre = ["-f", raw_fmt[0], "-ar", str(raw_fmt[1]), "-ac", "1"] if raw_fmt else []
    subprocess.run(["ffmpeg", "-y", "-v", "error", *pre, "-i", src, "-af", af, "-ar", "48000", "-ac", "1", dst], check=True)


def seconds(path):
    return float(subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", path], capture_output=True, text=True, check=True).stdout.strip())


def plausible(text, secs):
    """A narrated line runs at about 2-3.5 words a second; far longer means extra words were spoken (an instruction read
    aloud) or silence was padded, so that take is rejected."""
    words = max(1, len(text.split()))
    return secs <= words / 2.0 + 1.5


def post(url, body, headers=None):
    req = urllib.request.Request(url, data=json.dumps(body).encode(), headers={"content-type": "application/json", **(headers or {})})
    with urllib.request.urlopen(req, timeout=120) as r:
        return json.loads(r.read())


def human(ep, lang, lid):
    base = os.path.join(os.environ.get("NARRATION_DIR", "narration"), ep, lang)
    for ext in (".wav", ".mp3", ".m4a", ".ogg"):
        p = os.path.join(base, lid + ext)
        if os.path.exists(p):
            return p


def eleven(text, lang, dst, prev=None, nxt=None):
    key, voice = os.environ.get("ELEVENLABS_API_KEY"), ELEVEN_VOICE[lang]
    if not key or not voice:
        return False
    body = {"text": text, "model_id": ELEVEN_MODEL,
            "voice_settings": {"stability": 0.5, "similarity_boost": 0.8, "style": 0.15, "use_speaker_boost": True, "speed": 0.97}}
    if ELEVEN_MODEL != "eleven_v3":
        body["language_code"] = lang
        # neighbouring lines keep the intonation continuous across separately voiced lines
        if prev: body["previous_text"] = prev
        if nxt: body["next_text"] = nxt
    try:
        req = urllib.request.Request(f"{ELEVEN_BASE}/v1/text-to-speech/{voice}?output_format=mp3_44100_128", data=json.dumps(body).encode(),
                                     headers={"content-type": "application/json", "xi-api-key": key, "accept": "audio/mpeg"})
        with urllib.request.urlopen(req, timeout=120) as r:
            raw = dst + ".e.mp3"; open(raw, "wb").write(r.read())
        ff(raw, dst, POLISH); os.remove(raw)
        return True
    except Exception as e:
        print(f"elevenlabs tts: {e}", file=sys.stderr)
        return False


def google(text, lang, dst):
    key = os.environ.get("GOOGLE_TTS_API_KEY")
    if not key:
        return False
    for name in (GOOGLE_VOICE[lang], GOOGLE_FALLBACK[lang]):
        try:
            j = post(f"https://texttospeech.googleapis.com/v1/text:synthesize?key={key}",
                     {"input": {"text": text}, "voice": {"languageCode": name[:5], "name": name},
                      "audioConfig": {"audioEncoding": "LINEAR16", "sampleRateHertz": 48000, "speakingRate": 0.96}})
            raw = dst + ".g.wav"
            open(raw, "wb").write(base64.b64decode(j["audioContent"]))
            ff(raw, dst, POLISH); os.remove(raw)
            return True
        except Exception as e:  # try the next voice, then the next provider
            print(f"google tts {name}: {e}", file=sys.stderr)
    return False


def gemini(text, lang, dst):
    global _tts_model
    key = os.environ.get("GEMINI_API_KEY")
    if not key:
        return False
    # Only the line itself is sent: Gemini TTS sometimes READ a style instruction aloud ("Read this in natural English
    # like a warm..."), which made a 30-second Short 1:21 long. The voice (GEMINI_VOICE) already sets the character.
    style = ""
    for model in ([_tts_model] if _tts_model else GEMINI_MODELS):
        try:
            j = post(f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={key}",
                     {"contents": [{"parts": [{"text": style + text}]}],
                      "generationConfig": {"responseModalities": ["AUDIO"], "speechConfig": {"voiceConfig": {"prebuiltVoiceConfig": {"voiceName": GEMINI_VOICE}}}}})
            pcm = base64.b64decode(j["candidates"][0]["content"]["parts"][0]["inlineData"]["data"])
            raw = dst + ".pcm"
            open(raw, "wb").write(pcm)
            ff(raw, dst, POLISH, ("s16le", 24000)); os.remove(raw)
            _tts_model = model
            if not plausible(text, seconds(dst)):
                print(f"gemini tts {model}: {seconds(dst):.1f}s for {len(text.split())} words, too slow; next voice", file=sys.stderr)
                return False
            return True
        except Exception as e:
            msg = str(e)
            body = getattr(e, "read", None)
            if body:
                try: msg += " " + e.read().decode("utf8", "replace")[:300]
                except Exception: pass
            print(f"gemini tts {model}: {msg[:200]}", file=sys.stderr)
            if _tts_model or not any(k in msg for k in ("404", "403", "no longer available", "not found", "not supported", "limit: 0")):
                return False   # a real failure (quota for today, network): fall back to the next voice
    return False


def kokoro(text, lang, dst):
    global _k
    import soundfile as sf
    if _k is None:
        from kokoro_onnx import Kokoro
        _k = Kokoro(os.environ.get("KOKORO_MODEL", os.path.join(HERE, "kokoro-v1.0.int8.onnx")), os.environ.get("KOKORO_VOICES", os.path.join(HERE, "voices-v1.0.bin")))
    v, code, speed = KOKORO[lang]
    samples, sr = _k.create(text, voice=v, speed=speed, lang=code)
    raw = dst + ".k.wav"; sf.write(raw, samples, sr); ff(raw, dst, POLISH); os.remove(raw)
    return True


def voice_lines(job, order):
    """Voice every line with the first provider in `order` that works. Returns (results, providers used)."""
    lang, out = job["lang"], job["out"]
    res, used = [], set()
    lines = job["lines"]
    for i, line in enumerate(lines):
        prev = lines[i - 1]["text"] if i else None
        nxt = lines[i + 1]["text"] if i + 1 < len(lines) else None
        dst = os.path.join(out, f"{line['id']}.wav")
        rec = human(job["episode"], lang, line["id"])
        stamp, key = dst + ".key", f"{rec or ''}|{','.join(order)}|{line['text']}"
        if os.path.exists(dst) and os.path.exists(stamp) and open(stamp, encoding="utf8").read().startswith(key + "|"):
            src = open(stamp, encoding="utf8").read().rsplit("|", 1)[1]
        else:
            src = None
            for p in order:
                if p == "human" and rec:
                    ff(rec, dst, CLEAN_HUMAN); src = "human"
                elif p == "eleven" and eleven(line["text"], lang, dst, prev, nxt):
                    src = "eleven"
                elif p == "google" and google(line["text"], lang, dst):
                    src = "google"
                elif p == "gemini" and gemini(line["text"], lang, dst):
                    src = "gemini"
                elif p == "kokoro" and kokoro(line["text"], lang, dst):
                    src = "kokoro"
                if src:
                    break
            if not src:
                raise SystemExit(f"no voice provider could voice {line['id']}")
            open(stamp, "w", encoding="utf8").write(f"{key}|{src}")
        if src != "human":
            used.add(src)
        res.append({"id": line["id"], "file": dst, "seconds": round(seconds(dst), 3), "source": src})
    return res, used


def main():
    job = json.load(sys.stdin)
    os.makedirs(job["out"], exist_ok=True)
    order = [p for p in os.environ.get("VOICE_ORDER", "human,google,gemini,kokoro").split(",") if p]
    # ONE narrator per video: if a provider gave out part-way (e.g. Gemini's free daily limit), voice the whole
    # script again with the provider that took over, so the voice never changes in the middle of a video
    while True:
        res, used = voice_lines(job, order)
        tts = [p for p in order if p != "human"]
        if len(used) <= 1:
            break
        last = max(tts.index(p) for p in used)
        print(f"voice: mixed providers {sorted(used)}; re-voicing everything with {tts[last]}", file=sys.stderr)
        order = (["human"] if "human" in order else []) + tts[last:]
    json.dump({"lines": res}, sys.stdout, ensure_ascii=False)


if __name__ == "__main__":
    main()
