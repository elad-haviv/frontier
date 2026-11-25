/**
 * The picture's colours in CIE Lab, where a distance (ΔE) follows what the eye sees: "how alike"
 * then means the same for greens as for ochres.
 */

/** A picture the tool looks at: its size and each pixel's Lab colour. */
export interface LabPicture {
  w: number;
  h: number;
  L: Float32Array;
  A: Float32Array;
  B: Float32Array;
}

/** sRGB 0–255 to linear light, once for each value. */
const LINEAR = (() => {
  const out = new Float32Array(256);
  for (let i = 0; i < 256; i++) {
    const c = i / 255;
    out[i] = c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }
  return out;
})();

const f = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);

/** The paper a see-through pixel is laid on, so the empty parts of a picture read as paper. */
const PAPER = [247, 243, 234] as const;

/** Converts RGBA pixels (as `getImageData` gives them) to Lab, with D65 white. */
export function toLab(rgba: ArrayLike<number>, w: number, h: number): LabPicture {
  const n = w * h;
  const L = new Float32Array(n);
  const A = new Float32Array(n);
  const B = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const alpha = rgba[i * 4 + 3]! / 255;
    const mix = (c: number, k: number) => Math.round(c * alpha + PAPER[k]! * (1 - alpha));
    const r = LINEAR[mix(rgba[i * 4]!, 0)]!;
    const g = LINEAR[mix(rgba[i * 4 + 1]!, 1)]!;
    const b = LINEAR[mix(rgba[i * 4 + 2]!, 2)]!;
    const fx = f((0.4124 * r + 0.3576 * g + 0.1805 * b) / 0.95047);
    const fy = f(0.2126 * r + 0.7152 * g + 0.0722 * b);
    const fz = f((0.0193 * r + 0.1192 * g + 0.9505 * b) / 1.08883);
    L[i] = 116 * fy - 16;
    A[i] = 500 * (fx - fy);
    B[i] = 200 * (fy - fz);
  }
  return { w, h, L, A, B };
}
