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
import { restoreEverything, restoreProject } from "../backup/restoreProjects.js";
import { FolderTarget, S3Target } from "../backup/targets.js";
import { loadConfig } from "../config.js";
import { applySampleMode } from "../sample.js";

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
const setup = { dataDir: config.dataDir, own: config.library === "own", target, from };

try {
  if (at >= 0 && !wanted) throw new Error("Say which project: --project <address>.");
  if (wanted === undefined) {
    const files = await restoreEverything(setup);
    console.error(`Restored ${files} files from ${from} into ${config.dataDir}.`);
  } else {
    const done = await restoreProject(setup, wanted);
    console.error(`Restored ${done.files} files of "${done.name}" from ${from}.`);
  }
} catch (err) {
  console.error(`Nothing was restored. ${(err as Error).message}`);
  process.exit(1);
}
