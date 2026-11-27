/**
 * The AI keys this device holds (stage 27f). Each person brings their own key and it stays in
 * this browser: in `localStorage`, like the other device settings, so the page can read it and
 * the service worker's caches never hold it. The server never saves one; `api.ts` sends the keys
 * in a header with each request that can lead to an AI call.
 *
 * Where storage is blocked or full (a private window, site data turned off) the keys are held in
 * memory for as long as the page is open, and the page still works.
 */
import {
  AI_KEYS_HEADER,
  AiProviderKind,
  type DeviceKeys,
  decodeDeviceKeys,
  encodeDeviceKeys,
} from "@frontier/schema";
import { useSyncExternalStore } from "react";

/** Before keys were filed by person, they were kept under these two names. */
const OLD_KEYS = "frontier.aiKeys";
const OLD_CHECKS = "frontier.aiKeys.checks";

/**
 * The keys and their test results are filed under the person signed in, so on a browser two people
 * share, the next login neither reads nor sends the keys of the one before. Logging out does not
 * remove them: they wait for that person's next login.
 */
const keysName = (person: string) => `frontier.aiKeys:${person}`;
const checksName = (person: string) => `frontier.aiKeys.checks:${person}`;

let owner: string | null = null;
const ownerListeners = new Set<(person: string | null) => void>();

/**
 * Hears who is signed in on this device, now and from here on: the person's id, or null once
 * nobody is. What the device files per person (the save queues, the list of projects, the
 * recents) follows it.
 */
export function onKeysOwner(listener: (person: string | null) => void): () => void {
  ownerListeners.add(listener);
  return () => ownerListeners.delete(listener);
}

/** What the last test of a key on this device found. Kept beside the key, on this device only. */
export interface KeyCheck {
  at: string;
  ok: boolean;
  /** The provider's words when it refused or could not be reached. */
  message: string | null;
}

type Checks = Partial<Record<AiProviderKind, KeyCheck>>;

let keys: DeviceKeys | null = null;
let checks: Checks | null = null;
const listeners = new Set<() => void>();
/** Bumped on every change, so a snapshot read in React is a new value when anything changed. */
let version = 0;

function load<T>(name: string, fallback: T, valid: (raw: unknown) => T): T {
  try {
    const raw = localStorage.getItem(name);
    return raw ? valid(JSON.parse(raw)) : fallback;
  } catch {
    return fallback;
  }
}

/**
 * Says whose keys this device uses now: the person signed in, or nobody (logged out), when no key
 * is read or sent. Keys kept before they were filed by person go to the first person who is
 * signed in, once.
 */
export function setKeysOwner(person: string | null): void {
  if (person === owner) return;
  owner = person;
  keys = null;
  checks = null;
  if (person) migrateOld(person);
  for (const l of [...ownerListeners]) l(person);
  changed();
}

function migrateOld(person: string): void {
  try {
    for (const [from, to] of [
      [OLD_KEYS, keysName(person)],
      [OLD_CHECKS, checksName(person)],
    ] as const) {
      const old = localStorage.getItem(from);
      if (old === null) continue;
      if (localStorage.getItem(to) === null) localStorage.setItem(to, old);
      localStorage.removeItem(from);
    }
  } catch {
    /* storage blocked: nothing was kept to move */
  }
}

function readKeys(): DeviceKeys {
  if (!owner) return {};
  // The same checks the server applies to what a header carries: only real providers, and
  // only text that can be a key.
  const mine = owner;
  keys ??= load<DeviceKeys>(keysName(mine), {}, (raw) =>
    decodeDeviceKeys(btoa(JSON.stringify(raw))),
  );
  return keys;
}

function readChecks(): Checks {
  if (!owner) return {};
  checks ??= load<Checks>(checksName(owner), {}, (raw) => {
    const out: Checks = {};
    for (const kind of AiProviderKind.options) {
      const c = (raw as Record<string, Partial<KeyCheck> | undefined>)[kind];
      if (c && typeof c.at === "string" && typeof c.ok === "boolean") {
        out[kind] = {
          at: c.at,
          ok: c.ok,
          message: typeof c.message === "string" ? c.message : null,
        };
      }
    }
    return out;
  });
  return checks;
}

function changed(): void {
  version++;
  for (const l of listeners) l();
}

function save(): void {
  if (!owner) return;
  try {
    localStorage.setItem(keysName(owner), JSON.stringify(readKeys()));
    localStorage.setItem(checksName(owner), JSON.stringify(readChecks()));
  } catch {
    /* kept in memory only */
  }
}

/** The keys on this device, by provider kind. */
export function deviceKeys(): DeviceKeys {
  return { ...readKeys() };
}

export function hasDeviceKey(kind: AiProviderKind): boolean {
  return Boolean(readKeys()[kind]);
}

/** Keeps a key on this device, replacing the one for that provider, and what its test found. */
export function setDeviceKey(kind: AiProviderKind, key: string, check?: KeyCheck): void {
  if (!owner) return;
  keys = { ...readKeys(), [kind]: key.trim() };
  const next = { ...readChecks() };
  if (check) next[kind] = check;
  else delete next[kind];
  checks = next;
  save();
  changed();
}

/** Records what a test of the key found, for the section to show. */
export function recordCheck(kind: AiProviderKind, check: KeyCheck): void {
  if (!readKeys()[kind]) return;
  checks = { ...readChecks(), [kind]: check };
  save();
  changed();
}

export function removeDeviceKey(kind: AiProviderKind): void {
  const nextKeys = { ...readKeys() };
  delete nextKeys[kind];
  keys = nextKeys;
  const nextChecks = { ...readChecks() };
  delete nextChecks[kind];
  checks = nextChecks;
  save();
  changed();
}

export function checkOf(kind: AiProviderKind): KeyCheck | null {
  return readChecks()[kind] ?? null;
}

/** The value of the keys header for what this device holds, or null when it holds none. */
export function keysHeaderValue(only?: DeviceKeys): string | null {
  const wanted = only ?? readKeys();
  return Object.keys(wanted).length > 0 ? encodeDeviceKeys(wanted) : null;
}

export { AI_KEYS_HEADER };

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

// Another tab of this browser changed the keys: read them again.
if (typeof window !== "undefined") {
  window.addEventListener("storage", (e) => {
    if (e.key === null || (owner && (e.key === keysName(owner) || e.key === checksName(owner)))) {
      keys = null;
      checks = null;
      changed();
    }
  });
}

/** Removes every key and test result this device holds, whoever's. For "remove everything". */
export function removeAllDeviceKeys(): void {
  try {
    const names: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const name = localStorage.key(i);
      if (name && (name === OLD_KEYS || name === OLD_CHECKS || name.startsWith("frontier.aiKeys")))
        names.push(name);
    }
    for (const name of names) localStorage.removeItem(name);
  } catch {
    /* storage blocked */
  }
  keys = null;
  checks = null;
  changed();
}

/** The keys on this device, and what their last tests found, as React state. */
export function useDeviceKeys(): { keys: DeviceKeys; checks: Checks } {
  useSyncExternalStore(subscribe, () => version);
  return { keys: readKeys(), checks: readChecks() };
}

/** For tests: forgets what was read, so the next read comes from storage again. */
export function resetKeysForTests(person: string | null = "p1"): void {
  owner = person;
  keys = null;
  checks = null;
  version++;
}

/** Whose keys these are now: the signed-in person's id, or null when nobody is signed in. */
export function keysOwner(): string | null {
  return owner;
}
