/**
 * The only module that runs Git. Every operation runs under one lock, one at a time.
 *
 * The working copy is never edited and never holds a local commit: it always equals the last
 * fetched `main`. Commits are built in a temporary index and pushed directly.
 */
import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export type GitErrorCode =
  "git_busy" | "main_moved" | "push_failed" | "merge_failed" | "git_failed";

export class GitError extends Error {
  constructor(
    readonly code: GitErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "GitError";
  }
}

export interface Identity {
  name: string;
  email: string;
}

export interface GatewayOptions {
  /** Folder of the working copy, such as /data/vault. */
  dir: string;
  remoteUrl: string;
  /** Returns the token for the remote, or null when the remote needs none. */
  token?: () => Promise<string | null>;
  author: Identity;
  committer: Identity;
  /** How long an operation may wait for the lock. */
  lockTimeoutMs?: number;
  /** Called with the arguments of every Git command. Used by tests. */
  onCommand?: (args: readonly string[]) => void;
}

export interface ChangedFile {
  status: "added" | "modified" | "deleted";
  path: string;
}

export interface FetchResult {
  previous: string | null;
  current: string;
  changed: ChangedFile[];
}

export interface CommitChanges {
  writes: { path: string; content: Buffer }[];
  deletes: string[];
}

export interface MergeResult {
  clean: boolean;
  /** The merged text. With `clean` false it contains conflict markers. */
  text: string;
}

interface RunOptions {
  cwd?: string;
  env?: Record<string, string>;
  input?: Buffer | string;
  /** Exit codes that are returned to the caller, not thrown. */
  allow?: (code: number) => boolean;
  remote?: boolean;
}

interface RunResult {
  code: number;
  stdout: Buffer;
  stderr: string;
}

const MAX_BUFFER = 256 * 1024 * 1024;

export class GitGateway {
  private tail: Promise<unknown> = Promise.resolve();
  private readonly lockTimeoutMs: number;

  constructor(private readonly opts: GatewayOptions) {
    this.lockTimeoutMs = opts.lockTimeoutMs ?? 60_000;
  }

  /** Runs `fn` when every earlier operation has finished. Fails with `git_busy` if the wait is too long. */
  private locked<T>(fn: () => Promise<T>): Promise<T> {
    const previous = this.tail;
    let release!: () => void;
    const mine = new Promise<void>((resolve) => (release = resolve));
    this.tail = previous.then(() => mine);

    return new Promise<T>((resolve, reject) => {
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        reject(
          new GitError("git_busy", "Another Git operation is still running. Try again shortly."),
        );
      }, this.lockTimeoutMs);
      void previous.then(async () => {
        clearTimeout(timer);
        if (timedOut) {
          release();
          return;
        }
        try {
          resolve(await fn());
        } catch (err) {
          reject(err);
        } finally {
          release();
        }
      });
    });
  }

  private async remoteEnv(): Promise<Record<string, string>> {
    const token = this.opts.token ? await this.opts.token() : null;
    if (!token) return {};
    // Passed through the environment so the token never appears on a command line or on disk.
    const basic = Buffer.from(`x-access-token:${token}`).toString("base64");
    return {
      GIT_CONFIG_COUNT: "1",
      GIT_CONFIG_KEY_0: "http.https://github.com/.extraheader",
      GIT_CONFIG_VALUE_0: `Authorization: Basic ${basic}`,
    };
  }

  private async run(args: string[], options: RunOptions = {}): Promise<RunResult> {
    this.opts.onCommand?.(args);
    const env: Record<string, string> = {
      ...(process.env as Record<string, string>),
      GIT_TERMINAL_PROMPT: "0",
      LC_ALL: "C",
      ...(options.remote ? await this.remoteEnv() : {}),
      ...options.env,
    };
    return new Promise<RunResult>((resolve, reject) => {
      const child = execFile(
        "git",
        ["-c", "core.quotepath=off", ...args],
        { cwd: options.cwd ?? this.opts.dir, env, encoding: "buffer", maxBuffer: MAX_BUFFER },
        (error, stdout, stderr) => {
          const err = error as (Error & { code?: number | string }) | null;
          const code = err === null ? 0 : typeof err.code === "number" ? err.code : -1;
          const result = { code, stdout, stderr: stderr.toString("utf8") };
          if (code === 0 || options.allow?.(code)) resolve(result);
          else
            reject(
              new GitError(
                "git_failed",
                `git ${args[0]} failed: ${result.stderr.trim() || err?.message}`,
              ),
            );
        },
      );
      if (options.input !== undefined) child.stdin?.end(options.input);
    });
  }

  private async text(args: string[], options: RunOptions = {}): Promise<string> {
    return (await this.run(args, options)).stdout.toString("utf8").trim();
  }

  /** Clones the vault on first start. Does nothing when the working copy exists. */
  ensureClone(): Promise<void> {
    return this.locked(async () => {
      if (existsSync(join(this.opts.dir, ".git"))) return;
      await this.run(["clone", "--branch", "main", this.opts.remoteUrl, this.opts.dir], {
        cwd: tmpdir(),
        remote: true,
      });
    });
  }

  /** The commit the working copy is at. */
  head(): Promise<string> {
    return this.locked(() => this.text(["rev-parse", "HEAD"]));
  }

  /** Fetches `main` and resets the working copy to it. Returns the files that changed since last time. */
  fetch(): Promise<FetchResult> {
    return this.locked(() => this.fetchUnlocked());
  }

  private async fetchUnlocked(): Promise<FetchResult> {
    const previous = await this.text(["rev-parse", "HEAD"]);
    await this.run(["fetch", "origin", "main"], { remote: true });
    const current = await this.text(["rev-parse", "origin/main"]);
    await this.run(["reset", "--hard", "origin/main"]);
    await this.run(["clean", "-fd"]);
    const changed: ChangedFile[] = [];
    if (previous !== current) {
      const out = (
        await this.run(["diff", "--name-status", "--no-renames", "-z", previous, current])
      ).stdout;
      const parts = out.toString("utf8").split("\0");
      for (let i = 0; i + 1 < parts.length; i += 2) {
        const letter = parts[i]!;
        const status = letter === "A" ? "added" : letter === "D" ? "deleted" : "modified";
        changed.push({ status, path: parts[i + 1]! });
      }
    }
    return { previous, current, changed };
  }

  /** Every file path at a commit. */
  listFiles(commit = "HEAD"): Promise<string[]> {
    return this.locked(async () => {
      const out = (await this.run(["ls-tree", "-r", "-z", "--name-only", commit])).stdout.toString(
        "utf8",
      );
      return out.split("\0").filter((p) => p !== "");
    });
  }

  /** The bytes of a file at a commit, or null when it does not exist there. */
  readFile(path: string, commit = "HEAD"): Promise<Buffer | null> {
    return this.locked(async () => {
      const r = await this.run(["show", `${commit}:${path}`], { allow: (c) => c === 128 });
      return r.code === 0 ? r.stdout : null;
    });
  }

  /** The bytes of a blob by its hash, or null when the repository does not hold it. */
  readBlob(hash: string): Promise<Buffer | null> {
    return this.locked(async () => {
      if (!/^[0-9a-f]{40,64}$/.test(hash)) return null;
      const r = await this.run(["cat-file", "blob", hash], { allow: (c) => c === 128 });
      return r.code === 0 ? r.stdout : null;
    });
  }

  /** The blob hash of a file at a commit, or null when it does not exist there. */
  blobHash(path: string, commit = "HEAD"): Promise<string | null> {
    return this.locked(async () => {
      const r = await this.run(["rev-parse", "--verify", "--quiet", `${commit}:${path}`], {
        allow: (c) => c === 1 || c === 128,
      });
      return r.code === 0 ? r.stdout.toString("utf8").trim() : null;
    });
  }

  /** The blob hash Git would give these bytes. */
  hashOf(content: Buffer): Promise<string> {
    return this.locked(() =>
      this.text(["hash-object", "--no-filters", "--stdin"], { input: content }),
    );
  }

  /**
   * Builds a commit on top of the fetched `main` without changing the working copy.
   * Returns the new commit's hash. The commit is not on any branch until it is pushed.
   */
  commit(changes: CommitChanges, message: string): Promise<string> {
    return this.locked(async () => {
      if (changes.writes.length === 0 && changes.deletes.length === 0) {
        throw new GitError("git_failed", "There is nothing to commit.");
      }
      const scratch = await mkdtemp(join(tmpdir(), "frontier-index-"));
      const env = { GIT_INDEX_FILE: join(scratch, "index") };
      try {
        const parent = await this.text(["rev-parse", "origin/main"]);
        await this.run(["read-tree", parent], { env });
        for (const path of changes.deletes) {
          await this.run(["update-index", "--force-remove", "--", path], { env });
        }
        for (const w of changes.writes) {
          const blob = await this.text(["hash-object", "-w", "--no-filters", "--stdin"], {
            input: w.content,
          });
          await this.run(["update-index", "--add", "--cacheinfo", `100644,${blob},${w.path}`], {
            env,
          });
        }
        const tree = await this.text(["write-tree"], { env });
        return await this.text(["commit-tree", tree, "-p", parent, "-m", message], {
          env: {
            GIT_AUTHOR_NAME: this.opts.author.name,
            GIT_AUTHOR_EMAIL: this.opts.author.email,
            GIT_COMMITTER_NAME: this.opts.committer.name,
            GIT_COMMITTER_EMAIL: this.opts.committer.email,
          },
        });
      } finally {
        await rm(scratch, { recursive: true, force: true });
      }
    });
  }

  /**
   * Pushes a commit to `main`. Never forces. Throws `main_moved` when the remote has commits the
   * commit was not built on, and `push_failed` for any other failure.
   */
  push(commit: string): Promise<void> {
    return this.locked(async () => {
      const r = await this.run(["push", "--porcelain", "origin", `${commit}:refs/heads/main`], {
        remote: true,
        allow: () => true,
      });
      if (r.code === 0) return;
      const out = r.stdout.toString("utf8") + r.stderr;
      if (
        /^!.*\[(rejected|remote rejected)\]/m.test(out) &&
        /fetch first|non-fast-forward|stale info/.test(out)
      ) {
        throw new GitError("main_moved", "The vault changed on GitHub while you were publishing.");
      }
      throw new GitError(
        "push_failed",
        `The push did not go through: ${firstLine(r.stderr) || firstLine(out)}`,
      );
    });
  }

  /**
   * Three-way merge of one text file. All three texts must have "\n" line endings.
   * `clean` is false when the two sides changed the same place.
   */
  mergeFile(draft: string, base: string, main: string): Promise<MergeResult> {
    return this.locked(async () => {
      const scratch = await mkdtemp(join(tmpdir(), "frontier-merge-"));
      try {
        const [a, b, c] = [join(scratch, "draft"), join(scratch, "base"), join(scratch, "main")];
        await Promise.all([writeFile(a, draft), writeFile(b, base), writeFile(c, main)]);
        const r = await this.run(
          ["merge-file", "-p", "--diff3", "-L", "yours", "-L", "base", "-L", "theirs", a, b, c],
          {
            cwd: scratch,
            allow: (code) => code >= 1 && code <= 127,
          },
        ).catch((err: unknown) => {
          throw new GitError("merge_failed", `The merge tool failed: ${(err as Error).message}`);
        });
        return { clean: r.code === 0, text: r.stdout.toString("utf8") };
      } finally {
        await rm(scratch, { recursive: true, force: true });
      }
    });
  }
}

function firstLine(s: string): string {
  return (
    s
      .split("\n")
      .find((l) => l.trim() !== "")
      ?.trim() ?? ""
  );
}
