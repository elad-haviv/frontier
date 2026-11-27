// @vitest-environment happy-dom
import type { ProjectSummary, ProjectsResponse } from "@frontier/schema";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearProjects,
  homeProject,
  isOnDevice,
  knownProjects,
  loadProjects,
  markOffDevice,
  markOnDevice,
  noteLast,
  noteProject,
  projectAt,
} from "./projects.ts";

const project = (slug: string, name = slug): ProjectSummary => ({
  id: `${slug}00000000`.slice(0, 10),
  slug,
  name,
  description: "",
  colour: 0,
  kind: "own",
  role: "owner",
  entries: 3,
  maps: 1,
  members: [],
  lastVersion: null,
});

const list = (last: string | null, ...slugs: string[]): ProjectsResponse => ({
  projects: slugs.map((s) => project(s)),
  last,
  canCreate: true,
});

afterEach(() => {
  clearProjects();
  vi.unstubAllGlobals();
});

describe("the person's projects", () => {
  it("opens the project used last, else the first", () => {
    expect(homeProject(list("beta", "alpha", "beta"))?.slug).toBe("beta");
    expect(homeProject(list(null, "alpha", "beta"))?.slug).toBe("alpha");
    // A project the person has left is not where they are sent.
    expect(homeProject(list("gone", "alpha", "beta"))?.slug).toBe("alpha");
    expect(homeProject(list(null))).toBeNull();
    expect(homeProject(null)).toBeNull();
  });

  it("keeps the list it read, for an offline start, and forgets it at log out", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () => new Response(JSON.stringify(list("alpha", "alpha", "beta")), { status: 200 }),
      ),
    );
    await loadProjects();
    expect(knownProjects()?.projects.map((p) => p.slug)).toEqual(["alpha", "beta"]);
    expect(JSON.parse(localStorage.getItem("frontier.projects")!).last).toBe("alpha");
    // The server cannot be reached: what was read stays.
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      }),
    );
    await loadProjects();
    expect(knownProjects()?.projects).toHaveLength(2);
    clearProjects();
    expect(knownProjects()).toBeNull();
    expect(localStorage.getItem("frontier.projects")).toBeNull();
  });

  it("follows a rename and the project opened last", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify(list(null, "alpha", "beta")), { status: 200 })),
    );
    await loadProjects();
    const beta = projectAt("beta")!;
    noteProject({ id: beta.id, slug: "beta-2", name: "Beta two" });
    expect(projectAt("beta")).toBeUndefined();
    expect(projectAt("beta-2")?.name).toBe("Beta two");
    noteLast("beta-2");
    expect(homeProject()?.slug).toBe("beta-2");
  });

  it("knows which projects have a copy on this device", () => {
    expect(isOnDevice("alpha00000")).toBe(false);
    markOnDevice("alpha00000");
    expect(isOnDevice("alpha00000")).toBe(true);
    expect(JSON.parse(localStorage.getItem("frontier.onDevice")!)).toEqual(["alpha00000"]);
    markOffDevice("alpha00000");
    expect(isOnDevice("alpha00000")).toBe(false);
  });

  it("keeps the project this page opened last, over a list the server read before it was told", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () => new Response(JSON.stringify(list("alpha", "alpha", "beta")), { status: 200 }),
      ),
    );
    await loadProjects();
    noteLast("beta");
    // The server's answer was made before it heard of beta.
    await loadProjects();
    expect(knownProjects()?.last).toBe("beta");
    expect(homeProject()?.slug).toBe("beta");
  });
});
