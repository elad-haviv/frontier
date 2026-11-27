/**
 * Small things this device remembers for the signed-in person, such as proposals still to make
 * (stage 27f). They are filed under the person's id, so the next login on a shared browser neither
 * reads nor continues them. Where storage is blocked they are simply not remembered.
 */
import { keysOwner } from "./aiKeys.ts";

const name = (what: string, person: string) => `frontier.${what}:${person}`;

/** What was kept under this name for the signed-in person, or null. */
export function readOwn<T>(what: string, valid: (raw: unknown) => T | null): T | null {
  const person = keysOwner();
  if (!person) return null;
  try {
    const text = localStorage.getItem(name(what, person));
    return text ? valid(JSON.parse(text)) : null;
  } catch {
    return null;
  }
}

/** Keeps a value for the signed-in person; null removes it. */
export function writeOwn(what: string, value: unknown): void {
  const person = keysOwner();
  if (!person) return;
  try {
    if (value === null) localStorage.removeItem(name(what, person));
    else localStorage.setItem(name(what, person), JSON.stringify(value));
  } catch {
    /* not remembered */
  }
}
