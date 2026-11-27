// @vitest-environment happy-dom
import { AI_KEYS_HEADER, decodeDeviceKeys } from "@frontier/schema";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { checkOf, removeDeviceKey, resetKeysForTests, setDeviceKey } from "./aiKeys.ts";
import { api, ApiFailure, featureOf, needsAiKeys, setKeyPrompt } from "./api.ts";
import { setCurrentProject } from "./project.ts";

// Every test runs in one project: its calls go to `/api/p/avalymia/...`.
setCurrentProject({ id: "avalymia01", slug: "avalymia" });

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
const missing = (provider = "openrouter") =>
  json(409, {
    error: {
      code: "ai_key_missing",
      message: "No key on this device for OpenRouter. Add one under AI keys.",
      provider,
      href: "/settings/device/ai-keys",
    },
  });

/** Answers each request with the next of `replies`, and keeps what was asked. */
function answers(...replies: (() => Response)[]) {
  const asked: { url: string; headers: Record<string, string> }[] = [];
  let n = 0;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      asked.push({ url, headers: init.headers as Record<string, string> });
      return replies[Math.min(n++, replies.length - 1)]!();
    }),
  );
  return asked;
}

beforeEach(() => {
  localStorage.clear();
  resetKeysForTests();
});
afterEach(() => {
  vi.unstubAllGlobals();
  setKeyPrompt(null);
  removeDeviceKey("openrouter");
});

describe("which requests carry the keys", () => {
  it("is every request that can lead to an AI call, and no other", () => {
    for (const url of [
      "/api/lore",
      "/api/lore/stream",
      "/api/lore/abc/turns/0/addition",
      "/api/lore/draft/check",
      "/api/write/rewrite",
      "/api/characters/say",
      "/api/ai/models?refresh=1",
      "/api/settings/ai/test",
      "/api/proposals/fields",
      "/api/proposals/job",
      "/api/maps/abc/discover",
      "/api/maps/abc/discover/estimate",
      "/api/maps/abc/generate",
      "/api/maps/abc/discoveries/d1/art",
      "/api/comments/c1/work",
      "/api/write/review",
      "/api/keep-going/whats-missing",
      "/api/keep-going/question?tz=60",
    ]) {
      expect(needsAiKeys(url), url).toBe(true);
    }
    for (const url of [
      "/api/tree",
      "/api/entries?path=a.md",
      "/api/settings",
      "/api/settings/ai",
      "/api/ai/log",
      "/api/comments",
      "/api/comments/c1",
      "/api/keep-going/queue",
      "/api/keep-going/week?tz=0",
      "/api/maps/abc/discoveries",
      "/api/drafts",
      "/api/publish/confirm",
      "/api/login",
    ]) {
      expect(needsAiKeys(url), url).toBe(false);
    }
  });

  it("send the device's keys in one header, and only with those requests", async () => {
    setDeviceKey("openrouter", "sk-or-abc123");
    setDeviceKey("anthropic", "sk-ant-xyz789");
    const asked = answers(() => json(200, { ok: true }));
    await api.tree();
    await api.proposeFields("a.md");
    expect(asked[0]!.headers[AI_KEYS_HEADER]).toBeUndefined();
    expect(decodeDeviceKeys(asked[1]!.headers[AI_KEYS_HEADER])).toEqual({
      openrouter: "sk-or-abc123",
      anthropic: "sk-ant-xyz789",
    });
  });

  it("send no header from a device with no key", async () => {
    const asked = answers(() => json(200, { made: 0 }));
    await api.proposeFields("a.md");
    expect(asked[0]!.headers[AI_KEYS_HEADER]).toBeUndefined();
  });

  it("send only the key that is being tested, with a check", async () => {
    setDeviceKey("openrouter", "sk-or-kept");
    const asked = answers(() => json(200, { ok: true, refused: false, message: "", models: 1 }));
    await api.checkKey("anthropic", "sk-ant-typed");
    expect(asked[0]!.url).toBe("/api/ai/keys/anthropic/check");
    expect(decodeDeviceKeys(asked[0]!.headers[AI_KEYS_HEADER])).toEqual({
      anthropic: "sk-ant-typed",
    });
  });
});

describe("a request that finds no key on this device", () => {
  it("opens the explanation, and goes again with the key that was added", async () => {
    const asked = answers(missing, () => json(200, { made: 2 }));
    const ask = vi.fn(async (a: { feature: string; provider: string | null }) => {
      expect(a).toEqual({ feature: "Proposing fields", provider: "openrouter" });
      setDeviceKey("openrouter", "sk-or-new1234");
      return true;
    });
    setKeyPrompt(ask);
    expect(await api.proposeFields("a.md")).toEqual({ made: 2 });
    expect(ask).toHaveBeenCalledTimes(1);
    expect(asked).toHaveLength(2);
    expect(asked[0]!.headers[AI_KEYS_HEADER]).toBeUndefined();
    expect(decodeDeviceKeys(asked[1]!.headers[AI_KEYS_HEADER])).toEqual({
      openrouter: "sk-or-new1234",
    });
  });

  it("fails with the server's words when the key is not added, and when nothing can ask", async () => {
    answers(missing);
    setKeyPrompt(async () => false);
    const refused = await api.proposeFields("a.md").catch((e: unknown) => e as ApiFailure);
    expect(refused).toBeInstanceOf(ApiFailure);
    expect(refused).toMatchObject({
      code: "ai_key_missing",
      provider: "openrouter",
      href: "/settings/device/ai-keys",
    });
    setKeyPrompt(null);
    const alone = await api.proposeFields("a.md").catch((e: unknown) => e as ApiFailure);
    expect(alone).toMatchObject({ code: "ai_key_missing" });
  });

  it("asks only once for one request: a key that still does not work is the server's to say", async () => {
    const asked = answers(missing, missing);
    const ask = vi.fn(async () => true);
    setKeyPrompt(ask);
    await expect(api.proposeFields("a.md")).rejects.toMatchObject({ code: "ai_key_missing" });
    expect(ask).toHaveBeenCalledTimes(1);
    expect(asked).toHaveLength(2);
  });

  it("does the same for an answer that streams", async () => {
    const stream = () =>
      new Response('event: done\ndata: {"conversation":{"id":"c"}}\n\n', {
        headers: { "content-type": "text/event-stream" },
      });
    const asked = answers(missing, stream);
    setKeyPrompt(async () => {
      setDeviceKey("openrouter", "sk-or-new1234");
      return true;
    });
    const got = await api.askStreamed("Who?", undefined, () => undefined);
    expect(got).toEqual({ conversation: { id: "c" } });
    expect(asked).toHaveLength(2);
    expect(decodeDeviceKeys(asked[1]!.headers[AI_KEYS_HEADER])).toEqual({
      openrouter: "sk-or-new1234",
    });
  });
});

const rejected = (provider = "openrouter") =>
  json(409, {
    error: {
      code: "ai_key_rejected",
      message: "OpenRouter did not accept the key on this device. Add a working key under AI keys.",
      provider,
      href: "/settings/device/ai-keys",
    },
  });

describe("a key the provider turned away during use", () => {
  it("is recorded as not working, then the key is asked for in place, and the request goes again once", async () => {
    setDeviceKey("openrouter", "sk-or-old1234", {
      at: "2026-11-01T10:00:00Z",
      ok: true,
      message: null,
    });
    const asked = answers(rejected, () => json(200, { made: 3 }));
    const ask = vi.fn(async (a: { rejected?: boolean; provider: string | null }) => {
      // The section and the rail already stop saying "Working" while the dialog is open.
      expect(checkOf("openrouter")?.ok).toBe(false);
      expect(a).toMatchObject({ provider: "openrouter", rejected: true });
      setDeviceKey("openrouter", "sk-or-new1234", {
        at: "2026-11-02T10:00:00Z",
        ok: true,
        message: null,
      });
      return true;
    });
    setKeyPrompt(ask);
    expect(await api.proposeFields("a.md")).toEqual({ made: 3 });
    expect(ask).toHaveBeenCalledTimes(1);
    expect(asked).toHaveLength(2);
    expect(decodeDeviceKeys(asked[1]!.headers[AI_KEYS_HEADER])).toEqual({
      openrouter: "sk-or-new1234",
    });
    expect(checkOf("openrouter")?.ok).toBe(true);
  });

  it("is only recorded, with no dialog, for proposals that run by themselves", async () => {
    setDeviceKey("openrouter", "sk-or-old1234", {
      at: "2026-11-01T10:00:00Z",
      ok: true,
      message: null,
    });
    answers(rejected);
    const ask = vi.fn(async () => true);
    setKeyPrompt(ask);
    await expect(api.proposeFields("a.md", true)).rejects.toMatchObject({
      code: "ai_key_rejected",
    });
    expect(ask).not.toHaveBeenCalled();
    expect(checkOf("openrouter")?.ok).toBe(false);
  });

  it("is asked for once: a second refusal is the person's to read", async () => {
    setDeviceKey("openrouter", "sk-or-old1234");
    const asked = answers(rejected, rejected);
    setKeyPrompt(async () => true);
    await expect(api.proposeFields("a.md")).rejects.toMatchObject({ code: "ai_key_rejected" });
    expect(asked).toHaveLength(2);
  });
});

describe("a check of a key", () => {
  it("never opens the key dialog by itself", async () => {
    answers(missing);
    const ask = vi.fn(async () => true);
    setKeyPrompt(ask);
    await expect(api.checkKey("openrouter", "sk-or-typed1234")).rejects.toMatchObject({
      code: "ai_key_missing",
    });
    expect(ask).not.toHaveBeenCalled();
  });
});

describe("the feature a request is for", () => {
  it("is named in the words of the explanation's heading", () => {
    expect(featureOf("/api/lore/stream")).toBe("Ask");
    expect(featureOf("/api/keep-going/question")).toBe("The question of the day");
    expect(featureOf("/api/keep-going/whats-missing")).toBe("What's missing here");
    expect(featureOf("/api/lore/draft")).toBe("Drafting an entry");
    expect(featureOf("/api/lore/c/turns/1/addition")).toBe("Adding to an entry");
    expect(featureOf("/api/write/rewrite")).toBe("Writing help");
    expect(featureOf("/api/characters/say")).toBe("Talking with a character");
    expect(featureOf("/api/maps/m/discover")).toBe("Exploring the map");
    expect(featureOf("/api/maps/m/discoveries/d/art")).toBe("Concept art");
    expect(featureOf("/api/comments/c/work")).toBe("Work on it");
    expect(featureOf("/api/proposals/job")).toBe("Proposing fields");
    expect(featureOf("/api/settings/ai/test")).toBe("Trying a model");
    expect(featureOf("/api/ai/models")).toBe("AI help");
  });
});
