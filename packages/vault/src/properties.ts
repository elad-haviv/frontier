/**
 * The author's own properties: any key of the frontmatter beyond the ones Frontier gives fields of
 * their own (id, type, dates, other names, tags). Their kind is read from the value, as Obsidian
 * reads it, so the file stays plain YAML that Obsidian shows the same way.
 */
import { readFrontmatter } from "./frontmatter.js";
import type { NameCheck } from "./names.js";

/** The kinds of value a property can hold. */
export const PROPERTY_KINDS = ["text", "number", "date", "checkbox", "list", "link"] as const;
export type PropertyKind = (typeof PROPERTY_KINDS)[number];

/** Keys with fields of their own; they are not the author's own properties. */
export const BUILT_IN_KEYS = ["id", "type", "time", "aliases", "tags"] as const;

export interface CustomProperty {
  key: string;
  /** "other" for a value none of the kinds can show, such as a nested list; it is changed in the text. */
  kind: PropertyKind | "other";
  value: unknown;
}

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const LINK = /^\[\[([^[\]\n]+)\]\]$/;

/** The kind a value reads as. An empty value reads as text. */
export function propertyKind(value: unknown): PropertyKind | "other" {
  if (value === null || value === undefined) return "text";
  if (typeof value === "boolean") return "checkbox";
  if (typeof value === "number") return Number.isFinite(value) ? "number" : "other";
  if (value instanceof Date) return "date";
  if (typeof value === "string") {
    if (DATE.test(value)) return "date";
    if (LINK.test(value)) return "link";
    return "text";
  }
  if (Array.isArray(value) && value.every((v) => typeof v === "string" || typeof v === "number")) {
    return "list";
  }
  return "other";
}

const isBuiltIn = (key: string) => (BUILT_IN_KEYS as readonly string[]).includes(key.toLowerCase());

/**
 * The author's own properties, in the order they are written. Null when the frontmatter cannot
 * be read.
 */
export function customProperties(text: string): CustomProperty[] | null {
  const { data, error } = readFrontmatter(text);
  if (error) return null;
  if (!data) return [];
  return Object.entries(data)
    .filter(([key]) => !isBuiltIn(key))
    .map(([key, raw]) => {
      const value = raw instanceof Date ? raw.toISOString().slice(0, 10) : raw;
      return { key, kind: propertyKind(value), value };
    });
}

/** The entry a link property points at, as written between the brackets, or null. */
export function linkOf(value: unknown): string | null {
  if (typeof value !== "string") return null;
  return LINK.exec(value)?.[1] ?? null;
}

/**
 * The value to write for what the author typed or chose, for a property of the given kind. An
 * empty answer is written as an empty value. Throws a plain-worded Error for a number that is
 * not one.
 */
export function propertyValue(kind: PropertyKind, input: string | boolean | string[]): unknown {
  switch (kind) {
    case "checkbox":
      return input === true || input === "true";
    case "list": {
      const items = Array.isArray(input) ? input : String(input).split(",");
      return items.map((s) => String(s).trim()).filter(Boolean);
    }
    case "number": {
      const raw = String(input).trim();
      if (raw === "") return null;
      const n = Number(raw);
      if (!Number.isFinite(n)) throw new Error("Write a number, such as 12 or 3.5.");
      return n;
    }
    case "date": {
      const raw = String(input).trim();
      if (raw === "") return null;
      if (!DATE.test(raw)) throw new Error("Write the date as year-month-day, such as 2026-03-01.");
      return raw;
    }
    case "link": {
      const raw = String(input).trim();
      if (raw === "") return null;
      return LINK.test(raw) ? raw : `[[${raw}]]`;
    }
    default: {
      const raw = String(input);
      return raw.trim() === "" ? null : raw;
    }
  }
}

/** What the value shows as in a field: lists joined with commas, a link without its brackets. */
export function propertyText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (Array.isArray(value)) return value.map(String).join(", ");
  return linkOf(value) ?? String(value);
}

/**
 * Checks a new property name against the keys the entry already has. Letter case is ignored, as
 * Obsidian ignores it.
 */
export function checkPropertyName(raw: string, existing: string[]): NameCheck {
  const name = raw.trim();
  if (name === "") return { ok: false, problem: "Give the property a name." };
  if (/[\n\r]/.test(name)) return { ok: false, problem: "A name is one line." };
  if (name.length > 100) return { ok: false, problem: "That name is too long." };
  if (isBuiltIn(name)) {
    return { ok: false, problem: `“${name}” has a field of its own above.` };
  }
  if (existing.some((k) => k.toLowerCase() === name.toLowerCase())) {
    return { ok: false, problem: `There is already a property called “${name}”.` };
  }
  return { ok: true, name };
}
