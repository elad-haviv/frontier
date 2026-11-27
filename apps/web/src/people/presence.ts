/**
 * Telling the project which entry this tab is reading (stage 27d). The server keeps it in memory
 * only and lets it lapse after 60 seconds, so an open entry is announced again every 25 seconds.
 *
 * - `set(path)` announces the published entry that is open; `set(null)` says there is none. An
 *   entry that is only the person's own unsaved new one is never announced (the page passes null).
 * - A tab that is hidden or closing says it has left with a beacon (a JSON Blob, which a closing
 *   page can still send), and says it is back when it is shown again.
 * - Everything here is quiet: a failed announcement is not an error, the next one tries again.
 */
import { projectUrl } from "../api.ts";
import { currentSlug } from "../project.ts";
import { connection } from "../sync/connection.ts";
import { TAB_CLIENT } from "../sync/tab.ts";

/** Shorter than the server's 60 seconds, so one missed beat does not take a person off. */
export const HEARTBEAT_MS = 25_000;

export interface PresenceDeps {
  fetch: typeof fetch;
  /** The address of the project the app has open, or null outside any project. */
  project: () => string | null;
  /** Whether the server can be reached. Nothing is sent while it cannot. */
  online: () => boolean;
  /** `navigator.sendBeacon`; absent where the browser has none. */
  beacon?: ((url: string, data: Blob) => boolean) | undefined;
  client: string;
  setTimer?: typeof setInterval;
  clearTimer?: typeof clearInterval;
}

export class Presence {
  /** The entry that should be announced now, or null. */
  private path: string | null = null;
  /** The project the last announcement went to, so leaving clears the right one. */
  private announcedIn: string | null = null;
  /** Whether the last thing told to the server was an entry. */
  private announced = false;
  private visible = true;
  private timer: ReturnType<typeof setInterval> | undefined;

  constructor(private readonly d: PresenceDeps) {}

  /** The entry now open and published, or null for none. Repeating the same path does nothing. */
  set(path: string | null): void {
    if (path === this.path && (path === null || this.timer || !this.visible)) return;
    const slug = this.d.project();
    // Another project from the one announced in: its announcement is taken away first.
    if (this.announced && this.announcedIn !== null && this.announcedIn !== slug) {
      this.send(null, this.announcedIn);
    }
    this.path = path;
    if (path === null) {
      this.stopBeats();
      if (this.announced) this.send(null, this.announcedIn ?? slug);
      this.announced = false;
      return;
    }
    if (!this.visible) return;
    this.announce();
    this.startBeats();
  }

  /** The tab is hidden or closing: the announcement is taken away with a beacon. */
  hide(): void {
    this.visible = false;
    this.stopBeats();
    if (!this.announced) return;
    const slug = this.announcedIn ?? this.d.project();
    this.announced = false;
    if (slug === null) return;
    const body = new Blob([JSON.stringify({ client: this.d.client })], {
      type: "application/json",
    });
    const url = projectUrl("/presence/leave", slug);
    // Sent as a beacon when the browser has one; a plain request that outlives the page if not.
    if (this.d.beacon?.(url, body)) return;
    void this.d
      .fetch(url, { method: "POST", body, keepalive: true, credentials: "same-origin" })
      .catch(() => undefined);
  }

  /** The tab is shown again: what is open is announced afresh. */
  show(): void {
    this.visible = true;
    if (this.path !== null) {
      this.announce();
      this.startBeats();
    }
  }

  private announce(): void {
    const slug = this.d.project();
    if (this.path === null || slug === null) return;
    this.announcedIn = slug;
    this.announced = true;
    this.send(this.path, slug);
  }

  private send(path: string | null, slug: string | null): void {
    if (slug === null || !this.d.online()) return;
    void this.d
      .fetch(projectUrl("/presence", slug), {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ path, client: this.d.client }),
        keepalive: true,
        credentials: "same-origin",
      })
      .catch(() => undefined);
  }

  private startBeats(): void {
    if (this.timer) return;
    this.timer = (this.d.setTimer ?? setInterval)(() => this.announce(), HEARTBEAT_MS);
  }

  private stopBeats(): void {
    if (!this.timer) return;
    (this.d.clearTimer ?? clearInterval)(this.timer);
    this.timer = undefined;
  }
}

/** The app's one announcer. */
export const presence = new Presence({
  fetch: (...args) => fetch(...args),
  project: currentSlug,
  online: () => connection.state === "online",
  beacon:
    typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function"
      ? (url, data) => navigator.sendBeacon(url, data)
      : undefined,
  client: TAB_CLIENT,
});

if (typeof window !== "undefined") {
  window.addEventListener("pagehide", () => presence.hide());
  window.addEventListener("pageshow", () => presence.show());
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") presence.hide();
    else presence.show();
  });
}
