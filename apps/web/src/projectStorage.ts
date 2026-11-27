/**
 * What this device remembers in the browser's own storage about one library (stage 27b): the
 * entries read lately, where reading stopped, the maps opened lately, a chronicle's folded
 * spans… Each is filed under the signed-in person and the project's id, so it neither shows in
 * another project nor in another person's session on a shared browser, and is not lost when the
 * address is renamed. Display settings of the device itself (bar widths, the map's curve) are not
 * a library's and are not filed here.
 *
 * What an earlier build kept unfiled belongs to the first person who signs in and is in the
 * project that was the library before projects, and is moved there once (`fileUnfiled`).
 */
import { keysOwner } from "./aiKeys.ts";
import { currentProject } from "./project.ts";

/**
 * The key of a library's value: `<name>:<person>:<project id>`. With no project open, the name
 * itself; with nobody signed in (only before login, when nothing of a library is read) no person.
 */
export function projectKey(
  name: string,
  id: string | undefined = currentProject()?.id,
  person: string | null = keysOwner(),
): string {
  if (!id) return name;
  return person ? `${name}:${person}:${id}` : `${name}:${id}`;
}

/** Keys an earlier build wrote for the one library, moved to the legacy project once. */
const EXACT = ["frontier.keepGoing.v1", "frontier.maps.recent", "frontier.discovery.ready"];
/** Families of keys, one per map or chronicle id. */
const PREFIXES = ["frontier.explore.", "frontier.chronicle."];
/** Values filed under a person (`frontier.<what>:<person>`) that now are the project's too. */
const PERSON_KINDS = ["pendingProposals", "folderRun"];

/** The mark that this person's unfiled keys were taken in: one for each person. */
const doneKey = (person: string) => `frontier.projects.filed:${person}`;

/**
 * Moves what an earlier build kept for the one library under the person and the legacy project.
 * Only the person who owns the device's old data calls this (`queue.legacyFor`), and only with
 * the id of the project that was the library before projects: no other project may take it. It
 * leaves a mark so it runs once. Keys already filed under a person are left alone. Without
 * storage, nothing happens.
 */
export function fileUnfiled(
  person: string,
  legacyProjectId: string,
  storage: Storage | null = local(),
): void {
  if (!storage) return;
  try {
    if (storage.getItem(doneKey(person))) return;
    const names: string[] = [];
    for (let i = 0; i < storage.length; i++) {
      const name = storage.key(i);
      if (name) names.push(name);
    }
    for (const name of names) {
      const move = (to: string) => {
        const value = storage.getItem(name);
        if (value !== null && storage.getItem(to) === null) storage.setItem(to, value);
        storage.removeItem(name);
      };
      // `<name>:<10 letters or digits>` is filed under a project but not yet under a person.
      const project = /^(.*):([a-z0-9]{10})$/.exec(name);
      const base = project?.[1] ?? name;
      const family = EXACT.includes(base) || PREFIXES.some((p) => base.startsWith(p));
      if (family && !project) {
        move(`${name}:${person}:${legacyProjectId}`);
      } else if (family && project && !project[1]!.includes(":")) {
        move(`${project[1]}:${person}:${project[2]}`);
      } else if (PERSON_KINDS.some((k) => name === `frontier.${k}:${person}`)) {
        move(`${name}:${legacyProjectId}`);
      }
    }
    storage.setItem(doneKey(person), "1");
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
