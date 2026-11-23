/**
 * How the app starts: signed in, offline as signed in, or at the login page.
 *
 * After a login, and after every session check that says logged in, the device notes `signedIn:
 * { until }` beside the save queue, `until` being 30 days on, the session cookie's life. At start,
 * while that note holds, the session check gets 3 seconds: when it cannot reach the server or does
 * not answer in time, the app opens as signed in and offline, and the late answer decides. Without
 * the note, or after `until`, the start is as before: the session check, then the login page if it
 * fails.
 */
import { ApiFailure } from "../api.ts";
import type { Connection } from "../sync/connection.ts";
import type { Queue } from "../sync/queue.ts";

export const SIGNED_IN = "signedIn";
/** The session cookie's life. */
export const SIGNED_IN_MS = 30 * 24 * 60 * 60 * 1000;
/** How long the start waits for the session check before opening offline. */
export const SESSION_WAIT_MS = 3000;

export interface SignedIn {
  until: number;
}

export type StartMode = "check" | "may-start-offline";

export function startMode(signedIn: SignedIn | undefined, now: number): StartMode {
  return typeof signedIn?.until === "number" && signedIn.until > now
    ? "may-start-offline"
    : "check";
}

type Session = { loggedIn: boolean };

/** What the session check gave within its time. */
export type Checked =
  | { kind: "answer"; session: Session }
  | { kind: "unreachable" }
  | { kind: "late"; answer: Promise<Session> };

/** Waits at most `ms` for the session check; a failure to reach the server says so. */
export function sessionWithin(asked: Promise<Session>, ms: number): Promise<Checked | "failed"> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve({ kind: "late", answer: asked }), ms);
    asked.then(
      (session) => {
        clearTimeout(timer);
        resolve({ kind: "answer", session });
      },
      (error: unknown) => {
        clearTimeout(timer);
        resolve(
          error instanceof ApiFailure && error.status === 0 ? { kind: "unreachable" } : "failed",
        );
      },
    );
  });
}

export interface StartDeps {
  session: () => Promise<Session>;
  store: Pick<Queue, "meta" | "setMeta" | "removeMeta">;
  connection: Pick<Connection, "startOffline" | "reached" | "unauthorised">;
  now?: () => number;
  waitMs?: number;
}

/** Notes that this device is signed in, for 30 days from now. */
export function noteSignedIn(
  store: Pick<Queue, "setMeta">,
  now: number = Date.now(),
): Promise<void> {
  return store.setMeta(SIGNED_IN, { until: now + SIGNED_IN_MS } satisfies SignedIn).catch(() => {
    /* without storage there is no offline start; nothing else changes */
  });
}

/** True when the app opens signed in, online or not; false for the login page. */
export async function openApp(d: StartDeps): Promise<boolean> {
  const now = d.now ?? Date.now;
  const signedIn = await d.store.meta<SignedIn>(SIGNED_IN).catch(() => undefined);
  // The server's answer is the truth: the note follows it.
  const settle = (session: Session) => {
    if (session.loggedIn) void noteSignedIn(d.store, now());
    else void d.store.removeMeta(SIGNED_IN).catch(() => undefined);
    return session.loggedIn;
  };
  if (startMode(signedIn, now()) === "check") {
    return d.session().then(settle, () => false);
  }
  const checked = await sessionWithin(d.session(), d.waitMs ?? SESSION_WAIT_MS);
  if (checked === "failed") return false;
  if (checked.kind === "answer") return settle(checked.session);
  d.connection.startOffline();
  if (checked.kind === "late") {
    // The late answer decides: logged in, and the connection is online; logged out, and it asks
    // the server, which says signed out, so the login dialog opens over the page.
    checked.answer.then(
      (session) => (settle(session) ? d.connection.reached() : d.connection.unauthorised()),
      () => undefined,
    );
  }
  return true;
}
