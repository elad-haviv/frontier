/** Moving a whole shape: a zone dragged by its inside. */
import { type Position, type Space, wrapLongitude } from "./space.js";

/**
 * The points moved as the pointer went from `from` to `to`, both positions in the map's space.
 *
 * On a flat map, by their difference. On a sphere, by a turn about the polar axis through the
 * change in longitude (taken between −180° and 180°), with the change in latitude added to each
 * point's latitude: the shape stays upright, north up, wherever it goes. The change in latitude is
 * held back so that no point passes a pole; the shape stops there instead of folding over it.
 * Longitudes keep their differences, so a shape across the 180th meridian stays in one piece.
 */
export function moveBy(space: Space, points: Position[], from: Position, to: Position): Position[] {
  if (space.kind === "flat") {
    const dx = to[0] - from[0];
    const dy = to[1] - from[1];
    return points.map(([x, y]) => [x + dx, y + dy]);
  }
  if (points.length === 0) return [];
  const dLon = wrapLongitude(to[0] - from[0]);
  const lats = points.map((p) => p[1]);
  const north = Math.max(...lats);
  const south = Math.min(...lats);
  const dLat = Math.max(-90 - south, Math.min(90 - north, to[1] - from[1]));
  // One whole turn for every point, chosen by the first, keeps longitudes in range and together.
  const first = points[0]![0] + dLon;
  const shift = wrapLongitude(first) - first;
  return points.map(([lon, lat]) => [lon + dLon + shift, lat + dLat]);
}
