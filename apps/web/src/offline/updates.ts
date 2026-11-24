/**
 * The service worker's registration, and new versions of the app.
 *
 * The worker is registered only while signed in, in a production build, and not while the server
 * has switched it off (`/build.json` says `worker: false`). A new version installs in the
 * background and waits: the app never reloads by itself. It offers "A new version of Frontier is
 * ready" once nothing is being sent and no editor has the focus; a record waiting for a connection
 * or needing attention does not hold the offer back, since a reload loses nothing in the queue.
 * Reload asks the waiting worker to take over, and every open tab reloads when it does.
 */
import { useSyncExternalStore } from "react";
import { type Queue, queue } from "../sync/queue.ts";

/** How long Reload waits for a new version to finish installing before reloading plainly. */
export const INSTALL_WAIT_MS = 10_000;
/** The shortest time between two checks for a new version. */
export const CHECK_EVERY_MS = 60_000;

export interface UpdateDeps {
  /** Undefined in a browser without service workers. */
  container: ServiceWorkerContainer | undefined;
  queue: Pick<Queue, "current" | "subscribeList">;
  fetch: typeof fetch;
  reload: () => void;
  /** False in `vite dev`, where there is no worker. */
  enabled: boolean;
  /** Where focus and visibility are heard; none in tests that do not need them. */
  win?: Pick<Window, "addEventListener"> | undefined;
  doc?: Pick<Document, "addEventListener" | "activeElement" | "visibilityState"> | undefined;
  path: () => string;
  now?: () => number;
}

/** True while the author is typing in an editor. */
function editing(doc: UpdateDeps["doc"]): boolean {
  return !!doc?.activeElement?.closest?.(".cm-editor");
}

export class Updates {
  private registration: ServiceWorkerRegistration | null = null;
  private registering: Promise<void> | null = null;
  /** The new version waiting to take over, if any. */
  private waiting: ServiceWorker | null = null;
  /** The waiting version the author answered Later to. */
  private dismissed: ServiceWorker | null = null;
  private lastCheck = -Infinity;
  private reloading = false;
  private listeners = new Set<() => void>();
  private view = { offer: false };
  private readonly now: () => number;

  constructor(private readonly d: UpdateDeps) {
    this.now = d.now ?? Date.now;
  }

  /** Registers the worker, once, when this page may have it. Fails quietly: the app runs as before. */
  register(): Promise<void> {
    const c = this.d.container;
    if (!this.d.enabled || !c || this.d.path() === "/login") return Promise.resolve();
    this.registering ??= (async () => {
      try {
        // Offline the check fails, and the worker already registered stays as it is.
        const build = (await this.d
          .fetch("/build.json", { cache: "no-store" })
          .then((r) => r.json())
          .catch(() => null)) as { worker?: boolean } | null;
        if (build?.worker === false) return;
        const registration = await c.register("/sw.js", { scope: "/" });
        this.registration = registration;
        this.lastCheck = this.now();
        c.addEventListener("controllerchange", () => this.reloadOnce());
        if (registration.waiting && c.controller) this.found(registration.waiting);
        registration.addEventListener("updatefound", () => {
          const worker = registration.installing;
          worker?.addEventListener("statechange", () => {
            // With no controller this is the first install, which takes over by itself.
            if (worker.state === "installed" && c.controller) this.found(worker);
          });
        });
        this.listen();
      } catch {
        /* no worker: the app works as it did before it had one */
      }
    })();
    return this.registering;
  }

  /** Asks the browser to look for a new version, at most once a minute. */
  update(): void {
    const r = this.registration;
    if (!r || this.now() - this.lastCheck < CHECK_EVERY_MS) return;
    this.lastCheck = this.now();
    void r.update().catch(() => undefined);
  }

  /** Lets the new version take over in every tab; reloads plainly when there is none to wait for. */
  async reload(): Promise<void> {
    const r = this.registration;
    if (!r) return this.reloadOnce();
    const worker = r.waiting ?? (await this.installed(r));
    if (!worker) return this.reloadOnce();
    worker.postMessage({ type: "SKIP_WAITING" });
    // `controllerchange` reloads every tab; should it never come, this one reloads all the same.
    setTimeout(() => this.reloadOnce(), INSTALL_WAIT_MS);
  }

  /** Hides the offer until a newer version is found, or the app starts again. */
  later(): void {
    this.dismissed = this.waiting;
    this.changed();
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  current(): { offer: boolean } {
    return this.view;
  }

  private found(worker: ServiceWorker): void {
    this.waiting = worker;
    this.changed();
  }

  /** The worker that is installing, or one an update check finds, once installed; null if none in time. */
  private installed(r: ServiceWorkerRegistration): Promise<ServiceWorker | null> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => resolve(null), INSTALL_WAIT_MS);
      const follow = (worker: ServiceWorker | null) => {
        if (!worker) return;
        // Past `installed` it waits for nothing: a plain reload takes it.
        const settle = () => {
          if (worker.state === "installing") return;
          clearTimeout(timer);
          resolve(worker.state === "installed" ? worker : null);
        };
        worker.addEventListener("statechange", settle);
        settle();
      };
      if (r.installing) follow(r.installing);
      else {
        r.addEventListener("updatefound", () => follow(r.installing));
        void r.update().catch(() => undefined);
      }
    });
  }

  private reloadOnce(): void {
    if (this.reloading) return;
    this.reloading = true;
    this.d.reload();
  }

  /** What the offer depends on: the queue's sends, the focus, and when to look for a new version. */
  private listen(): void {
    this.d.queue.subscribeList(() => this.changed());
    // The focus has left one element and not yet reached the next during `focusout`.
    this.d.doc?.addEventListener("focusin", () => this.changed());
    this.d.doc?.addEventListener("focusout", () => setTimeout(() => this.changed(), 0));
    this.d.win?.addEventListener("focus", () => this.update());
    this.d.doc?.addEventListener("visibilitychange", () => {
      if (this.d.doc?.visibilityState === "visible") this.update();
    });
  }

  private changed(): void {
    const sending = this.d.queue.current().some((r) => r.state === "sending");
    const offer =
      this.waiting !== null && this.waiting !== this.dismissed && !sending && !editing(this.d.doc);
    if (offer === this.view.offer) return;
    this.view = { offer };
    for (const l of [...this.listeners]) l();
  }
}

/** The app's one update flow. */
export const updates = new Updates({
  container: typeof navigator === "undefined" ? undefined : navigator.serviceWorker,
  queue,
  fetch: (...args) => fetch(...args),
  reload: () => window.location.reload(),
  enabled: import.meta.env.PROD,
  win: typeof window === "undefined" ? undefined : window,
  doc: typeof document === "undefined" ? undefined : document,
  path: () => (typeof window === "undefined" ? "" : window.location.pathname),
});

/** Whether to offer the new version, and the author's two answers. */
export function useUpdate(): { offer: boolean; reload: () => void; later: () => void } {
  const view = useSyncExternalStore(
    (l) => updates.subscribe(l),
    () => updates.current(),
  );
  return { ...view, reload: () => void updates.reload(), later: () => updates.later() };
}
