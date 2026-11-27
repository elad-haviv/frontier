/**
 * What this device remembers in the browser's own storage about one library (stage 27b): the
 * entries read lately, where reading stopped, the maps opened lately, a chronicle's folded
 * spans… Each is filed under the project's id, so it neither shows in another project nor is
 * lost when the address is renamed. Display settings of the device itself (bar widths, the map's
 * curve) are not a library's and are not filed here.
 *
 * What an earlier build kept unfiled belongs to the first project and is moved there once
 * (`fileUnfiled`).
 */
import { currentProject } from "./project.ts";

/** The key of a library's value: `<name>:<project id>`. With no project open, the name itself. */
export function projectKey(name: string, id: string | undefined = currentProject()?.id): string {
  return id ? `${name}:${id}` : name;
}

/** Keys an earlier build wrote for the one library, moved to the first project once. */
const EXACT = ["frontier.keepGoing.v1", "frontier.maps.recent", "frontier.discovery.ready"];
/** Families of keys, one per map or chronicle id. */
const PREFIXES = ["frontier.explore.", "frontier.chronicle."];
/** Values filed under a person (`frontier.<what>:<person>`) that now are the project's too. */
const PERSON_KINDS = ["pendingProposals", "folderRun"];

const DONE = "frontier.projects.filed";

/**
 * Moves what an earlier build kept for the one library under the first project's id. Run once
 * the first project is known; it leaves a mark so a later project never takes over what is
 * left. Without storage, nothing happens.
 */
export function fileUnfiled(firstProjectId: string, storage: Storage | null = local()): void {
  if (!storage) return;
  try {
    if (storage.getItem(DONE)) return;
    const names: string[] = [];
    for (let i = 0; i < storage.length; i++) {
      const name = storage.key(i);
      if (name) names.push(name);
    }
    for (const name of names) {
      // A key already filed under a project (`…:<10 letters or digits>`) is left alone.
      const filed = /:[a-z0-9]{10}$/.test(name);
      const isPerson =
        PERSON_KINDS.some((k) => name.startsWith(`frontier.${k}:`)) && name.split(":").length === 2;
      const unfiled =
        EXACT.includes(name) || (PREFIXES.some((p) => name.startsWith(p)) && !filed) || isPerson;
      if (!unfiled) continue;
      const value = storage.getItem(name);
      if (value !== null) storage.setItem(`${name}:${firstProjectId}`, value);
      storage.removeItem(name);
    }
    storage.setItem(DONE, "1");
  } catch {
    /* storage is full or blocked: what is there stays unfiled and is not shown */
  }
}

function local(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}
