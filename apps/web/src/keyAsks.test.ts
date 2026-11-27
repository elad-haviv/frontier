import { describe, expect, it } from "vitest";
import { KeyAsks } from "./keyAsks.ts";

describe("the asks that wait for a key", () => {
  it("are not answered by a key for another provider", async () => {
    const have = new Set<string>();
    const asks = new KeyAsks((k) => have.has(k));
    let answer: boolean | null = null;
    void asks.add({ feature: "Proposing fields", provider: "anthropic" }).then((v) => (answer = v));
    // The person keeps an OpenRouter key, but the chosen model is Anthropic's.
    have.add("openrouter");
    asks.kept("openrouter");
    await Promise.resolve();
    expect(answer).toBeNull();
    expect(asks.first()).toMatchObject({ provider: "anthropic" });
    // Once an Anthropic key is kept, it goes on.
    have.add("anthropic");
    asks.kept("anthropic");
    await Promise.resolve();
    expect(answer).toBe(true);
    expect(asks.first()).toBeNull();
  });

  it("queue per provider, so two racing requests each get what they need", async () => {
    const have = new Set<string>();
    const asks = new KeyAsks((k) => have.has(k));
    const done: string[] = [];
    void asks.add({ feature: "Ask", provider: "openrouter" }).then((v) => v && done.push("a"));
    void asks.add({ feature: "Writing help", provider: "google" }).then((v) => v && done.push("b"));
    void asks.add({ feature: "Ask", provider: "openrouter" }).then((v) => v && done.push("c"));
    have.add("openrouter");
    asks.kept("openrouter");
    await Promise.resolve();
    // Both asks for OpenRouter go on together; Google's waits and is next in the dialog.
    expect(done.sort()).toEqual(["a", "c"]);
    expect(asks.first()).toMatchObject({ provider: "google" });
    have.add("google");
    asks.kept("google");
    await Promise.resolve();
    expect(done.sort()).toEqual(["a", "b", "c"]);
  });

  it("go on only with a new key when the old one was turned away, and fail together when closed", async () => {
    const asks = new KeyAsks(() => true);
    const out: boolean[] = [];
    void asks
      .add({ feature: "Ask", provider: "openrouter", rejected: true })
      .then((v) => out.push(v));
    // A key is still there for the provider, but it is the one that was refused.
    asks.kept("anthropic");
    await Promise.resolve();
    expect(out).toEqual([]);
    asks.kept("openrouter");
    await Promise.resolve();
    expect(out).toEqual([true]);

    void asks.add({ feature: "Ask", provider: "xai" }).then((v) => out.push(v));
    void asks.add({ feature: "Ask", provider: "xai" }).then((v) => out.push(v));
    asks.closed();
    await Promise.resolve();
    expect(out).toEqual([true, false, false]);
  });
});
