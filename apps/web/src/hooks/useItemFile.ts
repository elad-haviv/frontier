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
  change: (fn: (value: T) => T) => void;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
}

const PAUSE = 1000;
const KEPT = 100;

/**
 * The loop a page of items runs on: load, change, save about a second after the last change,
 * merge when another device saved first, undo and redo.
 */
export function useItemFile<T>(options: ItemFileOptions<T>, key: string): ItemFile<T> {
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
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const undoStack = useRef<T[]>([]);
  const redoStack = useRef<T[]>([]);
  const live = useRef(true);

  const show = (next: T) => {
    current.current = next;
    setValue(next);
    setStacks({ undo: undoStack.current.length, redo: redoStack.current.length });
  };

  const flush = useCallback(async () => {
    if (busy.current || !dirty.current || current.current === null) return;
    busy.current = true;
    dirty.current = false;
    setSaving("saving");
    const sent = current.current;
    try {
      let saved: { value: T; revision: number };
      try {
        saved = await opts.current.save(sent, revision.current);
      } catch (err) {
        if (!(err instanceof ApiFailure) || err.code !== "stale_revision") throw err;
        const theirs = await opts.current.load();
        const merged = opts.current.merge(base.current ?? theirs.value, sent, theirs.value);
        saved = await opts.current.save(merged, theirs.revision);
        // Changes typed while the merge was on its way are laid over the merged value.
        if (current.current !== sent && current.current !== null) {
          const again = opts.current.merge(sent, current.current, saved.value);
          dirty.current = true;
          if (live.current) show(again);
        } else if (live.current) show(saved.value);
      }
      base.current = saved.value;
      revision.current = saved.revision;
      opts.current.onSaved?.();
      if (live.current) setSaving(dirty.current ? "waiting" : "saved");
    } catch (err) {
      dirty.current = true;
      if (live.current) {
        setSaving("failed");
        setError(err instanceof ApiFailure ? err.message : "The change could not be saved.");
      }
    } finally {
      busy.current = false;
      if (dirty.current && live.current && timer.current === null) schedule();
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
    setState("loading");
    undoStack.current = [];
    redoStack.current = [];
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
      // A change still waiting is sent on the way out.
      if (dirty.current && current.current !== null && !busy.current) {
        void opts.current.save(current.current, revision.current).then(
          () => opts.current.onSaved?.(),
          () => undefined,
        );
        dirty.current = false;
      }
    };
  }, [key]);

  const put = useCallback(
    (next: T) => {
      dirty.current = true;
      setError(null);
      setSaving("waiting");
      show(next);
      schedule();
    },
    [schedule],
  );

  const change = useCallback(
    (fn: (value: T) => T) => {
      const before = current.current;
      if (before === null) return;
      const next = fn(before);
      if (next === before) return;
      undoStack.current = [...undoStack.current.slice(-KEPT + 1), before];
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
    put(before);
  }, [put]);

  const redo = useCallback(() => {
    const next = redoStack.current.at(-1);
    if (next === undefined || current.current === null) return;
    redoStack.current = redoStack.current.slice(0, -1);
    undoStack.current = [...undoStack.current, current.current];
    put(next);
  }, [put]);

  return {
    state,
    value,
    error,
    saving,
    change,
    undo,
    redo,
    canUndo: stacks.undo > 0,
    canRedo: stacks.redo > 0,
  };
}
