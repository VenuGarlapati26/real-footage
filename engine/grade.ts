// Film looks. Every clip in an episode gets the SAME look, so footage from NASA, Pexels and Wikimedia cuts together
// like one film. Each episode picks a look (episode.look, chosen by the writer; otherwise the pillar's default):
//   documentary  neutral premium: gentle S-curve, teal shadows, warm highlights (the original look)
//   golden       warm, glowing, nostalgic: food, history, people, cities at dusk
//   arctic       cool, crisp, clean whites: ice, ocean, space, engineering
//   noir         deep contrast, low saturation, cold shadows: mysteries, disasters, history's dark chapters
//   neon         teal + magenta, punchy: tech, cities at night, money
//   earth        rich greens and ochres, natural: wildlife, extreme earth, the body
// Written as a 33-point 3D LUT (.cube) for ffmpeg's lut3d. Each clip is level-matched first, then this LUT:
// tone curve on luma (hue kept), highlight roll-off, lifted blacks, saturation with skin tones protected, split toning.

import { writeFile } from "node:fs/promises";

const clamp = (x: number) => Math.max(0, Math.min(1, x));
const smooth = (a: number, b: number, x: number) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };

export interface Look {
  contrast: number;                 // S-curve exponent (1 = flat, 1.18 = the documentary curve)
  lift: number;                     // black level (0.022 = soft, filmic)
  sat: number; skinSat: number;     // overall saturation, and for skin tones
  shadow: [number, number, number]; // colour added in the shadows (RGB)
  high: [number, number, number];   // colour added in the highlights
  /** extra saturation in one hue family (greens for "earth", teal/magenta for "neon") */
  boost?: { hue: "green" | "teal" | "magenta" | "orange"; amount: number }[];
}

export const LOOKS = {
  documentary: { contrast: 1.18, lift: 0.022, sat: 0.92, skinSat: 0.98, shadow: [-0.012, 0.006, 0.022], high: [0.022, 0.008, -0.018] },
  golden:      { contrast: 1.14, lift: 0.03,  sat: 0.96, skinSat: 1.0,  shadow: [0.012, 0.0, -0.02],   high: [0.045, 0.022, -0.035], boost: [{ hue: "orange", amount: 0.12 }] },
  arctic:      { contrast: 1.2,  lift: 0.018, sat: 0.86, skinSat: 0.95, shadow: [-0.02, 0.004, 0.035], high: [-0.006, 0.006, 0.02],  boost: [{ hue: "teal", amount: 0.1 }] },
  noir:        { contrast: 1.32, lift: 0.012, sat: 0.7,  skinSat: 0.82, shadow: [-0.01, 0.0, 0.03],    high: [0.015, 0.008, -0.006] },
  neon:        { contrast: 1.24, lift: 0.015, sat: 1.04, skinSat: 0.98, shadow: [-0.006, 0.012, 0.04], high: [0.03, -0.004, 0.02],  boost: [{ hue: "teal", amount: 0.14 }, { hue: "magenta", amount: 0.12 }] },
  earth:       { contrast: 1.16, lift: 0.024, sat: 0.97, skinSat: 0.98, shadow: [-0.008, 0.01, 0.006], high: [0.03, 0.016, -0.024], boost: [{ hue: "green", amount: 0.1 }, { hue: "orange", amount: 0.06 }] },
} satisfies Record<string, Look>;
export type LookName = keyof typeof LOOKS;
export const isLook = (x: unknown): x is LookName => typeof x === "string" && x in LOOKS;

/** Look for an episode: its own choice, else its pillar's default, else documentary. */
export function lookFor(ep: { look?: string; topic?: string }, pillarLooks: Record<string, string> = {}): LookName {
  if (isLook(ep.look)) return ep.look;
  const p = ep.topic ? pillarLooks[ep.topic] : undefined;
  return isLook(p) ? p : "documentary";
}

const HUES = { orange: 30, green: 120, teal: 185, magenta: 315 };
function hueOf(r: number, g: number, b: number) {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn; if (d < 1e-4) return -1;
  const h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return (h * 60 + 360) % 360;
}

export function filmLook(r: number, g: number, b: number, look: Look = LOOKS.documentary): [number, number, number] {
  r = clamp(r); g = clamp(g); b = clamp(b);
  const y = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  const c1 = look.contrast, c2 = 1 + (look.contrast - 1) * 0.66;
  const s = (x: number) => x < 0.5 ? 0.5 * Math.pow(2 * x, c1) : 1 - 0.5 * Math.pow(2 * (1 - x), c2);
  const shoulder = (x: number) => x > 0.82 ? 0.82 + (1 - Math.exp(-(x - 0.82) * 4.2)) * 0.165 : x;
  const y2 = look.lift + (0.99 - look.lift) * shoulder(s(y));
  const k = y > 1e-4 ? y2 / y : 1;
  let R = r * k, G = g * k, B = b * k;
  const skin = r > g && g > b && r - b > 0.06 && r - b < 0.5 ? 1 : 0;
  let sat = skin ? look.skinSat : look.sat;
  const h = hueOf(r, g, b);
  for (const bo of look.boost ?? []) { if (h < 0) break; const dh = Math.min(Math.abs(h - HUES[bo.hue]), 360 - Math.abs(h - HUES[bo.hue])); sat += bo.amount * (1 - smooth(18, 45, dh)); }
  R = y2 + (R - y2) * sat; G = y2 + (G - y2) * sat; B = y2 + (B - y2) * sat;
  const sh = 1 - smooth(0.05, 0.45, y2), hi = smooth(0.55, 0.95, y2);
  R += look.shadow[0] * sh + look.high[0] * hi; G += look.shadow[1] * sh + look.high[1] * hi; B += look.shadow[2] * sh + look.high[2] * hi;
  return [clamp(R), clamp(G), clamp(B)];
}

export async function writeCube(file: string, name: LookName = "documentary", size = 33) {
  const look: Look = LOOKS[name];
  const lines = [`TITLE "Real Footage ${name}"`, `LUT_3D_SIZE ${size}`, "DOMAIN_MIN 0 0 0", "DOMAIN_MAX 1 1 1"];
  for (let b = 0; b < size; b++) for (let g = 0; g < size; g++) for (let r = 0; r < size; r++) {
    const [R, G, B] = filmLook(r / (size - 1), g / (size - 1), b / (size - 1), look);
    lines.push(`${R.toFixed(6)} ${G.toFixed(6)} ${B.toFixed(6)}`);
  }
  await writeFile(file, lines.join("\n") + "\n");
}
