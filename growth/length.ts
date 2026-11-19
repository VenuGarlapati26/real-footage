import type { Episode } from "../engine/types";
/** About how long the long cut of an episode runs, from its narration (2.6 words per second plus pauses). Pure. */
export const longSeconds = (ep: Episode) => ep.scenes.filter(sc => !sc.shortOnly).reduce((t, sc) => t + String(sc?.vo?.en ?? "").split(/\s+/).filter(Boolean).length / 2.6 + 0.8, 0);
/** The shortest long cut that becomes a long video (daily.ts uses the same number from settings, default 150 s). */
export const MIN_LONG_SECONDS = 150;
