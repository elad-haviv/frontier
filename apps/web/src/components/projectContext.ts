import type { ProjectResponse, ProjectRole } from "@frontier/schema";
import { createContext, useContext } from "react";

/** What the app knows of the open project, from its record or, until that arrives, the list. */
export interface ProjectInfo {
  id: string;
  /** The address it has now. */
  slug: string;
  name: string;
  description: string;
  colour: number;
  /** The person's own role here. */
  role: ProjectRole;
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

/** The open project, or null on a page outside any project. */
export const useProjectOrNull = (): ProjectInfo | null => useContext(ProjectContext);

/** What a role is called in the app's words. */
export const ROLE_NAMES: Record<ProjectRole, string> = {
  owner: "Owner",
  writer: "Writer",
  reader: "Reader",
};
