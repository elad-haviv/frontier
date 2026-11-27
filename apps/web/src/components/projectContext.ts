import type { ProjectResponse, ProjectRole } from "@frontier/schema";
import { createContext, useContext, useMemo } from "react";
import { type RoleInfo, roleInfo } from "./projectRole.ts";

/** What the app knows of the open project, from its record or, until that arrives, the list. */
export interface ProjectInfo {
  id: string;
  /** The address it has now. */
  slug: string;
  name: string;
  description: string;
  colour: number;
  /** The person's own role here; null while it is not known (see `useRole`). */
  role: ProjectRole | null;
  /** The server's record (members, whether it can be deleted); null until it has been read. */
  record: ProjectResponse | null;
  /** Reads the record again, as after the owner changed it. */
  reload: () => void;
}

export const ProjectContext = createContext<ProjectInfo | null>(null);

/** The open project. Only for pages inside a project. */
export function useProject(): ProjectInfo {
  const info = useContext(ProjectContext);
  if (!info) throw new Error("useProject needs a project above it.");
  return info;
}

/**
 * What the person may do in the open project: `known` says whether the app has been told yet, and
 * `canWrite` and `isOwner` are false until it has, never a guess of "reader".
 */
export function useRole(): RoleInfo {
  const { role } = useProject();
  return useMemo(() => roleInfo(role), [role]);
}

/** The open project, or null on a page outside any project. */
export const useProjectOrNull = (): ProjectInfo | null => useContext(ProjectContext);

/** What a role is called in the app's words. */
export const ROLE_NAMES: Record<ProjectRole, string> = {
  owner: "Owner",
  writer: "Writer",
  reader: "Reader",
};

/**
 * Whether to draw the controls that change the project's text (new entry, edit, rename, move,
 * delete, map editing, upload, saving versions): writers and owners, never a reader and never
 * while the role is still unknown, so nobody sees a control flash and vanish.
 */
export const useCanWrite = (): boolean => useRole().canWrite;

/** The same, outside a project's pages (false there): for parts that may be drawn without one. */
export function useCanWriteOrNot(): boolean {
  const info = useContext(ProjectContext);
  return useMemo(() => roleInfo(info?.role ?? null).canWrite, [info?.role]);
}

/** Whether the person is known to be a reader here; false while the role is unknown. */
export const useIsReader = (): boolean => useRole().role === "reader";
