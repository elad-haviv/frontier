/**
 * Losing access to a project while the app is open (stage 31c): a person taken out of it (or who
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

/** The notice as it stands now, for what is not a component. */
export const currentAccessNotice = (): string | null => notice;

/** Forgets the notice, once it was read. */
export function clearAccessNotice(): void {
  if (notice === null) return;
  notice = null;
  changed();
}

/** Forgets the notice and every project marked as leaving; at logout, so the next person sees none. */
export function resetAccess(): void {
  leaving.clear();
  inviteLinks.clear();
  clearAccessNotice();
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

// ---- Joining a project with a session started on the join page ---------------------------------

const JOINED = "frontier.joinedNote";

/**
 * A session started on the join page is followed by a full load of the project, so what the
 * browser held for someone before cannot reach the new person. The words that say they joined
 * would be lost with the old page, so they wait in this tab for the next one.
 */
export function rememberJoined(words: string): void {
  try {
    sessionStorage.setItem(JOINED, words);
  } catch {
    /* the toast is a courtesy */
  }
}

/** The words left by `rememberJoined`, once; null when there are none. */
export function takeJoined(): string | null {
  try {
    const words = sessionStorage.getItem(JOINED);
    sessionStorage.removeItem(JOINED);
    return words;
  } catch {
    return null;
  }
}

// ---- The invite link just made ---------------------------------------------------------------

/** A link made on Members, which the server never shows again. */
export interface MadeInvite {
  id: string;
  url: string;
  role: "reader" | "writer" | "owner";
  /** Stage 32: where it was emailed and whether the mail went; absent or null for a link made without an address. */
  sentTo?: string | null;
  mail?: "sent" | "failed" | null;
}
/** In memory only, never in storage: a link is a key, and it stays in this tab until logout. */
const inviteLinks = new Map<string, MadeInvite>();

/** Keeps the link just made for a project while the person moves about Settings. */
export function rememberInviteLink(project: string, link: MadeInvite | null): void {
  if (link) inviteLinks.set(project, link);
  else inviteLinks.delete(project);
}

/** The link made for a project in this session, if it was not taken away. */
export const recalledInviteLink = (project: string): MadeInvite | null =>
  inviteLinks.get(project) ?? null;
