import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { LightMyRequestResponse } from "fastify";
import { type App, buildApp } from "../../src/app.js";
import { hashPassword } from "../../src/auth/password.js";
import { loadConfig } from "../../src/config.js";
import { makeTestRepo, type TestRepo } from "./repo.js";

export const PASSWORD = "correct horse battery";

export interface TestApp extends App {
  repo: TestRepo;
  gitCommands: string[][];
  /** The session cookie after a successful login. */
  cookie: string;
  login(password?: string): Promise<LightMyRequestResponse>;
  get(url: string): Promise<LightMyRequestResponse>;
  put(url: string, body: unknown): Promise<LightMyRequestResponse>;
  del(url: string): Promise<LightMyRequestResponse>;
  post(
    url: string,
    body?: unknown,
    headers?: Record<string, string>,
  ): Promise<LightMyRequestResponse>;
  close(): Promise<void>;
}

export function testEnv(
  repo: TestRepo,
  extra: Record<string, string> = {},
): Record<string, string> {
  return {
    PUBLIC_URL: "http://localhost:3000",
    DATA_DIR: join(repo.root, "data"),
    VAULT_REMOTE_URL: repo.remote,
    SESSION_KEY: Buffer.alloc(32, 7).toString("base64"),
    COMMIT_AUTHOR_NAME: "The Author",
    COMMIT_AUTHOR_EMAIL: "author@example.com",
    COMMIT_BOT_NAME: "frontier[bot]",
    COMMIT_BOT_EMAIL: "bot@example.com",
    BACKUP_LOCAL_DIR: join(repo.root, "bucket"),
    ...extra,
  };
}

let cachedHash: Promise<string> | null = null;

/** A server on a fresh copy of the fixture vault, cloned and indexed, with a password set. */
export async function makeTestApp(
  extraEnv: Record<string, string> = {},
  options: { fetch?: typeof fetch; settleMs?: number } = {},
): Promise<TestApp> {
  const repo = makeTestRepo();
  const config = loadConfig(testEnv(repo, extraEnv));
  mkdirSync(join(config.dataDir, "state"), { recursive: true });
  const gitCommands: string[][] = [];
  const built = await buildApp(config, {
    onGitCommand: (args) => gitCommands.push([...args]),
    ...options,
  });
  await built.services.git.ensureClone();
  await built.services.sync();
  cachedHash ??= hashPassword(PASSWORD);
  await built.services.settings.write({ passwordHash: await cachedHash });

  const t: TestApp = {
    ...built,
    repo,
    gitCommands,
    cookie: "",
    async login(password = PASSWORD) {
      const res = await built.app.inject({
        method: "POST",
        url: "/api/login",
        payload: { password },
      });
      const set = res.headers["set-cookie"];
      const first = Array.isArray(set) ? set[0] : set;
      if (res.statusCode === 200 && first) t.cookie = first.split(";")[0]!;
      return res;
    },
    get: (url) =>
      built.app.inject({ method: "GET", url, headers: t.cookie ? { cookie: t.cookie } : {} }),
    post: (url, body, headers = {}) =>
      built.app.inject({
        method: "POST",
        url,
        headers: { ...(t.cookie ? { cookie: t.cookie } : {}), ...headers },
        ...(body === undefined ? {} : { payload: body as object }),
      }),
    put: (url, body) =>
      built.app.inject({
        method: "PUT",
        url,
        headers: { cookie: t.cookie },
        payload: body as object,
      }),
    del: (url) => built.app.inject({ method: "DELETE", url, headers: { cookie: t.cookie } }),
    async close() {
      await built.app.close();
      repo.cleanup();
    },
  };
  return t;
}
