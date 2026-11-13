// Typography as an .ass subtitle file rendered by libass (HarfBuzz shaping, so Hindi conjuncts are correct).
// The look is broadcast documentary, not "template": serif kicker titles that pull into focus, numbers set large
// in a grotesk, thin-rule lower thirds for footage credits, a small "REAL FOOTAGE" tag, and (Shorts only)
// bold word-by-word captions for people watching on mute.

import type { Format, Lang, Overlay, Shot } from "./types";
import { tx, ui } from "./langs";

const ass = (s: number) => { const cs = Math.round(s * 100); const h = Math.floor(cs / 360000), m = Math.floor(cs / 6000) % 60, sec = Math.floor(cs / 100) % 60; return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}.${String(cs % 100).padStart(2, "0")}`; };
const esc = (t: string) => t.replace(/\\/g, "\\\\").replace(/\{/g, "(").replace(/\}/g, ")").replace(/\n/g, "\\N");

export interface TitleScene { start: number; dur: number; overlays: Overlay[]; vo: { at: number; dur: number; text: string } }

export function buildAss(o: { W: number; H: number; format: Format; lang: Lang; scenes: TitleScene[]; shots: Shot[]; duration: number; brandTag: string;
  hook?: string; ask?: { text: string; at: number } }): string {
  const { W, H, format, lang } = o, P = format === "short";
  const u = Math.min(W, H) / 100;   // 1% of the short side
  const serif = lang === "hi" ? "Noto Serif Devanagari" : "Playfair Display";
  const sans = lang === "hi" ? "Mukta" : "Inter";
  const st = (name: string, font: string, size: number, bold: number, align: number, mv: number, ml = 0, mr = 0, extra = "&H00F3EDE4,&H00F3EDE4,&H64000000,&H8C000000", border = 0, shadow = 2.2) =>
    // Devanagari fonts carry tall line metrics, so libass draws their letters ~30% smaller at the same size
    `Style: ${name},${font},${Math.round(size * (/Mukta|Devanagari/.test(font) ? 1.38 : 1))},${extra},${bold},0,0,0,100,100,0,0,1,${border},${shadow},${align},${Math.round(ml)},${Math.round(mr)},${Math.round(mv)},1`;
  const styles = [
    st("Kicker", serif, P ? 12.5 * u : 10.5 * u, -1, P ? 8 : 1, P ? H * 0.2 : 9 * u, 7 * u, 7 * u),
    st("Sub", sans, P ? 4.4 * u : 3.4 * u, 0, P ? 8 : 1, P ? H * 0.2 - 0 : 5.4 * u, 7 * u, 7 * u, "&H00C8D4DC,&H00C8D4DC,&H64000000,&H8C000000"),
    st("Stat", "Inter", P ? 19 * u : 12 * u, -1, 5, 0),
    st("StatSub", sans, P ? 4.8 * u : 3 * u, 0, 5, 0, 0, 0, "&H003DB9F5,&H003DB9F5,&H64000000,&H8C000000"),
    st("Credit", sans, P ? 2.6 * u : 2.1 * u, 0, P ? 2 : 3, P ? H * 0.06 : 4.2 * u, 5 * u, 5 * u, "&H30F3EDE4,&H30F3EDE4,&H64000000,&H8C000000", 0, 1),
    st("Tag", lang === "hi" ? "Mukta" : "JetBrains Mono", P ? 2.8 * u : 2.2 * u, -1, 7, P ? H * 0.045 : 4 * u, 5 * u, 5 * u, "&H40F3EDE4,&H40F3EDE4,&H64000000,&H8C000000", 0, 0),
    st("Rule", "Inter", 10, 0, 7, 0, 0, 0, "&H003DB9F5,&H003DB9F5,&H64000000,&H8C000000", 0, 0),
    // captions: unsung words white, sung words warm gold; heavy outline for legibility over any footage
    st("Hook", sans, P ? 13 * u : 8 * u, -1, 5, 0, 0, 0, "&H00FFFFFF,&H00FFFFFF,&H00101010,&H96000000", P ? 0.7 * u : 0.5 * u, 2),
    st("Ask", serif, P ? 7.2 * u : 5.6 * u, -1, 5, 0, 9 * u, 9 * u, "&H00F3EDE4,&H00F3EDE4,&H64000000,&H8C000000", 0, 2.5),
    st("AskTag", sans, P ? 3.4 * u : 2.6 * u, -1, 5, 0, 0, 0, "&H003DB9F5,&H003DB9F5,&H64000000,&H8C000000", 0, 1),
    st("Cap", sans, P ? 8.4 * u : 4.2 * u, -1, 2, P ? H * 0.22 : 8 * u, 8 * u, 8 * u, "&H003DC8FF,&H00FFFFFF,&H00141414,&H96000000", P ? 0.7 * u : 0.4 * u, 1.2),
  ];
  const ev: string[] = [];
  const add = (layer: number, s: number, e: number, style: string, text: string) => ev.push(`Dialogue: ${layer},${ass(s)},${ass(e)},${style},,0,0,0,,${text}`);

  // brand tag: present the whole time, it is the channel's promise
  add(0, 0.3, o.duration - 0.2, "Tag", `{\\fad(500,300)}${esc(o.brandTag)}`);

  for (const sc of o.scenes) for (const ov of sc.overlays) {
    const s = sc.start + (ov.at ?? 0.3), e = Math.min(sc.start + sc.dur - 0.1, s + (ov.dur ?? sc.dur));
    const t = esc(tx(ov.text, lang)), sub = ov.sub ? esc(tx(ov.sub, lang)) : "";
    switch (ov.kind) {
      case "kicker": {   // pulls into focus and drifts up a touch
        const x = P ? W / 2 : 7 * u, y = P ? H * 0.16 : H - 13 * u;
        add(2, s, e, "Kicker", `{\\an${P ? 8 : 1}\\move(${x},${y + 1.2 * u},${x},${y},0,600)\\blur10\\t(0,450,\\blur0)\\fad(250,350)}${t}`);
        if (sub) add(2, s + 0.35, e, "Sub", `{\\an${P ? 8 : 1}\\pos(${x},${P ? y + 15 * u : y + 5.6 * u})\\fad(300,300)}${sub}`);
        if (!P) add(1, s + 0.15, e, "Rule", `{\\an7\\pos(${x},${y - 12.5 * u})\\p1\\fscx0\\t(0,500,\\fscx100)\\fad(0,300)}m 0 0 l ${8 * u} 0 l ${8 * u} ${0.35 * u} l 0 ${0.35 * u}{\\p0}`);
        break;
      }
      case "stat": {     // big number, counts in by scaling from 92% with a soft blur
        const y = P ? H * 0.42 : H * 0.45;
        add(2, s, e, "Stat", `{\\an5\\pos(${W / 2},${y})\\fscx92\\fscy92\\blur6\\t(0,500,\\fscx100\\fscy100\\blur0)\\fad(200,300)}${t}`);
        if (sub) add(2, s + 0.3, e, "StatSub", `{\\an5\\pos(${W / 2},${y + (P ? 14 : 9) * u})\\fad(300,300)}${sub}`);
        break;
      }
      case "label": add(2, s, e, "Sub", `{\\an7\\pos(${7 * u},${P ? H * 0.12 : 9 * u})\\fad(300,300)}${t}`); break;
      case "lower": add(2, s, e, "Sub", `{\\an1\\pos(${7 * u},${H - (P ? 30 : 9) * u})\\fad(300,300)}${t}`); break;
    }
  }
  // footage credit for every shot, bottom corner, small: honest and documentary-like
  for (const sh of o.shots) add(1, sh.start + 0.2, sh.start + sh.dur - 0.1, "Credit", `{\\fad(250,200)}${esc(sh.clip.credit === "OWN" ? ui(lang, "own") : ui(lang, "footage") + ": " + sh.clip.credit)}`);

  // Shorts: the on-screen hook for the first 2 seconds (different words from the spoken line) punches in
  if (P && o.hook) add(4, 0.05, 2.2, "Hook", `{\\an5\\pos(${W / 2},${H * 0.36})\\fscx125\\fscy125\\t(0,180,\\fscx100\\fscy100)\\fad(0,200)}${esc(o.hook)}`);
  // the question: a calm end card on a darkened band (comments are what push a video to new viewers)
  if (o.ask) {
    const s = o.ask.at, e = Math.min(o.duration - 0.05, s + 3.2), y = P ? H * 0.5 : H * 0.5, bw = W, bh = (P ? 40 : 30) * u;
    add(3, s, e, "Rule", `{\\an7\\pos(0,${y - bh / 2})\\1c&H000000&\\1a&H38&\\blur30\\fad(300,200)\\p1}m 0 0 l ${bw} 0 l ${bw} ${bh} l 0 ${bh}{\\p0}`);
    add(4, s + 0.1, e, "AskTag", `{\\an5\\pos(${W / 2},${y - (P ? 10 : 8) * u})\\fad(300,200)}${ui(lang, "comments").toUpperCase()}`);
    add(4, s + 0.2, e, "Ask", `{\\an5\\pos(${W / 2},${y + 2 * u})\\blur6\\t(0,400,\\blur0)\\fad(300,200)\\q0}${esc(o.ask.text)}`);
  }

  // Shorts: word-by-word captions (karaoke timing spread by word length)
  if (P) for (const sc of o.scenes) {
    const words = sc.vo.text.split(/\s+/).filter(Boolean), weight = words.map(w => w.length + 2), total = weight.reduce((a, b) => a + b, 0);
    let t0 = sc.start + sc.vo.at;
    for (let i = 0; i < words.length; i += 3) {
      const chunk = words.slice(i, i + 3), cs = chunk.map((_, j) => Math.round((weight[i + j] / total) * sc.vo.dur * 100));
      const len = cs.reduce((a, b) => a + b, 0) / 100;
      add(3, t0, t0 + len, "Cap", `{\\fad(60,60)}${chunk.map((w, j) => `{\\k${cs[j]}}${esc(w)}`).join(" ")}`);
      t0 += len;
    }
  }

  return [
    "[Script Info]", "ScriptType: v4.00+", `PlayResX: ${W}`, `PlayResY: ${H}`, "WrapStyle: 0", "ScaledBorderAndShadow: yes", "YCbCr Matrix: TV.709", "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    ...styles, "", "[Events]", "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text", ...ev, "",
  ].join("\n");
}
