// Platform captions. Each feed rewards something different, so each gets its own text:
//   Instagram Reels  sends ("send this to...") and saves -> share line + the question + a few precise hashtags
//   Facebook Reels   comments from older viewers -> the question first, plain language
//   YouTube Shorts   title carries the hook; the description links the full video
// Written from the episode's own lines (no invented claims) and checked by the caption gates.

import type { Episode, Lang } from "../engine/types";
import { tx, ui } from "../engine/langs";

const TAGS: Record<string, { hi: string[]; en: string[] }> = {
  space: { hi: ["#अंतरिक्ष", "#असलीवीडियो", "#विज्ञान"], en: ["#space", "#realfootage", "#science", "#ISS"] },
  earth: { hi: ["#धरती", "#असलीवीडियो", "#प्रकृति"], en: ["#earth", "#realfootage", "#nature"] },
};

export function instagramCaption(ep: Episode, lang: Lang): string {
  const set = TAGS[ep.topic] ?? TAGS.earth, tags = ((set as any)[lang] ?? set.en).slice(0, 4).join(" ");
  return [tx(ep.scenes[0].vo, lang), "", tx(ep.engage.share, lang), "", tx(ep.engage.ask, lang), "", tags].join("\n");
}

export function facebookCaption(ep: Episode, lang: Lang): string {
  return [tx(ep.engage.ask, lang), "", tx(ep.scenes[0].vo, lang), "", ui(lang, "more")].join("\n");
}

/** The channel's own first comment: the question, so the thread starts with something to answer. */
export const firstComment = (ep: Episode, lang: Lang) => `${tx(ep.engage.ask, lang)}\n\n${ui(lang, "creditsNote")}`;
