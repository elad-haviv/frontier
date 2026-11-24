import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadConfig } from "../src/config.js";
import { applySampleMode, ensureSampleRemote } from "../src/sample.js";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "frontier-sample-test-"));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

describe("sample mode", () => {
  it("makes a local remote from the bundled sample vault, once", () => {
    const remote = ensureSampleRemote(dir);
    const files = execFileSync("git", ["ls-tree", "-r", "--name-only", "main"], {
      cwd: remote,
      encoding: "utf8",
    });
    expect(files).toContain("01 Places/Harbor/Harbor.md");
    const head = () =>
      execFileSync("git", ["rev-parse", "main"], { cwd: remote, encoding: "utf8" });
    const first = head();
    expect(ensureSampleRemote(dir)).toBe(remote);
    expect(head()).toBe(first);
  });

  it("keeps the sample's Windows line endings", () => {
    const remote = ensureSampleRemote(dir);
    const rope = execFileSync("git", ["show", "main:03 Things/Rope.md"], { cwd: remote });
    expect(rope.includes(Buffer.from("\r\n"))).toBe(true);
  });

  it("fills in the settings so only a few variables are needed", () => {
    const env: NodeJS.ProcessEnv = {
      FRONTIER_SAMPLE_VAULT: "1",
      DATA_DIR: dir,
      PUBLIC_URL: "https://preview.example.com",
      SESSION_KEY: Buffer.alloc(32, 3).toString("base64"),
      COMMIT_AUTHOR_NAME: "Kept",
    };
    applySampleMode(env);
    const config = loadConfig(env);
    expect(config.remoteUrl).toBe(join(dir, "sample-remote.git"));
    expect(config.githubApp).toBeNull();
    expect(config.backup).toEqual({ kind: "local", dir: join(dir, "bucket") });
    expect(config.commitAuthor.name).toBe("Kept");
  });

  it("does nothing unless switched on", () => {
    const env: NodeJS.ProcessEnv = { DATA_DIR: dir };
    applySampleMode(env);
    expect(env["VAULT_REMOTE_URL"]).toBeUndefined();
  });
});
