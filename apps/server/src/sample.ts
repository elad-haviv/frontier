/**
 * Sample mode: runs Frontier on a made-up vault instead of a real one, for previews.
 *
 * With FRONTIER_SAMPLE_VAULT=1 the server makes a local Git repository from the bundled sample
 * vault and uses it as its remote. Nothing outside the container is read or written.
 */
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_SAMPLE = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../../packages/vault/test/fixture-vault",
);

/** Creates the sample remote if needed and returns its path. */
export function ensureSampleRemote(dataDir: string, sampleDir = DEFAULT_SAMPLE): string {
  const remote = join(dataDir, "sample-remote.git");
  if (existsSync(remote)) return remote;
  mkdirSync(dataDir, { recursive: true });
  const work = mkdtempSync(join(tmpdir(), "frontier-sample-"));
  const git = (cwd: string, ...args: string[]) =>
    execFileSync(
      "git",
      [
        "-c",
        "user.name=Frontier Sample",
        "-c",
        "user.email=sample@frontier.invalid",
        "-c",
        "core.autocrlf=false",
        ...args,
      ],
      { cwd, stdio: "ignore" },
    );
  try {
    cpSync(sampleDir, work, { recursive: true });
    git(work, "init", "--initial-branch=main");
    git(work, "add", "-A");
    git(work, "commit", "-m", "Sample vault");
    git(dataDir, "clone", "--bare", work, remote);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
  return remote;
}

/** Fills in the settings a sample run needs, so only a few variables have to be given. */
export function applySampleMode(env: NodeJS.ProcessEnv): void {
  if (env["FRONTIER_SAMPLE_VAULT"] !== "1") return;
  const dataDir = env["DATA_DIR"]?.trim() || "/data";
  env["VAULT_REMOTE_URL"] = ensureSampleRemote(dataDir);
  env["BACKUP_LOCAL_DIR"] ??= join(dataDir, "bucket");
  env["COMMIT_AUTHOR_NAME"] ??= "Sample Author";
  env["COMMIT_AUTHOR_EMAIL"] ??= "author@frontier.invalid";
  env["COMMIT_BOT_NAME"] ??= "frontier";
  env["COMMIT_BOT_EMAIL"] ??= "frontier@frontier.invalid";
}
