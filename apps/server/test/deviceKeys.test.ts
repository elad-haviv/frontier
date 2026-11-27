/**
 * AI keys live on the device (stage 27f). The server gets one with a request that needs it, uses
 * it for that request, and keeps nothing: not on disk, not in a backup, not in the AI call log,
 * not in the server's own log, not in an error that is sent back.
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AI_KEYS_HEADER, encodeDeviceKeys } from "@frontier/schema";
import { FieldJob } from "../src/ai/job.js";
import { deviceKey, deviceKeys, withDeviceKeys } from "../src/ai/keyring.js";
import { ApiError } from "../src/errors.js";
import { makeTestApp, type TestApp } from "./helpers/app.js";

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
    expect(failed.statusCode).toBe(502);
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

describe("a run over a folder", () => {
  it("stops when the key goes missing, as it does for a model that is off", async () => {
    for (const code of ["ai_key_missing", "ai_off"] as const) {
      const proposed: string[] = [];
      const proposer = {
        candidates: () => ["a.md", "b.md", "c.md"],
        propose: async (path: string) => {
          proposed.push(path);
          if (path === "b.md") throw new ApiError(code, "Nothing to call.");
          return 1;
        },
      };
      const job = new FieldJob(proposer as never);
      job.start("");
      await job.finished();
      expect(proposed).toEqual(["a.md", "b.md"]);
      expect(job.snapshot()).toMatchObject({
        state: "stopped",
        stoppedBy: "Nothing to call.",
        made: 1,
        done: 1,
      });
    }
  });
});
