/**
 * The pinned entries ("Working on"), shared by every place that shows or changes them: the left
 * bar, Home, and the pin button on an entry. One copy for the page, loaded once and kept in step
 * with the server's answer to each change.
 */
import { useSyncExternalStore } from "react";
import type { PinsResponse } from "@frontier/schema";
import { api } from "../api.ts";

export type Pin = PinsResponse["pins"][number];

let pins: readonly Pin[] = [];
let loaded = false;
let loading: Promise<void> | null = null;
const listeners = new Set<() => void>();

function set(next: readonly Pin[]): void {
  pins = next;
  loaded = true;
  for (const fn of listeners) fn();
}

/** Loads the pins once; later calls wait for the same load. A failure leaves the list as it was. */
export function loadPins(force = false): Promise<void> {
  if (loaded && !force) return Promise.resolve();
  loading ??= api
    .pins()
    .then((r) => set(r.pins))
    .catch(() => undefined)
    .finally(() => {
      loading = null;
    });
  return loading;
}

/** Pins or unpins an entry. Resolves to whether it is pinned now; rejects when the save fails. */
export async function togglePin(path: string): Promise<boolean> {
  const on = pins.some((p) => p.path === path);
  const r = on ? await api.unpin(path) : await api.pin(path);
  set(r.pins);
  return !on;
}

export async function reorderPins(paths: string[]): Promise<void> {
  set((await api.reorderPins(paths)).pins);
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  void loadPins();
  return () => listeners.delete(fn);
}

/** The pins, in order; re-renders when they change. Empty until the first load answers. */
export function usePins(): readonly Pin[] {
  return useSyncExternalStore(subscribe, () => pins);
}

/** For tests. */
export function resetPins(): void {
  pins = [];
  loaded = false;
  loading = null;
}
