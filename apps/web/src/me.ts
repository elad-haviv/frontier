import type { MeResponse } from "@frontier/schema";
import { useSyncExternalStore } from "react";
import { setKeysOwner } from "./aiKeys.ts";
import { api } from "./api.ts";

/**
 * The person logged in on this device. It is read from the server once the app opens signed in,
 * and kept in the browser so the left bar can still say who you are with no connection. It is
 * forgotten at log out, so the next person to use the browser is not shown it.
 */
const KEY = "frontier.me";

let current: MeResponse | null = readKept();
setKeysOwner(current?.id ?? null);
/** True after the server was asked and could not say, until it does. */
let failed = false;
const listeners = new Set<() => void>();

function readKept(): MeResponse | null {
  try {
    const text = localStorage.getItem(KEY);
    return text ? (JSON.parse(text) as MeResponse) : null;
  } catch {
    return null;
  }
}

function set(next: MeResponse | null): void {
  const changedPerson = current !== null && next !== null && current.id !== next.id;
  current = next;
  // The AI keys on this device are the signed-in person's: nobody's, once logged out.
  setKeysOwner(next?.id ?? null);
  try {
    if (next) localStorage.setItem(KEY, JSON.stringify(next));
    else localStorage.removeItem(KEY);
  } catch {
    /* without storage the name is shown only while the page is open */
  }
  for (const l of listeners) l();
  // Another person signed in on this page (the login dialog after a session ended): nothing of the
  // last one's, in memory or on the screen, must stay. Their own data is filed under their id.
  if (changedPerson && typeof window !== "undefined") window.location.reload();
}

/** Reads the person again from the server. A failure leaves what is known as it is. */
export async function loadMe(): Promise<MeResponse | null> {
  try {
    failed = false;
    set(await api.me());
  } catch {
    /* offline, or logged out: the left bar keeps what it had until the session says otherwise */
    failed = true;
    for (const l of listeners) l();
  }
  return current;
}

/** What the account still lacks, in words, for the places that ask for it. */
export function missing(name: string, email: string): string {
  if (name.trim() === "" && email.trim() === "") return "name and email";
  return name.trim() === "" ? "name" : "email";
}

/** Whether the last attempt to read the person failed, so a page can offer to try again. */
export function useMeFailed(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => failed,
    () => failed,
  );
}

/** Forgets the person, at log out. */
export function clearMe(): void {
  set(null);
}

/** Puts a profile the server just sent in place of the known one. */
export function noteMe(me: MeResponse): void {
  set(me);
}

const subscribe = (changed: () => void) => {
  listeners.add(changed);
  return () => listeners.delete(changed);
};

export function useMe(): MeResponse | null {
  return useSyncExternalStore(
    subscribe,
    () => current,
    () => current,
  );
}
