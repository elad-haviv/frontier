/**
 * Fills an empty data folder from the backup.
 *
 *   npm run restore -w apps/server            from the latest copy
 *   npm run restore -w apps/server -- 2026-11-20    from that night's copy
 *
 * Uses the same environment variables as the server. Run it while the server is stopped.
 */
import { restore } from "../backup/backup.js";
import { FolderTarget, S3Target } from "../backup/targets.js";
import { loadConfig } from "../config.js";
import { backupSources } from "../app.js";
import { applySampleMode } from "../sample.js";

applySampleMode(process.env);
const config = loadConfig();
const target =
  config.backup.kind === "local"
    ? new FolderTarget(config.backup.dir)
    : new S3Target(config.backup.s3);

try {
  const result = await restore(target, backupSources(config.dataDir), process.argv[2] ?? "latest");
  console.error(`Restored ${result.files} files from ${result.from} into ${config.dataDir}.`);
} catch (err) {
  console.error(`Nothing was restored. ${(err as Error).message}`);
  process.exit(1);
}
