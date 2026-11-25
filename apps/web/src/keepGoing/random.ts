/**
 * The dice: asks the server for a random entry of a kind and opens it. Used by the left bar, the
 * switcher, Home, the phone's round button, the `g r` key and the nudge after Publish.
 */
import type { NavigateFunction } from "react-router-dom";
import type { RandomQuery } from "@frontier/schema";
import { api, entryUrl } from "../api.ts";

export type RandomKind = NonNullable<RandomQuery["kind"]>;

/** The kinds in the order the dice offers them, with their words. */
export const RANDOM_KINDS: readonly { kind: RandomKind; label: string }[] = [
  { kind: "any", label: "Any" },
  { kind: "stub", label: "A stub" },
  { kind: "folder", label: "In this folder" },
  { kind: "old", label: "Untouched 6 months" },
];

/**
 * Opens a random entry. Resolves to the entry opened, or null when none fits (the caller says so).
 * Rejects when the server cannot be reached.
 */
export async function openRandom(
  navigate: NavigateFunction,
  query: RandomQuery = {},
): Promise<{ path: string; title: string } | null> {
  const { entry } = await api.randomEntry(query);
  if (!entry) return null;
  navigate(entryUrl(entry.path));
  return entry;
}
