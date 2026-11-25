// Makes the pictures the Find paths and Terrain browser tests look at (stage 20). Run from the
// repository root with `node apps/web/e2e/fixtures/make-find-paths.mjs`; the PNGs are committed.
//
// find-paths.png, 600 × 400 (a position is a pixel): a mainland from x = 100 to 430 and an island
// from x = 490 to 580, in a sea, each with a dark coast. A painted river runs from (420, 200) west
// to the coast at (100, 200), with a tributary from (330, 120) joining it near (320, 196). A dashed
// red road runs from (260, 110) south to (260, 300), over the river (a bridge).
//
// find-paths-heights.png, the same size: the height map that matches it. Black is the sea; the
// mainland rises to the east and away from the river's valley; the island is a low dome.
//
// find-paths-heights-shifted.png: the same heights moved 40 pixels east and 24 south, as a height
// map that does not line up with its picture.
//
// find-paths-steep.png and find-paths-steep-heights.png, 600 × 400 (steep ground, stage 20 decision
// 11): land all over, a grey ridge running north to south down x = 300, and its heights. At
// 200 m a pixel with white at 2000 m the ridge rises over 100% at its steepest, and a pass at
// y = 200 about 50%: too steep for a cart even winding, climbed on foot in zigzags, and short
// enough for a tunnel of under 5 km.
//
// find-paths-basin.png and find-paths-basin-heights.png, 600 × 400 (rivers that end inland,
// decision 12): sea west of x = 80, land rising east, and a closed bowl round (380, 200) that a
// river from the east runs into.
import { Buffer } from "node:buffer";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const here = dirname(fileURLToPath(import.meta.url));
const W = 600;
const H = 400;
const COAST = 'stroke="#3c2f21" stroke-width="2.5" stroke-linejoin="round"';
const RIVER = 'fill="none" stroke="#4a7391" stroke-width="3" stroke-linecap="round"';

const picture = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
  <rect width="${W}" height="${H}" fill="#aac5c4"/>
  <polygon points="100,30 430,30 430,370 100,370" fill="#ded2a2" ${COAST}/>
  <polygon points="490,80 580,80 580,320 490,320" fill="#ded2a2" ${COAST}/>
  <polyline points="420,200 380,200 300,190 220,210 101,200" ${RIVER}/>
  <polyline points="330,120 320,196" ${RIVER}/>
  <polyline points="260,110 260,300" fill="none" stroke="#8a3520" stroke-width="2.2" stroke-dasharray="8 4"/>
</svg>`;

/** The river's y at an x of the mainland, along its painted course. */
function riverY(x) {
  const pts = [
    [100, 200],
    [220, 210],
    [300, 190],
    [380, 200],
    [430, 200],
  ];
  for (let i = 1; i < pts.length; i++) {
    if (x <= pts[i][0]) {
      const t = (x - pts[i - 1][0]) / (pts[i][0] - pts[i - 1][0]);
      return pts[i - 1][1] + t * (pts[i][1] - pts[i - 1][1]);
    }
  }
  return 200;
}

function heightAt(x, y) {
  if (x >= 100 && x <= 430 && y >= 30 && y <= 370) {
    // Rising to the east, and away from the valley the river runs in.
    return 0.22 + 0.3 * ((x - 100) / 330) + 0.4 * Math.min(1, Math.abs(y - riverY(x)) / 170);
  }
  if (x >= 490 && x <= 580 && y >= 80 && y <= 320) {
    return 0.25 + 0.2 * Math.max(0, 1 - Math.hypot((x - 535) / 45, (y - 200) / 120));
  }
  return 0;
}

function heights(dx, dy) {
  const grey = Buffer.alloc(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) grey[y * W + x] = Math.round(255 * heightAt(x - dx, y - dy));
  }
  return sharp(grey, { raw: { width: W, height: H, channels: 1 } }).png();
}

await sharp(Buffer.from(picture)).png().toFile(join(here, "find-paths.png"));
await heights(0, 0).toFile(join(here, "find-paths-heights.png"));
await heights(40, 24).toFile(join(here, "find-paths-heights-shifted.png"));

const plain = (w, h, land) =>
  `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">${land}</svg>`;

/** The ridge: its height at x, for the height of its crest there. */
const ridge = (x, crest) => crest * Math.exp(-(((x - 300) / 6) ** 2));
const crestAt = (y) => 0.75 - 0.4 * Math.exp(-(((y - 200) / 40) ** 2));

const steepPicture = plain(
  W,
  H,
  `<rect width="${W}" height="${H}" fill="#ded2a2"/><rect x="288" width="24" height="${H}" fill="#c9c2b0"/>`,
);
await sharp(Buffer.from(steepPicture)).png().toFile(join(here, "find-paths-steep.png"));
{
  const grey = Buffer.alloc(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) grey[y * W + x] = Math.round(255 * (0.1 + ridge(x, crestAt(y))));
  }
  await sharp(grey, { raw: { width: W, height: H, channels: 1 } })
    .png()
    .toFile(join(here, "find-paths-steep-heights.png"));
}

const basinPicture = plain(
  W,
  H,
  `<rect width="${W}" height="${H}" fill="#aac5c4"/><rect x="80" width="${W - 80}" height="${H}" fill="#ded2a2" ${COAST}/>`,
);
await sharp(Buffer.from(basinPicture)).png().toFile(join(here, "find-paths-basin.png"));
{
  const grey = Buffer.alloc(W * H);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const r = Math.hypot(x - 380, y - 200);
      const land = x < 80 ? 0 : 0.12 + (x - 80) * 0.0012 + Math.abs(y - 200) * 0.0006;
      grey[y * W + x] = Math.round(255 * Math.max(0, land - 0.16 * Math.max(0, 1 - (r / 60) ** 2)));
    }
  }
  await sharp(grey, { raw: { width: W, height: H, channels: 1 } })
    .png()
    .toFile(join(here, "find-paths-basin-heights.png"));
}
