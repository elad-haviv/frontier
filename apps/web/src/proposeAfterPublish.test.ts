import { describe, expect, it, vi } from "vitest";
import { type ProposeDeps, proposeAfterPublish, resumeProposals } from "./proposeAfterPublish.ts";

const deps = (over: Partial<ProposeDeps> & { on?: boolean; model?: string | null } = {}) => {
  const proposed: string[] = [];
  /** What the device remembers; a test that "closes the tab" keeps it and builds new deps. */
  const waiting: string[] = [];
  const d: ProposeDeps = {
    pending: {
      read: () => [...waiting],
      write: (paths) => void waiting.splice(0, waiting.length, ...paths),
    },
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
  if (over.pending) d.pending = over.pending;
  return {
    d,
    proposed,
    get waiting() {
      return d.pending!.read();
    },
  };
};

describe("field proposals after a publish", () => {
  it("are asked for, entry by entry, with this device's key", async () => {
    const { d, proposed } = deps();
    expect(await proposeAfterPublish(null, ["a.md", "b.md"], d)).toBe(4);
    expect(proposed).toEqual(["a.md", "b.md"]);
  });

  it("do nothing when the setting is off, no model is chosen or nothing was published", async () => {
    for (const d of [deps({ on: false }), deps({ model: null })]) {
      expect(await proposeAfterPublish(null, ["a.md"], d.d)).toBe(0);
      expect(d.proposed).toEqual([]);
    }
    const none = deps();
    expect(await proposeAfterPublish(null, [], none.d)).toBe(0);
    expect(none.proposed).toEqual([]);
  });

  it("do nothing, quietly, when this device has no key for the model's provider", async () => {
    const { d, proposed } = deps({ model: "openrouter:test/model" });
    expect(await proposeAfterPublish(null, ["a.md"], d)).toBe(0);
    expect(proposed).toEqual([]);
  });

  it("go on past an entry that fails, and past settings that cannot be read", async () => {
    const propose = vi
      .fn()
      .mockRejectedValueOnce(new Error("not a note"))
      .mockResolvedValueOnce({ made: 1 });
    const { d } = deps({ propose });
    expect(await proposeAfterPublish(null, ["a.json", "b.md"], d)).toBe(1);
    const broken = deps({
      settings: async () => {
        throw new Error("offline");
      },
    });
    expect(await proposeAfterPublish(null, ["a.md"], broken.d)).toBe(0);
  });

  it("are kept on the device until asked for, so a closed tab loses none of them", async () => {
    // The page is closed before any answer: the settings cannot be read.
    const first = deps({
      settings: async () => {
        throw new Error("offline");
      },
    });
    await proposeAfterPublish(null, ["a.md", "b.md"], first.d);
    expect(first.waiting).toEqual(["a.md", "b.md"]);

    // The next load, online and with the key, goes on where it was left.
    const next = deps({ pending: first.d.pending! });
    expect(await resumeProposals(null, next.d)).toBe(4);
    expect(next.proposed).toEqual(["a.md", "b.md"]);
    expect(next.waiting).toEqual([]);
    // Nothing waiting, nothing asked.
    expect(await resumeProposals(null, next.d)).toBe(0);
  });

  it("wait for a key, and for the connection, and drop an entry that is gone", async () => {
    const noKey = deps({ hasKey: () => false });
    await proposeAfterPublish(null, ["a.md", "gone.md", "b.md"], noKey.d);
    expect(noKey.waiting).toEqual(["a.md", "gone.md", "b.md"]);

    // Online with the key, the connection drops after the first entry.
    const calls: string[] = [];
    const flaky = deps({
      pending: noKey.d.pending!,
      propose: async (path) => {
        calls.push(path);
        if (path === "gone.md")
          throw Object.assign(new Error("There is no such entry."), {
            code: "not_found",
            status: 404,
          });
        if (path === "b.md")
          throw Object.assign(new Error("offline"), { code: "offline", status: 0 });
        return { made: 1 };
      },
    });
    expect(await resumeProposals(null, flaky.d)).toBe(1);
    // "a.md" was made, "gone.md" no longer exists and is dropped, "b.md" waits for the connection.
    expect(calls).toEqual(["a.md", "gone.md", "b.md"]);
    expect(flaky.waiting).toEqual(["b.md"]);
  });

  it("are forgotten when the setting is off, as there is nothing to wait for", async () => {
    const off = deps({ on: false });
    await proposeAfterPublish(null, ["a.md"], off.d);
    expect(off.waiting).toEqual([]);
  });
});
