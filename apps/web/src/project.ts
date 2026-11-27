/**
 * Which project the app has open, and every address that depends on it (stage 27b).
 *
 * A project's pages live under `/p/<slug>/...`, and its server calls under `/api/p/<slug>/...`.
 * Nothing else in the app writes either prefix: pages write addresses as if there were one
 * library (`/e/Places/Harbor.md`, `/maps`), and `nav.tsx` (links and navigation) and `api.ts` (calls)
 * put the project in front through the one function here, `inProject`. What the app opens is set
 * once, by the project's route (`ProjectScope`), before anything under it draws, so a link or a
 * call made while it renders already knows the project.
 */
import { useSyncExternalStore } from "react";

/** The part of a project the address helpers and the device layer need. */
export interface ProjectRef {
  /** Never changes; the device files its copy of the project under it. */
  id: string;
  /** The address the project has now; it changes when the owner renames the address. */
  slug: string;
}

let current: ProjectRef | null = null;
const listeners = new Set<() => void>();
const changeListeners = new Set<(next: ProjectRef | null, previous: ProjectRef | null) => void>();

/** The project the app has open, or null on pages outside any project (All projects, Settings). */
export const currentProject = (): ProjectRef | null => current;

/** The open project's address, or null. */
export const currentSlug = (): string | null => current?.slug ?? null;

/**
 * Opens a project for the app, or none. Called by the project's route while it renders, so it
 * must be cheap and may be called again with the same project. A different project tells those
 * who keep state that belongs to one (`onProjectChange`).
 */
export function setCurrentProject(next: ProjectRef | null): void {
  const previous = current;
  if (previous?.id === next?.id && previous?.slug === next?.slug) return;
  current = next;
  for (const l of [...listeners]) l();
  if (previous?.id !== next?.id) for (const l of [...changeListeners]) l(next, previous);
}

/**
 * Hears that another project was opened (or none). Anything that keeps a library's data in the
 * page's memory (the pins, the names the link completion offers) lets go of it here, so nothing
 * of one project shows in another.
 */
export function onProjectChange(
  listener: (next: ProjectRef | null, previous: ProjectRef | null) => void,
): () => void {
  changeListeners.add(listener);
  return () => changeListeners.delete(listener);
}

/** Renders again when the open project, or its address, changes. */
export function useProjectRef(): ProjectRef | null {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => current,
    () => current,
  );
}

/** Addresses that are not a project's: they are what they say, in or out of a project. */
const OUTSIDE =
  /^\/(?:p\/|projects(?:[/?#]|$)|login(?:[/?#]|$)|join(?:[/?#]|$)|confirm(?:[/?#]|$)|reset(?:[/?#]|$)|forgot-password(?:[/?#]|$))/;

/** `/p/<slug>`, the front of every address of a project. */
export const projectRoot = (slug: string): string => `/p/${encodeURIComponent(slug)}`;

/**
 * The app address of something that is written as if there were one library: `/e/Notes.md` becomes
 * `/p/avalymia/e/Notes.md`. The root, `/`, is the project's Home. An address that already names a
 * project, or is outside any (`/projects`, `/login`), is returned as it is, and so is anything
 * that is not an absolute address (`?edit=1`, `#heading`). With no project open nothing is added:
 * the old-address redirect puts the address in a project.
 */
export function inProject(to: string, project: ProjectRef | null = current): string {
  if (!project || !to.startsWith("/") || to.startsWith("//") || OUTSIDE.test(to)) return to;
  const root = projectRoot(project.slug);
  if (to === "/") return root;
  return to.startsWith("/?") || to.startsWith("/#") ? `${root}${to.slice(1)}` : `${root}${to}`;
}

/** The same address as the open project's, for a place that needs a plain string (an `href`). */
export const appUrl = (to: string): string => inProject(to);

/**
 * An address of the app without its project: `/p/avalymia/e/Notes.md` is `/e/Notes.md`, and the
 * project's own root is `/`. What the pages' own pattern matching and the shell read, so none of
 * them must know about projects. Addresses outside a project are returned as they are.
 */
export function withoutProject(pathname: string): { slug: string | null; rest: string } {
  const m = /^\/p\/([^/]+)(\/.*)?$/.exec(pathname);
  if (!m) return { slug: null, rest: pathname };
  let slug = m[1]!;
  try {
    slug = decodeURIComponent(slug);
  } catch {
    /* the address is used as it is */
  }
  return { slug, rest: m[2] ?? "/" };
}

/**
 * Where an old address goes: the same page in a project, keeping the rest of the path, the query
 * and the hash. `/entry/...`-style addresses from before projects, `/maps`, `/` and the rest.
 */
export function movedInto(
  slug: string,
  location: { pathname: string; search: string; hash: string },
) {
  const rest = location.pathname === "/" ? "" : location.pathname;
  return `${projectRoot(slug)}${rest}${location.search}${location.hash}`;
}

/** Whether an address belongs to no project and is not one of the old addresses either. */
export function isOutsideProject(pathname: string): boolean {
  return /^\/(?:projects|settings|login|join|confirm|reset|forgot-password)(?:\/|$)/.test(pathname);
}
