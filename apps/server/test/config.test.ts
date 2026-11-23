import { describe, expect, it } from "vitest";
import { ConfigError, loadConfig } from "../src/config.js";

const KEY = Buffer.alloc(32, 1).toString("base64");

const local = {
  PUBLIC_URL: "https://frontier.example.com",
  VAULT_REMOTE_URL: "/tmp/remote.git",
  SESSION_KEY: KEY,
  COMMIT_AUTHOR_NAME: "A",
  COMMIT_AUTHOR_EMAIL: "a@example.com",
  COMMIT_BOT_NAME: "bot",
  COMMIT_BOT_EMAIL: "bot@example.com",
  BACKUP_LOCAL_DIR: "/tmp/bucket",
};

const hosted = {
  PUBLIC_URL: "https://frontier.example.com",
  DATA_DIR: "/srv/data",
  VAULT_REPO: "someone/vault",
  GITHUB_APP_ID: "123",
  GITHUB_APP_PRIVATE_KEY: "line one\\nline two",
  GITHUB_APP_INSTALLATION_ID: "456",
  WEBHOOK_SECRET: "hook",
  SESSION_KEY: KEY,
  COMMIT_AUTHOR_NAME: "A",
  COMMIT_AUTHOR_EMAIL: "a@example.com",
  COMMIT_BOT_NAME: "bot",
  COMMIT_BOT_EMAIL: "bot@example.com",
  BACKUP_S3_ENDPOINT: "https://s3.example.com",
  BACKUP_S3_REGION: "auto",
  BACKUP_S3_BUCKET: "frontier",
  BACKUP_S3_ACCESS_KEY: "ak",
  BACKUP_S3_SECRET_KEY: "sk",
};

describe("configuration", () => {
  it("accepts a local run without GitHub or a bucket", () => {
    const c = loadConfig(local);
    expect(c.remoteUrl).toBe("/tmp/remote.git");
    expect(c.githubApp).toBeNull();
    expect(c.githubToken).toBeNull();
    expect(c.webhookSecret).toBeNull();
    expect(c.dataDir).toBe("/data");
    expect(c.backup).toEqual({ kind: "local", dir: "/tmp/bucket" });
    expect(c.sessionKey).toHaveLength(32);
  });

  it("keeps a webhook secret given for a local run", () => {
    expect(loadConfig({ ...local, WEBHOOK_SECRET: "s" }).webhookSecret).toBe("s");
  });

  it("accepts a hosted run and builds the GitHub address", () => {
    const c = loadConfig(hosted);
    expect(c.remoteUrl).toBe("https://github.com/someone/vault.git");
    expect(c.githubApp).toEqual({
      appId: "123",
      privateKey: "line one\nline two",
      installationId: "456",
    });
    expect(c.webhookSecret).toBe("hook");
    expect(c.dataDir).toBe("/srv/data");
    expect(c.backup).toMatchObject({ kind: "s3", s3: { bucket: "frontier", pathStyle: true } });
    expect(loadConfig({ ...hosted, BACKUP_S3_PATH_STYLE: "false" }).backup).toMatchObject({
      s3: { pathStyle: false },
    });
  });

  it("accepts a personal access token in place of a GitHub App, and needs no webhook", () => {
    const rest: Record<string, string> = { ...hosted };
    for (const k of [
      "GITHUB_APP_ID",
      "GITHUB_APP_PRIVATE_KEY",
      "GITHUB_APP_INSTALLATION_ID",
      "WEBHOOK_SECRET",
    ]) {
      delete rest[k];
    }
    const c = loadConfig({ ...rest, GITHUB_TOKEN: "github_pat_example" });
    expect(c.githubToken).toBe("github_pat_example");
    expect(c.githubApp).toBeNull();
    expect(c.webhookSecret).toBeNull();
    expect(c.remoteUrl).toBe("https://github.com/someone/vault.git");
    // With neither a token nor an App, the App variables are named as missing.
    expect(() => loadConfig(rest)).toThrow(/GITHUB_APP_ID/);
  });

  it("names every missing variable", () => {
    expect(() => loadConfig({})).toThrow(ConfigError);
    try {
      loadConfig({ PUBLIC_URL: "https://x.example.com", SESSION_KEY: KEY });
    } catch (e) {
      const message = (e as Error).message;
      for (const name of [
        "VAULT_REPO",
        "GITHUB_APP_ID",
        "COMMIT_AUTHOR_NAME",
        "BACKUP_S3_BUCKET",
      ]) {
        expect(message).toContain(name);
      }
      expect(message).not.toContain("SESSION_KEY");
    }
    expect(() => loadConfig({ ...local, COMMIT_BOT_EMAIL: " " })).toThrow(
      "Missing environment variable: COMMIT_BOT_EMAIL",
    );
  });

  it("keeps the service worker on unless it is switched off", () => {
    expect(loadConfig(local).serviceWorker).toBe(true);
    expect(loadConfig({ ...local, FRONTIER_SERVICE_WORKER: "on" }).serviceWorker).toBe(true);
    expect(loadConfig({ ...local, FRONTIER_SERVICE_WORKER: "off" }).serviceWorker).toBe(false);
    expect(loadConfig({ ...local, FRONTIER_SERVICE_WORKER: " OFF " }).serviceWorker).toBe(false);
  });

  it("checks the session key length and the public address", () => {
    expect(() => loadConfig({ ...local, SESSION_KEY: "c2hvcnQ=" })).toThrow(/32 bytes/);
    expect(() => loadConfig({ ...local, PUBLIC_URL: "not a url" })).toThrow(/full address/);
  });
});
