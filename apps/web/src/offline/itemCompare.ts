/**
 * The compare screen's view of an item clash (stage 15c): for each item both sides changed, its
 * name and the fields that differ between the file as it is now and the server's kept copy of the
 * other side. Pure; `pages/Versions.tsx` draws it.
 */
import { findItem, type ItemShape, itemShapeOf } from "@frontier/schema";

/** One field that differs: what the file holds now, and what the kept copy holds. */
export interface FieldRow {
  field: string;
  now: string;
  other: string;
  /** A position: shown as "moved", with a way to the item on the map. */
  moved?: boolean;
}

export interface ItemDifference {
  key: string;
  name: string;
  /** `removed-other`: the kept copy has no such item; `removed-now`: the file has none now. */
  state: "changed" | "removed-other" | "removed-now" | "same";
  rows: FieldRow[];
}

/** Fields that place an item, shown as "moved" rather than as numbers. */
const POSITIONS = new Set(["at", "points", "extent"]);

/** What a field is called on screen. */
const FIELD_NAMES: Record<string, string> = {
  label: "Name",
  name: "Name",
  title: "Title",
  icon: "Icon",
  color: "Colour",
  order: "Place in the list",
  type: "Type",
  layer: "Layer",
  entry: "Linked entry",
  child: "Map under it",
  note: "Note",
  start: "Start",
  end: "End",
  length: "Length",
  point: "Single moment",
  lane: "Lane",
  visible: "Shown",
  curve: "Curve",
  kind: "Kind",
  space: "Space",
  markerSets: "Marker sets",
  under: "Lies under",
  main: "Main chronicle",
  clock: "Clock",
  origin: "Year 0",
  compare: "Comparison",
  path: "Folder",
};

const fieldName = (key: string) => FIELD_NAMES[key] ?? key;

/** A value in words, short enough for a table cell. */
export function shown(value: unknown): string {
  if (value === undefined || value === null || value === "") return "none";
  if (typeof value === "boolean") return value ? "yes" : "no";
  if (typeof value === "string") return value;
  if (typeof value === "number") return String(value);
  if (typeof value === "object" && value !== null && "name" in value) {
    return String((value as { name: unknown }).name);
  }
  const text = JSON.stringify(value);
  return text.length > 80 ? text.slice(0, 77) + "…" : text;
}

/** An item's name for the author: a label, a name, a folder's path, or a value's own key. */
function nameOf(shape: ItemShape, key: string, ...values: unknown[]): string {
  if (shape.tops.includes(key)) return fieldName(key);
  for (const v of values) {
    const item = v as { label?: unknown; name?: unknown; path?: unknown } | undefined;
    for (const n of [item?.label, item?.name, item?.path]) {
      if (typeof n === "string" && n) return n;
    }
  }
  return key;
}

/** The fields of two versions of one item that differ, in the order the item lists them. */
export function differingFields(now: unknown, other: unknown): FieldRow[] {
  if (typeof now !== "object" || now === null || typeof other !== "object" || other === null) {
    return JSON.stringify(now) === JSON.stringify(other)
      ? []
      : [{ field: "Value", now: shown(now), other: shown(other) }];
  }
  const a = now as Record<string, unknown>;
  const b = other as Record<string, unknown>;
  const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((k) => k !== "id");
  const rows: FieldRow[] = [];
  for (const k of keys) {
    if (JSON.stringify(a[k]) === JSON.stringify(b[k])) continue;
    if (POSITIONS.has(k)) {
      rows.push({ field: "Place", now: "moved", other: "another place", moved: true });
    } else rows.push({ field: fieldName(k), now: shown(a[k]), other: shown(b[k]) });
  }
  return rows;
}

/**
 * The clashing items of an item file, compared: `current` is the draft's text now, `other` the
 * kept copy's. Null when the path is not an item file or a text cannot be read.
 */
export function compareItems(
  path: string,
  current: string,
  other: string,
  clashes: string[],
): ItemDifference[] | null {
  const shape = itemShapeOf(path);
  if (!shape) return null;
  const now = shape.parse(current);
  const kept = shape.parse(other);
  if (!now || !kept) return null;
  return clashes.map((key) => {
    const a = findItem(shape, now, key);
    const b = findItem(shape, kept, key);
    const name = nameOf(shape, key, a?.value, b?.value);
    if (!b) return { key, name, state: "removed-other", rows: [] };
    if (!a) return { key, name, state: "removed-now", rows: [] };
    const rows = shape.tops.includes(key)
      ? differingFields({ [key]: a.value }, { [key]: b.value })
      : differingFields(a.value, b.value);
    return { key, name, state: rows.length === 0 ? "same" : "changed", rows };
  });
}

/** What the file is called in the column of its current state: "This map now". */
export function nowLabel(path: string): string {
  const kind = itemShapeOf(path)?.kind;
  if (kind === "map") return "This map now";
  if (kind === "chronicle") return "This chronicle now";
  return "This file now";
}
