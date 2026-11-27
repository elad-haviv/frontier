/**
 * The pinned entries ("Working on"), shared by every place that shows or changes them: the left
 * bar, Home, and the pin button on an entry. One copy for the page, loaded once and kept in step
 * with the server's answer to each change.
 */
import { onProjectChange } from "../project.ts";
import { useSyncExternalStore } from "react";
import type { PinsResponse } from "@frontier/schema";
import { api } from "../api.ts";
import { connection } from "../sync/connection.ts";

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

/**
 * Loads the pins once; later calls wait for the same load. With `force` a load already under way
 * is not trusted (it may have been asked before a change), so a new one starts. A failure leaves
 * the list as it was.
 */
export function loadPins(force = false): Promise<void> {
  if (loaded && !force) return Promise.resolve();
  if (loading && !force) return loading;
  const mine: Promise<void> = api
    .pins()
    .then((r) => {
      // Only the newest load may answer, so an older, slower one cannot put back old pins.
      if (loading === mine) set(r.pins);
    })
    .catch(() => undefined)
    .finally(() => {
      if (loading === mine) loading = null;
    });
  loading = mine;
  return mine;
}

const inFlight = new Set<string>();

/**
 * Pins or unpins an entry, by what the server has now (the list is loaded first, so an entry
 * pinned elsewhere is not pinned twice). Resolves to whether it is pinned now, or null when a
 * change to the same entry is already under way and this press was ignored. Rejects when the
 * save fails.
 */
export async function togglePin(path: string): Promise<boolean | null> {
  if (inFlight.has(path)) return null;
  inFlight.add(path);
  try {
    await loadPins();
    const on = pins.some((p) => p.path === path);
    const r = on ? await api.unpin(path) : await api.pin(path);
    set(r.pins);
    return !on;
  } finally {
    inFlight.delete(path);
  }
}

// Another project has other pins: none are shown until its own are read.
onProjectChange(() => {
  pins = [];
  loaded = false;
  loading = null;
  inFlight.clear();
  for (const fn of listeners) fn();
  if (listeners.size > 0) void loadPins();
});

export async function reorderPins(paths: string[]): Promise<void> {
  set((await api.reorderPins(paths)).pins);
}

/** How long the page is hidden before showing it again reloads the pins. */
export const HIDDEN_RELOAD_MS = 60_000;

let stopWatching: (() => void) | null = null;

/**
 * Reloads the pins when the connection returns after being lost, and when the page is shown again
 * after more than a minute hidden, so pins made on another device appear. Runs while anything
 * shows the pins.
 */
function watch(): () => void {
  let state = connection.current().state;
  const offConnection = connection.subscribe(() => {
    const next = connection.current().state;
    if (next === "online" && state !== "online") void loadPins(true);
    state = next;
  });
  let hiddenAt: number | null = null;
  const onVisibility = () => {
    if (document.visibilityState === "hidden") hiddenAt = Date.now();
    else {
      if (hiddenAt !== null && Date.now() - hiddenAt > HIDDEN_RELOAD_MS) void loadPins(true);
      hiddenAt = null;
    }
  };
  document.addEventListener("visibilitychange", onVisibility);
  return () => {
    offConnection();
    document.removeEventListener("visibilitychange", onVisibility);
  };
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  if (listeners.size === 1) stopWatching = watch();
  void loadPins();
  return () => {
    listeners.delete(fn);
    if (listeners.size === 0) {
      stopWatching?.();
      stopWatching = null;
    }
  };
}

/** The pins, in order; re-renders when they change. Empty until the first load answers. */
export function usePins(): readonly Pin[] {
  return useSyncExternalStore(subscribe, () => pins);
}

/** For tests. */
export const getPinsForTest = (): readonly Pin[] => pins;
/** For tests. */
export const watchPinsForTest = watch;

/** For tests. */
export function resetPins(): void {
  pins = [];
  loaded = false;
  loading = null;
  inFlight.clear();
}
