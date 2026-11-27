// @vitest-environment happy-dom
import "fake-indexeddb/auto";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { MemoryRouter } from "react-router-dom";
import { setKeysOwner } from "../../aiKeys.ts";
import { setCurrentProject } from "../../project.ts";
import { connection } from "../../sync/connection.ts";
import { ALPHA, signInWithProjects } from "../../testing/switchProject.ts";
import { ProjectContext } from "../projectContext.ts";
import { ProjectMenu } from "./ProjectMenu.tsx";

beforeAll(() => signInWithProjects());
afterEach(() => vi.unstubAllGlobals());
afterAll(() => {
  setKeysOwner(null);
  setCurrentProject(null);
});

describe("the project switcher's list", () => {
  it("is read when the menu opens, not each time a library changes", async () => {
    const asked: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        asked.push(url);
        return new Response(JSON.stringify({ projects: [], last: null, canCreate: false }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }),
    );
    const { createRoot } = await import("react-dom/client");
    const { act } = await import("react");
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    const info = {
      id: ALPHA.id,
      slug: ALPHA.slug,
      name: "alpha",
      description: "",
      colour: 0,
      role: "owner" as const,
      record: null,
      reload: () => undefined,
    };
    setCurrentProject(ALPHA);
    await act(async () =>
      root.render(
        createElement(
          MemoryRouter,
          null,
          createElement(ProjectContext.Provider, { value: info }, createElement(ProjectMenu)),
        ),
      ),
    );
    // Showing the switcher asks nothing; a library changing (a new index commit) asks nothing.
    expect(asked.filter((u) => u === "/api/projects")).toEqual([]);
    await act(async () => {
      connection.remember({ indexCommit: "c1" } as never);
    });
    await act(async () => {
      connection.remember({ indexCommit: "c2" } as never);
    });
    expect(asked.filter((u) => u === "/api/projects")).toEqual([]);

    // Opened, it reads the list once, and shows what comes as it arrives.
    const button = host.querySelector("button.project-button")!;
    await act(async () => {
      button.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });
    await vi.waitFor(() => expect(asked.filter((u) => u === "/api/projects")).toHaveLength(1));
    await act(async () => root.unmount());
  });
});
