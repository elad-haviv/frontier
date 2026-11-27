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
      "frontier.aiKeys",
      JSON.stringify({ openrouter: "ok-key-1", nobody: "x", xai: 5 }),
    );
    localStorage.setItem("frontier.aiKeys.checks", "not json");
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
    expect(localStorage.getItem("frontier.aiKeys")).toContain("sk-or-abc123");
    expect(Object.keys(sessionStorage)).toEqual([]);
  });
});
