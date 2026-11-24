import { describe, expect, it } from "vitest";
import { AiSettings, qualifyModelId, Settings, splitModelId } from "../src/index.js";

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
    expect(splitModelId("custom-2:llama3:8b")).toEqual({
      provider: "custom-2",
      model: "llama3:8b",
    });
    expect(splitModelId("openrouter:x/y")).toEqual({ provider: "openrouter", model: "x/y" });
    // Something that only looks like a provider stays OpenRouter's.
    expect(splitModelId("meta:llama")).toEqual({ provider: "openrouter", model: "meta:llama" });
    expect(qualifyModelId("test/model")).toBe("openrouter:test/model");
    expect(qualifyModelId(qualifyModelId("test/model"))).toBe("openrouter:test/model");
  });
});

describe("AI settings before stage 18", () => {
  const key = { iv: "a", data: "b", tag: "c" };

  it("become an OpenRouter provider with qualified models, and stay so when read again", () => {
    const read = AiSettings.parse({ key, models: { extraction: "test/model", conversation: "" } });
    expect(read.key).toBeNull();
    expect(read.providers).toEqual([
      {
        id: "openrouter",
        kind: "openrouter",
        name: null,
        key,
        baseUrl: null,
        enabled: true,
        addedAt: null,
        check: null,
      },
    ]);
    expect(read.models).toEqual({
      extraction: "openrouter:test/model",
      conversation: null,
      art: null,
    });
    expect(AiSettings.parse(read)).toEqual(read);
  });

  it("keep a stored OpenRouter provider over the old key", () => {
    const stored = { id: "openrouter", kind: "openrouter", key: { iv: "n", data: "e", tag: "w" } };
    const read = AiSettings.parse({ key, providers: [stored] });
    expect(read.providers).toHaveLength(1);
    expect(read.providers[0]!.key).toEqual(stored.key);
  });

  it("read with defaults from a file without them", () => {
    const s = Settings.parse({ passwordHash: "x" });
    expect(s.ai).toMatchObject({ providers: [], modelPrices: {}, models: { extraction: null } });
  });
});
