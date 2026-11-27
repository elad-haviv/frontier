// @vitest-environment happy-dom
import { AI_KEYS_HEADER, decodeDeviceKeys } from "@frontier/schema";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  checkOf,
  deviceKeys,
  hasDeviceKey,
  keysHeaderValue,
  recordCheck,
  removeDeviceKey,
  resetKeysForTests,
  setDeviceKey,
  setKeysOwner,
} from "./aiKeys.ts";

beforeEach(() => {
  localStorage.clear();
  resetKeysForTests();
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("the AI keys this device holds", () => {
  it("are kept per provider, survive a reload, and are removed one by one", () => {
    expect(deviceKeys()).toEqual({});
    expect(keysHeaderValue()).toBeNull();
    setDeviceKey("openrouter", "  sk-or-abc123  ", {
      at: "2026-11-01T10:00:00Z",
      ok: true,
      message: null,
    });
    setDeviceKey("anthropic", "sk-ant-xyz789");
    expect(deviceKeys()).toEqual({ openrouter: "sk-or-abc123", anthropic: "sk-ant-xyz789" });
    expect(hasDeviceKey("openrouter")).toBe(true);
    expect(hasDeviceKey("google")).toBe(false);
    expect(checkOf("openrouter")).toEqual({ at: "2026-11-01T10:00:00Z", ok: true, message: null });
    expect(checkOf("anthropic")).toBeNull();

    // A new page load reads them from storage.
    resetKeysForTests();
    expect(deviceKeys()).toEqual({ openrouter: "sk-or-abc123", anthropic: "sk-ant-xyz789" });
    expect(checkOf("openrouter")?.ok).toBe(true);

    removeDeviceKey("openrouter");
    resetKeysForTests();
    expect(deviceKeys()).toEqual({ anthropic: "sk-ant-xyz789" });
    expect(checkOf("openrouter")).toBeNull();
  });

  it("make the header's value, which the server reads back", () => {
    setDeviceKey("openrouter", "sk-or-abc123");
    expect(AI_KEYS_HEADER).toBe("frontier-ai-keys");
    expect(decodeDeviceKeys(keysHeaderValue()!)).toEqual({ openrouter: "sk-or-abc123" });
    // One key alone, as when a key is tested before it is kept.
    expect(decodeDeviceKeys(keysHeaderValue({ xai: "xai-1234" })!)).toEqual({ xai: "xai-1234" });
  });

  it("record what a test found, only for a key that is there", () => {
    recordCheck("google", { at: "2026-11-01T10:00:00Z", ok: true, message: null });
    expect(checkOf("google")).toBeNull();
    setDeviceKey("google", "AIzaSyKey1234567");
    recordCheck("google", { at: "2026-11-02T10:00:00Z", ok: false, message: "Refused (401)." });
    expect(checkOf("google")).toEqual({
      at: "2026-11-02T10:00:00Z",
      ok: false,
      message: "Refused (401).",
    });
  });

  it("ignore what storage holds that is not a key, and work in memory when storage is blocked", () => {
    localStorage.setItem(
      "frontier.aiKeys:p1",
      JSON.stringify({ openrouter: "ok-key-1", nobody: "x", xai: 5 }),
    );
    localStorage.setItem("frontier.aiKeys.checks:p1", "not json");
    resetKeysForTests();
    expect(deviceKeys()).toEqual({ openrouter: "ok-key-1" });
    expect(checkOf("openrouter")).toBeNull();

    // Storage blocked, as in a private window: the keys are held in memory while the page is open.
    const blocked = () => {
      throw new Error("blocked");
    };
    vi.stubGlobal("localStorage", { getItem: blocked, setItem: blocked, removeItem: blocked });
    setDeviceKey("xai", "xai-abcd1234");
    expect(deviceKeys().xai).toBe("xai-abcd1234");
    resetKeysForTests();
    expect(deviceKeys()).toEqual({});
  });

  it("are never put in the service worker's cache: they live only in localStorage", () => {
    setDeviceKey("openrouter", "sk-or-abc123");
    expect(localStorage.getItem("frontier.aiKeys:p1")).toContain("sk-or-abc123");
    expect(Object.keys(sessionStorage)).toEqual([]);
  });

  it("are filed under the person signed in: another login neither reads nor sends them, and logging out keeps them", () => {
    setDeviceKey("openrouter", "sk-or-abc123", {
      at: "2026-11-01T10:00:00Z",
      ok: true,
      message: null,
    });
    // Logged out: nobody's keys are read or sent.
    setKeysOwner(null);
    expect(deviceKeys()).toEqual({});
    expect(keysHeaderValue()).toBeNull();
    expect(hasDeviceKey("openrouter")).toBe(false);
    // Someone else logs in on the same browser.
    setKeysOwner("p2");
    expect(deviceKeys()).toEqual({});
    expect(keysHeaderValue()).toBeNull();
    expect(checkOf("openrouter")).toBeNull();
    setDeviceKey("anthropic", "sk-ant-two");
    expect(deviceKeys()).toEqual({ anthropic: "sk-ant-two" });
    // The first person comes back: their keys and their check are waiting, the other's are not.
    setKeysOwner(null);
    setKeysOwner("p1");
    expect(deviceKeys()).toEqual({ openrouter: "sk-or-abc123" });
    expect(checkOf("openrouter")?.ok).toBe(true);
  });

  it("kept before they were filed go to the first person who signs in, once", () => {
    resetKeysForTests(null);
    localStorage.setItem("frontier.aiKeys", JSON.stringify({ openrouter: "sk-or-old1234" }));
    localStorage.setItem(
      "frontier.aiKeys.checks",
      JSON.stringify({ openrouter: { at: "2026-11-01T10:00:00Z", ok: true, message: null } }),
    );
    expect(deviceKeys()).toEqual({});
    setKeysOwner("first");
    expect(deviceKeys()).toEqual({ openrouter: "sk-or-old1234" });
    expect(checkOf("openrouter")?.ok).toBe(true);
    expect(localStorage.getItem("frontier.aiKeys")).toBeNull();
    // The next person does not get them.
    setKeysOwner("second");
    expect(deviceKeys()).toEqual({});
  });
});
