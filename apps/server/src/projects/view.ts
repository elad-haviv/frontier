import { AsyncLocalStorage } from "node:async_hooks";

/**
 * The saved view: what a reader sees. A reader gets the last saved version of everything, never
 * anyone's unsaved changes (drafts, renames waiting, kept copies from other devices). Rather than
 * ask every read route to remember that, the draft store itself answers "nothing" while a
 * reader's request is being served, so a route written for a writer cannot leak a draft by
 * forgetting a check. `facade.ts` runs a reader's handler inside `asSavedView`.
 *
 * It lasts as long as the handler's own promise chain. A reader's request never writes a draft
 * (the role table keeps those routes for writers), so hiding the drafts costs nothing.
 */
const saved = new AsyncLocalStorage<true>();

export const asSavedView = <T>(work: () => T): T => saved.run(true, work);

/** True while serving a request that may see only what is saved. */
export const savedViewOnly = (): boolean => saved.getStore() === true;

/**
 * Runs `work` outside the saved view, whatever request started it. For what is shared by everyone
 * and only happens to be started by a reader's request (a timer, the status snapshot everyone is
 * sent): it must not be computed as the reader sees things.
 */
export const outsideSavedView = <T>(work: () => T): T => saved.exit(work);

/**
 * Whose unsaved changes a request works with (stage 31d). Each person has their own: the draft
 * store answers for the person set here and nobody else, so a route written as if there were one
 * author cannot reach another person's draft by id, by path or by listing. `facade.ts` runs every
 * handler inside `asPerson` with the session's person.
 *
 * Outside a request nothing is set, and the store speaks for the project's first owner: the
 * single author of a library from before people (scripts and tests that call a service directly).
 * What must touch everyone's work (clearing what reached the library, the sweep of people who
 * left) goes through `DraftStore.eachPerson` and says so.
 */
const person = new AsyncLocalStorage<{ id: string }>();

export const asPerson = <T>(id: string, work: () => T): T => person.run({ id }, work);

/** The person whose request is being served, or null outside one. */
export const currentPersonId = (): string | null => person.getStore()?.id ?? null;
