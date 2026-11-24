/**
 * A small painter of pictures in memory, for the unit tests of Find paths and Find areas: plain
 * RGBA pixels, hard-edged, with no canvas, so a test can paint a sea, a river or a dashed road
 * and hand it to the same code the worker runs.
 */
import { findInk, type Ink } from "../findAreas/ink.ts";
import { type LabPicture, toLab } from "../findAreas/lab.ts";

export type Rgb = [number, number, number];

export const rgb = (hex: string): Rgb => {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};

export class Painter {
  readonly rgba: Uint8ClampedArray;

  constructor(
    readonly w: number,
    readonly h: number,
    ground: Rgb,
  ) {
    this.rgba = new Uint8ClampedArray(w * h * 4);
    this.where(() => true, ground);
  }

  private set(x: number, y: number, [r, g, b]: Rgb): void {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const i = (y * this.w + x) * 4;
    this.rgba[i] = r;
    this.rgba[i + 1] = g;
    this.rgba[i + 2] = b;
    this.rgba[i + 3] = 255;
  }

  /** Paints every pixel for which `inside` holds. */
  where(inside: (x: number, y: number) => boolean, colour: Rgb): this {
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) if (inside(x, y)) this.set(x, y, colour);
    }
    return this;
  }

  /**
   * A line through points, `width` pixels wide; with `dash` as [on, off] lengths, dashed.
   */
  line(points: [number, number][], width: number, colour: Rgb, dash?: [number, number]): this {
    let along = 0;
    const r = width / 2;
    for (let i = 1; i < points.length; i++) {
      const [ax, ay] = points[i - 1]!;
      const [bx, by] = points[i]!;
      const length = Math.hypot(bx - ax, by - ay);
      for (let s = 0; s <= length; s += 0.25) {
        const on = !dash || (along + s) % (dash[0] + dash[1]) < dash[0];
        if (!on) continue;
        const cx = ax + ((bx - ax) * s) / length;
        const cy = ay + ((by - ay) * s) / length;
        for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++) {
          for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
            if (Math.hypot(x - cx, y - cy) <= r) this.set(x, y, colour);
          }
        }
      }
      along += length;
    }
    return this;
  }

  /** A little grain, the same each time, as a scanned map has. */
  grain(amount: number): this {
    let seed = 20261125;
    for (let i = 0; i < this.w * this.h; i++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) | 0;
      const n = ((seed >>> 8) / 16777216 - 0.5) * 2 * amount;
      for (let c = 0; c < 3; c++) this.rgba[i * 4 + c] = this.rgba[i * 4 + c]! + n;
    }
    return this;
  }

  /** Every channel multiplied: a tinted scan of the same map. */
  tint(r: number, g: number, b: number): this {
    for (let i = 0; i < this.w * this.h; i++) {
      this.rgba[i * 4] = this.rgba[i * 4]! * r;
      this.rgba[i * 4 + 1] = this.rgba[i * 4 + 1]! * g;
      this.rgba[i * 4 + 2] = this.rgba[i * 4 + 2]! * b;
    }
    return this;
  }

  lab(): LabPicture {
    return toLab(this.rgba, this.w, this.h);
  }

  /** The picture as the worker looks at it: its Lab colours and its ink. */
  looked(): { pic: LabPicture; ink: Ink } {
    const pic = this.lab();
    return { pic, ink: findInk(pic) };
  }
}
