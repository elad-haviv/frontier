// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { graphData } from "./graph/data.ts";
import { loadPins } from "./keepGoing/pins.ts";
import { recents } from "./keepGoing/recents.ts";
import { setCurrentProject } from "./project.ts";
import * as pinsModule from "./keepGoing/pins.ts";
import { libraryFileClient } from "./sync/libraryFile.ts";
import { FOLDERS } from "@frontier/schema";

const A = { id: "projecta01", slug: "alpha" };
const B = { id: "projectb01", slug: "beta" };

const json = (body: unknown) =>
  new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });

afterEach(() => {
  vi.unstubAllGlobals();
  setCurrentProject(null);
  localStorage.clear();
});

describe("switching projects leaves nothing of the last one", () => {
  it("empties the pins, and reads the new project's own", async () => {
    const asked: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        asked.push(url);
        return json({
          pins: [{ path: url.includes("/alpha/") ? "Alpha.md" : "Beta.md", title: "Pinned" }],
        });
      }),
    );
    const seen: string[][] = [];
    const { usePins } = pinsModule;
    // Read the way the left bar does: rendering the hook.
    const { createRoot } = await import("react-dom/client");
    const { act, createElement } = await import("react");
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const root = createRoot(document.createElement("div"));
    function Show() {
      seen.push(usePins().map((p) => p.path));
      return null;
    }
    setCurrentProject(A);
    await act(async () => {
      root.render(createElement(Show));
      await loadPins(true);
    });
    expect(seen.at(-1)).toEqual(["Alpha.md"]);
    await act(async () => {
      setCurrentProject(B);
    });
    // At once nothing of alpha is shown; then beta's own arrive, from beta's address.
    expect(seen.some((s, i) => i > 0 && s.length === 0)).toBe(true);
    await vi.waitFor(() => expect(seen.at(-1)).toEqual(["Beta.md"]));
    expect(asked).toEqual(["/api/p/alpha/pins", "/api/p/beta/pins"]);
    await act(async () => root.unmount());
  });

  it("keeps the recents of each project apart, and gives them back", () => {
    setCurrentProject(A);
    recents.touch("Harbor.md", "Harbor", "read");
    expect(recents.snapshot().recents.map((r) => r.path)).toEqual(["Harbor.md"]);
    setCurrentProject(B);
    expect(recents.snapshot().recents).toEqual([]);
    expect(recents.snapshot().current).toBeNull();
    recents.touch("Mira.md", "Mira", "edited");
    setCurrentProject(A);
    expect(recents.snapshot().recents.map((r) => r.path)).toEqual(["Harbor.md"]);
    // Filed under each project's id in the browser's storage.
    expect(localStorage.getItem("frontier.keepGoing.v1:projecta01")).toContain("Harbor.md");
    expect(localStorage.getItem("frontier.keepGoing.v1:projectb01")).toContain("Mira.md");
    expect(localStorage.getItem("frontier.keepGoing.v1")).toBeNull();
  });

  it("drops the graph, and a late answer of the project left", async () => {
    let answerA: ((r: Response) => void) | null = null;
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (url: string) =>
          new Promise<Response>((resolve) => {
            if (url.includes("/alpha/")) answerA = resolve;
            else resolve(json({ nodes: [{ path: "B.md", title: "B", type: null }], edges: [] }));
          }),
      ),
    );
    setCurrentProject(A);
    const stop = graphData.use();
    setCurrentProject(B);
    await vi.waitFor(() =>
      expect(graphData.current().model?.nodes.map((n) => n.path)).toEqual(["B.md"]),
    );
    // Alpha's graph arrives late: it is not put over beta's.
    answerA!(json({ nodes: [{ path: "A.md", title: "A", type: null }], edges: [] }));
    await new Promise((r) => setTimeout(r, 20));
    expect(graphData.current().model?.nodes.map((n) => n.path)).toEqual(["B.md"]);
    stop();
  });

  it("makes a library file client for each project", () => {
    setCurrentProject(A);
    const first = libraryFileClient(FOLDERS);
    expect(libraryFileClient(FOLDERS)).toBe(first);
    setCurrentProject(B);
    expect(libraryFileClient(FOLDERS)).not.toBe(first);
  });
});
