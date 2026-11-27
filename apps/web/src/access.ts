/**
 * Losing access to a project while the app is open (stage 27c): a person taken out of it (or who
 * left it on another device) is moved to All projects and told so in plain words there. The words
 * are kept here, outside the page that is being left, so the page they land on can show them.
 */
import { useSyncExternalStore } from "react";

let notice: string | null = null;
const listeners = new Set<() => void>();
/** Projects (by address) the person is leaving on purpose, so that leaving is not reported as a loss. */
const leaving = new Set<string>();

function changed(): void {
  for (const l of [...listeners]) l();
}

/** Says, on All projects, that the person's access to a project ended. */
export function noteAccessLost(name: string): void {
  notice = `You are no longer in ${name}. An owner may have taken you out of it, or you left it on another device.`;
  changed();
}

/** Forgets the notice, once it was read. */
export function clearAccessNotice(): void {
  if (notice === null) return;
  notice = null;
  changed();
}

/** The person is leaving this project on purpose; the loss that follows needs no notice. */
export function markLeaving(slug: string): void {
  leaving.add(slug);
}

export const isLeaving = (slug: string): boolean => leaving.has(slug);

/** Forgets that a project is being left (the leaving failed). */
export function unmarkLeaving(slug: string): void {
  leaving.delete(slug);
}

const subscribe = (l: () => void) => {
  listeners.add(l);
  return () => listeners.delete(l);
};

/** What All projects says about a project that was lost, or null. */
export function useAccessNotice(): string | null {
  return useSyncExternalStore(
    subscribe,
    () => notice,
    () => notice,
  );
}
