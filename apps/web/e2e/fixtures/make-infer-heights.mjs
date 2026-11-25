// Makes the picture the Terrain hints browser tests look at (stage 21). Run from the repository
// root with `node apps/web/e2e/fixtures/make-infer-heights.mjs`; the PNG is committed.
//
// infer-heights.png, 600 × 400 (a position is a pixel): an island in a sea, its coast dark. A
// river rises at (380, 190) and runs west to the coast at about (60, 210), drawn wider downstream,
// with a tributary from (250, 100) joining it at about (255, 205). A lake lies at (420, 290). A
// chain of mountain symbols runs from (380, 80) to (500, 160), drawn largest in its middle. Reed
// marks make a marsh about (140, 280). A dashed red road runs north to south at x = 190.
import { Buffer } from "node:buffer";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const here = dirname(fileURLToPath(import.meta.url));
const W = 600;
const H = 400;
const RIVER = 'fill="none" stroke="#4a7391" stroke-linecap="round" stroke-linejoin="round"';

const symbols = [];
for (let k = 0; k <= 6; k++) {
  for (const off of [-1, 1]) {
    const t = (k + (off > 0 ? 0.5 : 0)) / 6.5;
    const x = 380 + 120 * t + off * 12;
    const y = 80 + 80 * t - off * 16;
    const size = 11 + 11 * (1 - Math.abs(t - 0.5) * 2);
    symbols.push(
      `<polyline points="${x - size / 2},${y + size * 0.35} ${x},${y - size * 0.35} ${x + size / 2},${y + size * 0.35}" fill="none" stroke="#4a3a2a" stroke-width="1.8" stroke-linejoin="round"/>`,
    );
  }
}
const reeds = [];
for (let y = 258; y < 302; y += 10) {
  for (let x = 98; x < 184; x += 16) {
    const jx = x + ((((y - 258) / 10) | 0) % 2) * 8;
    if (((jx - 140) / 42) ** 2 + ((y - 280) / 22) ** 2 > 1) continue;
    reeds.push(
      `<path d="M${jx - 5},${y} H${jx + 5} M${jx - 2.5},${y - 0.6} L${jx - 3.2},${y - 3.5} M${jx},${y - 0.6} V${y - 5} M${jx + 2.5},${y - 0.6} L${jx + 3.2},${y - 3.5}" stroke="#4b6a58" stroke-width="1.2" fill="none"/>`,
    );
  }
}

const picture = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
  <rect width="${W}" height="${H}" fill="#aac5c4"/>
  <ellipse cx="300" cy="200" rx="250" ry="165" fill="#ded2a2" stroke="#3c2f21" stroke-width="2.5"/>
  <ellipse cx="420" cy="290" rx="30" ry="18" fill="#93b3bd" stroke="#3c2f21" stroke-width="1.5"/>
  <polyline points="190,50 190,350" fill="none" stroke="#8a3520" stroke-width="2.2" stroke-dasharray="8 4"/>
  <polyline points="380,190 310,205" ${RIVER} stroke-width="2.2"/>
  <polyline points="310,205 200,203" ${RIVER} stroke-width="3.2"/>
  <polyline points="200,203 52,210" ${RIVER} stroke-width="4.4"/>
  <polyline points="250,100 255,204" ${RIVER} stroke-width="2.2"/>
  ${symbols.join("\n  ")}
  ${reeds.join("\n  ")}
</svg>`;

await sharp(Buffer.from(picture)).png().toFile(join(here, "infer-heights.png"));
