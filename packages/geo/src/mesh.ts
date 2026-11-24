/**
 * The grid of an image. An image is drawn as a grid of cells whose corners are positions in the
 * map's space; the renderer turns each corner into a screen point with the current view.
 */
import { type Projected, projectedFrame } from "./projections.js";
import type { Extent, Position, Space } from "./space.js";

export interface Mesh {
  /** Corner positions, two numbers each. */
  positions: Float32Array;
  /** Where each corner falls in the image, from 0 to 1, two numbers each. */
  uvs: Float32Array;
  /** Three corner numbers per triangle. */
  triangles: Uint16Array;
  columns: number;
  rows: number;
}

/**
 * The grid for an image covering `extent`. A flat map needs one cell. On a sphere the whole globe
 * gets `fullColumns` by half as many rows, and a partial image a share of that, never fewer than
 * four cells a side.
 */
export function meshFor(space: Space, extent: Extent, fullColumns = 64): Mesh {
  const [x0, y0, x1, y1] = extent;
  let columns = 1;
  let rows = 1;
  if (space.kind === "sphere") {
    columns = Math.max(4, Math.round((fullColumns * Math.abs(x1 - x0)) / 360));
    rows = Math.max(4, Math.round(((fullColumns / 2) * Math.abs(y1 - y0)) / 180));
  }
  const positions = new Float32Array((columns + 1) * (rows + 1) * 2);
  const uvs = new Float32Array(positions.length);
  let n = 0;
  for (let r = 0; r <= rows; r++) {
    for (let c = 0; c <= columns; c++) {
      const u = c / columns;
      const v = r / rows;
      positions[n] = x0 + (x1 - x0) * u;
      // On a sphere the extent's second number is south and the image's top row is north.
      positions[n + 1] = space.kind === "sphere" ? y1 + (y0 - y1) * v : y0 + (y1 - y0) * v;
      uvs[n] = u;
      uvs[n + 1] = v;
      n += 2;
    }
  }
  const triangles = new Uint16Array(columns * rows * 6);
  let t = 0;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < columns; c++) {
      const a = r * (columns + 1) + c;
      const b = a + 1;
      const d = a + columns + 1;
      const e = d + 1;
      triangles.set([a, d, b, b, d, e], t);
      t += 6;
    }
  }
  return { positions, uvs, triangles, columns, rows };
}

/**
 * The grid of an image for the globe view, built for the part of the globe that is on screen.
 *
 * Inside a cell the image is stretched linearly, which only approximates the curve of the globe.
 * The cell size therefore shrinks as the globe grows: at `1.3 / sqrt(k)` radians the picture stays
 * within half a pixel of the true projection. `coarse` doubles the cell while a finger is down on
 * a slow device.
 */
export function globeMesh(
  view: { lon: number; lat: number; k: number },
  width: number,
  height: number,
  extent: Extent,
  coarse = false,
): Mesh {
  const deg = 180 / Math.PI;
  const cell = Math.min(6, (1.3 / Math.sqrt(view.k)) * deg) * (coarse ? 2 : 1);
  const [west, south, east, north] = extent;

  // How far from the centre the screen reaches over the globe's surface, in degrees.
  const reach = Math.asin(Math.min(1, Math.hypot(width, height) / 2 / view.k)) * deg;
  let lon0 = west;
  let lon1 = east;
  const lat0 = Math.max(south, view.lat - reach);
  const lat1 = Math.min(north, view.lat + reach);
  const poleInView = Math.abs(view.lat) + reach >= 90;
  if (!poleInView) {
    const half =
      Math.asin(Math.min(1, Math.sin(reach / deg) / Math.cos(view.lat / deg))) * deg + cell;
    // The image's own longitudes may be written anywhere; bring the centre near them.
    let centre = view.lon;
    const middle = (west + east) / 2;
    while (centre - middle > 180) centre -= 360;
    while (centre - middle < -180) centre += 360;
    lon0 = Math.max(west, centre - half);
    lon1 = Math.min(east, centre + half);
    // A full-globe image seen across the 180th meridian: draw the whole of it rather than two parts.
    if (east - west >= 360 && (centre - half < west || centre + half > east)) {
      lon0 = west;
      lon1 = east;
    }
  }
  if (lon1 <= lon0 || lat1 <= lat0) {
    return {
      positions: new Float32Array(0),
      uvs: new Float32Array(0),
      triangles: new Uint16Array(0),
      columns: 0,
      rows: 0,
    };
  }

  // Corners sit on a grid fixed to the image, so the picture does not swim as the view moves.
  const c0 = Math.floor((lon0 - west) / cell);
  const c1 = Math.ceil((lon1 - west) / cell);
  const r0 = Math.floor((north - lat1) / cell);
  const r1 = Math.ceil((north - lat0) / cell);
  const columns = c1 - c0;
  const rows = r1 - r0;
  const positions = new Float32Array((columns + 1) * (rows + 1) * 2);
  const uvs = new Float32Array(positions.length);
  let n = 0;
  for (let r = r0; r <= r1; r++) {
    const lat = Math.max(south, north - r * cell);
    for (let c = c0; c <= c1; c++) {
      const lon = Math.min(east, west + c * cell);
      positions[n] = lon;
      positions[n + 1] = lat;
      uvs[n] = (lon - west) / (east - west);
      uvs[n + 1] = (north - lat) / (north - south);
      n += 2;
    }
  }
  const triangles = new Uint16Array(columns * rows * 6);
  let t = 0;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < columns; c++) {
      const a = r * (columns + 1) + c;
      const b = a + 1;
      const d = a + columns + 1;
      triangles.set([a, d, b, b, d, d + 1], t);
      t += 6;
    }
  }
  return { positions, uvs, triangles, columns, rows };
}

/** An image grid for a projected view: plain triangles, corners on the screen, places in the image. */
export interface ProjectedMesh {
  /** Screen positions, two numbers per corner, three corners per triangle. */
  positions: Float32Array;
  /** Places in the image, two numbers per corner; may lie outside 0 to 1 where the image ends. */
  uvs: Float32Array;
}

/** The largest cell, in degrees, that divides 180 and is no larger than `wanted`. */
export function cellFor(wanted: number): number {
  let cell = 4;
  while (cell > wanted && cell > 1 / 64) cell /= 2;
  return cell;
}

/**
 * The grid of an image for a projected view.
 *
 * The grid is laid in the turned frame, so the map's edge and the cut between hemispheres fall on
 * cell edges and no cell is stretched across the map. Each cell has corners of its own, nudged a
 * millionth of a degree inside it, so a corner on an edge lands on its cell's side. A corner's
 * place in the image is found by turning it back. Within a cell the longitudes are brought within
 * 180 degrees of each other before they are read as places in the image, and a corner at the
 * image's own pole takes the longitude of its neighbours, so no cell samples across the image.
 */
export function projectedMesh(
  state: Projected,
  width: number,
  height: number,
  extent: Extent,
  coarse = false,
): ProjectedMesh {
  const frame = projectedFrame(state, width, height);
  const deg = 180 / Math.PI;
  const cell = cellFor(Math.min(2, (1.3 / Math.sqrt(state.k)) * deg) * (coarse ? 2 : 1));
  const limit = frame.latLimit;

  // The part of the turned frame on screen, from points sampled across it.
  let lon0 = 180;
  let lon1 = -180;
  let lat0 = limit;
  let lat1 = -limit;
  let found = 0;
  const n = 24;
  for (let i = 0; i <= n; i++) {
    for (let j = 0; j <= n; j++) {
      const t = frame.fromScreen((width * i) / n, (height * j) / n);
      if (!t) continue;
      found += 1;
      lon0 = Math.min(lon0, t[0]);
      lon1 = Math.max(lon1, t[0]);
      lat0 = Math.min(lat0, t[1]);
      lat1 = Math.max(lat1, t[1]);
    }
  }
  // When part of the screen is off the map, the edge of what is on it lies between samples.
  const spare = found === (n + 1) * (n + 1) ? 2 * cell : Math.max(2 * cell, 20);
  if (found === 0) [lon0, lon1, lat0, lat1] = [-180, 180, -limit, limit];
  lon0 = Math.max(-180, Math.floor((lon0 - spare) / cell) * cell);
  lon1 = Math.min(180, Math.ceil((lon1 + spare) / cell) * cell);
  lat0 = Math.max(-limit, Math.floor((lat0 - spare) / cell) * cell);
  lat1 = Math.min(limit, Math.ceil((lat1 + spare) / cell) * cell);

  const [west, south, east, north] = extent;
  const whole = east - west >= 360;
  const positions: number[] = [];
  const uvs: number[] = [];
  const e = 1e-6;
  const corner = (lon: number, lat: number) => {
    const t: Position = [lon, Math.max(-limit, Math.min(limit, lat))];
    return { screen: frame.toScreen(t), place: frame.unturn(t) };
  };

  for (let lat = lat0; lat < lat1 - e; lat += cell) {
    const top = Math.min(lat + cell, lat1);
    for (let lon = lon0; lon < lon1 - e; lon += cell) {
      const right = Math.min(lon + cell, lon1);
      const cs = [
        corner(lon + e, top - e),
        corner(right - e, top - e),
        corner(lon + e, lat + e),
        corner(right - e, lat + e),
      ];
      const xs = cs.map((c) => c.screen[0]);
      const ys = cs.map((c) => c.screen[1]);
      if (Math.max(...xs) < 0 || Math.min(...xs) > width) continue;
      if (Math.max(...ys) < 0 || Math.min(...ys) > height) continue;

      // Longitudes within 180 degrees of each other; a corner at the image's pole follows the rest.
      const away = cs.filter((c) => Math.abs(c.place[1]) < 89.9);
      const ref = (away[0] ?? cs[0]!).place[0];
      const near = (l: number) => l + 360 * Math.round((ref - l) / 360);
      const poleLon =
        away.length > 0 ? away.reduce((sum, c) => sum + near(c.place[0]), 0) / away.length : ref;
      const uv = cs.map((c) => {
        const lonAt = Math.abs(c.place[1]) < 89.9 ? near(c.place[0]) : poleLon;
        return [(lonAt - west) / (east - west), (north - c.place[1]) / (north - south)] as const;
      });
      // Nothing of a part image in this cell: leave it out.
      if (uv.every((q) => q[1] < 0) || uv.every((q) => q[1] > 1)) continue;
      if (!whole && (uv.every((q) => q[0] < 0) || uv.every((q) => q[0] > 1))) continue;

      for (const i of [0, 1, 2, 1, 3, 2]) {
        positions.push(cs[i]!.screen[0], cs[i]!.screen[1]);
        uvs.push(uv[i]![0], uv[i]![1]);
      }
    }
  }
  return { positions: new Float32Array(positions), uvs: new Float32Array(uvs) };
}
