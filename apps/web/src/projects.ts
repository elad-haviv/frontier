/**
 * The projects the signed-in person is in (stage 27b): the list the switcher and All projects
 * show, read from the server and kept on the device so the app can still say what the person's
 * projects are with no connection. It is forgotten at log out, like the person (`me.ts`).
 *
 * Also which projects this device holds a copy of (`useOnDevice`), for the switcher's mark and
 * for the plain note when a project that is not on the device is opened with no connection.
 */
import type { ProjectSummary, ProjectsResponse } from "@frontier/schema";
import { useSyncExternalStore } from "react";
import { api } from "./api.ts";

const KEY = "frontier.projects";
const DEVICE_KEY = "frontier.onDevice";

interface Known {
  list: ProjectsResponse | null;
  /** True after the server was asked and could not say, until it does. */
  failed: boolean;
  /** True from the first read until it answers or fails. */
  loading: boolean;
}

let state: Known = { list: readKept(), failed: false, loading: false };
let device: ReadonlySet<string> = readDevice();
const listeners = new Set<() => void>();

function readKept(): ProjectsResponse | null {
  try {
    const text = localStorage.getItem(KEY);
    return text ? (JSON.parse(text) as ProjectsResponse) : null;
  } catch {
    return null;
  }
}

function readDevice(): ReadonlySet<string> {
  try {
    const raw = JSON.parse(localStorage.getItem(DEVICE_KEY) ?? "[]") as unknown;
    return new Set(Array.isArray(raw) ? raw.filter((x): x is string => typeof x === "string") : []);
  } catch {
    return new Set();
  }
}

function change(next: Partial<Known>): void {
  state = { ...state, ...next };
  for (const l of [...listeners]) l();
}

let reading: Promise<ProjectsResponse | null> | null = null;
/**
 * The project this page opened last. A list read while the server was still being told of it may
 * say another, so what this page knows wins.
 */
let openedHere: string | null = null;

/** Reads the list from the server. A failure leaves what is known as it is. */
export function loadProjects(): Promise<ProjectsResponse | null> {
  reading ??= (async () => {
    change({ loading: true });
    try {
      const read = await api.projects();
      const list =
        openedHere && read.projects.some((p) => p.slug === openedHere)
          ? { ...read, last: openedHere }
          : read;
      try {
        localStorage.setItem(KEY, JSON.stringify(list));
      } catch {
        /* without storage the list is known only while the page is open */
      }
      change({ list, failed: false, loading: false });
    } catch {
      change({ failed: true, loading: false });
    } finally {
      reading = null;
    }
    return state.list;
  })();
  return reading;
}

/** What the app knows of the person's projects right now. */
export const knownProjects = (): ProjectsResponse | null => state.list;

/** Puts a changed project (a rename, a new address) into the list at once. */
export function noteProject(next: Pick<ProjectSummary, "id"> & Partial<ProjectSummary>): void {
  if (!state.list) return;
  const projects = state.list.projects.map((p) => (p.id === next.id ? { ...p, ...next } : p));
  const list = { ...state.list, projects };
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    /* as above */
  }
  change({ list });
}

/** Forgets the list, at log out. */
export function clearProjects(): void {
  try {
    localStorage.removeItem(KEY);
    localStorage.removeItem(DEVICE_KEY);
  } catch {
    /* nothing to remove */
  }
  device = new Set();
  openedHere = null;
  change({ list: null, failed: false, loading: false });
}

const subscribe = (changed: () => void) => {
  listeners.add(changed);
  return () => listeners.delete(changed);
};

/** The projects, their state, and whether the person may make one; renders again on change. */
export function useProjects(): Known {
  return useSyncExternalStore(
    subscribe,
    () => state,
    () => state,
  );
}

/** The project at an address, as last read; only its current address, not an old one. */
export const projectAt = (slug: string): ProjectSummary | undefined =>
  state.list?.projects.find((p) => p.slug === slug);

/**
 * Where the app opens for an address that names no project (`/`, and the addresses from before
 * projects): the project the person used last, else their first. Null when they are in none.
 */
export function homeProject(list: ProjectsResponse | null = state.list): ProjectSummary | null {
  if (!list) return null;
  return list.projects.find((p) => p.slug === list.last) ?? list.projects[0] ?? null;
}

// ---- Which projects are on this device -------------------------------------------------------

/** Notes that this device holds a copy of the project's library (its compact index was kept). */
export function markOnDevice(id: string): void {
  if (device.has(id)) return;
  device = new Set([...device, id]);
  try {
    localStorage.setItem(DEVICE_KEY, JSON.stringify([...device]));
  } catch {
    /* only the page remembers it */
  }
  for (const l of [...listeners]) l();
}

/** Notes that this device no longer holds the project's copy (it was cleared). */
export function markOffDevice(id: string): void {
  if (!device.has(id)) return;
  device = new Set([...device].filter((x) => x !== id));
  try {
    localStorage.setItem(DEVICE_KEY, JSON.stringify([...device]));
  } catch {
    /* as above */
  }
  for (const l of [...listeners]) l();
}

export const isOnDevice = (id: string): boolean => device.has(id);

/** The projects that have a copy on this device; renders again when one is added or removed. */
export function useOnDevice(): ReadonlySet<string> {
  return useSyncExternalStore(
    subscribe,
    () => device,
    () => device,
  );
}

/** Notes the project the person opened last, so `/` and the old addresses open it, offline too. */
export function noteLast(slug: string): void {
  openedHere = slug;
  if (!state.list || state.list.last === slug) return;
  const list = { ...state.list, last: slug };
  try {
    localStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    /* as above */
  }
  change({ list });
}
