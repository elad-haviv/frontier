// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { BUILT_IN_KINDS, type RelationsResponse } from "@frontier/schema";
import { setCurrentProject } from "../project.ts";
import { ALPHA, BETA } from "../testing/switchProject.ts";
import { addRelation, reloadRelations } from "./data.ts";

const answer = (body: unknown) =>
  new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });
const relations = (name: string): RelationsResponse => ({
  kinds: BUILT_IN_KINDS,
  people: [
    {
      key: `${name}.md`,
      title: name,
      path: `${name}.md`,
      type: null,
      born: null,
      died: null,
      dates: null,
    },
  ],
  facts: [],
  unknown: [],
});

afterEach(() => {
  setCurrentProject(null);
  vi.unstubAllGlobals();
});

/** What the relations hook would show: read the module's snapshot through a hook-free probe. */
async function shown(): Promise<string[]> {
  const { useRelations } = await import("./data.ts");
  const { createElement } = await import("react");
  const { mount } = await import("../testing/mount.ts");
  let titles: string[] = [];
  const Probe = () => {
    const r = useRelations();
    titles = [...(r.graph?.people.values() ?? [])].map((p) => p.title);
    return null;
  };
  const m = await mount(createElement(Probe), null);
  await m.settle();
  await m.unmount();
  return titles;
}

describe("the relations the Trees pages share", () => {
  it("asks the open project and keeps nothing of another project's", async () => {
    const asked: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        asked.push(url);
        return answer(relations(url.includes("/alpha/") ? "Alphan" : "Betan"));
      }),
    );
    setCurrentProject(ALPHA);
    expect(await shown()).toEqual(["Alphan"]);
    expect(asked.at(-1)).toContain("/api/p/alpha/relations");
    setCurrentProject(BETA);
    // The new project's own are read; the old project's are gone first.
    expect(await shown()).toEqual(["Betan"]);
    expect(asked.at(-1)).toContain("/api/p/beta/relations");
  });

  it("drops an answer that comes after the person went to another project", async () => {
    let release: (r: Response) => void = () => undefined;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        url.includes("/alpha/")
          ? new Promise<Response>((r) => (release = r))
          : answer(relations("Betan")),
      ),
    );
    setCurrentProject(ALPHA);
    const slow = reloadRelations();
    setCurrentProject(BETA);
    await reloadRelations();
    release(answer(relations("Alphan")));
    await slow;
    expect(await shown()).toEqual(["Betan"]);
  });

  it("writes a relation to the project it was asked in, even when another is open by then", async () => {
    const calls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        calls.push(`${init?.method ?? "GET"} ${url}`);
        if (init?.method === "POST") {
          // The person goes to another project while the write is on its way.
          setCurrentProject(BETA);
          return answer({ ok: true, draft: "d", made: null });
        }
        return answer(relations("Betan"));
      }),
    );
    setCurrentProject(ALPHA);
    await addRelation({ path: "A.md", what: "parent", who: "B.md" } as never);
    expect(calls[0]).toBe("POST /api/p/alpha/relations");
    // The list is not read again for a project that is no longer open.
    expect(calls.filter((c) => c.startsWith("GET"))).toEqual([]);
  });
});
