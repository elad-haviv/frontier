// Makes the pictures the Find areas browser tests look at (stage 19). Run from the repository
// root with `node apps/web/e2e/fixtures/make-find-areas.mjs`; the PNGs are committed beside it.
//
// find-areas-flat.png, 600 × 400: a sea, three countries with dark borders between them (West
// on the left; North-east and South-east on the right, split at y = 200), and an island.
// find-areas-globe.png, 720 × 360, a globe's plate: a sea, and two countries between 30° west
// and 30° east, one from 20° south to 20° north, the other from 20° to 50° north.
import { Buffer } from "node:buffer";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const here = dirname(fileURLToPath(import.meta.url));
const BORDER = 'stroke="#3c2f21" stroke-width="3" stroke-linejoin="round"';

const flat = `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="400">
  <rect width="600" height="400" fill="#aac5c4"/>
  <polygon points="60,60 300,60 300,340 60,340" fill="#a9b98a" ${BORDER}/>
  <polygon points="300,60 540,60 540,200 300,200" fill="#dcb871" ${BORDER}/>
  <polygon points="300,200 540,200 540,340 300,340" fill="#d2a296" ${BORDER}/>
  <polygon points="100,360 160,360 160,390 100,390" fill="#c9c19a" ${BORDER}/>
</svg>`;

// x = (lon + 180) × 2, y = (90 − lat) × 2.
const globe = `<svg xmlns="http://www.w3.org/2000/svg" width="720" height="360">
  <rect width="720" height="360" fill="#aac5c4"/>
  <polygon points="300,140 420,140 420,220 300,220" fill="#a9b98a" ${BORDER}/>
  <polygon points="300,80 420,80 420,140 300,140" fill="#dcb871" ${BORDER}/>
</svg>`;

await sharp(Buffer.from(flat)).png().toFile(join(here, "find-areas-flat.png"));
await sharp(Buffer.from(globe)).png().toFile(join(here, "find-areas-globe.png"));
