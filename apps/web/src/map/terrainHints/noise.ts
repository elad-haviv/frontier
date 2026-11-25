/**
 * Natural detail for a built height map: smooth value noise from a seed, summed over octaves
 * (fractal noise), and its ridged form (1 − |noise|, sharpened), which draws mountain crests. The
 * same seed always gives the same detail, so a variation can be told by its number.
 */

/** A small fast generator of numbers 0 to 1 from a seed (mulberry32). */
export function seeded(seed: number): () => number {
  let a = seed | 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class Noise {
  private perm = new Uint8Array(512);
  private value = new Float32Array(256);

  constructor(seed: number) {
    const rand = seeded(seed * 7919 + 20261125);
    const p = Array.from({ length: 256 }, (_, i) => i);
    for (let i = 255; i > 0; i--) {
      const j = (rand() * (i + 1)) | 0;
      [p[i], p[j]] = [p[j]!, p[i]!];
    }
    for (let i = 0; i < 512; i++) this.perm[i] = p[i & 255]!;
    for (let i = 0; i < 256; i++) this.value[i] = rand() * 2 - 1;
  }

  /** Value noise, about −1 to 1, smooth between whole positions. */
  at(x: number, y: number): number {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const xf = x - xi;
    const yf = y - yi;
    const X = xi & 255;
    const Y = yi & 255;
    const u = xf * xf * (3 - 2 * xf);
    const v = yf * yf * (3 - 2 * yf);
    const { perm: P, value: G } = this;
    const a = G[P[X + P[Y]!]!]!;
    const b = G[P[X + 1 + P[Y]!]!]!;
    const c = G[P[X + P[Y + 1]!]!]!;
    const d = G[P[X + 1 + P[Y + 1]!]!]!;
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
  }

  /** Fractal noise: `octaves` of noise, each twice as fine and half as strong. About −1 to 1. */
  fbm(x: number, y: number, octaves: number): number {
    let sum = 0;
    let amp = 0.5;
    let f = 1;
    let norm = 0;
    for (let i = 0; i < octaves; i++) {
      sum += amp * this.at(x * f + i * 17.3, y * f - i * 9.1);
      norm += amp;
      amp *= 0.5;
      f *= 2.03;
    }
    return sum / norm;
  }

  /** Ridged noise, 0 to 1: high along thin crests, sharper as `sharp` (0 to 1) grows. */
  ridged(x: number, y: number, octaves: number, sharp: number): number {
    const r = Math.max(0, 1 - Math.abs(this.fbm(x, y, octaves)) * 2.6);
    return r ** (1 + sharp * 2.2);
  }
}
