/** The inside of a zone on a globe laid flat. */
import { geoArea, type GeoContext, geoEquirectangular, geoPath } from "d3-geo";
import { densify } from "./measure.js";
import type { Position } from "./space.js";

/**
 * The rings to fill for a zone on a sphere in the flat view centred on the longitude `centre`.
 *
 * The outline of a zone cannot simply be closed and filled there: a zone that crosses the edge of
 * the picture is two pieces, and one that contains a pole reaches up to the pole's line across the
 * whole width. The rings returned here are those pieces, as `[longitude, latitude]` with every
 * longitude within 180 degrees of `centre`, cut where the picture repeats, so that the same rings
 * drawn at each repeat join into the whole zone.
 *
 * The inside of a zone is the smaller of the two parts its outline divides the globe into, as in
 * the globe view. Sides follow great circles, in the same steps as the outline that is drawn.
 */
export function zoneOnPlate(points: Position[], centre: number): Position[][] {
  if (points.length < 3) return [];
  let ring = densify({ kind: "sphere", radius: null, unit: "" }, [...points, points[0]!]);
  // d3 takes the inside of a ring to be on one side of its direction; a ring drawn the other way
  // would cover the rest of the globe.
  if (geoArea({ type: "Polygon", coordinates: [ring] }) > 2 * Math.PI) ring = ring.reverse();

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
  geoPath(
    projection,
    pen,
  )({
    type: "Polygon",
    coordinates: [ring],
  });
  return rings.filter((r) => r.length >= 3);
}
