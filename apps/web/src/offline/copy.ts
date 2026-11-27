/**
 * What pages need of the device copy (stage 15b), kept small because it is in the first load:
 * whether an answer came from the device and when it was stored, whether an entry shows text not
 * sent yet, the late answers that replace a device answer, and the calls into the device layer
 * itself (`device.ts`), which loads on its own once the app is signed in.
 */
import { setReadThrough } from "../api.ts";

const served = new WeakMap<object, number>();
const unsent = new WeakSet<object>();
const freshListeners = new Set<(url: string) => void>();

/** Notes that `value` was answered from the device, stored at `at`. */
export function markServed(value: unknown, at: number): void {
  if (value && typeof value === "object") served.set(value, at);
}

/** When the device stored this answer, or null when the server gave it. */
export function servedFromDevice(value: unknown): number | null {
  return value && typeof value === "object" ? (served.get(value) ?? null) : null;
}

/** Notes that this entry shows the text of a change not sent yet. */
export function markUnsent(value: object): void {
  unsent.add(value);
}

export function notSentYet(value: unknown): boolean {
  return !!value && typeof value === "object" && unsent.has(value);
}

/** Hears that a late answer from the server replaced the device answer for `url`. */
export function onFresh(listener: (url: string) => void): () => void {
  freshListeners.add(listener);
  return () => freshListeners.delete(listener);
}

export function announceFresh(url: string): void {
  for (const l of [...freshListeners]) l(url);
}

/** The window event fired the first time an item is kept on this device (`InstallCard.tsx`). */
export const FIRST_ITEM = "frontier:first-item";

/** The address an entry is read from, as `api.entry` makes it. */
export const entryAddress = (path: string): string =>
  `/api/entries?path=${encodeURIComponent(path)}`;

/** The code of a read whose item is not on this device while the server cannot be reached. */
export const NOT_ON_DEVICE = "not_on_device";

type DeviceModule = typeof import("./device.ts");
let loading: Promise<DeviceModule> | null = null;

/** Loads the device layer and puts it in front of the app's reads; once signed in. */
export function startDeviceCopy(): void {
  loading ??= import("./device.ts");
  setReadThrough(loading.then((m) => m.startDevice()).catch(() => null));
}

const device = () => loading?.then((m) => m.device).catch(() => null) ?? Promise.resolve(null);

/** An entry, map or chronicle was opened: it is kept on this device among the recent ones. */
export function markOpened(key: `entry:${string}` | `map:${string}` | `chronicle:${string}`): void {
  void device().then((d) => d?.opened(key));
}

/** The space the device copy takes, in bytes; null when nothing can be kept on this device. */
export async function deviceSpace(): Promise<number | null> {
  loading ??= import("./device.ts");
  const d = await device();
  return d ? d.space() : null;
}

/** Removes the copies of entries, maps and chronicles; changes not sent yet stay. */
export async function clearDeviceCopy(): Promise<void> {
  loading ??= import("./device.ts");
  await (await device())?.clear();
}

/** The space each of these projects' copies takes on this device; null where nothing is kept. */
export async function deviceSpaces(
  refs: { id: string; slug: string }[],
): Promise<{ id: string; bytes: number | null }[]> {
  loading ??= import("./device.ts");
  const d = await device();
  return d ? d.spaces(refs) : refs.map((r) => ({ id: r.id, bytes: null }));
}

/** Empties the copy of one project, which need not be the open one. */
export async function clearDeviceCopyOf(ref: { id: string; slug: string }): Promise<void> {
  loading ??= import("./device.ts");
  await (await device())?.clearProject(ref);
}
