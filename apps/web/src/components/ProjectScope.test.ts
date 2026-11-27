// @vitest-environment happy-dom
import "fake-indexeddb/auto";
import { act, createElement } from "react";
import { Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { currentAccessNotice, isLeaving, markLeaving, resetAccess } from "../access.ts";
import { setKeysOwner } from "../aiKeys.ts";
import { setCurrentProject } from "../project.ts";
import { clearProjects } from "../projects.ts";
import { connection } from "../sync/connection.ts";
import { ALPHA, BETA, signInWithProjects } from "../testing/switchProject.ts";
import { answer, failure, type Mounted, mount, stubServer } from "../testing/mount.ts";
import { ProjectScope } from "./ProjectScope.tsx";
import { useProject } from "./projectContext.ts";

// The shell is a page of its own; here it only says which project it was drawn for.
vi.mock("./Shell.tsx", () => ({
  Shell: ({ children }: { children: unknown }) => {
    const project = useProject();
    return createElement(
      "div",
      { id: "shell", "data-role": project.role ?? "", "data-name": project.name },
      children as never,
    );
  },
}));
// What a person has not sent yet is the queue's; here only that it is asked to send again.
const { resumeRefused, forgetProjectCopy, held } = vi.hoisted(() => ({
  held: { records: [] as unknown[] },
  resumeRefused: vi.fn(async () => undefined),
  forgetProjectCopy: vi.fn(async () => undefined) as unknown as ReturnType<
    typeof vi.fn<(ref: { id: string; slug: string }) => Promise<void>>
  >,
}));
vi.mock("../sync/queue.ts", async (original) => {
  const real = await original<typeof import("../sync/queue.ts")>();
  return {
    ...real,
    queue: Object.assign(Object.create(real.queue), { resumeRefused, current: () => held.records }),
  };
});
vi.mock("../offline/copy.ts", async (original) => ({
  ...(await original<typeof import("../offline/copy.ts")>()),
  forgetProjectCopy,
}));

const record = (ref: { id: string; slug: string }, name: string, role: string) => ({
  ...ref,
  movedFrom: null,
  name,
  description: "",
  colour: 0,
  kind: "own",
  createdAt: "2026-01-01T00:00:00.000Z",
  role,
  members: [],
  deletable: true,
});

let mounted: Mounted | null = null;
let go: (to: string) => void = () => undefined;
function Controls() {
  const navigate = useNavigate();
  go = (to) => void navigate(to);
  return createElement("output", { id: "where" }, useLocation().pathname);
}

/** The server: each project's record by its slug, which the test may change. */
function serve(records: Record<string, () => Response>) {
  return stubServer((url) => {
    const slug = /\/api\/p\/([^/]+)\/project$/.exec(url)?.[1];
    if (slug) return (records[slug] ?? (() => failure(404, "no_project", "No such project")))();
    if (url.includes("/api/projects"))
      return answer({ projects: [], last: null, canCreate: false });
    return answer({});
  });
}

async function open(at: string) {
  mounted = await mount(
    createElement(
      "div",
      null,
      createElement(Controls),
      createElement(
        Routes,
        null,
        createElement(Route, {
          path: "/p/:slug/*",
          element: createElement(ProjectScope, null, createElement("p", { id: "page" }, "A page")),
        }),
        createElement(Route, { path: "/projects", element: createElement("p", { id: "all" }) }),
      ),
    ),
    null,
    at,
  );
  await mounted.settle();
  await mounted.settle();
  return mounted;
}

beforeEach(async () => {
  await signInWithProjects();
  resumeRefused.mockClear();
  forgetProjectCopy.mockClear();
  held.records = [];
});
afterEach(async () => {
  await mounted?.unmount();
  mounted = null;
  vi.unstubAllGlobals();
  setCurrentProject(null);
  clearProjects();
  resetAccess();
  setKeysOwner(null);
});

describe("a project's page (stage 27c)", () => {
  it("shows the page that says there is no such project for one the person is not in, after being in another", async () => {
    serve({ alpha: () => answer(record(ALPHA, "Alpha", "writer")) });
    const m = await open("/p/alpha");
    expect(m.one("#shell").dataset.name).toBe("Alpha");
    go("/p/gamma");
    await m.settle();
    await m.settle();
    // Not "You are no longer in Alpha", and not sent to All projects.
    expect(m.one("#where").textContent).toBe("/p/gamma");
    expect(m.host.textContent).toContain("There is no project here that you can open");
    expect(currentAccessNotice()).toBeNull();
    expect(forgetProjectCopy).not.toHaveBeenCalled();
  });

  it("does not let a late answer about the old project overwrite the new one's record", async () => {
    let release: (r: Response) => void = () => undefined;
    let hold = false;
    serve({
      alpha: () => answer(record(ALPHA, "Alpha", "writer")),
      beta: () => answer(record(BETA, "Beta", "reader")),
    });
    const m = await open("/p/alpha");
    // The access re-read of alpha is slow: it answers after the person went to beta.
    hold = true;
    const fast = globalThis.fetch;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) =>
        hold && String(url).endsWith("/api/p/alpha/project")
          ? new Promise<Response>((r) => (release = r))
          : fast(url, init),
      ),
    );
    await act(async () => connection.accessMayHaveChanged());
    go("/p/beta");
    await m.settle();
    await m.settle();
    expect(m.one("#shell").dataset.name).toBe("Beta");
    hold = false;
    await act(async () => release(answer(record(ALPHA, "Alpha", "owner"))));
    await m.settle();
    expect(m.one("#shell").dataset.name).toBe("Beta");
    expect(m.one("#shell").dataset.role).toBe("reader");
  });

  it("says once that the role was lowered, and the shell follows it", async () => {
    let role = "writer";
    serve({ alpha: () => answer(record(ALPHA, "Alpha", role)) });
    const m = await open("/p/alpha");
    expect(m.one("#shell").dataset.role).toBe("writer");
    role = "reader";
    await act(async () => connection.accessMayHaveChanged());
    await m.settle();
    expect(m.one("#shell").dataset.role).toBe("reader");
    const said = document.body.textContent ?? "";
    expect(said).toContain("You are now a Reader here.");
    expect(said).toContain("You can read and ask, but not change the project.");
    // Nothing more is said when the same role is read again.
    await act(async () => connection.accessMayHaveChanged());
    await m.settle();
    expect((document.body.textContent ?? "").match(/You are now a Reader here/g)).toHaveLength(1);
  });

  it("says where the changes are when the role is lowered while the device holds some", async () => {
    let role = "writer";
    serve({ alpha: () => answer(record(ALPHA, "Alpha", role)) });
    const m = await open("/p/alpha");
    held.records = [{ key: "entry:01 Places/Harbor.md" }];
    role = "reader";
    await act(async () => connection.accessMayHaveChanged());
    await m.settle();
    expect(document.body.textContent).toContain(
      "Your last changes were not saved. They are kept on this device, in Not sent yet.",
    );
    expect(m.withText("button", "Open Not sent yet")).not.toBeNull();
  });

  it("sends refused saves again when the role is writer again", async () => {
    let role = "reader";
    serve({ alpha: () => answer(record(ALPHA, "Alpha", role)) });
    const m = await open("/p/alpha");
    resumeRefused.mockClear();
    role = "writer";
    await act(async () => connection.accessMayHaveChanged());
    await m.settle();
    expect(resumeRefused).toHaveBeenCalled();
  });

  it("goes to All projects with a note, and lets go of the device copy, when the person is taken out", async () => {
    let inIt = true;
    serve({
      alpha: () => (inIt ? answer(record(ALPHA, "Alpha", "writer")) : failure(403, "no_project")),
    });
    const m = await open("/p/alpha");
    inIt = false;
    await act(async () => connection.accessMayHaveChanged());
    await m.settle();
    await m.settle();
    expect(m.one("#where").textContent).toBe("/projects");
    expect(currentAccessNotice()).toContain("You are no longer in Alpha.");
    expect(forgetProjectCopy).toHaveBeenCalledWith(ALPHA);
  });

  it("does not report leaving on purpose as a loss, and unmarks it once the page is gone", async () => {
    let inIt = true;
    serve({
      alpha: () => (inIt ? answer(record(ALPHA, "Alpha", "writer")) : failure(403, "no_project")),
    });
    const m = await open("/p/alpha");
    markLeaving("alpha");
    inIt = false;
    await act(async () => connection.accessMayHaveChanged());
    await m.settle();
    await m.settle();
    expect(m.one("#where").textContent).toBe("/projects");
    expect(currentAccessNotice()).toBeNull();
    // Gone from the screen: the mark is let go, so a later removal is a loss to report.
    expect(isLeaving("alpha")).toBe(false);
    // What it kept is still let go of.
    expect(forgetProjectCopy).toHaveBeenCalledWith(ALPHA);
  });
});
