import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { AI_KEYS_HEADER, type DeviceKeys, encodeDeviceKeys } from "@frontier/schema";
import type { LightMyRequestResponse } from "fastify";
import { type App, buildApp } from "../../src/app.js";
import { hashPassword } from "../../src/auth/password.js";
import { loadConfig } from "../../src/config.js";
import { makeTestRepo, type TestRepo } from "./repo.js";

export const PASSWORD = "correct horse battery";
/** The test account's email and name: the same as the commit author's, so saved versions read as before. */
export const EMAIL = "author@example.com";
export const NAME = "The Author";

export interface TestApp extends App {
  repo: TestRepo;
  gitCommands: string[][];
  /** The session cookie after a successful login. */
  cookie: string;
  /** The AI keys this "device" holds: sent in the keys header with every request, as the browser does. */
  keys: DeviceKeys;
  /** The headers of a request: the session cookie, and the keys when the device has any. */
  base(extra?: Record<string, string>): Record<string, string>;
  login(password?: string, email?: string): Promise<LightMyRequestResponse>;
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

/** Makes the first account (the admin), with the settings file the rest of the server expects. */
export async function seedAccount(
  services: App["services"],
  password = PASSWORD,
  extra: { email?: string; name?: string } = {},
) {
  if (password === PASSWORD) cachedHash ??= hashPassword(PASSWORD);
  if (!(await services.settings.read())) await services.settings.write({ passwordHash: "" });
  return services.server.people.create({
    name: extra.name ?? NAME,
    email: extra.email ?? EMAIL,
    passwordHash: password === PASSWORD ? await cachedHash! : await hashPassword(password),
  });
}

/** A server on a fresh copy of the fixture vault, cloned and indexed, with a password set. */
export async function makeTestApp(
  extraEnv: Record<string, string> = {},
  options: {
    fetch?: typeof fetch;
    settleMs?: number;
    logger?: boolean;
    logStream?: { write(line: string): void };
  } = {},
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
  await seedAccount(built.services);

  // Like a browser: a new session cookie in an answer replaces the one held, as when a change
  // ends the other sessions and this one is given the new epoch.
  const keep = async (pending: Promise<LightMyRequestResponse>) => {
    const res = await pending;
    const set = res.headers["set-cookie"];
    const first = Array.isArray(set) ? set[0] : set;
    if (res.statusCode < 400 && first?.startsWith("frontier_session=")) {
      t.cookie = first.split(";")[0]!;
    }
    return res;
  };

  const t: TestApp = {
    ...built,
    repo,
    gitCommands,
    cookie: "",
    keys: {},
    base: (extra = {}) => ({
      ...(t.cookie ? { cookie: t.cookie } : {}),
      ...(Object.keys(t.keys).length > 0 ? { [AI_KEYS_HEADER]: encodeDeviceKeys(t.keys) } : {}),
      ...extra,
    }),
    async login(password = PASSWORD, email = EMAIL) {
      const res = await built.app.inject({
        method: "POST",
        url: "/api/login",
        payload: { email, password },
      });
      const set = res.headers["set-cookie"];
      const first = Array.isArray(set) ? set[0] : set;
      if (res.statusCode === 200 && first) t.cookie = first.split(";")[0]!;
      return res;
    },
    get: (url) => keep(built.app.inject({ method: "GET", url, headers: t.base() })),
    post: (url, body, headers = {}) =>
      keep(
        built.app.inject({
          method: "POST",
          url,
          headers: t.base(headers),
          ...(body === undefined ? {} : { payload: body as object }),
        }),
      ),
    put: (url, body) =>
      keep(
        built.app.inject({
          method: "PUT",
          url,
          headers: t.base(),
          payload: body as object,
        }),
      ),
    del: (url) => keep(built.app.inject({ method: "DELETE", url, headers: t.base() })),
    async close() {
      await built.app.close();
      repo.cleanup();
    },
  };
  return t;
}

/** A person's session on a test server: requests as them, without the helper's own login. */
export interface Client {
  id: string;
  cookie: string;
  get(url: string): Promise<LightMyRequestResponse>;
  post(url: string, body?: unknown): Promise<LightMyRequestResponse>;
  put(url: string, body: unknown): Promise<LightMyRequestResponse>;
  del(url: string, body?: unknown): Promise<LightMyRequestResponse>;
}

let sharedHash: Promise<string> | null = null;

/** Makes another account on the server and logs it in. It belongs to no project until it is made a member. */
export async function addPerson(
  t: Pick<App, "app" | "server">,
  name: string,
  email: string,
): Promise<Client> {
  sharedHash ??= hashPassword(PASSWORD);
  const person = await t.server.people.create({ name, email, passwordHash: await sharedHash });
  const res = await t.app.inject({
    method: "POST",
    url: "/api/login",
    payload: { email, password: PASSWORD },
  });
  const cookie = String(res.headers["set-cookie"]).split(";")[0]!;
  const send = (method: "GET" | "POST" | "PUT" | "DELETE", url: string, payload?: unknown) =>
    t.app.inject({
      method,
      url,
      headers: { cookie },
      ...(payload === undefined ? {} : { payload: payload as object }),
    });
  return {
    id: person.id,
    cookie,
    get: (url) => send("GET", url),
    post: (url, body) => send("POST", url, body),
    put: (url, body) => send("PUT", url, body),
    del: (url, body) => send("DELETE", url, body),
  };
}

/** Puts a person in a project with a role, as the store would hold it after an invitation (stage 27c). */
export async function addMember(
  t: Pick<App, "server">,
  projectId: string,
  personId: string,
  role: "owner" | "writer" | "reader",
): Promise<void> {
  await t.server.projects.update(projectId, (p) => ({
    ...p,
    members: [
      ...p.members.filter((m) => m.personId !== personId),
      { personId, role, addedAt: new Date().toISOString() },
    ],
  }));
}
