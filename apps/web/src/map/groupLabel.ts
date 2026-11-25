/**
 * Where a group's name is written on the map when it is placed by itself (stage 19): at the visual
 * centre of its largest piece, the point inside it farthest from its edges, unless no piece holds
 * 40% of the group (an archipelago of like islands), when it goes in the middle of the whole
 * group, across the sea, as a mapmaker writes it. A group with no zones is named above the middle
 * of its box. All of it works on the screen, on the shapes as they were drawn.
 */
type Point = [number, number];

/** The area of a ring, whichever way round it goes. */
export function ringArea(ring: readonly Point[]): number {
  let sum = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    sum += (ring[j]![0] + ring[i]![0]) * (ring[j]![1] - ring[i]![1]);
  }
  return Math.abs(sum / 2);
}

/** How far a point is from a ring's edge: positive inside, negative outside. */
function edgeDistance([x, y]: Point, ring: readonly Point[]): number {
  let inside = false;
  let least = Infinity;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [ax, ay] = ring[i]!;
    const [bx, by] = ring[j]!;
    if (ay > y !== by > y && x < ((bx - ax) * (y - ay)) / (by - ay) + ax) inside = !inside;
    const dx = bx - ax;
    const dy = by - ay;
    const t =
      dx || dy
        ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy)))
        : 0;
    least = Math.min(least, Math.hypot(x - (ax + t * dx), y - (ay + t * dy)));
  }
  return (inside ? 1 : -1) * least;
}

interface Cell {
  x: number;
  y: number;
  half: number;
  d: number;
  /** The most any point of the cell can be from the edge. */
  most: number;
}

const cellOf = (x: number, y: number, half: number, ring: readonly Point[]): Cell => {
  const d = edgeDistance([x, y], ring);
  return { x, y, half, d, most: d + half * Math.SQRT2 };
};

/**
 * The visual centre of a ring: the point inside it farthest from every edge, to within
 * `precision` pixels (the "pole of inaccessibility", found by splitting the box into cells and
 * looking only in those that could still hold a better point).
 */
export function polylabel(ring: readonly Point[], precision = 1): Point {
  const xs = ring.map((p) => p[0]);
  const ys = ring.map((p) => p[1]);
  const [x0, y0, x1, y1] = [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
  const size = Math.min(x1 - x0, y1 - y0);
  if (!(size > 0)) return [(x0 + x1) / 2, (y0 + y1) / 2];
  const half = size / 2;
  const queue: Cell[] = [];
  for (let x = x0; x < x1; x += size) {
    for (let y = y0; y < y1; y += size) queue.push(cellOf(x + half, y + half, half, ring));
  }
  let best = cellOf((x0 + x1) / 2, (y0 + y1) / 2, 0, ring);
  for (let guard = 0; queue.length > 0 && guard < 5000; guard++) {
    // The cell that could hold the farthest point is looked at first.
    let at = 0;
    for (let i = 1; i < queue.length; i++) if (queue[i]!.most > queue[at]!.most) at = i;
    const cell = queue.splice(at, 1)[0]!;
    if (cell.d > best.d) best = cell;
    if (cell.most - best.d <= precision) continue;
    const h = cell.half / 2;
    queue.push(
      cellOf(cell.x - h, cell.y - h, h, ring),
      cellOf(cell.x + h, cell.y - h, h, ring),
      cellOf(cell.x - h, cell.y + h, h, ring),
      cellOf(cell.x + h, cell.y + h, h, ring),
    );
  }
  return [best.x, best.y];
}

/** The box around some points: left, top, right, bottom; null when there are none. */
export function boxOf(points: readonly Point[]): [number, number, number, number] | null {
  if (points.length === 0) return null;
  let [x0, y0, x1, y1] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const [x, y] of points) {
    x0 = Math.min(x0, x);
    y0 = Math.min(y0, y);
    x1 = Math.max(x1, x);
    y1 = Math.max(y1, y);
  }
  return [x0, y0, x1, y1];
}

/** A piece must hold this share of the group's area for the name to go in it. */
export const LARGEST_SHARE = 0.4;

/**
 * Where a group's name goes by itself, on the screen: in the largest of its zones' pieces, or the
 * middle of the group; `above` says it should sit above that point, for a group with no zones.
 */
export function autoAnchor(
  zones: readonly (readonly Point[])[],
  others: readonly Point[],
): { at: Point; above: boolean } | null {
  const rings = zones.filter((r) => r.length >= 3);
  if (rings.length > 0) {
    const areas = rings.map(ringArea);
    const total = areas.reduce((a, b) => a + b, 0);
    const largest = areas.indexOf(Math.max(...areas));
    if (total > 0 && areas[largest]! / total >= LARGEST_SHARE) {
      return { at: polylabel(rings[largest]!), above: false };
    }
    const box = boxOf([...rings.flat(), ...others])!;
    return { at: [(box[0] + box[2]) / 2, (box[1] + box[3]) / 2], above: false };
  }
  const box = boxOf(others);
  return box ? { at: [(box[0] + box[2]) / 2, (box[1] + box[3]) / 2], above: true } : null;
}

/**
 * The name moved up or down, by whole lines, until no marker lies under its box: tried in place
 * first, then a line below, a line above, and so on. In place when none is clear.
 */
export function clearOfMarkers(
  at: Point,
  half: { w: number; h: number },
  markers: readonly Point[],
  reach = 8,
): Point {
  const clear = ([x, y]: Point) =>
    !markers.some(
      ([mx, my]) =>
        mx > x - half.w - reach &&
        mx < x + half.w + reach &&
        my > y - half.h - reach &&
        my < y + half.h + reach,
    );
  const line = half.h * 2 + 4;
  for (const step of [0, 1, -1, 2, -2]) {
    const tried: Point = [at[0], at[1] + step * line];
    if (clear(tried)) return tried;
  }
  return at;
}

/**
 * Whether the name is written at this zoom: while the group is at least 60% as wide on the screen
 * as its name, so zoomed far out small groups drop their names instead of covering the map.
 */
export const NAME_SHARE = 0.6;
export function nameFits(groupWidth: number, nameWidth: number): boolean {
  return groupWidth >= nameWidth * NAME_SHARE;
}

/** A darker shade of a colour: the name of a purple realm is written in a deep purple. */
export function darker(hex: string, by = 0.45): string {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) return "#2a2420";
  const part = (s: string) =>
    Math.round(parseInt(s, 16) * (1 - by))
      .toString(16)
      .padStart(2, "0");
  return `#${part(m[1]!)}${part(m[2]!)}${part(m[3]!)}`;
}
