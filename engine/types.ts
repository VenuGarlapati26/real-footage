// Episode script: what is said, what real footage shows it, and where every fact comes from.

import type { Lang, Txt } from "./langs";
export type { Lang, Txt } from "./langs";
export type Format = "long" | "short";

/** How to find footage for a shot. Tried in order; the first that returns a usable clip wins. */
export type FootageQuery =
  | { provider: "local"; file: string }                          // your own clip: footage/<file>
  | { provider: "nasa"; q: string; nasaId?: string; takes?: Take[] } // NASA Image & Video Library (public domain)
  | { provider: "pexels"; q: string; id?: string; takes?: Take[] }   // Pexels (free licence, PEXELS_API_KEY); id = a pinned video
  | { provider: "pixabay"; q: string; id?: string; takes?: Take[] }  // Pixabay (free licence, PIXABAY_API_KEY)
  | { provider: "wikimedia"; q: string; file?: string; height?: 1080 | 720; credit?: string; license?: string; takes?: Take[] }; // Wikimedia Commons (PD / CC0 / CC BY only)

/** A hand-picked window inside a clip, in seconds [from, to]: the shot is cut from inside it (still never across an edit).
 *  This is how an editor's selects are kept: pin a nasaId / Commons file, list the takes you want, in order. */
export type Take = [number, number];

export interface Overlay {
  /** orbit: animated orbit diagram that counts (text = the count, e.g. "16"); map: a globe turns to `geo` and pins it
   *  (text = place, sub = coordinates line); chapter: full-screen chapter card in long videos (text = title, sub = "01");
   *  compare: bars that grow to `bars` values */
  kind: "kicker" | "stat" | "lower" | "label" | "orbit" | "map" | "chapter" | "compare";
  geo?: { lat: number; lon: number };
  bars?: { label: Txt; value: number; display?: string }[];
  text: Txt; sub?: Txt;
  at?: number;        // seconds into the scene (default: 0.3)
  dur?: number;       // default: until the scene ends
}

export interface Scene {
  id: string;
  vo: Txt;                                  // narration
  footage: FootageQuery[];                  // candidates, in order of preference
  shots?: number;                           // how many cuts in this scene (default: by length, ~3 s each)
  overlays?: Overlay[];
  sources?: string[];                       // fact sources used in this scene
  shortOnly?: boolean; longOnly?: boolean;
  /** the scene shows something the video calls real (e.g. space): only NASA, Wikimedia or your own clips allowed,
   *  never stock sites, where "earth from space" is often a CGI render */
  authentic?: boolean;
  /** how hard the music pushes under this scene, 1 (barely there) to 5 (full). Default: rises to the episode's peak */
  energy?: number;
  /** a beauty moment: shown in true slow motion (half speed) when the clip was filmed at 48 fps or more */
  slowmo?: boolean;
}

/** The feel of the music. Each mood has an ElevenLabs style set and a matching synth fallback (engine/audio.ts). */
export type Mood = "awe" | "mystery" | "tension" | "triumph" | "upbeat" | "investigate" | "melancholy";

export interface MusicPlan {
  mood: Mood;
  styles?: string[];      // extra style words for this episode, English (e.g. "tabla", "sitar drone", "analog synth")
  avoid?: string[];       // extra things the music must not have
  bpm?: number;
  peak?: string;          // scene id where the music should hit its peak (default: the scene with the biggest number)
}

/** What turns a viewer into a commenter, a sharer and a re-watcher. */
export interface Engage {
  ask: Txt;            // the question on the end card and in the first comment (comments push videos to new viewers)
  hookText: Txt;       // on-screen words for the first 2 seconds of a Short: NOT the spoken line (yt-shorts rule)
  loop: Txt;           // the Short's last line, written so the first line answers it (people watch twice)
  share: Txt;          // Reels/Instagram: the "send this to someone who..." line (DM shares drive Instagram reach)
}

export interface Episode {
  id: string; status: "draft" | "approved"; topic: string;
  title: Txt; thumb: Txt; engage: Engage;
  scenes: Scene[];
  music?: MusicPlan;
  angle?: string;
  look?: "documentary" | "golden" | "arctic" | "noir" | "neon" | "earth";   // film look (engine/grade.ts); default: the pillar's         // story format (channel/formats.json): mystery, scale, countdown, then-now, what-if, myth, timeline, record      // if missing, the mood is guessed from the topic (engine/music.ts)
  sources: { id: string; title: string; url: string; claims: string[] }[];
}

/** A downloaded clip with everything needed to credit and license it. */
export interface Clip {
  provider: string; id: string; file: string; width: number; height: number; duration: number;
  title: string; credit: string; license: string; page: string;
  fps?: number;
}

/** speed < 1 = slow motion (0.5 = half speed, from 48-60 fps footage); trIn / trOut = how the shot meets its neighbours */
export interface Shot { scene: string; clip: Clip; inPoint: number; dur: number; start: number; speed?: number; trIn?: Transition; trOut?: Transition }
/** cut: hard cut · whip: a whip-pan blur through the cut (with a whoosh) · leak: a warm light leak washes over the cut ·
 *  flash: a quick white flash */
export type Transition = "cut" | "whip" | "leak" | "flash";
