/**
 * What the person may do in a project, and how sure the app is (stage 27b).
 *
 * The role is known from the project's own record, else from the list of projects, else from what
 * this device remembered the last time it knew. Until one of those has arrived the role is
 * unknown, which is not the same as "reader": a writer must not look like a reader while the
 * record is on its way, and the shell must still be right with no connection.
 */
import { type ProjectRole, roleAtLeast } from "@frontier/schema";
import { readOwn, writeOwn } from "../personStorage.ts";

/** What the app can say about the person's role in a project. */
export interface RoleInfo {
  /** The role, or null while it is not known. */
  role: ProjectRole | null;
  /** True once a record, the list or the device's memory has said. */
  known: boolean;
  /** May change entries, maps and chronicles (writers and owners); false while unknown. */
  canWrite: boolean;
  /** May change the project itself (owners only); false while unknown. */
  isOwner: boolean;
}

export function roleInfo(role: ProjectRole | null): RoleInfo {
  return {
    role,
    known: role !== null,
    canWrite: role !== null && roleAtLeast(role, "writer"),
    isOwner: role === "owner",
  };
}

const WHAT = "role";
const asRole = (raw: unknown): ProjectRole | null =>
  raw === "owner" || raw === "writer" || raw === "reader" ? raw : null;

/** The role this device last knew for a project, for this person; null when it never did. */
export const rememberedRole = (projectId: string): ProjectRole | null =>
  readOwn(WHAT, asRole, projectId);

/** Keeps a role the app was told, so the next start is right before (or without) the server. */
export const rememberRole = (projectId: string, role: ProjectRole): void =>
  writeOwn(WHAT, role, projectId);

/** The role to use: the project's record, else the list, else what the device remembered. */
export function resolveRole(
  projectId: string,
  from: { record?: ProjectRole | null | undefined; summary?: ProjectRole | null | undefined },
): ProjectRole | null {
  return from.record ?? from.summary ?? rememberedRole(projectId);
}
