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
