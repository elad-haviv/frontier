import type { ProjectRole, Reading } from "@frontier/schema";

/** How long an announcement lasts without being repeated. The web app repeats it every 25 seconds. */
export const PRESENCE_TTL_MS = 60_000;

/** How many devices or tabs one person can be reading on at once; the oldest is forgotten past it. */
const CLIENTS_PER_PERSON = 8;

interface Client {
  person: string;
  /** The device or tab; one anonymous client when the web app names none. */
  client: string;
  path: string;
  /** When this client began reading this entry. */
  since: number;
  seen: number;
}

export interface PresenceOptions {
  /** A person's role in the project now; null when they are not in it (they are not listed). */
  roleOf: (personId: string) => ProjectRole | null;
  nameOf: (personId: string) => string;
  /** Told when who-is-reading-what changed (not for a repeat of the same announcement). */
  onChange: () => void;
  now?: () => number;
  ttlMs?: number;
}

/**
 * Who is reading which entry of one project, now (stage 31d). A light signal and nothing more:
 * kept in memory only, never written to disk or to a log, per project (a person reading in two
 * projects is two separate facts, each in its own project's `Presence`), gone when the server
 * restarts. Fed by the web app announcing the entry it has open (`PUT /presence`); cleared when the
 * person says they left, when an announcement is not repeated within the time to live, and when the
 * person's last status stream ends. Delivered through the status stream to writers and owners only.
 */
export class Presence {
  private readonly clients = new Map<string, Client>();
  /** How many status streams each of a person's devices has open, by person and client. */
  private readonly streams = new Map<string, number>();
  private timer: NodeJS.Timeout | null = null;
  private readonly now: () => number;
  private readonly ttl: number;

  constructor(private readonly o: PresenceOptions) {
    this.now = o.now ?? Date.now;
    this.ttl = o.ttlMs ?? PRESENCE_TTL_MS;
  }

  /** A person's device says which entry it has open, or `null` for none. */
  announce(person: string, client: string | undefined, path: string | null): void {
    const key = this.key(person, client);
    const at = this.now();
    const before = this.shape();
    this.expire(at);
    const had = this.clients.get(key);
    if (path === null) {
      this.clients.delete(key);
    } else {
      this.clients.set(key, {
        person,
        client: client ?? "",
        path,
        since: had && had.path === path ? had.since : at,
        seen: at,
      });
      this.limit(person);
    }
    this.afterChange(before);
  }

  /** The person's device has gone (a closed tab); the same as announcing no entry. */
  leave(person: string, client: string | undefined): void {
    this.announce(person, client, null);
  }

  /**
   * A status stream of the person's opened. `client` is the device or tab it belongs to (the same
   * name its announcements use); a stream that says none is the person's anonymous client.
   */
  streamOpened(person: string, client?: string): void {
    const key = this.key(person, client);
    this.streams.set(key, (this.streams.get(key) ?? 0) + 1);
  }

  /**
   * One ended. Nobody is reading through a stream that ended, so what that device announced goes
   * with it, once it has no stream left; what the person's other tabs and devices announced stays,
   * for they have streams of their own. A stream that names no client cannot say which announcement
   * was its own: with the person's last stream gone, they have left, whatever they announced.
   */
  streamClosed(person: string, client?: string): void {
    const key = this.key(person, client);
    const n = (this.streams.get(key) ?? 1) - 1;
    if (n > 0) {
      this.streams.set(key, n);
      return;
    }
    this.streams.delete(key);
    if (client !== undefined) {
      this.leave(person, client);
      return;
    }
    const prefix = `${person}\u0000`;
    if (![...this.streams.keys()].some((k) => k.startsWith(prefix))) this.forget(person);
    else this.leave(person, undefined);
  }

  private key(person: string, client: string | undefined): string {
    return `${person}\u0000${client ?? ""}`;
  }

  /** Forgets everything of one person, such as when they are removed. */
  forget(person: string): void {
    const before = this.shape();
    for (const [key, c] of this.clients) if (c.person === person) this.clients.delete(key);
    this.afterChange(before);
  }

  /**
   * Who else is reading what, as `viewer` is told: one row for each person and entry, the earliest
   * time they began, never the viewer themselves, and only people who are in the project now.
   */
  readingFor(viewer: string): Reading[] {
    this.expire(this.now());
    const rows = new Map<string, { person: string; path: string; since: number }>();
    for (const c of this.clients.values()) {
      if (c.person === viewer || this.o.roleOf(c.person) === null) continue;
      const key = `${c.person}\u0000${c.path}`;
      const known = rows.get(key);
      if (!known || c.since < known.since)
        rows.set(key, { person: c.person, path: c.path, since: c.since });
    }
    return [...rows.values()]
      .sort((a, b) => a.since - b.since || a.path.localeCompare(b.path))
      .map((r) => ({
        id: r.person,
        name: this.o.nameOf(r.person),
        path: r.path,
        since: new Date(r.since).toISOString(),
      }));
  }

  /** How many announcements are held, for tests and for knowing the timer is needed. */
  size(): number {
    return this.clients.size;
  }

  /** Stops the timer. */
  close(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.clients.clear();
    this.streams.clear();
  }

  private limit(person: string): void {
    const mine = [...this.clients.entries()]
      .filter(([, c]) => c.person === person)
      .sort((a, b) => a[1].seen - b[1].seen);
    for (const [key] of mine.slice(0, Math.max(0, mine.length - CLIENTS_PER_PERSON))) {
      this.clients.delete(key);
    }
  }

  /** What listeners would be told, as a string to compare: who and which entry, not when. */
  private shape(): string {
    return [...this.clients.values()]
      .map((c) => `${c.person}\u0000${c.path}`)
      .sort()
      .join("\u0001");
  }

  private expire(at: number): boolean {
    let any = false;
    for (const [key, c] of this.clients) {
      if (at - c.seen >= this.ttl) {
        this.clients.delete(key);
        any = true;
      }
    }
    return any;
  }

  private afterChange(before: string): void {
    this.schedule();
    if (this.shape() !== before) this.o.onChange();
  }

  /** One timer, for the soonest announcement to lapse; none while nothing is held. */
  private schedule(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    if (this.clients.size === 0) return;
    const soonest = Math.min(...[...this.clients.values()].map((c) => c.seen + this.ttl));
    this.timer = setTimeout(
      () => {
        const before = this.shape();
        this.expire(this.now());
        this.afterChange(before);
      },
      Math.max(50, soonest - this.now()),
    );
    this.timer.unref();
  }
}
