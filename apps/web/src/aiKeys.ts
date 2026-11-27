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

const KEYS = "frontier.aiKeys";
const CHECKS = "frontier.aiKeys.checks";

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

function readKeys(): DeviceKeys {
  // The same checks the server applies to what a header carries: only real providers, and
  // only text that can be a key.
  keys ??= load<DeviceKeys>(KEYS, {}, (raw) => decodeDeviceKeys(btoa(JSON.stringify(raw))));
  return keys;
}

function readChecks(): Checks {
  checks ??= load<Checks>(CHECKS, {}, (raw) => {
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
  try {
    localStorage.setItem(KEYS, JSON.stringify(readKeys()));
    localStorage.setItem(CHECKS, JSON.stringify(readChecks()));
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
    if (e.key === KEYS || e.key === CHECKS || e.key === null) {
      keys = null;
      checks = null;
      changed();
    }
  });
}

/** The keys on this device, and what their last tests found, as React state. */
export function useDeviceKeys(): { keys: DeviceKeys; checks: Checks } {
  useSyncExternalStore(subscribe, () => version);
  return { keys: readKeys(), checks: readChecks() };
}

/** For tests: forgets what was read, so the next read comes from storage again. */
export function resetKeysForTests(): void {
  keys = null;
  checks = null;
  version++;
}
