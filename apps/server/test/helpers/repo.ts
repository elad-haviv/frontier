import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const FIXTURE = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../../../packages/vault/test/fixture-vault",
);

const IDENTITY = [
  "-c",
  "user.name=Seed",
  "-c",
  "user.email=seed@example.com",
  "-c",
  "core.autocrlf=false",
];

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", [...IDENTITY, ...args], {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

export interface TestRepo {
  /** A temporary folder holding everything; removed by `cleanup`. */
  root: string;
  /** The bare repository that stands in for GitHub. */
  remote: string;
  /** Where the gateway under test keeps its working copy. Not created yet. */
  workdir: string;
  /** Makes a commit on the remote's `main` from outside, as Obsidian or an agent would. */
  pushFromOutside(changes: Record<string, string | null>, message?: string): string;
  /** The commit `main` is at on the remote. */
  remoteHead(): string;
  /** A file's content on the remote's `main`, or null. */
  remoteFile(path: string): string | null;
  /** Every file path on the remote's `main`. */
  remoteFiles(): string[];
  /** The commit message, author and committer of a commit on the remote. */
  remoteCommit(commit: string): {
    message: string;
    author: string;
    committer: string;
    parents: string[];
  };
  cleanup(): void;
}

/** A bare remote seeded with the fixture vault, plus an outside clone used to push to it. */
export function makeTestRepo(): TestRepo {
  const root = mkdtempSync(join(tmpdir(), "frontier-test-"));
  const remote = join(root, "remote.git");
  const outside = join(root, "outside");
  const workdir = join(root, "data", "vault");

  mkdirSync(remote);
  git(remote, "init", "--bare", "--initial-branch=main");
  cpSync(FIXTURE, outside, { recursive: true });
  git(outside, "init", "--initial-branch=main");
  git(outside, "add", "-A");
  git(outside, "commit", "-m", "Seed fixture vault");
  git(outside, "remote", "add", "origin", remote);
  git(outside, "push", "origin", "main");

  return {
    root,
    remote,
    workdir,
    pushFromOutside(changes, message = "Outside change") {
      git(outside, "pull", "--ff-only", "origin", "main");
      for (const [path, content] of Object.entries(changes)) {
        const full = join(outside, path);
        if (content === null) rmSync(full);
        else {
          mkdirSync(dirname(full), { recursive: true });
          writeFileSync(full, content);
        }
      }
      git(outside, "add", "-A");
      git(outside, "commit", "-m", message);
      git(outside, "push", "origin", "main");
      return git(outside, "rev-parse", "HEAD");
    },
    remoteHead: () => git(remote, "rev-parse", "refs/heads/main"),
    remoteFile(path) {
      try {
        return execFileSync("git", ["show", `refs/heads/main:${path}`], {
          cwd: remote,
          encoding: "utf8",
          stdio: ["ignore", "pipe", "pipe"],
        });
      } catch {
        return null;
      }
    },
    remoteFiles: () =>
      execFileSync(
        "git",
        ["-c", "core.quotepath=off", "ls-tree", "-r", "--name-only", "refs/heads/main"],
        {
          cwd: remote,
          encoding: "utf8",
        },
      )
        .split("\n")
        .filter((l) => l !== ""),
    remoteCommit(commit) {
      const out = git(remote, "show", "-s", "--format=%an <%ae>%n%cn <%ce>%n%P%n%B", commit).split(
        "\n",
      );
      return {
        author: out[0]!,
        committer: out[1]!,
        parents: out[2]!.split(" ").filter((p) => p !== ""),
        message: out.slice(3).join("\n").trim(),
      };
    },
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}
