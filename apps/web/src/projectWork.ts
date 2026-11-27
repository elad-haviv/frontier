/**
 * Work that belongs to the project it was started in (stage 27b).
 *
 * `api` and `queue`, as the pages import them, answer for the project that is open when a call is
 * made, which is right for a page that is on the screen. An action that waits (a read, a
 * confirmation, an upload) and then writes can find another project open by the time it goes on:
 * a person who switches while a save is on its way would otherwise see the second half land in
 * the project they went to. So an action takes `projectWork()` first, before its first `await`,
 * and uses `work.api` and `work.queue` for everything after: they are the calls and the save
 * queue of the project it began in, whichever is open now.
 */
import { useMemo } from "react";
import { apiFor, ApiFailure } from "./api.ts";
import { currentProject, type ProjectRef, useProjectRef } from "./project.ts";
import { queue, type Queue } from "./sync/queue.ts";

export interface ProjectWork {
  /** The project the work began in. */
  ref: ProjectRef;
  /** The server calls of that project. */
  api: ReturnType<typeof apiFor>;
  /** That project's own save queue. */
  queue: Queue;
  /** Whether that project is still the one open: for work that only matters on screen. */
  open: () => boolean;
}

/**
 * The calls and queue of a project, fixed now (the open one unless one is named). With no project
 * the work is empty: using `api` or `queue` on it is a mistake in the code and says so, as a call
 * with no project open does.
 */
export function projectWork(ref: ProjectRef | null = currentProject()): ProjectWork {
  const need = (): ProjectRef => {
    if (!ref) throw new ApiFailure(0, "no_project", "No project is open.");
    return ref;
  };
  return {
    get ref() {
      return need();
    },
    get api() {
      return apiFor(need().slug);
    },
    get queue() {
      return queue.queueOf(need());
    },
    open: () => ref !== null && currentProject()?.id === ref.id,
  };
}

/**
 * The same for a page or hook: fixed to the project the page was drawn for. Another project is a
 * whole new tree (`ProjectScope`), so this does not change while the page lives.
 */
export function useProjectWork(): ProjectWork {
  const ref = useProjectRef();
  const id = ref?.id;
  // The address may change (a rename) but the project does not.
  return useMemo(() => projectWork(ref), [id]);
}
