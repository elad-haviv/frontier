import { describe, expect, it, vi } from "vitest";
import { type ProposeDeps, proposeAfterPublish } from "./proposeAfterPublish.ts";

const deps = (over: Partial<ProposeDeps> & { on?: boolean; model?: string | null } = {}) => {
  const proposed: string[] = [];
  const d: ProposeDeps = {
    settings: async () => ({
      ai: {
        proposeOnPublish: over.on ?? true,
        models: { extraction: over.model === undefined ? "anthropic:claude-x" : over.model },
      },
    }),
    propose: async (path) => {
      proposed.push(path);
      return { made: 2 };
    },
    hasKey: (kind) => kind === "anthropic",
    ...over,
  };
  return { d, proposed };
};

describe("field proposals after a publish", () => {
  it("are asked for, entry by entry, with this device's key", async () => {
    const { d, proposed } = deps();
    expect(await proposeAfterPublish(["a.md", "b.md"], d)).toBe(4);
    expect(proposed).toEqual(["a.md", "b.md"]);
  });

  it("do nothing when the setting is off, no model is chosen or nothing was published", async () => {
    for (const d of [deps({ on: false }), deps({ model: null })]) {
      expect(await proposeAfterPublish(["a.md"], d.d)).toBe(0);
      expect(d.proposed).toEqual([]);
    }
    const none = deps();
    expect(await proposeAfterPublish([], none.d)).toBe(0);
    expect(none.proposed).toEqual([]);
  });

  it("do nothing, quietly, when this device has no key for the model's provider", async () => {
    const { d, proposed } = deps({ model: "openrouter:test/model" });
    expect(await proposeAfterPublish(["a.md"], d)).toBe(0);
    expect(proposed).toEqual([]);
  });

  it("go on past an entry that fails, and past settings that cannot be read", async () => {
    const propose = vi
      .fn()
      .mockRejectedValueOnce(new Error("not a note"))
      .mockResolvedValueOnce({ made: 1 });
    const { d } = deps({ propose });
    expect(await proposeAfterPublish(["a.json", "b.md"], d)).toBe(1);
    const broken = deps({
      settings: async () => {
        throw new Error("offline");
      },
    });
    expect(await proposeAfterPublish(["a.md"], broken.d)).toBe(0);
  });
});
