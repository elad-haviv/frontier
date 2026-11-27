import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { ProjectsFile, type ProjectRecord } from "@frontier/schema";
import { backupPlan, backupSources, PrefixedTarget } from "../projects/services.js";
import { isServerState } from "../projects/layout.js";
import { StateFiles } from "../state/files.js";
import { restore } from "./backup.js";
import type { BackupTarget } from "./targets.js";

export interface RestoreSetup {
  dataDir: string;
  /** Whether the first project is an own library, so that its repository is in the backup. */
  own: boolean;
  target: BackupTarget;
  /** "latest" or a night such as "2026-11-20". */
  from: string;
}

/**
 * The first project's files: the old layout, with the server's own files that share its state
 * folder. For the whole server both are restored; for the project alone, only its own.
 */
async function restoreFirst(d: RestoreSetup, withServerFiles: boolean) {
  const sources = backupSources(d.dataDir, d.own);
  const done = await restore(
    d.target,
    sources,
    d.from,
    withServerFiles ? undefined : (name, rel) => !(name === "state" && isServerState(rel)),
  );
  await mendRepository(sources["library"]);
  return done;
}

async function restoreFolder(d: RestoreSetup, record: Pick<ProjectRecord, "id" | "layout">) {
  const plan = backupPlan(d.dataDir, record, true);
  const done = await restore(new PrefixedTarget(d.target, plan.prefix), plan.sources, d.from);
  await mendRepository(plan.sources["library"]);
  return done;
}

/**
 * A backup holds files, not empty folders, and a bare repository is not one to Git without its
 * `refs` and `objects` folders, which are empty when everything is packed. They are made again.
 */
async function mendRepository(path: string | undefined): Promise<void> {
  if (!path || !existsSync(join(path, "HEAD"))) return;
  for (const dir of ["refs/heads", "refs/tags", "objects/info", "objects/pack"]) {
    await mkdir(join(path, dir), { recursive: true });
  }
}

/**
 * Everything: the first project and the server's own files, then every project made since that
 * the backup holds, each from its own prefix. Returns how many files came back.
 */
export async function restoreEverything(d: RestoreSetup): Promise<number> {
  let files = (await restoreFirst(d, true)).files;
  const ids = new Set(
    (await d.target.list("projects/"))
      .map((k) => /^projects\/([a-z0-9]{10})\//.exec(k)?.[1])
      .filter((id): id is string => id !== undefined),
  );
  for (const id of ids) files += (await restoreFolder(d, { id, layout: "folder" })).files;
  return files;
}

/** One project, by its address or id, which the project list in the data folder must know. */
export async function restoreProject(
  d: RestoreSetup,
  which: string,
): Promise<{ files: number; name: string }> {
  const list = await new StateFiles().readJson(
    join(d.dataDir, "state", "projects.json"),
    ProjectsFile,
  );
  const record = list?.projects.find((p) => p.slug === which || p.id === which);
  if (!record) {
    throw new Error(
      `There is no project "${which}" in the project list. On a new disk, restore everything first.`,
    );
  }
  const done =
    record.layout === "legacy" ? await restoreFirst(d, false) : await restoreFolder(d, record);
  return { files: done.files, name: record.name };
}
