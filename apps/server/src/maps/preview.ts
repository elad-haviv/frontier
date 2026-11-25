/**
 * The small preview the list of maps carries for each map (stage 23): what a card draws without
 * the whole map file. A globe or flat map shows its first image; a star map its stars and routes
 * seen from above; a system model its orbits.
 */
import type { MapFeature, MapFile, MapPreview } from "@frontier/schema";

const BODY_COLOURS: Record<string, string> = {
  rocky: "#b08a6a",
  ocean: "#6d9fcf",
  gas: "#d9b38c",
  ice: "#9fcbd6",
  dwarf: "#bfb8ad",
  comet: "#dfe6ee",
};
const MOST_STARS = 60;
const MOST_RINGS = 5;

type Marker = Extract<MapFeature, { kind: "marker" }>;

export function previewOf(map: MapFile): MapPreview | null {
  if (map.space.kind === "stars") return starsPreview(map);
  if (map.space.kind === "system") return systemPreview(map);
  const image = map.images.find((i) => i.visible) ?? map.images[0];
  return image ? { kind: "image", path: image.path } : null;
}

function starsPreview(map: MapFile): MapPreview | null {
  const markers = map.features.filter((f): f is Marker => f.kind === "marker");
  if (markers.length === 0) return null;
  // The largest stars when there are too many to draw small.
  const kept = [...markers].sort((a, b) => (b.size ?? 2) - (a.size ?? 2)).slice(0, MOST_STARS);
  const xs = kept.map((m) => m.at[0]);
  const ys = kept.map((m) => m.at[1]);
  const [x0, x1] = [Math.min(...xs), Math.max(...xs)];
  const [y0, y1] = [Math.min(...ys), Math.max(...ys)];
  // One scale for both, so the shape is not stretched; the smaller side is centred.
  const span = Math.max(x1 - x0, y1 - y0, 1e-6);
  const mx = (x1 - x0) / span;
  const my = (y1 - y0) / span;
  const place = (v: number, lo: number, share: number) =>
    Math.round((0.1 + 0.8 * ((1 - share) / 2 + (v - lo) / span)) * 1000) / 1000;
  const index = new Map(kept.map((m, i) => [m.id, i]));
  const colour = (m: Marker) =>
    m.tone ?? map.layers.find((l) => l.id === m.layer)?.color ?? "#f2d28a";
  const lines: [number, number][] = [];
  for (const f of map.features) {
    if (f.kind !== "route") continue;
    for (let i = 1; i < f.stops.length; i++) {
      const a = index.get(f.stops[i - 1]!);
      const b = index.get(f.stops[i]!);
      if (a !== undefined && b !== undefined) lines.push([a, b]);
    }
  }
  return {
    kind: "stars",
    dots: kept.map((m) => ({
      x: place(m.at[0], x0, mx),
      y: 1 - place(m.at[1], y0, my),
      c: colour(m),
    })),
    lines,
  };
}

function systemPreview(map: MapFile): MapPreview | null {
  const bodies = map.features.flatMap((f) =>
    f.kind === "marker" && f.body ? [{ f, b: f.body }] : [],
  );
  const star = bodies.find((x) => x.b.type === "star");
  if (!star) return null;
  const planets = bodies
    .filter(
      (x) => x.b.parent === star.f.id && x.b.type !== "belt" && x.b.type !== "comet" && x.b.a > 0,
    )
    .sort((p, q) => p.b.a - q.b.a)
    .slice(0, MOST_RINGS);
  const widest = Math.max(...planets.map((p) => Math.sqrt(p.b.a)), 1e-6);
  return {
    kind: "system",
    star: star.f.tone ?? "#f2d28a",
    rings: planets.map((p) => ({
      r: Math.round((0.2 + 0.8 * (Math.sqrt(p.b.a) / widest)) * 1000) / 1000,
      a:
        Math.round(((((p.b.phase ?? 0) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)) * 1000) /
        1000,
      c: p.f.tone ?? BODY_COLOURS[p.b.type] ?? "#c9c5bb",
    })),
  };
}
