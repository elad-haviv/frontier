// Makes the app's PNG icons from `public/icons/icon.svg`. Run by hand after changing the mark:
// `node apps/web/scripts/icons.mjs`. The PNGs are committed, so the build does not need it.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const icons = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "icons");
const svg = readFileSync(join(icons, "icon.svg"));
const PAPER = "#f7f3ea";

/** The mark at `size` pixels, its rounded corners clear. */
const mark = (size) => sharp(svg, { density: 300 }).resize(size, size).png().toBuffer();

/** The mark at `share` of a square of paper, for icons whose corners the system cuts itself. */
async function onPaper(size, share) {
  const inner = Math.round(size * share);
  return sharp({ create: { width: size, height: size, channels: 4, background: PAPER } })
    .composite([{ input: await mark(inner), gravity: "centre" }])
    .png()
    .toBuffer();
}

const out = {
  "icon-192.png": await mark(192),
  "icon-512.png": await mark(512),
  // Android may cut a maskable icon to a circle of 80% of its width; the mark stays inside it.
  "icon-maskable-512.png": await onPaper(512, 0.8),
  // iOS reads this one instead of the manifest's, and rounds its corners itself.
  "apple-touch-icon.png": await onPaper(180, 1),
};
for (const [name, png] of Object.entries(out)) {
  await sharp(png).toFile(join(icons, name));
  process.stdout.write(`Wrote ${name}\n`);
}
