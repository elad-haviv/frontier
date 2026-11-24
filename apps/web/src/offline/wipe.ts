/**
 * What logout removes from the device beside the save queue: the note that this device is signed
 * in, the last status, the device copy, the app's caches (the images on the device among them),
 * and the service worker. Display settings in
 * `localStorage` stay; they say nothing about the library.
 */
import type { Queue } from "../sync/queue.ts";
import { SIGNED_IN } from "./start.ts";

export interface WipeDeps {
  store: Pick<Queue, "removeMeta"> & Partial<Pick<Queue, "clearDevice">>;
  caches?: Pick<CacheStorage, "keys" | "delete"> | undefined;
  container?: Pick<ServiceWorkerContainer, "getRegistrations"> | undefined;
}

/** The caches the app and its worker make; another app on the same site keeps its own. */
const OURS = /^(frontier-|workbox-)/;

/** Each step runs even when one before it fails, so as much as can go goes. */
export async function wipeDevice(d: WipeDeps): Promise<void> {
  for (const key of [SIGNED_IN, "snapshot"]) await d.store.removeMeta(key).catch(() => undefined);
  // The device copy: every answer and item kept for reading offline (15b).
  await d.store.clearDevice?.().catch(() => undefined);
  try {
    for (const name of (await d.caches?.keys()) ?? []) {
      if (OURS.test(name)) await d.caches?.delete(name);
    }
  } catch {
    /* Cache Storage is switched off: there is nothing in it */
  }
  try {
    for (const registration of (await d.container?.getRegistrations()) ?? []) {
      await registration.unregister();
    }
  } catch {
    /* no worker to remove */
  }
}
