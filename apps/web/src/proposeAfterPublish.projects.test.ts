// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { setKeysOwner } from "./aiKeys.ts";
import { setCurrentProject } from "./project.ts";
import { proposeAfterPublish } from "./proposeAfterPublish.ts";

vi.mock("./aiKeys.ts", async (original) => ({
  ...(await original<typeof import("./aiKeys.ts")>()),
  hasDeviceKey: () => true,
}));

const A = { id: "projecta01", slug: "alpha" };
const B = { id: "projectb01", slug: "beta" };

afterEach(() => {
  vi.unstubAllGlobals();
  setCurrentProject(null);
  setKeysOwner(null);
  localStorage.clear();
});

describe("proposals after a save, with more than one project", () => {
  it("go on for the project they were asked in, and wait there, whichever is open", async () => {
    setKeysOwner("person1");
    const asked: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        asked.push(url);
        const body = url.endsWith("/api/settings")
          ? { ai: { proposeOnPublish: true, models: { extraction: "anthropic:claude-x" } } }
          : { made: 1 };
        // The first proposal is on its way when the person moves to beta.
        if (
          url.includes("proposals") &&
          asked.filter((a) => a.includes("proposals")).length === 1
        ) {
          setCurrentProject(B);
        }
        return new Response(JSON.stringify(body), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }),
    );
    setCurrentProject(A);
    expect(await proposeAfterPublish(A, ["a.md", "b.md"])).toBe(2);
    // Both went to alpha, and nothing of it is waiting in either project.
    expect(asked.filter((u) => u.includes("proposals"))).toEqual([
      "/api/p/alpha/proposals/fields",
      "/api/p/alpha/proposals/fields",
    ]);
    expect(localStorage.getItem("frontier.pendingProposals:person1:projecta01")).toBeNull();
    expect(localStorage.getItem("frontier.pendingProposals:person1:projectb01")).toBeNull();
  });

  it("are kept for each project apart", async () => {
    setKeysOwner("person1");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      }),
    );
    setCurrentProject(A);
    await proposeAfterPublish(A, ["a.md"]);
    setCurrentProject(B);
    await proposeAfterPublish(B, ["b.md"]);
    expect(
      JSON.parse(localStorage.getItem("frontier.pendingProposals:person1:projecta01")!),
    ).toEqual(["a.md"]);
    expect(
      JSON.parse(localStorage.getItem("frontier.pendingProposals:person1:projectb01")!),
    ).toEqual(["b.md"]);
  });

  it("ask the project the entries were published in, even when another is open by then", async () => {
    // A publish waits for the server; the person went to beta meanwhile.
    setKeysOwner("person1");
    const asked: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        asked.push(url);
        const body = url.endsWith("/api/settings")
          ? { ai: { proposeOnPublish: true, models: { extraction: "anthropic:claude-x" } } }
          : { made: 1 };
        return new Response(JSON.stringify(body), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }),
    );
    setCurrentProject(B);
    expect(await proposeAfterPublish(A, ["a.md"])).toBe(1);
    expect(asked.filter((u) => u.includes("proposals"))).toEqual(["/api/p/alpha/proposals/fields"]);
  });
});
