/**
 * A library item file, such as the folder file, as the pages of this tab see it: one copy per
 * kind, shared by every component that reads it. A change is shown at once and put into the save
 * queue, which sends it, merges it with another device's copy when that one was saved first, and
 * keeps it on the device until the server has it.
 */
import { useEffect, useSyncExternalStore } from "react";
import type { LibraryFileKind, LibraryFileName } from "@frontier/schema";
import { api, ApiFailure } from "../api.ts";
import { type Known, queue } from "./queue.ts";

export interface LibraryFileState<F> {
  state: "loading" | "ready" | "failed";
  value: F | null;
  error: string | null;
}

export class LibraryFileClient<F> {
  private snapshot: LibraryFileState<F> = { state: "loading", value: null, error: null };
  private listeners = new Set<() => void>();
  private known: Known = { draftId: "", revision: 0, baseBlob: "" };
  private loading: Promise<void> | null = null;
  private stop: (() => void) | null = null;

  constructor(readonly kind: LibraryFileKind<F>) {}

  get name(): LibraryFileName {
    return this.kind.name;
  }

  current = (): LibraryFileState<F> => this.snapshot;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    void this.start();
    return () => this.listeners.delete(listener);
  };

  private show(next: Partial<LibraryFileState<F>>): void {
    this.snapshot = { ...this.snapshot, ...next };
    for (const l of [...this.listeners]) l();
  }

  /** Loads the file once, and hears from then on what the queue does with it. */
  start(): Promise<void> {
    this.stop ??= queue.subscribe(this.name, (e) => {
      if (e.type === "saved") this.known = e.known;
      else if (e.type === "merged") {
        this.known = e.known;
        this.show({ value: e.value as F });
      } else if (e.type === "record" && e.record?.state === "attention") {
        this.show({ error: e.record.error ?? "The change could not be saved." });
      } else if (e.type === "record") this.show({ error: null });
    });
    this.loading ??= this.load();
    return this.loading;
  }

  /**
   * Reads the server's copy again, after the server changed the file itself (as a folder delete
   * does). A change still unsent stays as it is: the queue merges it when it is sent.
   */
  async reload(): Promise<void> {
    this.loading = this.load();
    return this.loading;
  }

  private async load(): Promise<void> {
    try {
      const loaded = await api.libraryFile(this.name);
      this.known = {
        draftId: "",
        revision: loaded.revision,
        baseBlob: loaded.blob,
        base: loaded.file,
      };
      const unsent = await queue.get(this.name);
      this.show({ state: "ready", value: (unsent?.value ?? loaded.file) as F, error: null });
    } catch (err) {
      if (this.snapshot.value !== null) return;
      this.show({
        state: "failed",
        error: err instanceof ApiFailure ? err.message : "It could not be read.",
      });
      this.loading = null;
    }
  }

  /** Changes the file. Resolves once the change is in the queue. */
  async change(fn: (file: F) => F): Promise<void> {
    await this.start();
    const before = this.snapshot.value;
    if (before === null)
      throw new ApiFailure(0, "offline", `The ${this.kind.noun} could not be read.`);
    const next = fn(before);
    if (next === before) return;
    this.show({ value: next });
    await queue.put(this.name, next, this.known);
  }

  /** Sends what waits now, and resolves once it has been sent or could not be. */
  flush(): Promise<void> {
    return queue.sendNow(this.name);
  }
}

const clients = new Map<string, LibraryFileClient<unknown>>();

/** The one client of a kind in this tab. */
export function libraryFileClient<F>(kind: LibraryFileKind<F>): LibraryFileClient<F> {
  let client = clients.get(kind.name);
  if (!client) {
    client = new LibraryFileClient(kind as LibraryFileKind<unknown>);
    clients.set(kind.name, client);
  }
  return client as LibraryFileClient<F>;
}

/** A library file's value, kept up to date, and its client for changes. */
export function useLibraryFile<F>(
  kind: LibraryFileKind<F>,
): LibraryFileState<F> & { client: LibraryFileClient<F> } {
  const client = libraryFileClient(kind);
  const state = useSyncExternalStore(client.subscribe, client.current);
  useEffect(() => void client.start(), [client]);
  return { ...state, client };
}
