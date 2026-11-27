/**
 * Fills an empty data folder from the backup.
 *
 *   npm run restore -w apps/server                          everything, from the latest copy
 *   npm run restore -w apps/server -- 2026-11-20            everything, from that night's copy
 *   npm run restore -w apps/server -- --project avalymia    one project (its address or id)
 *
 * Everything is the first project and the server's own files (accounts, settings, the project
 * list), which share the old layout, and every project made since, each from its own prefix in
 * the backup. One project needs the project list to be here already (restore everything first
 * on a new disk), and its folders to be empty.
 *
 * Uses the same environment variables as the server. Run it while the server is stopped.
 */
import { join } from "node:path";
import { ProjectsFile, type ProjectRecord } from "@frontier/schema";
import { restore } from "../backup/backup.js";
import { FolderTarget, S3Target } from "../backup/targets.js";
import { loadConfig } from "../config.js";
import { backupPlan, backupSources, PrefixedTarget } from "../app.js";
import { isServerState } from "../projects/layout.js";
import { applySampleMode } from "../sample.js";
import { StateFiles } from "../state/files.js";

applySampleMode(process.env);
const config = loadConfig();
const target =
  config.backup.kind === "local"
    ? new FolderTarget(config.backup.dir)
    : new S3Target(config.backup.s3);

const args = process.argv.slice(2);
const at = args.indexOf("--project");
const wanted = at >= 0 ? args[at + 1] : undefined;
const from = args.find((a, i) => !a.startsWith("--") && i !== at + 1) ?? "latest";

/** The first project's files: the old layout, without the server's own files that share it. */
const restoreFirst = (everything: boolean) =>
  restore(
    target,
    backupSources(config.dataDir, config.library === "own"),
    from,
    everything ? () => true : (name, rel) => !(name === "state" && isServerState(rel)),
  );

const restoreOf = (record: Pick<ProjectRecord, "id" | "layout">) => {
  const plan = backupPlan(config.dataDir, record, true);
  return restore(new PrefixedTarget(target, plan.prefix), plan.sources, from);
};

try {
  let files = 0;
  if (wanted === undefined) {
    files += (await restoreFirst(true)).files;
    const ids = new Set(
      (await target.list("projects/"))
        .map((k) => /^projects\/([a-z0-9]{10})\//.exec(k)?.[1])
        .filter((id): id is string => id !== undefined),
    );
    for (const id of ids) files += (await restoreOf({ id, layout: "folder" })).files;
    console.error(`Restored ${files} files from ${from} into ${config.dataDir}.`);
  } else {
    const list = await new StateFiles().readJson(
      join(config.dataDir, "state", "projects.json"),
      ProjectsFile,
    );
    const record = list?.projects.find((p) => p.slug === wanted || p.id === wanted);
    if (!record) {
      throw new Error(
        `There is no project "${wanted}" in the project list. On a new disk, restore everything first.`,
      );
    }
    files = (record.layout === "legacy" ? await restoreFirst(false) : await restoreOf(record))
      .files;
    console.error(`Restored ${files} files of "${record.name}" from ${from}.`);
  }
} catch (err) {
  console.error(`Nothing was restored. ${(err as Error).message}`);
  process.exit(1);
}
