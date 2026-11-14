// npm run channel:art -> the final Lumora channel art, rendered natively at 4K:
//   channel/art/lumora-banner-3840x2160.jpg   (4K, under YouTube's 6 MB banner limit)
//   channel/art/lumora-banner-2560x1440.png   (YouTube's standard size, for any upload that refuses 4K)
//   channel/art/lumora-profile-3200x3200.png  (+ a JPG under 4 MB, and an 800x800 copy)
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { statSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

const { chromium } = createRequire(import.meta.url)("playwright");
const browser = await chromium.launch();
const shoot = async (sel: string, scale: number, out: string) => {
  const page = await browser.newPage({ viewport: { width: 2600, height: 2400 }, deviceScaleFactor: scale });
  await page.goto(pathToFileURL(path.resolve("tools/lumora-brand.html")).href);
  await page.waitForFunction("window.ready === true");
  await page.locator(sel).screenshot({ path: out });
  await page.close();
};
try {
  const A = "channel/art";
  await shoot("#banner", 1.5, `${A}/lumora-banner-3840x2160.png`);
  await shoot("#banner", 1, `${A}/lumora-banner-2560x1440.png`);
  await shoot("#profile", 4, `${A}/lumora-profile-3200x3200.png`);
  const ff = (...a: string[]) => execFileSync("ffmpeg", ["-v", "error", "-y", ...a]);
  ff("-i", `${A}/lumora-banner-3840x2160.png`, "-q:v", "1", `${A}/lumora-banner-3840x2160.jpg`);
  ff("-i", `${A}/lumora-profile-3200x3200.png`, "-q:v", "2", `${A}/lumora-profile-3200x3200.jpg`);
  ff("-i", `${A}/lumora-profile-3200x3200.png`, "-vf", "scale=800:800:flags=lanczos", `${A}/lumora-profile-800.png`);
  for (const f of ["lumora-banner-3840x2160.jpg", "lumora-banner-2560x1440.png", "lumora-profile-3200x3200.png", "lumora-profile-3200x3200.jpg", "lumora-profile-800.png"])
    console.log(`${A}/${f}  ${(statSync(`${A}/${f}`).size / 1e6).toFixed(2)} MB`);
} finally { await browser.close(); }
