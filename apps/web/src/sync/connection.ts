/**
 * One connection state for the whole app: online, offline or signed out.
 *
 * It listens to the server's status stream, which also brings the status snapshot every page
 * reads. When the stream fails, or a request cannot reach the server, it asks `/api/status` once:
 * a 401 means signed out, a failure to connect means offline, and any other answer means online.
 * Any later answer from the server means online again. The browser's own online flag is only a
 * hint to try again at once.
 */
import { useSyncExternalStore } from "react";
import type { StatusSnapshot } from "@frontier/schema";

export type ConnectionState = "online" | "offline" | "signed-out";

export interface ConnectionDeps {
  fetch: typeof fetch;
  EventSource: typeof EventSource | undefined;
  /** Where the browser's `online` event is heard; none in tests that do not need it. */
  events?: Pick<Window, "addEventListener" | "removeEventListener">;
  /** The longest wait before the stream is opened again after it closed. */
  maxDelayMs?: number;
}

const STREAM = "/api/status/events";
const STATUS = "/api/status";

export class Connection {
  state: ConnectionState = "online";
  /** The latest status the server sent, or null before the first. */
  snapshot: StatusSnapshot | null = null;
  private listeners = new Set<() => void>();
  private source: EventSource | null = null;
  private probing: Promise<void> | null = null;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private delay: number;
  private started = false;
  /** What `useSyncExternalStore` compares: a new object after every change. */
  private view: { state: ConnectionState; snapshot: StatusSnapshot | null } = {
    state: this.state,
    snapshot: null,
  };

  constructor(private readonly d: ConnectionDeps) {
    this.delay = this.firstDelay();
  }

  /** The first wait before the stream is opened again: two seconds, or less in tests. */
  private firstDelay(): number {
    return Math.min(2000, this.d.maxDelayMs ?? 30_000);
  }

  private readonly onOnline = () => this.retry();

  start(): void {
    if (this.started) return;
    this.started = true;
    this.d.events?.addEventListener("online", this.onOnline);
    this.open();
  }

  stop(): void {
    this.started = false;
    this.d.events?.removeEventListener("online", this.onOnline);
    clearTimeout(this.timer);
    this.source?.close();
    this.source = null;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  current() {
    return this.view;
  }

  private set(state: ConnectionState, snapshot = this.snapshot): void {
    if (state === this.state && snapshot === this.snapshot) return;
    const back = state === "online" && this.state !== "online";
    this.state = state;
    this.snapshot = snapshot;
    this.view = { state, snapshot };
    for (const l of [...this.listeners]) l();
    // Coming back: the stream is opened again at once if it had given up.
    if (back && this.started && !this.source) this.open();
  }

  private open(): void {
    clearTimeout(this.timer);
    this.source?.close();
    this.source = null;
    if (!this.d.EventSource || !this.started) return;
    const source = new this.d.EventSource(STREAM);
    this.source = source;
    source.onopen = () => {
      this.delay = this.firstDelay();
      this.set("online");
    };
    source.addEventListener("status", (e) => {
      try {
        this.set("online", JSON.parse((e as MessageEvent<string>).data) as StatusSnapshot);
      } catch {
        /* a snapshot that cannot be read is skipped; the next one replaces it */
      }
    });
    source.onerror = () => {
      // While it is connecting the browser tries again by itself; once closed, it is reopened
      // here after the probe, waiting longer each time, except while signed out.
      const closed = source.readyState === 2;
      if (closed && this.source === source) this.source = null;
      void this.probe().then(() => {
        if (closed && !this.source) this.reopenLater();
      });
    };
  }

  private reopenLater(): void {
    clearTimeout(this.timer);
    if (!this.started || this.state === "signed-out") return;
    this.timer = setTimeout(() => this.open(), this.delay);
    this.delay = Math.min(this.delay * 2, this.d.maxDelayMs ?? 30_000);
  }

  /** Asks `/api/status` once, and takes the state from the answer. */
  probe(): Promise<void> {
    this.probing ??= (async () => {
      try {
        const res = await this.d.fetch(STATUS, { credentials: "same-origin" });
        if (res.status === 401) this.set("signed-out");
        else if (res.ok) {
          const snapshot = (await res.json().catch(() => null)) as StatusSnapshot | null;
          this.set("online", snapshot ?? this.snapshot);
        } else this.set("online");
      } catch {
        this.set("offline");
      } finally {
        this.probing = null;
      }
    })();
    return this.probing;
  }

  /** A request had an answer from the server. */
  reached(): void {
    if (this.state !== "online") this.set("online");
  }

  /** A request could not reach the server. */
  unreachable(): void {
    void this.probe();
  }

  /** A request was refused for want of a session. */
  unauthorised(): void {
    void this.probe();
  }

  /** Tries again now: asks the server, and opens the stream if it had given up. */
  retry(): Promise<void> {
    this.delay = this.firstDelay();
    if (this.started && (!this.source || this.source.readyState === 2)) this.open();
    return this.probe();
  }

  /** After the author logged in again. */
  loggedIn(): Promise<void> {
    return this.retry();
  }

  /** Reads the status again, as after a change the stream may not tell of. */
  refreshStatus(): Promise<void> {
    return this.probe();
  }
}

/** The app's one connection service. */
export const connection = new Connection({
  fetch: (...args) => fetch(...args),
  EventSource: typeof EventSource === "undefined" ? undefined : EventSource,
  ...(typeof window === "undefined" ? {} : { events: window }),
});

/** The connection state and the latest status snapshot, for any component. */
export function useConnection(): {
  state: ConnectionState;
  snapshot: StatusSnapshot | null;
  retry: () => void;
} {
  const view = useSyncExternalStore(
    (l) => connection.subscribe(l),
    () => connection.current(),
  );
  return { ...view, retry: () => void connection.retry() };
}
