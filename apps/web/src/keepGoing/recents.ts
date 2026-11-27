/**
 * What this device remembers for "keep going" (stage 25): the entries read or edited lately, the
 * entry viewed before this one, where reading stopped in each entry and where the editor's cursor
 * was. Nothing here goes to the server: it is the device's own, in one `localStorage` key, and a
 * device without storage (a private window, a full disk) simply forgets at reload.
 *
 * This is separate from the device copy for reading offline (`offline/device.ts`), which keeps
 * entry bodies, not what was read when or where.
 */
import { useSyncExternalStore } from "react";
import { currentProject, onProjectChange, type ProjectRef } from "../project.ts";
import { projectKey } from "../projectStorage.ts";

export const RECENTS_KEY = "frontier.keepGoing.v1";
/** How many recent entries are kept. */
export const MAX_RECENTS = 30;
/** How many reading and cursor positions are kept; the oldest go first. */
export const MAX_POSITIONS = 200;
/** A reading position older than this is not resumed. */
export const RESUME_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
/** How long after a scroll or cursor move the positions are written. */
const WRITE_DELAY_MS = 400;

export interface RecentEntry {
  path: string;
  title: string;
  /** Whether the entry was last read or last edited here. */
  kind: "read" | "edited";
  /** Milliseconds since 1970. */
  at: number;
}

/** What a component shows: replaced, never changed, when something in it changes. */
export interface RecentsSnapshot {
  /** Newest first, at most `MAX_RECENTS`, each entry once. */
  recents: readonly RecentEntry[];
  /** The entry open now, as last told by `viewed`; null before any. */
  current: Pick<RecentEntry, "path" | "title"> | null;
  /** The entry viewed before `current`; null before there is one. */
  previous: Pick<RecentEntry, "path" | "title"> | null;
}

interface Stored {
  recents: RecentEntry[];
  current: RecentsSnapshot["current"];
  previous: RecentsSnapshot["previous"];
  scroll: Record<string, { y: number; at: number }>;
  cursor: Record<string, { pos: number; at: number }>;
}

type Place = Pick<RecentEntry, "path" | "title">;

const empty = (): Stored => ({
  recents: [],
  current: null,
  previous: null,
  scroll: {},
  cursor: {},
});

const isPlace = (v: unknown): v is Place =>
  typeof (v as Place | null)?.path === "string" && typeof (v as Place).title === "string";

/** Reads what was stored, keeping what is well formed and dropping the rest. */
export function readStored(raw: string | null): Stored {
  const out = empty();
  if (!raw) return out;
  let data: Partial<Record<keyof Stored, unknown>>;
  try {
    data = JSON.parse(raw) as typeof data;
  } catch {
    return out;
  }
  if (Array.isArray(data.recents)) {
    const seen = new Set<string>();
    for (const r of data.recents as RecentEntry[]) {
      if (
        isPlace(r) &&
        (r.kind === "read" || r.kind === "edited") &&
        Number.isFinite(r.at) &&
        !seen.has(r.path)
      ) {
        seen.add(r.path);
        out.recents.push({ path: r.path, title: r.title, kind: r.kind, at: r.at });
      }
    }
    out.recents = out.recents.slice(0, MAX_RECENTS);
  }
  if (isPlace(data.current)) out.current = { path: data.current.path, title: data.current.title };
  if (isPlace(data.previous)) {
    out.previous = { path: data.previous.path, title: data.previous.title };
  }
  const keep = <T extends { at: number }>(from: unknown, ok: (v: T) => boolean) => {
    const into: Record<string, T> = {};
    if (from && typeof from === "object") {
      for (const [path, v] of Object.entries(from as Record<string, T>)) {
        if (v && Number.isFinite(v.at) && ok(v)) into[path] = v;
      }
    }
    return into;
  };
  out.scroll = keep<{ y: number; at: number }>(data.scroll, (v) => Number.isFinite(v.y));
  out.cursor = keep<{ pos: number; at: number }>(data.cursor, (v) => Number.isFinite(v.pos));
  return out;
}

/** The newest `MAX_POSITIONS` of a set of positions. */
function newest<T extends { at: number }>(positions: Record<string, T>): Record<string, T> {
  const entries = Object.entries(positions);
  if (entries.length <= MAX_POSITIONS) return positions;
  return Object.fromEntries(entries.sort((a, b) => b[1].at - a[1].at).slice(0, MAX_POSITIONS));
}

/**
 * Whether to scroll back to where reading stopped: only when the stop was more than one screen
 * down the entry and less than 30 days ago.
 */
export function shouldResume(
  position: { y: number; at: number } | null | undefined,
  viewportHeight: number,
  now: number,
): boolean {
  return !!position && position.y > viewportHeight && now - position.at < RESUME_MAX_AGE_MS;
}

/**
 * The last entry, as seen from `open`. From the entry that is open, it is the one viewed before;
 * from anywhere else (Home, the switcher), it is the entry that was open.
 */
export function lastEntry(
  at: Pick<RecentsSnapshot, "current" | "previous">,
  open: string | null,
): Place | null {
  const { current, previous } = at;
  if (current && current.path === open) return previous && previous.path !== open ? previous : null;
  return current && current.path !== open ? current : null;
}

export interface RecentsDeps {
  storage: Pick<Storage, "getItem" | "setItem"> | null;
  now?: () => number;
  /** Stands in for the timer that delays writing positions, in tests. */
  later?: (run: () => void, ms: number) => unknown;
  /** The storage key of the open library's recents; each project has its own (stage 27b). */
  key?: () => string;
}

export class Recents {
  private data: Stored;
  private snap: RecentsSnapshot;
  private readonly listeners = new Set<() => void>();
  private dirty = false;
  private timer: unknown = null;
  private readonly now: () => number;
  /** The key the data was read from and is written to, until `switchProject`. */
  private name: string;

  constructor(private readonly d: RecentsDeps) {
    this.now = d.now ?? Date.now;
    this.name = d.key?.() ?? RECENTS_KEY;
    this.data = readStored(this.read());
    this.snap = this.snapshotOf();
  }

  private read(): string | null {
    try {
      return this.d.storage?.getItem(this.name) ?? null;
    } catch {
      return null;
    }
  }

  private write(): void {
    this.dirty = false;
    try {
      this.d.storage?.setItem(this.name, JSON.stringify(this.data));
    } catch {
      // No room or no storage: this device forgets at reload, which is all that is lost.
    }
  }

  /** Writes soon, once for a burst of scrolling. */
  private writeLater(): void {
    this.dirty = true;
    if (this.timer !== null) return;
    const later = this.d.later ?? ((run, ms) => setTimeout(run, ms));
    this.timer = later(() => {
      this.timer = null;
      if (this.dirty) this.write();
    }, WRITE_DELAY_MS);
  }

  /** Writes what is waiting to be written, as when the page is hidden. */
  flush(): void {
    if (this.dirty) this.write();
  }

  private snapshotOf(): RecentsSnapshot {
    return {
      recents: [...this.data.recents],
      current: this.data.current,
      previous: this.data.previous,
    };
  }

  private changed(): void {
    this.snap = this.snapshotOf();
    this.write();
    for (const l of this.listeners) l();
  }

  /**
   * Another project was opened: what waits to be written goes to the project it belongs to, and
   * the new project's recents are read. Nothing of one shows in the other.
   */
  switchProject(): void {
    this.flush();
    this.name = this.d.key?.() ?? RECENTS_KEY;
    this.reload();
  }

  /** Reads the storage again, as when another tab changed it. */
  reload(): void {
    this.data = readStored(this.read());
    this.snap = this.snapshotOf();
    for (const l of this.listeners) l();
  }

  // ---- For components -----------------------------------------------------------------------

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  };

  /** The same object until something changes, as `useSyncExternalStore` needs. */
  snapshot = (): RecentsSnapshot => this.snap;

  // ---- Recent entries and the last entry ------------------------------------------------------

  /** Puts an entry first among the recent ones, once, with how it was last used. */
  touch(path: string, title: string, kind: RecentEntry["kind"]): void {
    const rest = this.data.recents.filter((r) => r.path !== path);
    this.data.recents = [{ path, title, kind, at: this.now() }, ...rest].slice(0, MAX_RECENTS);
    this.changed();
  }

  /**
   * An entry is open (read or in the editor). The one open before becomes the last entry; opening
   * the same entry again changes nothing about it, so a reload does not lose the last entry.
   */
  viewed(path: string, title: string, kind: RecentEntry["kind"] = "read"): void {
    const now = this.data.current;
    if (now && now.path !== path) this.data.previous = now;
    this.data.current = { path, title };
    this.touch(path, title, kind);
  }

  /** The entry viewed before `open`, for "‹ Last: Name" and Alt+←; null when there is none. */
  lastBefore(open: string | null): Place | null {
    return lastEntry(this.data, open);
  }

  /** An entry was renamed or moved: its places here follow it. */
  renamed(from: string, to: string, title: string): void {
    const move = <T extends Place>(p: T | null): T | null =>
      p && p.path === from ? { ...p, path: to, title } : p;
    this.data.recents = this.data.recents.map((r) => move(r)!);
    this.data.current = move(this.data.current);
    this.data.previous = move(this.data.previous);
    for (const key of ["scroll", "cursor"] as const) {
      const at = this.data[key] as Record<string, unknown>;
      if (from in at) {
        at[to] = at[from];
        delete at[from];
      }
    }
    this.changed();
  }

  /** An entry is gone: it is forgotten everywhere here. */
  forget(path: string): void {
    this.data.recents = this.data.recents.filter((r) => r.path !== path);
    if (this.data.current?.path === path) this.data.current = null;
    if (this.data.previous?.path === path) this.data.previous = null;
    delete this.data.scroll[path];
    delete this.data.cursor[path];
    this.changed();
  }

  // ---- Where reading stopped, and where the cursor was ---------------------------------------

  /** Where reading is now in an entry, in pixels from its top. Written soon, not at once. */
  setScroll(path: string, y: number): void {
    this.data.scroll[path] = { y: Math.max(0, Math.round(y)), at: this.now() };
    this.data.scroll = newest(this.data.scroll);
    this.writeLater();
  }

  /**
   * Where to scroll an entry to on opening it: the position where reading stopped, only when that
   * was more than one screen (`viewportHeight`) down and less than 30 days ago; otherwise null.
   */
  resumeAt(path: string, viewportHeight: number): number | null {
    const position = this.data.scroll[path];
    return shouldResume(position, viewportHeight, this.now()) ? position!.y : null;
  }

  /** The reader chose "Start from the top": the stop is forgotten. */
  clearScroll(path: string): void {
    if (!(path in this.data.scroll)) return;
    delete this.data.scroll[path];
    this.writeLater();
  }

  /** Where the editor's cursor is in an entry, as a character offset. Written soon. */
  setCursor(path: string, pos: number): void {
    this.data.cursor[path] = { pos: Math.max(0, Math.round(pos)), at: this.now() };
    this.data.cursor = newest(this.data.cursor);
    this.writeLater();
  }

  /** Where the cursor was when the editor was last open on this entry, or null. */
  cursorAt(path: string): number | null {
    return this.data.cursor[path]?.pos ?? null;
  }
}

function deviceStorage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    // Reading `localStorage` itself can throw when site data is blocked.
    return null;
  }
}

/** This device's recents, shared by the whole app. */
export const recents = new Recents({
  storage: deviceStorage(),
  key: () => projectKey(RECENTS_KEY),
});
onProjectChange(() => recents.switchProject());

if (typeof window !== "undefined") {
  // Positions are written a moment after they change; leaving the page writes them at once.
  window.addEventListener("pagehide", () => recents.flush());
  // Another tab of the app changed them.
  window.addEventListener("storage", (e) => {
    if (e.key === projectKey(RECENTS_KEY)) recents.reload();
  });
}

/**
 * The recents of a named project: the shared ones when it is the project open, else a copy read
 * from, and written back to, that project's own key. For work that finishes after the person has
 * gone to another project (what a publish did to the entries read lately).
 */
export function recentsOf(project: ProjectRef): Recents {
  if (currentProject()?.id === project.id) return recents;
  return new Recents({
    storage: deviceStorage(),
    key: () => projectKey(RECENTS_KEY, project.id),
  });
}

/** The recent entries, the open entry and the one before it; the component renders again on change. */
export function useRecents(): RecentsSnapshot {
  return useSyncExternalStore(recents.subscribe, recents.snapshot, recents.snapshot);
}

/** The entry viewed before `open`, for "‹ Last: Name"; renders again when it changes. */
export function useLastEntry(open: string | null): Place | null {
  return lastEntry(useRecents(), open);
}
