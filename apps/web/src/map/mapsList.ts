/**
 * The list of maps, as the Maps page shows it (stage 23): each map is one card. Which maps match a
 * search or a filter, how they are sorted and grouped, and which cards are drawn as a deck are
 * decided here, so the page only draws.
 */
import type { MapPreview } from "@frontier/schema";
import { projectKey } from "../projectStorage.ts";

export type Kind = "sphere" | "flat" | "stars" | "system";
export type State = "new" | "unpublished" | "published";

/** A map as the list knows it. */
export interface MapRow {
  id: string;
  title: string;
  kind: Kind;
  /** A flat map marked schematic: a diagram, with no measuring. */
  schematic: boolean;
  features: number;
  state: State;
  /** The id of the globe it lies under. */
  under: string | null;
  /** When it last changed, in milliseconds; null when the server did not say. */
  edited: number | null;
  preview: MapPreview | null;
}

export const KIND_WORD: Record<Kind, string> = {
  sphere: "Globe",
  flat: "Flat map",
  stars: "Star map",
  system: "System model",
};
export const KIND_PLURAL: Record<Kind, string> = {
  sphere: "Globes",
  flat: "Flat maps",
  stars: "Star maps",
  system: "System models",
};
/** The short names on the filter chips. */
export const KIND_CHIP: Record<Kind, string> = {
  sphere: "Globes",
  flat: "Flat",
  stars: "Star maps",
  system: "Systems",
};
export const KINDS: Kind[] = ["sphere", "flat", "stars", "system"];

/** What the server's list gives for one map, made into a row. */
export function rowOf(m: {
  id: string;
  title: string;
  space: { kind: string; schematic?: boolean | undefined };
  under: string | null;
  features: number;
  state: string;
  edited?: string | null | undefined;
  preview?: MapPreview | null | undefined;
}): MapRow {
  const kind: Kind =
    m.space.kind === "sphere" || m.space.kind === "stars" || m.space.kind === "system"
      ? m.space.kind
      : "flat";
  const edited = m.edited ? Date.parse(m.edited) : NaN;
  return {
    id: m.id,
    title: m.title,
    kind,
    schematic: kind === "flat" && m.space.schematic === true,
    features: m.features,
    state: m.state === "new" ? "new" : m.state === "unpublished" ? "unpublished" : "published",
    under: m.under,
    edited: Number.isFinite(edited) ? edited : null,
    preview: m.preview ?? null,
  };
}

/** The maps that lie under this one, directly or through others, nearest first. */
export function below(id: string, rows: MapRow[]): MapRow[] {
  const out: MapRow[] = [];
  const seen = new Set([id]);
  let level = [id];
  while (level.length) {
    const next = rows.filter((r) => r.under !== null && level.includes(r.under) && !seen.has(r.id));
    for (const r of next) seen.add(r.id);
    out.push(...next);
    level = next.map((r) => r.id);
  }
  return out;
}

/** The maps this one lies under, directly or through others, nearest first. */
export function above(id: string, rows: MapRow[]): MapRow[] {
  const out: MapRow[] = [];
  const seen = new Set([id]);
  let at = rows.find((r) => r.id === id)?.under;
  while (at && !seen.has(at)) {
    seen.add(at);
    const up = rows.find((r) => r.id === at);
    if (!up) break;
    out.push(up);
    at = up.under;
  }
  return out;
}

/** Whether the map is part of a stack of globes: something lies under it, or it lies under something. */
export function inStack(id: string, rows: MapRow[]): boolean {
  return below(id, rows).length > 0 || above(id, rows).length > 0;
}

/**
 * How many sheets show behind a card, from 0 to 2: a map that has maps lying under it is drawn as
 * a deck. It is only how the card looks; the cards are not grouped.
 */
export function deckDepth(id: string, rows: MapRow[]): 0 | 1 | 2 {
  return Math.min(2, below(id, rows).length) as 0 | 1 | 2;
}

/** What a search is matched against: the title, the kind, and the titles of the maps it lies under. */
function haystack(r: MapRow, rows: MapRow[]): string {
  return [
    r.title,
    KIND_WORD[r.kind],
    KIND_PLURAL[r.kind],
    r.schematic ? "schematic diagram" : "",
    ...above(r.id, rows).map((u) => u.title),
  ]
    .join(" ")
    .toLowerCase();
}

/** Every word typed must be found, in any order. */
export function matches(r: MapRow, query: string, rows: MapRow[]): boolean {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const text = haystack(r, rows);
  return words.every((w) => text.includes(w));
}

export interface Filters {
  query: string;
  kind: Kind | "all";
  /** Only maps that are not published yet or have unpublished changes. */
  needsPublishing: boolean;
}
export const NO_FILTERS: Filters = { query: "", kind: "all", needsPublishing: false };
export const isFiltered = (f: Filters) =>
  f.query.trim() !== "" || f.kind !== "all" || f.needsPublishing;

export type Sort = "recent" | "name" | "kind";

const byName = (a: MapRow, b: MapRow) => a.title.localeCompare(b.title);

export function filterAndSort(rows: MapRow[], f: Filters, sort: Sort): MapRow[] {
  const kept = rows.filter(
    (r) =>
      (f.kind === "all" || r.kind === f.kind) &&
      (!f.needsPublishing || r.state !== "published") &&
      matches(r, f.query, rows),
  );
  const compare: Record<Sort, (a: MapRow, b: MapRow) => number> = {
    recent: (a, b) => (b.edited ?? -Infinity) - (a.edited ?? -Infinity) || byName(a, b),
    name: byName,
    kind: (a, b) => KINDS.indexOf(a.kind) - KINDS.indexOf(b.kind) || byName(a, b),
  };
  return [...kept].sort(compare[sort]);
}

/** How many maps there are of each kind, and how many need publishing, for the filter chips. */
export function counts(rows: MapRow[]): Record<Kind | "all" | "needsPublishing", number> {
  const out = { all: rows.length, sphere: 0, flat: 0, stars: 0, system: 0, needsPublishing: 0 };
  for (const r of rows) {
    out[r.kind]++;
    if (r.state !== "published") out.needsPublishing++;
  }
  return out;
}

/** Maps in groups by kind, in the order of KINDS, leaving out the kinds with none. */
export function byKind(rows: MapRow[]): { kind: Kind; rows: MapRow[] }[] {
  return KINDS.map((kind) => ({ kind, rows: rows.filter((r) => r.kind === kind) })).filter(
    (g) => g.rows.length,
  );
}

// ---- What shows at each size of library -------------------------------------------------------

/** A library grows into its tools: nothing but cards at first, then search, then filters. */
export function toolsFor(count: number, filtering: boolean) {
  return {
    view: count >= 5,
    search: count >= 12 || filtering,
    chips: count >= 30 || filtering,
    recent: count >= 30,
    groups: count >= 8,
    newTile: count < 8,
  };
}

/** Grid up to about 40 maps, and a list above, until the author chooses. */
export const defaultView = (count: number): "grid" | "list" => (count > 40 ? "list" : "grid");

// ---- Words --------------------------------------------------------------------------------------

const DAY = 86_400_000;

/** "today", "yesterday", "3 days ago", "last month", "5 months ago". */
export function agoText(at: number | null, now = Date.now()): string {
  if (at === null) return "";
  const days = Math.max(0, Math.floor((now - at) / DAY));
  if (days === 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days} days ago`;
  if (days < 60) return "last month";
  if (days < 365) return `${Math.floor(days / 30)} months ago`;
  return days < 730 ? "last year" : `${Math.floor(days / 365)} years ago`;
}

/** "12 features · edited 3 days ago". */
export function metaText(r: MapRow, now = Date.now()): string {
  const features = `${r.features} ${r.features === 1 ? "feature" : "features"}`;
  return r.edited === null ? features : `${features} · edited ${agoText(r.edited, now)}`;
}

/** Where a map sits among the others, in words: "lies under Ezob", "2 layers below", or both. */
export function stackText(r: MapRow, rows: MapRow[]): string {
  const up = above(r.id, rows)[0];
  const down = below(r.id, rows).length;
  const parts: string[] = [];
  if (up) parts.push(`lies under ${up.title}`);
  if (down) parts.push(`${down} ${down === 1 ? "layer" : "layers"} below`);
  return parts.join(" · ");
}

export function stateText(s: State): string {
  return s === "new" ? "Not published yet" : s === "unpublished" ? "Unpublished changes" : "";
}

// ---- Recently opened (kept on this device) -----------------------------------------------------

const RECENT_KEY = "frontier.maps.recent";
/** Kept per project: the maps of one library are not the other's. */
const recentKey = () => projectKey(RECENT_KEY);

/** Notes that a map was opened. */
export function noteOpened(id: string, now = Date.now()): void {
  try {
    const list = recentList().filter((r) => r.id !== id);
    list.unshift({ id, at: now });
    localStorage.setItem(recentKey(), JSON.stringify(list.slice(0, 20)));
  } catch {
    // Without storage nothing is remembered, and the page still works.
  }
}

export function recentList(): { id: string; at: number }[] {
  try {
    const raw = JSON.parse(localStorage.getItem(recentKey()) ?? "[]") as unknown;
    return Array.isArray(raw)
      ? raw.filter(
          (r): r is { id: string; at: number } =>
            typeof r?.id === "string" && typeof r?.at === "number",
        )
      : [];
  } catch {
    return [];
  }
}

/** The maps opened most recently that still exist, newest first. */
export function recentMaps(rows: MapRow[], count = 4): MapRow[] {
  const out: MapRow[] = [];
  for (const r of recentList()) {
    const row = rows.find((x) => x.id === r.id);
    if (row) out.push(row);
    if (out.length === count) break;
  }
  return out;
}

const VIEW_KEY = "frontier.maps.view";
export function savedView(): "grid" | "list" | null {
  try {
    const v = localStorage.getItem(VIEW_KEY);
    return v === "grid" || v === "list" ? v : null;
  } catch {
    return null;
  }
}
export function saveView(view: "grid" | "list"): void {
  try {
    localStorage.setItem(VIEW_KEY, view);
  } catch {
    // Not remembered.
  }
}
