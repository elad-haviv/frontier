/**
 * Before the save queue, text typed while the server could not be reached was kept in
 * `localStorage`, one key per file. On first start those keys are moved into the queue, and then
 * deleted. A file that already has a record in the queue keeps it: that one is newer.
 */
import type { Queue } from "./queue.ts";

const PREFIX = "frontier:draft:";

interface Buffered {
  id: string;
  text: string;
  /** The revision the server had when the text was typed. */
  revision: number;
}

function readable(value: unknown): value is Buffered {
  const b = value as Buffered | null;
  return (
    typeof b?.id === "string" &&
    /^[a-z0-9]{12}$/.test(b.id) &&
    typeof b.text === "string" &&
    Number.isInteger(b.revision) &&
    b.revision >= 0
  );
}

/** Moves every old buffer key into the queue. Returns how many texts were moved. */
export async function migrateBuffers(
  queue: Pick<Queue, "get" | "put">,
  storage: Storage | null = typeof localStorage === "undefined" ? null : localStorage,
): Promise<number> {
  if (!storage) return 0;
  let keys: string[];
  try {
    keys = Object.keys(storage).filter((k) => k.startsWith(PREFIX));
  } catch {
    return 0;
  }
  let moved = 0;
  for (const name of keys) {
    const path = name.slice(PREFIX.length);
    let value: unknown = null;
    try {
      value = JSON.parse(storage.getItem(name) ?? "null");
    } catch {
      /* not readable: nothing to move */
    }
    if (path && readable(value) && !(await queue.get(`entry:${path}`))) {
      // The old buffer did not know which file it started from, so the server treats it as it
      // treated such saves before: a draft it knows of is built on, an older revision is kept.
      await queue.put(`entry:${path}`, value.text, {
        kind: "edit",
        draftId: value.id,
        revision: value.revision,
      });
      moved++;
    }
    try {
      storage.removeItem(name);
    } catch {
      /* it is read again next time, and skipped then */
    }
  }
  return moved;
}
