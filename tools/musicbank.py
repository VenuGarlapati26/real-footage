#!/usr/bin/env python3
"""Fill the channel's music bank with free, original instrumental tracks (ACE-Step 1.5, MIT licence).

Runs in the weekly "Music bank" workflow on the GitHub runner's CPU, so it costs nothing. Slow is fine: tracks are
made ahead of time, a few per run, and every video afterwards picks from the bank (engine/bank.ts).

  python3 tools/musicbank.py --ace <ACE-Step-1.5 dir> [--budget-min 300] [--dry]

Each track: music/bank/<mood>/<mood>-<seed>.mp3 + .json (caption, seed, model, licence).
Every caption asks for a slow build to one big cinematic climax, then a resolve, so the editor can line the climax
up with the video's reveal.
"""
import argparse, glob, json, os, random, shutil, subprocess, sys, time

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)

# English captions (the model's caption field, max 512 chars). Adult, cinematic; never kids, never vocals.
CAPTIONS = {
    "awe": "Cinematic documentary score, sense of wonder. Warm analog synth pads, felt piano, slow strings, subtle tanpura drone, wide reverb. Starts sparse and quiet, builds slowly with a soft pulse, rises to one huge emotional orchestral climax, then resolves gently. Instrumental, no vocals.",
    "mystery": "Dark mysterious documentary score. Low drones, muted piano motif, pizzicato strings, distant ticking, deep sub pulses. Starts eerie and minimal, tension creeps up, one big dark revealing hit, then an uneasy calm. Instrumental, no vocals.",
    "investigate": "Modern investigative documentary music. Clean minimal piano motif over a steady electronic pulse, analytical and curious, light percussion, synth bass. Builds layer by layer to a confident full groove with a decisive hit, then strips back. Instrumental, no vocals.",
    "tension": "Tense thriller score. Driving staccato strings, deep sub hits, ticking clock, pulsing low synth, modern trailer sound design. Tightens steadily to an intense climax with a massive impact, then a dark tail. Instrumental, no vocals.",
    "triumph": "Epic uplifting cinematic music. Strings, brass, big taiko and orchestral drums, hopeful piano opening. Builds with marching drums to a soaring triumphant brass climax, then a warm resolve. Instrumental, no vocals.",
    "upbeat": "Modern upbeat cinematic electronic music, confident and energetic. Plucked synths, crisp percussion, punchy bass, subtle Indian percussion colour. Light groove intro, builds to a big energetic drop, then rides out. Instrumental, no vocals.",
    "melancholy": "Emotional bittersweet documentary score. Solo piano, cello, soft strings, intimate and warm. Gentle start, cello enters, strings swell to one aching emotional peak, then a quiet resolve. Instrumental, no vocals.",
}
BPM = {"awe": 72, "mystery": 66, "investigate": 92, "tension": 100, "triumph": 84, "upbeat": 112, "melancholy": 64}
KEY = {"awe": "A major", "mystery": "A minor", "investigate": "D minor", "tension": "E minor", "triumph": "F major", "upbeat": "G major", "melancholy": "G# minor"}
LYRICS = "[Intro]\n[Instrumental]\n\n[Build]\n[Instrumental]\n\n[Climax]\n[Instrumental]\n\n[Outro]\n[Instrumental]"


def toml_str(v):
    if isinstance(v, bool): return "true" if v else "false"
    if isinstance(v, (int, float)): return str(v)
    return json.dumps(v, ensure_ascii=False)  # JSON strings are valid TOML basic strings


def job(mood, seed, seconds, out_dir):
    """The ACE-Step CLI config for one track: turbo model, CPU, no language model (faster, we give all metadata)."""
    return {
        "config_path": "acestep-v15-turbo", "device": os.environ.get("ACE_DEVICE", "cpu"), "offload_to_cpu": False,
        "caption": CAPTIONS[mood], "lyrics": LYRICS, "instrumental": True, "duration": seconds,
        "bpm": BPM[mood], "keyscale": KEY[mood], "timesignature": "4",
        "inference_steps": 8, "shift": 3.0, "seed": seed, "use_random_seed": False, "batch_size": 1,
        "thinking": False, "use_cot_metas": False, "use_cot_caption": False, "use_cot_lyrics": False, "use_cot_language": False,
        "audio_format": "wav", "save_dir": out_dir,
    }


def plan(cfg, bank):
    """Which moods need tracks, fewest first, at most perRun."""
    have = {m: len(glob.glob(os.path.join(bank, m, "*.mp3"))) for m in cfg["moods"]}
    need = sorted([m for m in cfg["moods"] if have[m] < cfg["perMood"]], key=lambda m: have[m])
    out = []
    while len(out) < cfg["perRun"] and need:
        for m in list(need):
            if len(out) >= cfg["perRun"]: break
            out.append(m); have[m] += 1
            if have[m] >= cfg["perMood"]: need.remove(m)
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--ace", default=os.environ.get("ACE_DIR", "ACE-Step-1.5"))
    ap.add_argument("--budget-min", type=float, default=300)
    ap.add_argument("--dry", action="store_true", help="write the job files only")
    ap.add_argument("--check", action="store_true", help="print how many tracks are still needed and exit")
    a = ap.parse_args()
    cfg = json.load(open(os.path.join(ROOT, "channel/music-bank.json")))
    bank = os.path.join(ROOT, "music/bank")
    todo, t0, made = plan(cfg, bank), time.time(), []
    if a.check:
        print(len(todo)); return
    print(f"bank plan: {todo or 'full'}")
    for mood in todo:
        if (time.time() - t0) / 60 > a.budget_min: print("time budget used up"); break
        seed = random.randint(1, 2**31 - 1)
        work = os.path.join(ROOT, ".cache/acestep", f"{mood}-{seed}"); os.makedirs(work, exist_ok=True)
        conf = os.path.join(work, "job.toml")
        with open(conf, "w", encoding="utf8") as f:
            for k, v in job(mood, seed, cfg["seconds"], work).items(): f.write(f"{k} = {toml_str(v)}\n")
        if a.dry: made.append(conf); continue
        s = time.time()
        r = subprocess.run(["uv", "run", "python", "cli.py", "-c", conf, "--backend", "pt", "--log-level", "WARNING"], cwd=a.ace)
        wavs = sorted(glob.glob(os.path.join(work, "**", "*.wav"), recursive=True), key=os.path.getmtime)
        if r.returncode or not wavs: print(f"{mood}: generation failed", file=sys.stderr); continue
        os.makedirs(os.path.join(bank, mood), exist_ok=True)
        dst = os.path.join(bank, mood, f"{mood}-{seed}.mp3")
        subprocess.run(["ffmpeg", "-y", "-v", "error", "-i", wavs[-1], "-af", "loudnorm=I=-16:TP=-1.5", "-ar", "48000", "-b:a", "192k", dst], check=True)
        json.dump({"mood": mood, "caption": CAPTIONS[mood], "seed": seed, "bpm": BPM[mood], "key": KEY[mood], "seconds": cfg["seconds"],
                   "model": "ACE-Step 1.5 turbo", "licence": "Generated by this channel with ACE-Step 1.5 (MIT). Original, no samples, nothing to claim.",
                   "made": time.strftime("%Y-%m-%d"), "minutes": round((time.time() - s) / 60, 1)}, open(dst[:-4] + ".json", "w"), indent=2)
        shutil.rmtree(work, ignore_errors=True); made.append(dst)
        print(f"{mood}: {dst} in {(time.time() - s) / 60:.1f} min")
    print(json.dumps({"made": made}))


if __name__ == "__main__":
    main()
