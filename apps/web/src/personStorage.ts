/**
 * Small things this device remembers for the signed-in person, such as proposals still to make
 * (stage 31f). They are filed under the person's id and the project's, so the next login on a shared browser neither
 * reads nor continues them. Where storage is blocked they are simply not remembered.
 */
import { keysOwner } from "./aiKeys.ts";
import { currentProject } from "./project.ts";

/**
 * Filed under the person and the project: `frontier.<what>:<person>:<project id>`. With no
 * project open there is nothing of a library to keep, so nothing is read or written.
 */
const name = (what: string, person: string, project: string) =>
  `frontier.${what}:${person}:${project}`;

/**
 * What was kept under this name for the signed-in person in a project (the open one, unless one
 * is named: work that goes on while the person moves to another project names its own), or null.
 */
export function readOwn<T>(
  what: string,
  valid: (raw: unknown) => T | null,
  project: string | undefined = currentProject()?.id,
): T | null {
  const person = keysOwner();
  if (!person || !project) return null;
  try {
    const text = localStorage.getItem(name(what, person, project));
    return text ? valid(JSON.parse(text)) : null;
  } catch {
    return null;
  }
}

/** Keeps a value for the signed-in person; null removes it. */
export function writeOwn(
  what: string,
  value: unknown,
  project: string | undefined = currentProject()?.id,
): void {
  const person = keysOwner();
  if (!person || !project) return;
  try {
    if (value === null) localStorage.removeItem(name(what, person, project));
    else localStorage.setItem(name(what, person, project), JSON.stringify(value));
  } catch {
    /* not remembered */
  }
}
