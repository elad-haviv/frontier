/** The inside of a zone on a globe laid flat. */
import { geoArea, type GeoContext, geoEquirectangular, geoPath } from "d3-geo";
import type { Position } from "./space.js";

/**
 * Whether a closed ring encloses anything: not a dot, nor a line drawn there and back, which is
 * what a zone of fewer than three distinct points is drawn as.
 */
export function hasInside(ring: Position[]): boolean {
  if (ring.length < 4) return false;
  const area = geoArea({ type: "Polygon", coordinates: [ring] });
  return area > 1e-12 && area < 4 * Math.PI - 1e-12;
}

/**
 * A zone's closed outline as a GeoJSON polygon whose inside is the smaller of the two parts it
 * divides the globe into. d3 takes the inside of a ring to be on one side of its direction; a
 * ring drawn the other way would cover the rest of the globe. Both the globe's fill and the test
 * of a press inside a zone use this.
 */
export function zonePolygon(ring: Position[]): { type: "Polygon"; coordinates: Position[][] } {
  const shape = { type: "Polygon" as const, coordinates: [ring] };
  return geoArea(shape) > 2 * Math.PI ? { ...shape, coordinates: [[...ring].reverse()] } : shape;
}

/**
 * The rings to fill for a zone on a sphere in the flat view centred on the longitude `centre`.
 *
 * The outline of a zone cannot simply be closed and filled there: a zone that crosses the edge of
 * the picture is two pieces, and one that contains a pole reaches up to the pole's line across the
 * whole width. The rings returned here are those pieces, as `[longitude, latitude]` with every
 * longitude within 180 degrees of `centre`, cut where the picture repeats, so that the same rings
 * drawn at each repeat join into the whole zone.
 *
 * `ring` is the zone's closed outline (`outline(space, points, { curve, closed: true }).line`), in
 * steps fine enough to draw. The inside of a zone is the smaller of the two parts its outline
 * divides the globe into, as in the globe view.
 */
export function zoneOnPlate(ring: Position[], centre: number): Position[][] {
  if (!hasInside(ring)) return [];

  const rings: Position[][] = [];
  let current: Position[] = [];
  const nothing = () => undefined;
  const pen: GeoContext = {
    beginPath: nothing,
    closePath: nothing,
    arc: nothing,
    moveTo(x: number, y: number) {
      current = [[x + centre, -y]];
      rings.push(current);
    },
    lineTo(x: number, y: number) {
      current.push([x + centre, -y]);
    },
  };
  // One unit is one degree; d3 cuts the ring at the edge of the picture and carries it along
  // the pole's line where it contains a pole. The steps are already fine, so none are added.
  const projection = geoEquirectangular()
    .rotate([-centre, 0])
    .scale(180 / Math.PI)
    .translate([0, 0])
    .precision(0);
  geoPath(projection, pen)(zonePolygon(ring));
  return rings.filter((r) => r.length >= 3);
}
