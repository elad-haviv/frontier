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
  /**
   * How long a fetch or a push may take before it is stopped (default 90 seconds), and a first clone
   * (default 10 minutes). A command that talks to the remote holds the one lock, so one that hangs
   * would otherwise make every other read and save wait until it gave up.
   */
  remoteTimeoutMs?: number;
  cloneTimeoutMs?: number;
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

/** One saved version of the library. */
export interface Version {
  commit: string;
  at: string;
  message: string;
  paths: string[];
  /** Who Git says made it (the commit's author). Never sent to the browser as it is: see `publish/authors.ts`. */
  author: Identity;
}

/** One saved version of a file: the commit, when, and who Git says made it. */
export interface SavedChange {
  commit: string;
  at: string;
  author: Identity;
}

const changeOf = ([commit, at, name, email]: string[]): SavedChange => ({
  commit: commit ?? "",
  at: at ?? "",
  author: { name: name ?? "", email: email ?? "" },
});

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
  /** Stops the command after this long (for those that talk to the remote). */
  timeoutMs?: number;
}

interface RunResult {
  code: number;
  stdout: Buffer;
  stderr: string;
}

const MAX_BUFFER = 256 * 1024 * 1024;

/** A fetch or a push that takes longer than this is stopped: 90 seconds, far more than a healthy one needs. */
export const REMOTE_TIMEOUT_MS = 90_000;
/** A first clone may be a large library: 10 minutes. */
export const CLONE_TIMEOUT_MS = 10 * 60_000;

/** Only branches under this name are read as proposals from agents. */
export const PROPOSAL_PREFIX = "proposal/";

function parseNameStatus(out: Buffer): ChangedFile[] {
  const changed: ChangedFile[] = [];
  const parts = out.toString("utf8").split("\0");
  for (let i = 0; i + 1 < parts.length; i += 2) {
    const letter = parts[i]!;
    const status = letter === "A" ? "added" : letter === "D" ? "deleted" : "modified";
    changed.push({ status, path: parts[i + 1]! });
  }
  return changed;
}

/** One commit of the log with the Markdown files it added, changed or deleted. */
export interface LoggedCommit {
  commit: string;
  /** The commit's time, ISO 8601. */
  at: string;
  changes: {
    /** "R" is a rename: `path` is the new name and `from` the old one. */
    status: "A" | "M" | "D" | "R";
    path: string;
    from?: string;
    /** For a rename: whether the text changed too, not only the name. */
    edited?: boolean;
  }[];
}

/** What one commit did to the words of each Markdown file it touched. */
export interface WordCommit {
  commit: string;
  at: string;
  files: { path: string; created: boolean; deleted: boolean; added: number; removed: number }[];
}

function parseChangeLog(out: string): LoggedCommit[] {
  return out
    .split("\u0001")
    .filter((part) => part.trim() !== "")
    .map((part) => {
      const [head = "", ...lines] = part.split("\n");
      const [commit = "", at = ""] = head.split("\u0002");
      const changes: LoggedCommit["changes"] = [];
      for (const line of lines) {
        const tab = line.indexOf("\t");
        if (tab === -1) continue;
        const letter = line.slice(0, tab);
        const names = line.slice(tab + 1).split("\t");
        if (letter.startsWith("R") && names.length === 2) {
          changes.push({
            status: "R",
            path: names[1]!,
            from: names[0]!,
            edited: letter !== "R100",
          });
          continue;
        }
        changes.push({
          status: letter === "A" ? "A" : letter === "D" ? "D" : "M",
          path: names[names.length - 1]!,
        });
      }
      return { commit, at, changes };
    });
}

/**
 * Reads the output of `git log -z` whose format is `%x00` and then `fields` placeholders joined by
 * `%x00`, optionally with `--name-only` or `--raw`. Every free-text field (a name, a subject) is
 * split off by NUL, which Git never lets into one, so a control character in an author's name
 * cannot shift the fields or the paths. A commit starts at an empty token (a path is never empty),
 * takes the next `fields` tokens, and then every token up to the next empty one is a path (or, for
 * `--raw`, a `:mode mode old new status` token and then its path).
 */
export function parseLogZ(out: string, fields: number): { fields: string[]; rest: string[] }[] {
  const tokens = out.split("\0");
  const commits: { fields: string[]; rest: string[] }[] = [];
  let i = 0;
  while (i < tokens.length) {
    if (tokens[i] !== "") {
      i++;
      continue;
    }
    i++;
    if (i + fields > tokens.length) break;
    const head = tokens.slice(i, i + fields);
    i += fields;
    const rest: string[] = [];
    while (i < tokens.length && tokens[i] !== "") rest.push(tokens[i++]!);
    // Git puts a newline between the format and the first path.
    if (rest[0]?.startsWith("\n")) rest[0] = rest[0].slice(1);
    commits.push({ fields: head, rest });
  }
  return commits;
}

const wordsIn = (line: string): number => line.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu)?.length ?? 0;

function parseWordChanges(out: string): WordCommit[] {
  return out
    .split("\u0001")
    .filter((part) => part.trim() !== "")
    .map((part) => {
      const [head = "", ...lines] = part.split("\n");
      const [commit = "", at = ""] = head.split("\u0002");
      const files: WordCommit["files"] = [];
      let file: WordCommit["files"][number] | null = null;
      for (const line of lines) {
        if (line.startsWith("diff --git ")) {
          // "diff --git a/<path> b/<path>": the two halves are the same path for a plain change.
          const both = line.slice("diff --git ".length);
          const half = (both.length - 1) / 2;
          file = {
            path: both.slice(half + 3),
            created: false,
            deleted: false,
            added: 0,
            removed: 0,
          };
          files.push(file);
        } else if (!file) continue;
        else if (line.startsWith("rename to ")) file.path = line.slice("rename to ".length);
        else if (line.startsWith("new file mode")) file.created = true;
        else if (line.startsWith("deleted file mode")) file.deleted = true;
        else if (line.startsWith("+++") || line.startsWith("---")) continue;
        else if (line.startsWith("+")) file.added += wordsIn(line.slice(1));
        else if (line.startsWith("-")) file.removed += wordsIn(line.slice(1));
      }
      return { commit, at, files };
    });
}

export class GitGateway {
  private tail: Promise<unknown> = Promise.resolve();
  private readonly lockTimeoutMs: number;
  private readonly remoteTimeoutMs: number;
  private readonly cloneTimeoutMs: number;

  constructor(private readonly opts: GatewayOptions) {
    this.lockTimeoutMs = opts.lockTimeoutMs ?? 60_000;
    this.remoteTimeoutMs = opts.remoteTimeoutMs ?? REMOTE_TIMEOUT_MS;
    this.cloneTimeoutMs = opts.cloneTimeoutMs ?? CLONE_TIMEOUT_MS;
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
        {
          cwd: options.cwd ?? this.opts.dir,
          env,
          encoding: "buffer",
          maxBuffer: MAX_BUFFER,
          // Killed outright: Git's helpers (ssh, the HTTPS transport) ignore a polite stop.
          ...(options.timeoutMs !== undefined
            ? { timeout: options.timeoutMs, killSignal: "SIGKILL" as const }
            : {}),
        },
        (error, stdout, stderr) => {
          const err = error as (Error & { code?: number | string; killed?: boolean }) | null;
          if (err?.killed && options.timeoutMs !== undefined) {
            reject(
              new GitError(
                "git_failed",
                `git ${args[0]} took longer than ${Math.round(options.timeoutMs / 1000)} seconds and was stopped.`,
              ),
            );
            return;
          }
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
        timeoutMs: this.cloneTimeoutMs,
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
    // Agents' proposal branches come with every fetch; a branch removed on the remote goes here too.
    await this.run(
      [
        "fetch",
        "--prune",
        "origin",
        "+refs/heads/main:refs/remotes/origin/main",
        `+refs/heads/${PROPOSAL_PREFIX}*:refs/remotes/origin/${PROPOSAL_PREFIX}*`,
      ],
      { remote: true, timeoutMs: this.remoteTimeoutMs },
    );
    const current = await this.text(["rev-parse", "origin/main"]);
    await this.run(["reset", "--hard", "origin/main"]);
    await this.run(["clean", "-fd"]);
    const changed: ChangedFile[] = [];
    if (previous !== current) {
      const out = (
        await this.run(["diff", "--name-status", "--no-renames", "-z", previous, current])
      ).stdout;
      changed.push(...parseNameStatus(out));
    }
    return { previous, current, changed };
  }

  /** The proposal branches on the remote as of the last fetch, by name. */
  proposalBranches(): Promise<{ name: string; tip: string }[]> {
    return this.locked(async () => {
      const out = await this.text([
        "for-each-ref",
        "--format=%(objectname) %(refname)",
        `refs/remotes/origin/${PROPOSAL_PREFIX}`,
      ]);
      return out
        .split("\n")
        .filter((l) => l !== "")
        .map((l) => {
          const space = l.indexOf(" ");
          return {
            tip: l.slice(0, space),
            name: l.slice(space + 1 + "refs/remotes/origin/".length),
          };
        })
        .sort((a, b) => a.name.localeCompare(b.name));
    });
  }

  /** The commit where a branch left `main`, or null when the two share no history. */
  forkPoint(commit: string): Promise<string | null> {
    return this.locked(async () => {
      const r = await this.run(["merge-base", "origin/main", commit], { allow: (c) => c === 1 });
      return r.code === 0 ? r.stdout.toString("utf8").trim() : null;
    });
  }

  /** The files that differ between two commits. A moved file shows as one removed and one added. */
  diffFiles(from: string, to: string): Promise<ChangedFile[]> {
    return this.locked(async () =>
      parseNameStatus(
        (await this.run(["diff", "--name-status", "--no-renames", "-z", from, to])).stdout,
      ),
    );
  }

  /** Each commit after `from` up to `to`, with the files it changed. */
  commitsBetween(from: string, to: string): Promise<{ commit: string; paths: string[] }[]> {
    return this.locked(async () => {
      const out = (
        await this.run([
          "log",
          "--no-renames",
          "--name-only",
          "-z",
          "--format=%x01%H",
          `${from}..${to}`,
        ])
      ).stdout.toString("utf8");
      return out
        .split("\u0001")
        .filter((part) => part !== "")
        .map((part) => {
          const [commit, ...paths] = part.split(/[\0\n]/).filter((x) => x !== "");
          return { commit: commit!, paths };
        });
    });
  }

  /** The first lines of the commit messages after `from` up to `to`, oldest first. */
  subjects(from: string, to: string): Promise<string[]> {
    return this.locked(async () =>
      (await this.text(["log", "--reverse", "--format=%s", `${from}..${to}`]))
        .split("\n")
        .filter((l) => l !== ""),
    );
  }

  /** Removes a proposal branch from the remote. This deletes a branch; it rewrites nothing. */
  deleteProposalBranch(name: string): Promise<void> {
    return this.locked(async () => {
      if (!name.startsWith(PROPOSAL_PREFIX)) {
        throw new GitError("git_failed", "Only proposal branches are removed.");
      }
      const r = await this.run(["push", "--porcelain", "origin", `:refs/heads/${name}`], {
        remote: true,
        allow: () => true,
        timeoutMs: this.remoteTimeoutMs,
      });
      const out = r.stdout.toString("utf8") + r.stderr;
      // Already gone on the remote counts as removed.
      if (r.code !== 0 && !/remote ref does not exist/.test(out)) {
        throw new GitError("push_failed", `The branch could not be removed: ${out.trim()}`);
      }
      await this.run(["update-ref", "-d", `refs/remotes/origin/${name}`]);
    });
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

  /**
   * Whether a commit is part of the published library: reachable from where the working copy is.
   * A commit of an unpublished branch (a proposal not yet kept) is not, however it is named.
   */
  isPublished(commit: string): Promise<boolean> {
    return this.locked(async () => {
      const r = await this.run(["merge-base", "--is-ancestor", commit, "HEAD"], {
        allow: (c) => c === 1 || c === 128,
      });
      return r.code === 0;
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

  /** Every file's blob hash at a commit, by path, from one `ls-tree`; empty when there is none. */
  blobs(commit = "HEAD"): Promise<Map<string, string>> {
    return this.locked(async () => {
      const r = await this.run(["ls-tree", "-r", "-z", "--full-tree", commit], {
        allow: (c) => c === 128,
      });
      const out = new Map<string, string>();
      if (r.code !== 0) return out;
      for (const line of r.stdout.toString("utf8").split("\0")) {
        // "<mode> <type> <hash>\t<path>"
        const tab = line.indexOf("\t");
        if (tab === -1) continue;
        const [, type, hash] = line.slice(0, tab).split(" ");
        if (type === "blob" && hash) out.set(line.slice(tab + 1), hash);
      }
      return out;
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
   * Returns the new commit's hash. The commit is not on any branch until it is pushed. It is
   * made by `author` when given, else by the configured author.
   */
  commit(changes: CommitChanges, message: string, author?: Identity): Promise<string> {
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
            GIT_AUTHOR_NAME: (author ?? this.opts.author).name,
            GIT_AUTHOR_EMAIL: (author ?? this.opts.author).email,
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
   * Builds a commit that adds every file of a folder to `main`: new files are added, files that
   * exist are replaced, and nothing is removed. Returns the commit and how many files it changed.
   */
  commitFolder(
    folder: string,
    message: string,
    author?: Identity,
  ): Promise<{ commit: string; files: number }> {
    return this.locked(async () => {
      const scratch = await mkdtemp(join(tmpdir(), "frontier-index-"));
      const env = { GIT_INDEX_FILE: join(scratch, "index") };
      try {
        const parent = await this.text(["rev-parse", "origin/main"]);
        await this.run(["read-tree", parent], { env });
        await this.run(
          [
            "--work-tree",
            folder,
            "-c",
            "core.autocrlf=false",
            "add",
            "--ignore-removal",
            "--",
            ".",
          ],
          { env },
        );
        const tree = await this.text(["write-tree"], { env });
        const changed = (
          await this.run(["diff-tree", "-r", "--name-only", "-z", "--no-renames", parent, tree])
        ).stdout
          .toString("utf8")
          .split("\0")
          .filter((p) => p !== "");
        if (changed.length === 0) {
          throw new GitError("git_failed", "Every file in it is in the library already.");
        }
        const commit = await this.text(["commit-tree", tree, "-p", parent, "-m", message], {
          env: {
            GIT_AUTHOR_NAME: (author ?? this.opts.author).name,
            GIT_AUTHOR_EMAIL: (author ?? this.opts.author).email,
            GIT_COMMITTER_NAME: this.opts.committer.name,
            GIT_COMMITTER_EMAIL: this.opts.committer.email,
          },
        });
        return { commit, files: changed.length };
      } finally {
        await rm(scratch, { recursive: true, force: true });
      }
    });
  }

  /**
   * The saved versions, newest first: of one file, followed across its renames, or of the whole
   * library. Each lists the paths it changed, as they were named at that version.
   */
  history(path?: string, limit = 100): Promise<Version[]> {
    return this.locked(async () => {
      const out = (
        await this.run([
          "log",
          `-n${limit}`,
          "--name-only",
          "-z",
          "--format=%x00%H%x00%cI%x00%s%x00%an%x00%ae",
          ...(path ? ["--follow", "--", path] : ["--no-renames"]),
        ])
      ).stdout.toString("utf8");
      return parseLogZ(out, 5).map(({ fields: [commit, at, message, name, email], rest }) => ({
        commit: commit!,
        at: at!,
        message: message!,
        author: { name: name ?? "", email: email ?? "" },
        paths: rest.filter((p) => p !== ""),
      }));
    });
  }

  /**
   * The last saved version that touched a file, newest first, even when it is gone since (the
   * version that deleted it is that). Null for a path no version ever touched.
   */
  lastChange(path: string): Promise<{ commit: string; at: string; author: Identity } | null> {
    return this.locked(async () => {
      const r = await this.run(
        ["log", "-n1", "-z", "--format=%x00%H%x00%cI%x00%an%x00%ae", "--", path],
        { allow: (c) => c === 128 },
      );
      if (r.code !== 0) return null;
      const [last] = parseLogZ(r.stdout.toString("utf8"), 4);
      return last ? changeOf(last.fields) : null;
    });
  }

  /** The last version that touched each path, by path, as of a commit: see `lastChangeAt`. */
  private changeMap: { head: string; map: Map<string, SavedChange> } | null = null;

  /**
   * As `lastChange`, for a path at a commit the caller already knows is the working copy's (the
   * index's commit). Answered from one map of every path's last version, built by one pass over the
   * log and, for each new commit after that, by reading only the commits since; a read of an entry
   * costs no Git command once the map is there, instead of a `git log` for each (stage 31d).
   */
  async lastChangeAt(path: string, commit: string): Promise<SavedChange | null> {
    const held =
      this.changeMap?.head === commit ? this.changeMap : await this.buildChangeMap(commit);
    return held.map.get(path) ?? null;
  }

  private buildChangeMap(commit: string): Promise<{ head: string; map: Map<string, SavedChange> }> {
    return this.locked(async () => {
      // Another read may have built it while this one waited.
      if (this.changeMap?.head === commit) return this.changeMap;
      const before = this.changeMap;
      const range = before
        ? (
            await this.run(["merge-base", "--is-ancestor", before.head, commit], {
              allow: (c) => c === 1 || c === 128,
            })
          ).code === 0
          ? `${before.head}..${commit}`
          : commit
        : commit;
      const r = await this.run(
        [
          "log",
          "--no-renames",
          "--name-only",
          "-z",
          "--format=%x00%H%x00%cI%x00%an%x00%ae",
          range,
          "--",
        ],
        // A library with no commit yet has no log.
        { allow: (c) => c === 128 },
      );
      const map =
        range === commit || !before ? new Map<string, SavedChange>() : new Map(before.map);
      const seen = new Set<string>();
      // Newest first: the first commit to name a path is its last version.
      if (r.code === 0) {
        for (const { fields, rest } of parseLogZ(r.stdout.toString("utf8"), 4)) {
          const change = changeOf(fields);
          for (const p of rest) {
            if (p === "" || seen.has(p)) continue;
            seen.add(p);
            map.set(p, change);
          }
        }
      }
      this.changeMap = { head: commit, map };
      return this.changeMap;
    });
  }

  /**
   * The saved versions of a file made after the version whose blob is `sinceBlob` (the one a change
   * was started from), newest first, each with who saved it and the blob it left; `""` for a change
   * started from no file counts every version. Stops at the version with that blob; when none has it
   * (the base is no longer in the history) every version up to `limit` is listed.
   */
  changesAfter(
    path: string,
    sinceBlob: string,
    limit = 200,
  ): Promise<(SavedChange & { blob: string | null })[]> {
    return this.locked(async () => {
      const r = await this.run(
        [
          "log",
          `-n${limit}`,
          "--no-renames",
          "--raw",
          "--no-abbrev",
          "-z",
          "--format=%x00%H%x00%cI%x00%an%x00%ae",
          "--",
          path,
        ],
        { allow: (c) => c === 128 },
      );
      if (r.code !== 0) return [];
      const out: (SavedChange & { blob: string | null })[] = [];
      for (const { fields, rest } of parseLogZ(r.stdout.toString("utf8"), 4)) {
        // ":<mode> <mode> <old> <new> <status>", then the path.
        const meta = rest.find((t) => t.startsWith(":"))?.split(" ");
        const blob = meta?.[3] && !/^0+$/.test(meta[3]) ? meta[3] : null;
        if (sinceBlob !== "" && blob === sinceBlob) break;
        out.push({ ...changeOf(fields), blob });
      }
      return out;
    });
  }

  /** When the last saved version was made and the name of its author; null for a library with none. */
  lastVersion(): Promise<{ at: string; by: string } | null> {
    return this.locked(async () => {
      const r = await this.run(["log", "-n1", "-z", "--format=%x00%cI%x00%an"], {
        allow: () => true,
      });
      const [last] = r.code === 0 ? parseLogZ(r.stdout.toString("utf8"), 2) : [];
      const [at, by] = last?.fields ?? [];
      return at ? { at, by: by ?? "" } : null;
    });
  }

  /**
   * The commits that changed Markdown files, newest first, each with the files it added, changed,
   * renamed or deleted. `since` is anything Git reads as a time. A merge commit lists nothing.
   */
  changeLog(options: { limit?: number; since?: string } = {}): Promise<LoggedCommit[]> {
    return this.locked(async () => {
      const r = await this.run(
        [
          "log",
          `-n${options.limit ?? 5000}`,
          ...(options.since ? [`--since=${options.since}`] : []),
          "--find-renames",
          "--name-status",
          "--format=%x01%H%x02%cI",
          "--",
          "*.md",
        ],
        // A library with no commit yet has no log.
        { allow: (c) => c === 128 },
      );
      return r.code === 0 ? parseChangeLog(r.stdout.toString("utf8")) : [];
    });
  }

  /**
   * The words each commit since a time added to and took from each Markdown file, and whether it
   * made the file. Counts the lines of the patch, frontmatter included.
   */
  wordChanges(since: string): Promise<WordCommit[]> {
    return this.locked(async () => {
      const r = await this.run(
        [
          "log",
          `--since=${since}`,
          "--find-renames",
          "-p",
          "-U0",
          "--format=%x01%H%x02%cI",
          "--",
          "*.md",
        ],
        { allow: (c) => c === 128 },
      );
      return r.code === 0 ? parseWordChanges(r.stdout.toString("utf8")) : [];
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
        timeoutMs: this.remoteTimeoutMs,
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
