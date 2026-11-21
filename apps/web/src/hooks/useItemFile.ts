import { useCallback, useEffect, useRef, useState } from "react";
import { ApiFailure } from "../api.ts";

export interface ItemFileOptions<T> {
  load: () => Promise<{ value: T; revision: number }>;
  save: (value: T, revision: number) => Promise<{ value: T; revision: number }>;
  /** Brings together what this page changed and what another device saved meanwhile. */
  merge: (base: T, mine: T, theirs: T) => T;
  /** Called after each save that reached the server. */
  onSaved?: () => void;
}

export type SaveState = "saved" | "waiting" | "saving" | "failed";

export interface ItemFile<T> {
  state: "loading" | "ready" | "failed";
  value: T | null;
  error: string | null;
  saving: SaveState;
  /**
   * Changes the value. Changes that follow each other with the same `tag`, such as the letters
   * typed into one field, are one step for undo.
   */
  change: (fn: (value: T) => T, tag?: string) => void;
  /** Takes in what the server holds now, for after the server changed the file itself. */
  reload: () => Promise<void>;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
}

const PAUSE = 1000;
const KEPT = 100;

/**
 * The loop a page of items runs on: load, change, save about a second after the last change,
 * merge when another device saved first, undo and redo. One use is for one file: give the
 * component a React key so a different file gets a fresh loop.
 */
export function useItemFile<T>(options: ItemFileOptions<T>): ItemFile<T> {
  const [state, setState] = useState<"loading" | "ready" | "failed">("loading");
  const [value, setValue] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState<SaveState>("saved");
  const [stacks, setStacks] = useState({ undo: 0, redo: 0 });

  const opts = useRef(options);
  opts.current = options;
  const current = useRef<T | null>(null);
  /** What the server last held, as far as this page knows. */
  const base = useRef<T | null>(null);
  const revision = useRef(0);
  const dirty = useRef(false);
  const busy = useRef(false);
  /** Set when the server refused the value itself: sending it again would be refused again. */
  const halted = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const undoStack = useRef<T[]>([]);
  const redoStack = useRef<T[]>([]);
  const lastTag = useRef<string | null>(null);
  const live = useRef(true);

  const show = (next: T) => {
    current.current = next;
    setValue(next);
    setStacks({ undo: undoStack.current.length, redo: redoStack.current.length });
  };

  /**
   * Sends one value. When another device saved first, the two are merged and the result is
   * sent; `merged` then says so, because earlier snapshots no longer hold the other's changes.
   */
  const send = async (sent: T): Promise<{ value: T; merged: boolean }> => {
    let saved: { value: T; revision: number };
    let merged = false;
    try {
      saved = await opts.current.save(sent, revision.current);
    } catch (err) {
      if (!(err instanceof ApiFailure) || err.code !== "stale_revision") throw err;
      const theirs = await opts.current.load();
      const both = opts.current.merge(base.current ?? theirs.value, sent, theirs.value);
      saved = await opts.current.save(both, theirs.revision);
      merged = true;
    }
    base.current = saved.value;
    revision.current = saved.revision;
    opts.current.onSaved?.();
    return { value: saved.value, merged };
  };

  const flush = useCallback(async () => {
    if (busy.current || !dirty.current || current.current === null) return;
    busy.current = true;
    dirty.current = false;
    lastTag.current = null;
    setSaving("saving");
    const sent = current.current;
    try {
      const saved = await send(sent);
      if (saved.merged) {
        // A snapshot from before the merge would take the other device's changes away again.
        undoStack.current = [];
        redoStack.current = [];
        if (current.current !== sent && current.current !== null) {
          // Changes typed while the merge was on its way are laid over the merged value.
          dirty.current = true;
          if (live.current) show(opts.current.merge(sent, current.current, saved.value));
        } else if (live.current) show(saved.value);
      }
      if (live.current) setSaving(dirty.current ? "waiting" : "saved");
    } catch (err) {
      dirty.current = true;
      // The server answered and said no: the same value would be refused again.
      halted.current = err instanceof ApiFailure && err.status >= 400 && err.status < 500;
      if (live.current) {
        setSaving("failed");
        setError(err instanceof ApiFailure ? err.message : "The change could not be saved.");
      }
    } finally {
      busy.current = false;
      if (dirty.current && !halted.current) {
        if (live.current) schedule();
        // The page was left while a save was on its way: what was typed since goes now.
        else if (current.current !== null) void send(current.current).catch(() => undefined);
      }
    }
  }, []);

  const schedule = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      timer.current = null;
      void flush();
    }, PAUSE);
  }, [flush]);

  useEffect(() => {
    live.current = true;
    opts.current.load().then(
      (loaded) => {
        if (!live.current) return;
        base.current = loaded.value;
        revision.current = loaded.revision;
        show(loaded.value);
        setState("ready");
      },
      (err: unknown) => {
        if (!live.current) return;
        setError(err instanceof ApiFailure ? err.message : "It could not be opened.");
        setState("failed");
      },
    );
    return () => {
      live.current = false;
      if (timer.current) clearTimeout(timer.current);
      timer.current = null;
      // A change still waiting is sent on the way out. One on its way is followed up by `flush`.
      if (dirty.current && current.current !== null && !busy.current && !halted.current) {
        dirty.current = false;
        void send(current.current).catch(() => undefined);
      }
    };
  }, []);

  const put = useCallback(
    (next: T) => {
      dirty.current = true;
      halted.current = false;
      setError(null);
      setSaving("waiting");
      show(next);
      schedule();
    },
    [schedule],
  );

  const change = useCallback(
    (fn: (value: T) => T, tag?: string) => {
      const before = current.current;
      if (before === null) return;
      const next = fn(before);
      if (next === before) return;
      if (tag === undefined || tag !== lastTag.current) {
        undoStack.current = [...undoStack.current.slice(-KEPT + 1), before];
      }
      lastTag.current = tag ?? null;
      redoStack.current = [];
      put(next);
    },
    [put],
  );

  const undo = useCallback(() => {
    const before = undoStack.current.at(-1);
    if (before === undefined || current.current === null) return;
    undoStack.current = undoStack.current.slice(0, -1);
    redoStack.current = [...redoStack.current, current.current];
    lastTag.current = null;
    put(before);
  }, [put]);

  const redo = useCallback(() => {
    const next = redoStack.current.at(-1);
    if (next === undefined || current.current === null) return;
    redoStack.current = redoStack.current.slice(0, -1);
    undoStack.current = [...undoStack.current, current.current];
    lastTag.current = null;
    put(next);
  }, [put]);

  const reload = useCallback(async () => {
    const theirs = await opts.current.load();
    if (!live.current || current.current === null) return;
    const mine = current.current;
    const both = dirty.current
      ? opts.current.merge(base.current ?? theirs.value, mine, theirs.value)
      : theirs.value;
    base.current = theirs.value;
    revision.current = theirs.revision;
    undoStack.current = [];
    redoStack.current = [];
    lastTag.current = null;
    show(both);
  }, []);

  return {
    state,
    value,
    error,
    saving,
    change,
    reload,
    undo,
    redo,
    canUndo: stacks.undo > 0,
    canRedo: stacks.redo > 0,
  };
}
