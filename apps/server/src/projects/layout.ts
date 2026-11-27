/**
 * Where a project's files are, and which files in the data folder belong to the whole server and
 * which to one project.
 *
 * A project made after stage 27b lives under `DATA_DIR/projects/<id>/`:
 *
 *   library.git/   its repository (an own library)
 *   vault/         the working copy of `main`
 *   state/         working files: drafts, proposals, comments, conversations, ...
 *   assets/        what can be made again: thumbnails; and what cannot: generated art
 *
 * The first project is the library a server had before projects. It keeps the same four straight
 * under `DATA_DIR`, so an upgrade moves nothing, and its `state/` is the folder the server-wide
 * files are in as well. Which files in `DATA_DIR/state` are which:
 *
 *   SERVER-WIDE (`SERVER_STATE`): people.json (accounts), settings.json (AI models, rules for
 *     Keep going; AI prices), projects.json (the project store), ai-log/ (each person's spending),
 *     backup-server.json is not kept (see below).
 *   PROJECT (everything else in the folder, for the first project): drafts/, proposals/,
 *     quarantine/, pushed.json, conversations/, comments.json, consults.json, discoveries/,
 *     ai-cache/, question*, inbox/, backup.json (when the first project was last backed up).
 *
 * No service of a project is given a path outside its project's folder, except the first
 * project's `state`, which is the shared folder and is why its code goes through
 * `isServerState` wherever it lists or copies the folder.
 */
import { join, resolve, sep } from "node:path";
import type { ProjectRecord } from "@frontier/schema";

/** Entries of `DATA_DIR/state` that belong to the server, not to the first project. */
export const SERVER_STATE = ["people.json", "settings.json", "projects.json", "ai-log"] as const;

/** Whether a path inside a state folder (relative, with `/`) is a server-wide file. */
export function isServerState(rel: string): boolean {
  const top = rel.split("/")[0] ?? "";
  return (SERVER_STATE as readonly string[]).includes(top);
}

export interface ProjectPaths {
  /** The project's own folder; for the first project, the data folder itself. */
  root: string;
  /** The bare repository, when the project is an own library. */
  library: string;
  vault: string;
  state: string;
  /** Thumbnails and generated art. */
  assets: string;
}

/** The folder of a project made after stage 27b. */
export const projectFolder = (dataDir: string, id: string): string => join(dataDir, "projects", id);

export function pathsOf(
  dataDir: string,
  record: Pick<ProjectRecord, "id" | "layout">,
): ProjectPaths {
  const root = record.layout === "legacy" ? dataDir : projectFolder(dataDir, record.id);
  return {
    root,
    library: join(root, "library.git"),
    vault: join(root, "vault"),
    state: join(root, "state"),
    assets: join(root, "assets"),
  };
}

/** Whether `path` is inside `folder` (or is it). */
export function isInside(folder: string, path: string): boolean {
  const a = resolve(folder);
  const b = resolve(path);
  return b === a || b.startsWith(a + sep);
}
