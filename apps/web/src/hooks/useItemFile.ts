import { useCallback, useEffect, useRef, useState } from "react";
import { sameValue } from "@frontier/schema";
import { ApiFailure } from "../api.ts";
import { type Known, type LinkItem, type QueueKey } from "../sync/queue.ts";
import { useProjectWork } from "../projectWork.ts";

export interface ItemFileOptions<T> {
  /** The file's key in the save queue, such as `chronicle:<id>`. */
  key: QueueKey;
  load: () => Promise<{ value: T; revision: number; blob: string }>;
  /** Brings together what this page changed and what the server answered or another device saved. */
  merge: (base: T, mine: T, theirs: T) => T;
  /** Says whether the server changed the value it was sent, so the page should take it in. */
  changed?: (sent: T, saved: T) => boolean;
  /** Called with each answer of the server: what it stored, and the links it could not make. */
  onSaved?: (answer: {
    sent: T;
    value: T;
    link: { id: string; path: string }[];
    unlinked: { id: string; reason: string }[];
  }) => void;
}

export type SaveState = "saved" | "waiting" | "saving" | "failed";

export interface ItemFile<T> {
  state: "loading" | "ready" | "failed";
  value: T | null;
  error: string | null;
  /**
   * Changes the value. Changes that follow each other with the same `tag`, such as the letters
   * typed into one field, are one step for undo. `link` travels with the save.
   */
  change: (fn: (value: T) => T, tag?: string, link?: LinkItem[]) => void;
  /** Asks for a save without a change to the value, as when a link is sent along with it. */
  touch: (link?: LinkItem[]) => void;
  /** Takes in what the server holds now, for after the server changed the file itself. */
  reload: () => Promise<void>;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
}

const KEPT = 100;

/**
 * The loop a page of items runs on: load, change, undo and redo. Each change is put into the save
 * queue, which sends it about a second after the last one, merges when another device saved
 * first, and keeps it on the device until the server has it. One use is for one file: give the
 * component a React key so a different file gets a fresh loop.
 */
export function useItemFile<T>(options: ItemFileOptions<T>): ItemFile<T> {
  const work = useProjectWork();
  const [state, setState] = useState<"loading" | "ready" | "failed">("loading");
  const [value, setValue] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [stacks, setStacks] = useState({ undo: 0, redo: 0 });

  const opts = useRef(options);
  opts.current = options;
  const key = options.key;
  const current = useRef<T | null>(null);
  /** What the next record starts from: the server's last confirmed value, revision and blob. */
  const known = useRef<Known>({ draftId: "", revision: 0, baseBlob: "" });
  const undoStack = useRef<T[]>([]);
  const redoStack = useRef<T[]>([]);
  const lastTag = useRef<string | null>(null);

  const show = (next: T) => {
    current.current = next;
    setValue(next);
    setStacks({ undo: undoStack.current.length, redo: redoStack.current.length });
  };

  const put = useCallback(
    (next: T, link?: LinkItem[]) => {
      show(next);
      void work.queue.put(key, next, { ...known.current, ...(link ? { link } : {}) });
    },
    [key],
  );

  useEffect(() => {
    let live = true;
    (async () => {
      const loaded = await opts.current.load();
      known.current = {
        draftId: "",
        revision: loaded.revision,
        baseBlob: loaded.blob,
        base: loaded.value,
      };
      // A change this device has not sent yet is newer than the server's copy.
      const unsent = await work.queue.get(key);
      if (!live) return;
      show(unsent ? (unsent.value as T) : loaded.value);
      setState("ready");
    })().catch((err: unknown) => {
      if (!live) return;
      setError(err instanceof ApiFailure ? err.message : "It could not be opened.");
      setState("failed");
    });

    const stop = work.queue.subscribe(key, (e) => {
      if (e.type === "saved") {
        known.current = e.known;
        const sent = e.sent as T;
        const saved = e.value as T;
        if (opts.current.changed?.(sent, saved) && current.current !== null) {
          // The server changed what it was sent, such as by writing an entry's id into a link.
          // Changes made while the save was on its way are laid over what it answered.
          show(
            sameValue(current.current, sent)
              ? saved
              : opts.current.merge(sent, current.current, saved),
          );
        }
        opts.current.onSaved?.({ sent, value: saved, link: e.link, unlinked: e.unlinked });
      } else if (e.type === "merged") {
        known.current = e.known;
        // A snapshot from before the merge would take the other device's changes away again.
        undoStack.current = [];
        redoStack.current = [];
        lastTag.current = null;
        show(e.value as T);
      } else if (e.type === "record" && e.record?.state === "attention") {
        setError(e.record.error ?? "The change could not be saved.");
      } else if (e.type === "record") {
        setError(null);
      }
    });
    return () => {
      live = false;
      stop();
    };
  }, [key]);

  const change = useCallback(
    (fn: (value: T) => T, tag?: string, link?: LinkItem[]) => {
      const before = current.current;
      if (before === null) return;
      const next = fn(before);
      if (next === before && !link) return;
      if (next !== before) {
        if (tag === undefined || tag !== lastTag.current) {
          undoStack.current = [...undoStack.current.slice(-KEPT + 1), before];
        }
        lastTag.current = tag ?? null;
        redoStack.current = [];
      }
      put(next, link);
    },
    [put],
  );

  const touch = useCallback(
    (link?: LinkItem[]) => {
      if (current.current !== null) put(current.current, link);
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
    if (current.current === null) return;
    const unsent = await work.queue.get(key);
    const base = (known.current.base as T | undefined) ?? theirs.value;
    known.current = {
      draftId: "",
      revision: theirs.revision,
      baseBlob: theirs.blob,
      base: theirs.value,
    };
    undoStack.current = [];
    redoStack.current = [];
    lastTag.current = null;
    if (!unsent) {
      show(theirs.value);
      return;
    }
    // A change still unsent is merged with what the server holds now, and goes from there.
    await work.queue.drop(key);
    put(opts.current.merge(base, current.current, theirs.value));
  }, [key, put]);

  return {
    state,
    value,
    error,
    change,
    touch,
    reload,
    undo,
    redo,
    canUndo: stacks.undo > 0,
    canRedo: stacks.redo > 0,
  };
}
