/**
 * Positions and spaces. A position is two numbers in the map's own space: longitude and latitude
 * in degrees on a sphere, or x and y in pixels of the map's first image on a flat map, y downwards.
 */
export type Position = [number, number];

export type Space =
  | { kind: "sphere"; radius: number | null; unit: string }
  | { kind: "flat"; width: number; height: number; scale: number | null; unit: string };

/** `[west, south, east, north]` on a sphere, `[left, top, right, bottom]` on a flat map. */
export type Extent = [number, number, number, number];

/** A longitude brought into the range from -180 up to, not including, 180. */
export function wrapLongitude(lon: number): number {
  return ((((lon + 180) % 360) + 360) % 360) - 180;
}

export const clampLatitude = (lat: number): number => Math.max(-90, Math.min(90, lat));

/** The extent a map's space covers as a whole. */
export function fullExtent(space: Space): Extent {
  return space.kind === "sphere" ? [-180, -90, 180, 90] : [0, 0, space.width, space.height];
}
