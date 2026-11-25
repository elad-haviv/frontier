/**
 * Travelling time in words: "about 9½ days", at eight hours a day. And what a map's unit is in
 * kilometres, since the built-in speeds are km an hour.
 */

/** Hours travelled in a day. */
export const HOURS_A_DAY = 8;

/**
 * A time as travellers say it: whole hours under a day, then days to the nearest half.
 * "3 h", "1 day", "1½ days", "27 days".
 */
export function travelTime(hours: number): string {
  if (hours < HOURS_A_DAY - 0.5) return `${Math.max(1, Math.round(hours))} h`;
  const days = Math.round((hours / HOURS_A_DAY) * 2) / 2;
  const whole = Math.floor(days);
  const half = days - whole > 0;
  return `${whole || ""}${half ? "½" : ""} day${days > 1 ? "s" : ""}`;
}

const KM: Record<string, number> = {
  km: 1,
  kilometre: 1,
  kilometres: 1,
  kilometer: 1,
  kilometers: 1,
  m: 0.001,
  metre: 0.001,
  metres: 0.001,
  meter: 0.001,
  meters: 0.001,
  mi: 1.609344,
  mile: 1.609344,
  miles: 1.609344,
  league: 4.828032,
  leagues: 4.828032,
  ft: 0.0003048,
  feet: 0.0003048,
  nmi: 1.852,
};

/** How many kilometres one of a map's units is; null for a unit of the world's own. */
export function unitKm(unit: string): number | null {
  return KM[unit.trim().toLowerCase()] ?? null;
}
