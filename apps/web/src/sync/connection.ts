/**
 * One connection state for the whole app: online, offline or signed out.
 *
 * It listens to the server's status stream, which also brings the status snapshot every page
 * reads. When the stream fails, or a request cannot reach the server, it asks the status once:
 * a 401 means signed out, a failure to connect means offline, and any other answer means online.
 * Any later answer from the server means online again. The browser's own online flag is only a
 * hint to try again at once.
 */
import { useSyncExternalStore } from "react";
import type { StatusSnapshot } from "@frontier/schema";
import { currentSlug } from "../project.ts";

export type ConnectionState = "online" | "offline" | "signed-out";

export interface ConnectionDeps {
  fetch: typeof fetch;
  EventSource: typeof EventSource | undefined;
  /** Where the browser's `online` event is heard; none in tests that do not need it. */
  events?: Pick<Window, "addEventListener" | "removeEventListener">;
  /** The longest wait before the stream is opened again after it closed. */
  maxDelayMs?: number;
  /** The address of the project the app has open, or null outside any project. */
  project: () => string | null;
}

/** The status and its stream are a project's (stage 27b); outside one, `/api/me` says who is in. */
const streamOf = (slug: string) => `/api/p/${encodeURIComponent(slug)}/status/events`;
const statusOf = (slug: string | null) =>
  slug === null ? "/api/me" : `/api/p/${encodeURIComponent(slug)}/status`;

export class Connection {
  state: ConnectionState = "online";
  /** The latest status the server sent, or null before the first. */
  snapshot: StatusSnapshot | null = null;
  private listeners = new Set<() => void>();
  private accessListeners = new Set<() => void>();
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

  /**
   * Starts as offline, as when the app opens signed in but the server has not answered: the
   * stream and a probe start as usual, and the first answer says what holds.
   */
  startOffline(): void {
    this.set("offline");
    this.start();
    void this.probe();
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

  /**
   * Hears that what the person may do in the open project may have changed: the status stream was
   * cut while the server could still be reached (the server closes it when a role changes or a
   * person is removed), or a request was refused for want of a role or a project. The project's
   * record is read again then.
   */
  onAccessMayHaveChanged(listener: () => void): () => void {
    this.accessListeners.add(listener);
    return () => this.accessListeners.delete(listener);
  }

  /** Says that the person's access to the open project may have changed. */
  accessMayHaveChanged(): void {
    for (const l of [...this.accessListeners]) l();
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
    const slug = this.d.project();
    // Outside a project there is nothing to listen to; the first project that opens starts it.
    if (!this.d.EventSource || !this.started || slug === null) return;
    const source = new this.d.EventSource(streamOf(slug));
    if (this.openedFor !== slug) this.streamOpenedBefore = false;
    this.openedFor = slug;
    this.source = source;
    source.onopen = () => {
      // A stream that opens again after one that ended: a role may have changed, or the person
      // been taken out, while none was open. The server cuts a stream that is open at the time,
      // and one that was not open is never cut, so nothing else would say so.
      if (this.streamOpenedBefore) this.accessMayHaveChanged();
      this.streamOpenedBefore = true;
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
        // The server answers but the stream ended: it closes the streams of a person whose role
        // changed or who was taken out, so the project's record is read again.
        if (this.state === "online") this.accessMayHaveChanged();
      });
    };
  }

  /** The project the stream was opened for. */
  private openedFor: string | null = null;
  /** Whether a stream of this project has opened before: a later one is a reconnection. */
  private streamOpenedBefore = false;

  /**
   * The app opened another project (or none): the status of the last is forgotten and the stream
   * of the new one is opened, so no count of one project shows in another.
   */
  projectChanged(): void {
    if (this.d.project() === this.openedFor && this.source) return;
    this.delay = this.firstDelay();
    this.set(this.state, null);
    this.open();
  }

  private reopenLater(): void {
    clearTimeout(this.timer);
    if (!this.started || this.state === "signed-out") return;
    this.timer = setTimeout(() => this.open(), this.delay);
    this.delay = Math.min(this.delay * 2, this.d.maxDelayMs ?? 30_000);
  }

  /** Asks the project's status once (`/api/me` outside a project), and takes the state from the answer. */
  probe(): Promise<void> {
    this.probing ??= (async () => {
      try {
        const slug = this.d.project();
        const res = await this.d.fetch(statusOf(slug), { credentials: "same-origin" });
        if (res.status === 401) this.set("signed-out");
        else if (res.ok) {
          // Only a project's status is a snapshot; who is in is not.
          const snapshot =
            slug === null ? null : ((await res.json().catch(() => null)) as StatusSnapshot | null);
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

  /** Shows a snapshot kept from an earlier visit until the server sends one, as offline. */
  remember(snapshot: StatusSnapshot): void {
    if (this.snapshot === null) this.set(this.state, snapshot);
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
  project: currentSlug,
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

/** What a control that needs the server says while the server cannot be reached. */
export const NEEDS_CONNECTION = "Needs a connection";

/**
 * For writes that go straight to the server rather than through the save queue (comments,
 * renames, saving a version…): the reason to refuse them now, or undefined while online.
 */
export function useNeedsConnection(): string | undefined {
  const view = useSyncExternalStore(
    (l) => connection.subscribe(l),
    () => connection.current(),
  );
  return view.state === "online" ? undefined : NEEDS_CONNECTION;
}
