import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GitError, GitGateway } from "../src/git/gateway.js";
import { makeTestRepo, type TestRepo } from "./helpers/repo.js";

const AUTHOR = { name: "The Author", email: "author@example.com" };
const BOT = { name: "frontier[bot]", email: "bot@example.com" };

let repo: TestRepo;
let commands: string[][];
let git: GitGateway;

function gateway(overrides: Partial<ConstructorParameters<typeof GitGateway>[0]> = {}): GitGateway {
  return new GitGateway({
    dir: repo.workdir,
    remoteUrl: repo.remote,
    author: AUTHOR,
    committer: BOT,
    onCommand: (args) => commands.push([...args]),
    ...overrides,
  });
}

beforeEach(async () => {
  repo = makeTestRepo();
  commands = [];
  git = gateway();
  await git.ensureClone();
});

afterEach(() => repo.cleanup());

const code = (p: Promise<unknown>) =>
  p.then(
    () => "no error",
    (e: unknown) => (e instanceof GitError ? e.code : `other: ${String(e)}`),
  );

describe("clone and fetch", () => {
  it("clones once and leaves an existing working copy alone", async () => {
    expect(existsSync(join(repo.workdir, "README.md"))).toBe(true);
    const before = commands.length;
    await git.ensureClone();
    expect(commands.length).toBe(before);
    expect(await git.head()).toBe(repo.remoteHead());
  });

  it("reports nothing changed when the remote has not moved", async () => {
    const r = await git.fetch();
    expect(r.previous).toBe(r.current);
    expect(r.changed).toEqual([]);
  });

  it("moves the working copy to the new main and lists what changed", async () => {
    const pushed = repo.pushFromOutside({
      "02 People/Mira.md": "# Mira\n\nChanged outside.\n",
      "02 People/New Person.md": "# New\n",
      "03 Things/Plain.md": null,
    });
    const r = await git.fetch();
    expect(r.current).toBe(pushed);
    expect(r.changed).toEqual([
      { status: "modified", path: "02 People/Mira.md" },
      { status: "added", path: "02 People/New Person.md" },
      { status: "deleted", path: "03 Things/Plain.md" },
    ]);
    expect(readFileSync(join(repo.workdir, "02 People/Mira.md"), "utf8")).toContain(
      "Changed outside",
    );
    expect(existsSync(join(repo.workdir, "03 Things/Plain.md"))).toBe(false);
  });

  it("throws away stray files and edits in the working copy", async () => {
    const { writeFileSync } = await import("node:fs");
    writeFileSync(join(repo.workdir, "stray.txt"), "x");
    writeFileSync(join(repo.workdir, "README.md"), "overwritten");
    await git.fetch();
    expect(existsSync(join(repo.workdir, "stray.txt"))).toBe(false);
    expect(readFileSync(join(repo.workdir, "README.md"), "utf8")).toContain("Fixture vault");
  });
});

describe("reading", () => {
  it("lists files, including names with spaces", async () => {
    const files = await git.listFiles();
    expect(files).toContain("01 Places/Harbor/Old Quay.md");
    expect(files).toContain("99 Appendices/Images/map one.png");
    expect(files).toEqual(repo.remoteFiles());
  });

  it("reads a file's bytes and blob hash, and null for a missing file", async () => {
    const bytes = await git.readFile("03 Things/Rope.md");
    expect(bytes?.toString("utf8")).toBe(
      "# Rope\r\n\r\nTied at the [[Old Quay]].\r\nSecond line.\r\n",
    );
    expect(await git.readFile("nope.md")).toBeNull();
    const hash = await git.blobHash("03 Things/Rope.md");
    expect(hash).toMatch(/^[0-9a-f]{40}$/);
    expect(await git.hashOf(bytes!)).toBe(hash);
    expect(await git.blobHash("nope.md")).toBeNull();
  });
});

describe("commit and push", () => {
  it("builds a commit without touching the working copy, then pushes it", async () => {
    const before = statSync(join(repo.workdir, "02 People/Mira.md")).mtimeMs;
    const commit = await git.commit(
      {
        writes: [{ path: "02 People/Mira.md", content: Buffer.from("# Mira\n\nEdited.\n") }],
        deletes: [],
      },
      "Edit Mira",
    );
    expect(readFileSync(join(repo.workdir, "02 People/Mira.md"), "utf8")).not.toContain("Edited");
    expect(statSync(join(repo.workdir, "02 People/Mira.md")).mtimeMs).toBe(before);
    expect(await git.head()).not.toBe(commit);

    const parent = repo.remoteHead();
    await git.push(commit);
    expect(repo.remoteHead()).toBe(commit);
    expect(repo.remoteFile("02 People/Mira.md")).toBe("# Mira\n\nEdited.\n");
    expect(repo.remoteCommit(commit)).toEqual({
      message: "Edit Mira",
      author: "The Author <author@example.com>",
      committer: "frontier[bot] <bot@example.com>",
      parents: [parent],
    });
  });

  it("removes a deleted file and a rename's old path from the commit", async () => {
    const old = (await git.readFile("02 People/Mira.md"))!;
    const commit = await git.commit(
      {
        writes: [{ path: "02 People/Mira Vale.md", content: old }],
        deletes: ["02 People/Mira.md", "03 Things/Plain.md"],
      },
      "Rename Mira, delete Plain",
    );
    await git.push(commit);
    const files = repo.remoteFiles();
    expect(files).toContain("02 People/Mira Vale.md");
    expect(files).not.toContain("02 People/Mira.md");
    expect(files).not.toContain("03 Things/Plain.md");
    // The files are still in the working copy until the next fetch.
    expect(existsSync(join(repo.workdir, "02 People/Mira.md"))).toBe(true);
    await git.fetch();
    expect(existsSync(join(repo.workdir, "02 People/Mira.md"))).toBe(false);
  });

  it("keeps the bytes it is given, including Windows line endings and images", async () => {
    const text = Buffer.from("# Rope\r\n\r\nOne line.\r\n");
    const image = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 1, 2, 3, 255]);
    const commit = await git.commit(
      {
        writes: [
          { path: "03 Things/Rope.md", content: text },
          { path: "99 Appendices/Images/new.png", content: image },
        ],
        deletes: [],
      },
      "Bytes",
    );
    await git.push(commit);
    await git.fetch();
    expect(readFileSync(join(repo.workdir, "03 Things/Rope.md")).equals(text)).toBe(true);
    expect(readFileSync(join(repo.workdir, "99 Appendices/Images/new.png")).equals(image)).toBe(
      true,
    );
  });

  it("refuses an empty commit", async () => {
    expect(await code(git.commit({ writes: [], deletes: [] }, "Nothing"))).toBe("git_failed");
  });

  it("reports main_moved when the remote changed first, and leaves the remote alone", async () => {
    const commit = await git.commit(
      { writes: [{ path: "02 People/Mira.md", content: Buffer.from("mine\n") }], deletes: [] },
      "Mine",
    );
    const theirs = repo.pushFromOutside({ "02 People/Shade.md": "# Shade\n\nTheirs.\n" });
    expect(await code(git.push(commit))).toBe("main_moved");
    expect(repo.remoteHead()).toBe(theirs);
  });

  it("reports push_failed when the remote cannot be reached", async () => {
    const commit = await git.commit(
      { writes: [{ path: "x.md", content: Buffer.from("x\n") }], deletes: [] },
      "X",
    );
    const { renameSync } = await import("node:fs");
    renameSync(repo.remote, repo.remote + ".gone");
    expect(await code(git.push(commit))).toBe("push_failed");
    renameSync(repo.remote + ".gone", repo.remote);
  });

  it("never asks Git to force a push", async () => {
    const commit = await git.commit(
      { writes: [{ path: "x.md", content: Buffer.from("x\n") }], deletes: [] },
      "X",
    );
    await git.push(commit);
    repo.pushFromOutside({ "y.md": "y\n" });
    await git.fetch();
    const pushes = commands.filter((c) => c[0] === "push");
    expect(pushes.length).toBeGreaterThan(0);
    for (const args of commands) {
      for (const arg of args) {
        expect(arg).not.toMatch(/^--force/);
        expect(arg).not.toMatch(/^-f$/);
        // A "+" is allowed only when fetching, where it lets the local copy of a proposal branch
        // follow the remote. It never appears in a push.
        if (args[0] !== "fetch") expect(arg.startsWith("+")).toBe(false);
      }
    }
    // "clean -fd" is the one command that takes an "f", and it is not a push.
    expect(commands.filter((c) => c.includes("-fd")).every((c) => c[0] === "clean")).toBe(true);
  });
});

describe("three-way merge", () => {
  const base = "one\ntwo\nthree\nfour\nfive\n";

  it("merges changes in different places", async () => {
    const r = await git.mergeFile(
      "ONE\ntwo\nthree\nfour\nfive\n",
      base,
      "one\ntwo\nthree\nfour\nFIVE\n",
    );
    expect(r).toEqual({ clean: true, text: "ONE\ntwo\nthree\nfour\nFIVE\n" });
  });

  it("reports an overlap and returns both sides marked", async () => {
    const r = await git.mergeFile(
      "one\nMINE\nthree\nfour\nfive\n",
      base,
      "one\nTHEIRS\nthree\nfour\nfive\n",
    );
    expect(r.clean).toBe(false);
    expect(r.text).toContain("<<<<<<< yours");
    expect(r.text).toContain("MINE");
    expect(r.text).toContain("THEIRS");
  });

  it("is clean when both sides made the same change", async () => {
    const same = "one\nSAME\nthree\nfour\nfive\n";
    expect(await git.mergeFile(same, base, same)).toEqual({ clean: true, text: same });
  });
});

describe("errors and the lock", () => {
  it("reports a Git failure with Git's own message", async () => {
    const broken = gateway({ dir: join(repo.root, "not-a-repo") });
    await expect(broken.head()).rejects.toThrow(/git rev-parse failed/);
    expect(await code(broken.head())).toBe("git_failed");
  });

  it("fails a clone from a missing remote", async () => {
    const g = gateway({
      dir: join(repo.root, "second"),
      remoteUrl: join(repo.root, "missing.git"),
    });
    expect(await code(g.ensureClone())).toBe("git_failed");
  });

  it("runs operations one at a time, in the order asked", async () => {
    const order: string[] = [];
    const g = gateway({ onCommand: (args) => order.push(args[0]!) });
    await Promise.all([g.fetch(), g.listFiles(), g.head()]);
    const firstList = order.indexOf("ls-tree");
    const lastFetchStep = order.lastIndexOf("clean");
    expect(lastFetchStep).toBeLessThan(firstList);
    expect(order.lastIndexOf("rev-parse")).toBeGreaterThan(firstList);
  });

  it("gives up with git_busy when the lock is held too long, and recovers afterwards", async () => {
    const g = gateway({ lockTimeoutMs: 1 });
    const results = await Promise.all([code(g.fetch()), code(g.head()), code(g.head())]);
    expect(results[0]).toBe("no error");
    expect(results.slice(1)).toContain("git_busy");
    await new Promise((r) => setTimeout(r, 50));
    expect(
      await new GitGateway({
        dir: repo.workdir,
        remoteUrl: repo.remote,
        author: AUTHOR,
        committer: BOT,
      }).head(),
    ).toBe(repo.remoteHead());
  });

  it("passes a token through the environment, never on the command line", async () => {
    let asked = 0;
    const g = gateway({
      token: async () => {
        asked++;
        return "secret-token-value";
      },
    });
    await g.fetch();
    expect(asked).toBeGreaterThan(0);
    expect(JSON.stringify(commands)).not.toContain("secret-token-value");
    expect(JSON.stringify(commands)).not.toContain(
      Buffer.from("x-access-token:secret-token-value").toString("base64"),
    );
  });

  it("uses no token when the source returns none", async () => {
    const g = gateway({ token: async () => null });
    expect((await g.fetch()).changed).toEqual([]);
  });
});

describe("the log of changes (stage 25)", () => {
  it("lists the commits that changed Markdown files, with what each did to each file", async () => {
    repo.pushFromOutside(
      { "03 Things/Added.md": "# Added\n\nOne two three.\n", "image.png": "x" },
      "Add one",
    );
    repo.pushFromOutside(
      { "03 Things/Added.md": "# Added\n\nOne two three four five.\n", "02 People/Mira.md": null },
      "Change one, delete another",
    );
    await git.fetch();
    const log = await git.changeLog({ limit: 2 });
    expect(log).toHaveLength(2);
    expect(log[0]!.changes).toEqual(
      expect.arrayContaining([
        { status: "M", path: "03 Things/Added.md" },
        { status: "D", path: "02 People/Mira.md" },
      ]),
    );
    expect(log[1]!.changes).toEqual([{ status: "A", path: "03 Things/Added.md" }]);
    expect(Date.parse(log[0]!.at)).toBeGreaterThan(0);
    expect(log[0]!.commit).toMatch(/^[0-9a-f]{40}$/);
    expect((await git.changeLog()).length).toBeGreaterThan(2);
  });

  it("follows a rename in the log and in the words, instead of a delete and a new file", async () => {
    const body = Array.from({ length: 30 }, (_, i) => `w${i}`).join("\n");
    repo.pushFromOutside({ "03 Things/Old.md": `# Old\n\n${body}\n` }, "Make");
    repo.pushFromOutside(
      { "03 Things/Old.md": null, "04 Moved/New.md": `# Old\n\n${body}\n` },
      "Move",
    );
    repo.pushFromOutside(
      { "04 Moved/New.md": null, "04 Moved/Newer.md": `# Old\n\n${body}\nplus two\n` },
      "Move and edit",
    );
    await git.fetch();
    const log = await git.changeLog({ limit: 3 });
    expect(log[1]!.changes).toEqual([
      { status: "R", path: "04 Moved/New.md", from: "03 Things/Old.md", edited: false },
    ]);
    expect(log[0]!.changes).toEqual([
      { status: "R", path: "04 Moved/Newer.md", from: "04 Moved/New.md", edited: true },
    ]);
    const words = await git.wordChanges("2000-01-01");
    expect(words[1]!.files).toEqual([
      { path: "04 Moved/New.md", created: false, deleted: false, added: 0, removed: 0 },
    ]);
    expect(words[0]!.files).toEqual([
      { path: "04 Moved/Newer.md", created: false, deleted: false, added: 2, removed: 0 },
    ]);
  });

  it("counts the words a commit added and took, and whether it made or deleted the file", async () => {
    repo.pushFromOutside({ "03 Things/Words.md": "# Words\n\none two three\nfour\n" }, "Make");
    repo.pushFromOutside(
      { "03 Things/Words.md": "# Words\n\none two\nfour five six seven\n" },
      "Edit",
    );
    repo.pushFromOutside(
      { "03 Things/Words.md": null, "03 Things/With Space.md": "# Spaced\n" },
      "Go",
    );
    await git.fetch();
    const changes = await git.wordChanges("2000-01-01");
    const byMessage = changes.filter((c) =>
      c.files.some((f) => f.path.includes("Words") || f.path.includes("Space")),
    );
    // Newest first: the delete and the new file, the edit, the make.
    expect(byMessage[0]!.files).toEqual(
      expect.arrayContaining([
        { path: "03 Things/Words.md", created: false, deleted: true, added: 0, removed: 7 },
        { path: "03 Things/With Space.md", created: true, deleted: false, added: 1, removed: 0 },
      ]),
    );
    expect(byMessage[1]!.files).toEqual([
      { path: "03 Things/Words.md", created: false, deleted: false, added: 6, removed: 4 },
    ]);
    expect(byMessage[2]!.files).toEqual([
      { path: "03 Things/Words.md", created: true, deleted: false, added: 5, removed: 0 },
    ]);
  });

  it("gives nothing for a library with no commit", async () => {
    const dir = join(repo.root, "empty-work");
    execFileSync("git", ["init", "--initial-branch=main", dir], { stdio: "ignore" });
    const g = new GitGateway({ dir, remoteUrl: repo.remote, author: AUTHOR, committer: BOT });
    expect(await g.changeLog()).toEqual([]);
    expect(await g.wordChanges("2000-01-01")).toEqual([]);
    expect(await g.lastChange("02 People/Mira.md")).toBeNull();
  });
});

describe("who made a version (stage 31d)", () => {
  const WREN = { name: "Wren Writer", email: "wren@example.com" };

  it("gives the author of each saved version in the history", async () => {
    const commit = await git.commit(
      {
        writes: [{ path: "02 People/Mira.md", content: Buffer.from("# Mira\n\nChanged.\n") }],
        deletes: [],
      },
      "Wren changes Mira",
      WREN,
    );
    await git.push(commit);
    await git.fetch();
    const versions = await git.history();
    expect(versions[0]).toMatchObject({ commit, message: "Wren changes Mira", author: WREN });
    expect(versions.at(-1)!.author).toEqual({ name: "Seed", email: "seed@example.com" });
    expect((await git.history("02 People/Mira.md"))[0]!.author).toEqual(WREN);
  });

  it("names the last version that touched a file, even one that deleted it, and none for an untouched path", async () => {
    const edit = await git.commit(
      {
        writes: [{ path: "02 People/Mira.md", content: Buffer.from("# Mira\n\nChanged.\n") }],
        deletes: [],
      },
      "Edit",
      WREN,
    );
    await git.push(edit);
    await git.fetch();
    const last = await git.lastChange("02 People/Mira.md");
    expect(last).toMatchObject({ commit: edit, author: WREN });
    expect(Date.parse(last!.at)).not.toBeNaN();
    const removed = await git.commit(
      { writes: [], deletes: ["02 People/Mira.md"] },
      "Remove",
      AUTHOR,
    );
    await git.push(removed);
    await git.fetch();
    expect((await git.lastChange("02 People/Mira.md"))!.author).toEqual(AUTHOR);
    expect(await git.lastChange("No/Such/File.md")).toBeNull();
  });
});
