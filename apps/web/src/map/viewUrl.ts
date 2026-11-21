import type { ViewState } from "@frontier/geo";

const LETTER = { flat: "f", globe: "g", plate: "p" } as const;
const round = (n: number, digits: number) => Number(n.toFixed(digits));

/** The view as it is kept in the address: its kind, centre and size. */
export function writeView(state: ViewState): string {
  const [a, b] = state.kind === "flat" ? [state.x, state.y] : [state.lon, state.lat];
  const digits = state.kind === "flat" ? 1 : 4;
  return [LETTER[state.kind], round(a, digits), round(b, digits), round(state.k, 4)].join(",");
}

/** Reads a view from the address, or null when it is missing or does not suit this kind of map. */
export function readView(text: string | null, sphere: boolean): ViewState | null {
  if (!text) return null;
  const [letter, ...rest] = text.split(",");
  const [a, b, k] = rest.map(Number);
  if (a === undefined || b === undefined || k === undefined) return null;
  if (![a, b, k].every(Number.isFinite) || k <= 0) return null;
  if (letter === "f" && !sphere) return { kind: "flat", x: a, y: b, k };
  if (letter === "g" && sphere) return { kind: "globe", lon: a, lat: b, k };
  if (letter === "p" && sphere) return { kind: "plate", lon: a, lat: b, k };
  return null;
}

/** An icon's file name made readable: without a game's prefix, a doubled ending, or underscores. */
export function iconLabel(name: string): string {
  return name
    .replace(/^SR-mapicon-/i, "")
    .replace(/\.png$/i, "")
    .replace(/_/g, " ");
}

/** 8 random characters for a new image, layer or feature. */
export function newItemId(): string {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  return [...bytes].map((b) => alphabet[b % 36]).join("");
}
