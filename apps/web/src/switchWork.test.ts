// @vitest-environment happy-dom
import "fake-indexeddb/auto";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { setKeysOwner } from "./aiKeys.ts";
import { completeLinks, linkTarget } from "./components/linkComplete.ts";
import { makeEntry } from "./map/featureEntry.ts";
import { setCurrentProject } from "./project.ts";
import { togglePin } from "./keepGoing/pins.ts";
import { usePreviewText } from "./components/HoverPreview.tsx";
import { queue } from "./sync/queue.ts";
import { ALPHA, BETA, signInWithProjects, switchWhileAsking } from "./testing/switchProject.ts";

beforeAll(() => signInWithProjects());
afterEach(() => {
  vi.unstubAllGlobals();
  setCurrentProject(null);
});
afterAll(() => {
  setKeysOwner(null);
  queue.stop();
});

describe("work that ends after the person has gone to another project", () => {
  it("makes an entry from the map in the project the map is in", async () => {
    setCurrentProject(ALPHA);
    // The names are being read when the person opens beta.
    switchWhileAsking({
      when: (url) => url.includes("/switcher"),
      to: BETA,
      answer: (url) => (url.includes("/switcher") ? { results: [] } : undefined),
    });
    await makeEntry("Places/Harbor.md", "# Harbor\n");
    expect(
      queue
        .queueOf(ALPHA)
        .current()
        .map((r) => r.key),
    ).toEqual(["entry:Places/Harbor.md"]);
    expect(queue.queueOf(BETA).current()).toEqual([]);
  });

  it("does not pin in the project open by the time the pins were read", async () => {
    setCurrentProject(ALPHA);
    // The pins are being read for the press when the person opens beta.
    const { asked } = switchWhileAsking({
      when: (url) => url.endsWith("/pins"),
      to: BETA,
      answer: () => ({ pins: [] }),
    });
    expect(await togglePin("Mira.md")).toBeNull();
    expect(asked.filter((a) => a.method !== "GET")).toEqual([]);
  });

  it("does not let a late answer refill the link names a switch cleared", async () => {
    setCurrentProject(ALPHA);
    const { asked } = switchWhileAsking({
      when: (url) => url.includes("/switcher"),
      to: BETA,
      answer: (url) =>
        url.startsWith("/api/p/alpha/switcher")
          ? { results: [{ path: "Alpha.md", title: "Alpha" }] }
          : { results: [{ path: "Beta.md", title: "Beta" }] },
    });
    // Asked in alpha; beta is open when the answer arrives.
    await linkTarget("Alpha.md", "Alpha");
    const first = asked.length;
    // Beta must read its own names, not find alpha's in the cache.
    expect(await linkTarget("Beta.md", "Beta")).toBe("Beta");
    expect(asked.length).toBe(first + 1);
    expect(asked.at(-1)!.url).toBe("/api/p/beta/switcher");
    void completeLinks;
  });

  it("does not let a late preview refill the cache a switch cleared", async () => {
    const { createRoot } = await import("react-dom/client");
    const { act, createElement } = await import("react");
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const seen: (string | null)[] = [];
    function Show() {
      seen.push(usePreviewText("Harbor.md"));
      return null;
    }
    setCurrentProject(ALPHA);
    const { asked } = switchWhileAsking({
      when: (url) => url.includes("/preview"),
      to: BETA,
      answer: (url) => ({ text: url.includes("/alpha/") ? "Alpha's harbor" : "Beta's harbor" }),
    });
    const root = createRoot(document.createElement("div"));
    await act(async () => root.render(createElement(Show)));
    const previews = () => asked.filter((a) => a.url.includes("/preview")).map((a) => a.url);
    await vi.waitFor(() => expect(previews()).toHaveLength(1));
    await act(async () => root.unmount());
    // Beta's own preview of the same path is asked for, not served from alpha's late answer.
    const again = createRoot(document.createElement("div"));
    await act(async () => again.render(createElement(Show)));
    await vi.waitFor(() => expect(seen.at(-1)).toBe("Beta's harbor"));
    expect(previews()).toEqual([
      "/api/p/alpha/preview?path=Harbor.md",
      "/api/p/beta/preview?path=Harbor.md",
    ]);
    await act(async () => again.unmount());
  });
});
