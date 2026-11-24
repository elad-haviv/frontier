import type { CatalogModel } from "@frontier/schema";
import { describe, expect, it } from "vitest";
import { fuzzy, matches, needsPrice, whyNot } from "./ModelPicker.tsx";

const model = (over: Partial<CatalogModel> = {}): CatalogModel => ({
  id: "anthropic:claude-sonnet-5-5",
  model: "claude-sonnet-5-5",
  name: "Claude Sonnet 5.5",
  description: null,
  provider: "anthropic",
  providerKind: "anthropic",
  providerName: "Anthropic",
  contextLength: 1_000_000,
  maxOutput: null,
  promptPrice: 3,
  completionPrice: 15,
  imagePrice: null,
  priceFrom: "openrouter",
  checked: true,
  costReported: false,
  abilities: {
    structuredOutput: true,
    imagesIn: true,
    imageOut: false,
    reasoning: true,
    tools: true,
  },
  suits: { extraction: "yes", conversation: "yes", art: "no" },
  recommendedFor: [],
  ...over,
});

describe("the model picker's search", () => {
  it("forgives a missing letter and prefers a run of letters", () => {
    expect(fuzzy("sonet", "Claude Sonnet")).not.toBeNull();
    expect(fuzzy("xyz", "Claude Sonnet")).toBeNull();
    expect(fuzzy("son", "Sonnet")!.score).toBeGreaterThan(fuzzy("snt", "Sonnet")!.score);
    expect(fuzzy("net", "Sonnet")!.at).toEqual([3, 4, 5]);
  });

  it("needs every word, in the name, the id or the provider", () => {
    expect(matches("sonet anthropic", model())).not.toBeNull();
    expect(matches("5-5", model())).not.toBeNull();
    expect(matches("sonnet openai", model())).toBeNull();
    expect(matches("", model())).toEqual({ score: 0, inName: [] });
  });

  it("says why a model cannot do a task, and when a price must be typed first", () => {
    expect(whyNot("conversation", model())).toBeNull();
    expect(whyNot("art", model())).toBe("makes no pictures, which concept art needs");
    expect(
      whyNot("extraction", model({ suits: { extraction: "no", conversation: "no", art: "no" } })),
    ).toMatch(/fixed-form answers/);
    expect(needsPrice(model())).toBe(false);
    expect(needsPrice(model({ promptPrice: null, completionPrice: null }))).toBe(true);
    // A provider that reports each call's cost needs no price.
    expect(
      needsPrice(model({ promptPrice: null, completionPrice: null, costReported: true })),
    ).toBe(false);
  });
});
