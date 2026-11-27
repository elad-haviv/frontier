/**
 * AI keys live on the device (stage 27f). The server gets one with a request that needs it, uses
 * it for that request, and keeps nothing: not on disk, not in a backup, not in the AI call log,
 * not in the server's own log, not in an error that is sent back.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AI_KEYS_HEADER, encodeDeviceKeys } from "@frontier/schema";
import { buildApp } from "../src/app.js";
import {
  deviceKey,
  deviceKeys,
  outsideRequest,
  requestPerson,
  withDeviceKeys,
} from "../src/ai/keyring.js";
import { makeTestApp, seedAccount, type TestApp } from "./helpers/app.js";

let t: TestApp;
afterEach(() => t.close());

/** A key nobody would write by chance, so finding it anywhere means it leaked. */
const SECRET = "sk-or-v1-LEAKCHECK7f3a9c2e41b8d605";
const VEL = "01 Places/Vel Aran.md";
const BODY = "# Vel Aran\n\nVel Aran was founded around 340 EM by [[Mira]].\n";

/** Stands in for OpenRouter. A provider that refuses a key often says the key back. */
function provider() {
  const seen: string[] = [];
  let refuse = false;
  const fake: typeof fetch = async (input, init) => {
    const path = new URL(String(input)).pathname;
    const auth = new Headers(init?.headers).get("authorization") ?? "";
    if (auth.includes("WRONG") || refuse) {
      return Response.json(
        { error: { message: `Invalid API key ${auth.replace("Bearer ", "")}` } },
        { status: 401 },
      );
    }
    if (path.endsWith("/key")) return Response.json({ data: { label: "test" } });
    if (path.endsWith("/models")) {
      return Response.json({
        data: [
          {
            id: "test/model",
            name: "Test model",
            pricing: { prompt: "0.000001", completion: "0.000002" },
            supported_parameters: ["structured_outputs"],
          },
        ],
      });
    }
    const body = JSON.parse(String(init?.body)) as {
      response_format?: { json_schema?: { name?: string } };
    };
    seen.push(auth);
    const name = body.response_format?.json_schema?.name;
    const answer =
      name === "rewrite"
        ? { text: "Rewritten." }
        : name === "test"
          ? { reply: "ok" }
          : name === "question_of_the_day"
            ? { question: "What did Vel Aran look like when it was founded?" }
            : name === "whats_missing"
              ? { proposals: [], questions: ["Who is Mira?"] }
              : { time: [] };
    return Response.json({
      choices: [{ message: { content: JSON.stringify(answer) } }],
      usage: { prompt_tokens: 100, completion_tokens: 20, cost: 0.001 },
    });
  };
  return { fake, seen, refuseFromNow: () => (refuse = true) };
}

/** Every file under a folder, as text, with its path. */
function filesUnder(root: string): { path: string; text: string }[] {
  const out: { path: string; text: string }[] = [];
  const visit = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) visit(full);
      else out.push({ path: full, text: readFileSync(full).toString("latin1") });
    }
  };
  if (existsSync(root)) visit(root);
  return out;
}

describe("a key sent with a request", () => {
  it("is found nowhere on disk, in a backup, in the AI log or in the server's log, after calls of every kind", async () => {
    const p = provider();
    const lines: string[] = [];
    t = await makeTestApp(
      {},
      { fetch: p.fake, settleMs: 0, logger: true, logStream: { write: (l) => lines.push(l) } },
    );
    await t.login();
    t.repo.pushFromOutside({ [VEL]: BODY });
    await t.services.sync();
    t.keys = { openrouter: SECRET };
    await t.put("/api/settings/ai", {
      models: { extraction: "test/model", conversation: "test/model" },
      proposeOnPublish: true,
    });

    const answers: string[] = [];
    const note = (res: { body: string }) => answers.push(res.body);
    // Calls that work, of several kinds.
    note(await t.post("/api/settings/ai/test"));
    note(await t.get("/api/ai/models"));
    note(await t.post("/api/ai/keys/openrouter/check"));
    note(await t.post("/api/proposals/fields", { path: VEL }));
    note(
      await t.post("/api/write/rewrite", {
        path: VEL,
        passage: "Vel Aran was founded.",
        how: "shorter",
      }),
    );
    // Stage 25's two: what's missing here, and the question of the day.
    const missing = await t.post("/api/keep-going/whats-missing", { path: VEL });
    expect(missing.statusCode).toBe(200);
    note(missing);
    const question = await t.post("/api/keep-going/question", {});
    expect(question.statusCode).toBe(200);
    note(question);
    await withDeviceKeys({ openrouter: SECRET }, async () => {
      for await (const e of t.services.ai.stream({
        task: "conversation",
        system: "s",
        user: "u",
      })) {
        void e;
      }
    });
    // A key the provider refuses, and a refused call that says the key back.
    t.keys = { openrouter: "sk-or-WRONG-key-0000" };
    note(await t.post("/api/ai/keys/openrouter/check"));
    t.keys = { openrouter: SECRET };
    p.refuseFromNow();
    const failed = await t.post("/api/write/rewrite", {
      path: VEL,
      passage: "Vel Aran was founded.",
      how: "shorter",
    });
    // The provider turned the key away: said as such, not as a failed call.
    expect(failed.statusCode).toBe(409);
    expect(failed.json().error).toMatchObject({ code: "ai_key_rejected", provider: "openrouter" });
    note(failed);
    note(await t.post("/api/settings/ai/test"));
    // Something that is no request for the AI at all, with the keys header present.
    note(await t.get("/api/settings"));
    // The provider saw the key; that is the point of sending it.
    expect(p.seen).toContain(`Bearer ${SECRET}`);

    // Then every place a trace could be: answers, the server's log, the whole data folder, the
    // backup, the repository the vault is pushed to, and the AI call log in particular.
    await t.services.backup.runNow();
    const aiLog = filesUnder(join(t.services.config.dataDir, "state", "ai-log"));
    expect(aiLog.length).toBeGreaterThan(0);
    const everything = [
      ...answers.map((text, i) => ({ path: `answer ${i}`, text })),
      { path: "the server's log", text: lines.join("") },
      ...filesUnder(t.repo.root),
    ];
    const leaks = everything.filter((f) => f.text.includes(SECRET)).map((f) => f.path);
    expect(leaks).toEqual([]);
    // Nor a recognisable part of it, as a provider shows a key masked.
    expect(everything.filter((f) => f.text.includes("LEAKCHECK")).map((f) => f.path)).toEqual([]);
    // The log of failed calls says the call failed, with the key taken out of the provider's words.
    expect(aiLog.map((f) => f.text).join("")).toContain("[key]");
    expect(lines.join("")).toContain("AI call failed");
  });

  it("is taken off the request before anything else can read it, and kept out of log lines", async () => {
    const lines: string[] = [];
    t = await makeTestApp(
      {},
      { settleMs: 0, logger: true, logStream: { write: (l) => lines.push(l) } },
    );
    t.app.get("/api/_probe", async (request) => ({
      header: request.headers[AI_KEYS_HEADER] ?? null,
      raw: request.raw.headers[AI_KEYS_HEADER] ?? null,
      keys: deviceKeys(),
      key: deviceKey("openrouter"),
    }));
    await t.login();
    const res = await t.app.inject({
      method: "GET",
      url: "/api/_probe",
      headers: t.base({ [AI_KEYS_HEADER]: encodeDeviceKeys({ openrouter: SECRET, xai: "xai-1" }) }),
    });
    expect(res.json()).toEqual({
      header: null,
      raw: null,
      keys: { openrouter: SECRET, xai: "xai-1" },
      key: SECRET,
    });
    // Another request at the same time does not see them, and nor does code outside a request.
    const plain = await t.app.inject({ method: "GET", url: "/api/_probe", headers: t.base() });
    expect(plain.json()).toMatchObject({ keys: {}, key: null });
    expect(deviceKeys()).toEqual({});

    // Were a request ever logged whole, its header would not get into the line.
    t.app.log.info({ req: { headers: { [AI_KEYS_HEADER]: SECRET } } }, "a request");
    const logged = lines.join("");
    expect(logged).toContain("a request");
    expect(logged).not.toContain(SECRET);
  });

  it("is ignored when it is not a well-formed header, and does not fail the request", async () => {
    t = await makeTestApp({}, { settleMs: 0 });
    t.app.get("/api/_probe", async () => ({ keys: deviceKeys() }));
    await t.login();
    for (const junk of ["!!!", btoa("[]"), btoa(JSON.stringify({ openrouter: "has space" }))]) {
      const res = await t.app.inject({
        method: "GET",
        url: "/api/_probe",
        headers: t.base({ [AI_KEYS_HEADER]: junk }),
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ keys: {} });
    }
  });
});

describe("what a request holds", () => {
  it("survives body parsing on a real socket, and is empty once the response is sent", async () => {
    t = await makeTestApp({}, { settleMs: 0 });
    const held: { keys: unknown; person: string | null; outside: unknown; holder?: unknown }[] = [];
    t.app.post("/api/_echo", async (request) => {
      held.push({
        keys: deviceKeys(),
        person: requestPerson(),
        outside: outsideRequest(() => deviceKeys()),
        holder: request.keysHolder,
      });
      return { body: request.body, keys: deviceKeys() };
    });
    await t.login();
    await t.app.listen({ port: 0, host: "127.0.0.1" });
    const address = t.app.server.address();
    const port = typeof address === "object" && address ? address.port : 0;
    const res = await fetch(`http://127.0.0.1:${port}/api/_echo`, {
      method: "POST",
      headers: {
        cookie: t.cookie,
        "content-type": "application/json",
        [AI_KEYS_HEADER]: encodeDeviceKeys({ openrouter: SECRET }),
      },
      body: JSON.stringify({ hello: "world" }),
    });
    // Parsed from the socket, and the keys are still the request's own in the handler.
    expect(await res.json()).toEqual({ body: { hello: "world" }, keys: { openrouter: SECRET } });
    expect(held[0]!.keys).toEqual({ openrouter: SECRET });
    expect(held[0]!.person).toBe((await t.services.server.people.all())[0]!.id);
    // A timer armed from a request is armed outside it, so it never inherits the keys.
    expect(held[0]!.outside).toEqual({});
    // And the holder is emptied when the response is over.
    await new Promise((r) => setTimeout(r, 50));
    expect(held[0]!.holder).toMatchObject({ keys: {}, person: null });
  });
});

describe("one person's key checks, spending and notice", () => {
  const SECOND = { email: "second@example.com", name: "Second", password: "second-password-1" };

  async function twoPeople() {
    const p = provider();
    t = await makeTestApp({}, { fetch: p.fake, settleMs: 0 });
    await t.login();
    await seedAccount(t.services, SECOND.password, { email: SECOND.email, name: SECOND.name });
    t.keys = { openrouter: SECRET };
    await t.put("/api/settings/ai", { models: { extraction: "test/model" } });
    return p;
  }
  const asSecond = async () => {
    t.cookie = "";
    expect((await t.login(SECOND.password, SECOND.email)).statusCode).toBe(200);
  };

  it("limits key checks for each person, not for the whole server", async () => {
    await twoPeople();
    for (let i = 0; i < 20; i++) {
      expect((await t.post("/api/ai/keys/openrouter/check")).statusCode).toBe(200);
    }
    const over = await t.post("/api/ai/keys/openrouter/check");
    expect(over.statusCode).toBe(429);
    // Someone else is not locked out by it.
    await asSecond();
    expect((await t.post("/api/ai/keys/openrouter/check")).statusCode).toBe(200);
  });

  it("counts calls and spending for each person, the older lines being the admin's", async () => {
    await twoPeople();
    // A line from before calls named a person.
    await t.services.aiLog.append({
      at: new Date().toISOString(),
      task: "extraction",
      model: "openrouter:test/model",
      provider: "openrouter",
      promptTokens: 1,
      completionTokens: 1,
      costUsd: 0.5,
      entry: null,
      ok: true,
    });
    await t.post("/api/settings/ai/test");
    const mine = (await t.get("/api/ai/log")).json();
    expect(mine.calls).toHaveLength(2);
    expect(mine.totalUsd).toBeCloseTo(0.501, 3);
    expect((await t.get("/api/settings")).json().ai.spentUsd).toBeCloseTo(0.501, 3);

    await asSecond();
    const theirs = (await t.get("/api/ai/log")).json();
    expect(theirs.calls).toHaveLength(0);
    expect(theirs.totalUsd).toBe(0);
    expect((await t.get("/api/settings")).json().ai.spentUsd).toBe(0);
    await t.post("/api/settings/ai/test");
    const after = (await t.get("/api/ai/log")).json();
    expect(after.calls).toHaveLength(1);
    expect(after.totalUsd).toBeCloseTo(0.001, 3);
  });

  it("shows the notice about removed keys only to the server's owner, who alone clears it", async () => {
    await twoPeople();
    t.services.status.keysWereRemoved({
      at: "2026-11-20T00:00:00.000Z",
      providers: ["OpenRouter"],
      environment: [],
    });
    expect((await t.get("/api/status")).json().notices.keysRemoved).toMatchObject({
      providers: ["OpenRouter"],
    });
    await asSecond();
    expect((await t.get("/api/status")).json().notices.keysRemoved).toBeNull();
    const refused = await t.del("/api/notices/keys-removed");
    expect(refused.statusCode).toBe(403);
    expect((await t.services.settings.read())!.ai.keysRemoved).toBeNull();
    t.cookie = "";
    await t.login();
    expect((await t.del("/api/notices/keys-removed")).statusCode).toBe(200);
    expect((await t.get("/api/status")).json().notices.keysRemoved).toBeNull();
  });
});

describe("provider keys still set in the environment", () => {
  it("are told to the owner once, and not again after it is cleared", async () => {
    t = await makeTestApp({ OPENROUTER_API_KEY: "sk-or-env-0000", XAI_API_KEY: "xai-env-0000" });
    // The settings file exists once the first account does; the next start finds the variables.
    const second = await buildApp(t.services.config, {});
    try {
      expect(second.services.status.snapshot().notices.keysRemoved).toMatchObject({
        providers: [],
        environment: ["OPENROUTER_API_KEY", "XAI_API_KEY"],
      });
      expect((await t.services.settings.read())!.ai.envKeysNoticed).toBe(true);
    } finally {
      await second.app.close();
    }
    // Cleared by the owner, it is not made again at the start after.
    await t.login();
    t.services.status.keysWereRemoved({ at: "x", providers: [], environment: [] });
    expect((await t.del("/api/notices/keys-removed")).statusCode).toBe(200);
    const third = await buildApp(t.services.config, {});
    try {
      expect(third.services.status.snapshot().notices.keysRemoved).toBeNull();
    } finally {
      await third.app.close();
    }
  });
});
