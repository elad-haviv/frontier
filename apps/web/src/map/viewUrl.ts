import { isProjectionId, type ViewState } from "@frontier/geo";

const LETTER = { flat: "f", globe: "g", plate: "p" } as const;
const round = (n: number, digits: number) => Number(n.toFixed(digits));

/** The view as it is kept in the address: its kind, centre and size, and for a projection its turn. */
export function writeView(state: ViewState): string {
  if (state.kind === "projected") {
    return [
      "x",
      state.projection,
      ...state.rotate.map((a) => round(a, 3)),
      round(state.k, 2),
      round(state.x, 1),
      round(state.y, 1),
    ].join(",");
  }
  const [a, b] = state.kind === "flat" ? [state.x, state.y] : [state.lon, state.lat];
  const digits = state.kind === "flat" ? 1 : 4;
  return [LETTER[state.kind], round(a, digits), round(b, digits), round(state.k, 4)].join(",");
}

/** Reads a view from the address, or null when it is missing or does not suit this kind of map. */
export function readView(text: string | null, sphere: boolean): ViewState | null {
  if (!text) return null;
  const [letter, ...rest] = text.split(",");
  if (letter === "x") {
    if (!sphere) return null;
    const [name, ...numbers] = rest;
    const [l, f, g, k, x, y] = numbers.map(Number);
    const all = [l, f, g, k, x, y];
    if (all.some((n) => n === undefined || !Number.isFinite(n)) || !(k! > 0)) return null;
    // A projection this Frontier does not know is shown in the plain flat view, at the same place.
    if (!name || !isProjectionId(name)) {
      return { kind: "plate", lon: -l!, lat: -f!, k: (k! * Math.PI) / 180 };
    }
    const wrap = (a: number) =>
      a >= -180 && a <= 180 ? a : ((((a + 180) % 360) + 360) % 360) - 180;
    return {
      kind: "projected",
      projection: name,
      rotate: [wrap(l!), Math.max(-90, Math.min(90, f!)), wrap(g!)],
      k: k!,
      x: x!,
      y: y!,
    };
  }
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
