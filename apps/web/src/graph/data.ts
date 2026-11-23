/**
 * The graph for the visit: fetched when the screen first needs it, kept while the app is open so
 * coming back shows it at once, and fetched again while it is in use whenever the server may have
 * changed it: after every status-stream event, and after the save queue has sent an entry (a draft
 * save does not change the status, so this is what brings a link just written into the graph).
 * At most one request is in flight, with one more queued behind it.
 */
import { useEffect, useSyncExternalStore } from "react";
import type { GraphResponse } from "@frontier/schema";
import { api, ApiFailure } from "../api.ts";
import { servedFromDevice } from "../offline/copy.ts";
import { connection } from "../sync/connection.ts";
import { queue } from "../sync/queue.ts";
import { type GraphModel, makeModel } from "./model.ts";

export interface GraphDataDeps {
  fetch: () => Promise<GraphResponse>;
  /** Hears each new status snapshot. */
  onStatus: (listener: () => void) => () => void;
  /** Hears each change of the save queue's list. */
  onQueue: (listener: () => void) => () => void;
  /** The entries waiting in the save queue, with their revisions. */
  entries: () => Map<string, number>;
}

export interface GraphState {
  model: GraphModel | null;
  /** Why the graph could not be read, while no model is held. */
  error: string | null;
  loading: boolean;
  /** When the graph shown was stored on this device, while it is the device's copy (15b). */
  at?: number | null;
}

export const NEEDS_CONNECTION = "The graph needs a connection.";

export class GraphData {
  private state: GraphState = { model: null, error: null, loading: false };
  private readonly listeners = new Set<() => void>();
  private inFlight = false;
  private again = false;
  private users = 0;
  private stops: (() => void)[] = [];
  private seen = new Map<string, number>();

  constructor(private readonly d: GraphDataDeps) {}

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  current = (): GraphState => this.state;

  private set(change: Partial<GraphState>): void {
    this.state = { ...this.state, ...change };
    for (const l of [...this.listeners]) l();
  }

  /**
   * A screen or tab uses the graph until the returned function runs: it is fetched now (again,
   * when one is held, in case it changed meanwhile) and after each change heard while in use.
   */
  use(): () => void {
    if (this.users++ === 0) {
      this.seen = this.d.entries();
      this.stops = [this.d.onStatus(() => this.fetch()), this.d.onQueue(() => this.queueChanged())];
    }
    this.fetch();
    let done = false;
    return () => {
      if (done) return;
      done = true;
      if (--this.users === 0) {
        for (const stop of this.stops) stop();
        this.stops = [];
      }
    };
  }

  /** The queue's list changed: an entry gone or with a new revision was sent to the server. */
  private queueChanged(): void {
    const now = this.d.entries();
    const sent = [...this.seen].some(([key, revision]) => now.get(key) !== revision);
    this.seen = now;
    if (sent) this.fetch();
  }

  /** Fetches the graph, or queues one more fetch behind the one in flight. */
  fetch(): void {
    if (this.inFlight) {
      this.again = true;
      return;
    }
    this.inFlight = true;
    this.set({ loading: true });
    void this.d.fetch().then(
      (r) => this.settle({ model: makeModel(r), error: null, at: servedFromDevice(r) }),
      (err: unknown) =>
        this.settle({
          // A graph already held stays shown as it was.
          error: this.state.model
            ? null
            : err instanceof ApiFailure && err.code !== "offline"
              ? err.message
              : NEEDS_CONNECTION,
        }),
    );
  }

  private settle(change: Partial<GraphState>): void {
    this.inFlight = false;
    this.set({ ...change, loading: false });
    if (this.again) {
      this.again = false;
      this.fetch();
    }
  }
}

/** The app's one graph. */
export const graphData = new GraphData({
  fetch: () => api.graph(),
  onStatus: (listener) => {
    let last = connection.current().snapshot;
    return connection.subscribe(() => {
      const now = connection.current().snapshot;
      if (now === last) return;
      last = now;
      listener();
    });
  },
  onQueue: (listener) => queue.subscribeList(listener),
  entries: () =>
    new Map(
      queue
        .current()
        .filter((r) => r.key.startsWith("entry:"))
        .map((r) => [r.key, r.revision]),
    ),
});

/** The graph for a screen or tab, fetched while it is mounted. */
export function useGraphData(data = graphData): GraphState & { retry: () => void } {
  useEffect(() => data.use(), [data]);
  const state = useSyncExternalStore(data.subscribe, data.current);
  return { ...state, retry: () => data.fetch() };
}
