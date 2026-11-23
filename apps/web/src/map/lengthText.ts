import type { Length } from "@frontier/geo";

const number = (n: number, digits = 1) =>
  n.toLocaleString(undefined, { maximumFractionDigits: digits });

/** A measured length in words: an angle and a share of the way round, or a distance. */
export function lengthText(length: Length, sphere: boolean): string {
  const parts: string[] = [];
  if (length.distance !== null) parts.push(`${number(length.distance)} ${length.unit}`);
  if (sphere) {
    parts.push(`${number(length.raw, 2)}°`);
    parts.push(`${number((length.fraction ?? 0) * 100, 2)}% of the way round`);
  } else if (length.distance === null) {
    parts.push(`${number(length.raw, 0)} map units`);
  }
  return parts.join(" · ");
}
