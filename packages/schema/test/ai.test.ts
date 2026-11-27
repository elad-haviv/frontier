import { describe, expect, it } from "vitest";
import {
  AI_KEYS_HEADER,
  AiSettings,
  decodeDeviceKeys,
  encodeDeviceKeys,
  maskKey,
  qualifyModelId,
  Settings,
  splitModelId,
} from "../src/index.js";

describe("model ids", () => {
  it("read a bare id as OpenRouter's and keep a provider's own colons", () => {
    expect(splitModelId("anthropic/claude-sonnet-4.5")).toEqual({
      provider: "openrouter",
      model: "anthropic/claude-sonnet-4.5",
    });
    // OpenRouter's variants have a colon after the slash.
    expect(splitModelId("openai/gpt-4o:free")).toEqual({
      provider: "openrouter",
      model: "openai/gpt-4o:free",
    });
    expect(splitModelId("anthropic:claude-sonnet-5-5")).toEqual({
      provider: "anthropic",
      model: "claude-sonnet-5-5",
    });
    expect(splitModelId("openrouter:x/y")).toEqual({ provider: "openrouter", model: "x/y" });
    // Something that only looks like a provider stays OpenRouter's.
    expect(splitModelId("meta:llama")).toEqual({ provider: "openrouter", model: "meta:llama" });
    expect(qualifyModelId("test/model")).toBe("openrouter:test/model");
    expect(qualifyModelId(qualifyModelId("test/model"))).toBe("openrouter:test/model");
  });
});

describe("AI settings", () => {
  it("qualify the models of settings written before stage 18", () => {
    const read = AiSettings.parse({ models: { extraction: "test/model", conversation: "" } });
    expect(read.models).toEqual({
      extraction: "openrouter:test/model",
      conversation: null,
      art: null,
    });
    expect(AiSettings.parse(read)).toEqual(read);
  });

  it("drop the keys and providers an older file held, which now live on each device", () => {
    const read = AiSettings.parse({
      key: { iv: "a", data: "b", tag: "c" },
      providers: [{ id: "openrouter", kind: "openrouter", key: { iv: "n", data: "e", tag: "w" } }],
      monthlyCapUsd: 10,
    });
    expect(read).not.toHaveProperty("key");
    expect(read).not.toHaveProperty("providers");
    expect(read).not.toHaveProperty("monthlyCapUsd");
    expect(read.keysRemoved).toBeNull();
  });

  it("read with defaults from a file without them", () => {
    const s = Settings.parse({ passwordHash: "x" });
    expect(s.ai).toMatchObject({ modelPrices: {}, models: { extraction: null } });
  });
});

describe("the keys a device sends", () => {
  it("round-trip through the header's value", () => {
    const keys = { openrouter: "sk-or-abc123", anthropic: "sk-ant-xyz789" };
    expect(AI_KEYS_HEADER).toBe("frontier-ai-keys");
    expect(decodeDeviceKeys(encodeDeviceKeys(keys))).toEqual(keys);
  });

  it("leave out what cannot be a key instead of failing", () => {
    expect(decodeDeviceKeys(undefined)).toEqual({});
    expect(decodeDeviceKeys("not base64 at all!")).toEqual({});
    expect(decodeDeviceKeys(btoa("[1,2]"))).toEqual({});
    expect(decodeDeviceKeys(btoa("null"))).toEqual({});
    const mixed = btoa(
      JSON.stringify({ openrouter: "ok-key-1", anthropic: "has space", nobody: "sk-x", xai: 5 }),
    );
    expect(decodeDeviceKeys(mixed)).toEqual({ openrouter: "ok-key-1" });
  });
});

describe("keys shown", () => {
  it("are masked to their prefix and last four characters", () => {
    expect(maskKey("sk-or-v1-abcdefghijkla1b2")).toBe("sk-…a1b2");
    expect(maskKey("sk-ant-api03-xyzxyzxyz9f3e")).toBe("sk-…9f3e");
    expect(maskKey("xai-abcdefghijk1234")).toBe("xai-…1234");
    expect(maskKey("AIzaSyAbcdefghij5678")).toBe("…5678");
    expect(maskKey("short")).toBe("…rt");
  });
});
