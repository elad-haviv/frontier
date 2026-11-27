// @vitest-environment happy-dom
import { createElement } from "react";
import { Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { setCurrentProject } from "../project.ts";
import { ALPHA } from "../testing/switchProject.ts";
import { type Mounted, mount, projectInfo } from "../testing/mount.ts";
import { useCanWrite, useCanWriteOrNot, useIsReader } from "./projectContext.ts";
import { WriterOnly } from "./WriterOnly.tsx";

// Changes this device holds for the open project: the test sets them.
const held = vi.hoisted(() => ({ records: [] as { key: string }[] }));
vi.mock("../sync/queue.ts", async (original) => ({
  ...(await original<typeof import("../sync/queue.ts")>()),
  useUnsent: () => held.records,
}));

let mounted: Mounted | null = null;
afterEach(async () => {
  await mounted?.unmount();
  mounted = null;
  held.records = [];
  setCurrentProject(null);
});

async function at(
  role: "owner" | "writer" | "reader" | null,
  path = "/edit/01%20Places/Harbor.md",
) {
  setCurrentProject(ALPHA);
  mounted = await mount(
    createElement(
      Routes,
      null,
      createElement(Route, {
        path: "/edit/*",
        element: createElement(WriterOnly, {
          what: "edit entries",
          children: createElement("p", { id: "the-editor" }, "The editor"),
        }),
      }),
    ),
    projectInfo({ role }),
    path,
  );
  return mounted;
}

describe("a page only a writer may use", () => {
  it("shows the page to a writer and to an owner", async () => {
    for (const role of ["writer", "owner"] as const) {
      const m = await at(role);
      expect(m.host.querySelector("#the-editor"), role).not.toBeNull();
      expect(m.host.textContent).not.toContain("You can read this");
      await m.unmount();
      mounted = null;
    }
  });

  it("tells a reader what the role allows, and where to read instead", async () => {
    const m = await at("reader");
    expect(m.host.querySelector("#the-editor")).toBeNull();
    expect(m.one("h1").textContent).toBe("You can read this, not change it");
    expect(m.host.textContent).toContain("You are a Reader in Alpha.");
    expect(m.host.textContent).toContain("Only writers and owners can edit entries.");
    expect(m.one<HTMLAnchorElement>("a[href$='/e/01%20Places/Harbor.md']").textContent).toBe(
      "Read Harbor",
    );
  });

  it("says plainly that the last changes were not saved, and where to copy them from, when the device holds them", async () => {
    held.records = [{ key: "entry:01 Places/Harbor.md" }];
    const m = await at("reader");
    expect(m.host.textContent).toContain(
      "Your last changes to Harbor were not saved, because your role changed while you were writing.",
    );
    const link = m.withText<HTMLButtonElement>("button", "Not sent yet")!;
    expect(link).not.toBeNull();
    // It opens the list, which the left bar draws.
    await m.click(link);
    const { useUnsentOpen } = await import("./unsentPanel.ts");
    let open = false;
    const Probe = () => {
      open = useUnsentOpen()[0];
      return null;
    };
    const p = await mount(createElement(Probe), null);
    expect(open).toBe(true);
    await p.unmount();
  });

  it("does not say it for an entry the device holds nothing of", async () => {
    held.records = [{ key: "entry:01 Places/Other.md" }];
    const m = await at("reader");
    expect(m.host.textContent).not.toContain("were not saved");
  });

  it("shows neither the page nor a notice while the role is not known", async () => {
    const m = await at(null);
    expect(m.host.querySelector("#the-editor")).toBeNull();
    expect(m.host.textContent).not.toContain("You can read this");
    expect(m.host.querySelector("[role=progressbar]")).not.toBeNull();
  });
});

describe("what the controls ask", () => {
  function Probe() {
    return createElement(
      "output",
      null,
      [useCanWrite(), useIsReader(), useCanWriteOrNot()].join(","),
    );
  }

  it("is not a writer, and not a reader either, while the role is unknown", async () => {
    for (const [role, expected] of [
      [null, "false,false,false"],
      ["reader", "false,true,false"],
      ["writer", "true,false,true"],
      ["owner", "true,false,true"],
    ] as const) {
      const m = await mount(createElement(Probe), projectInfo({ role }));
      expect(m.one("output").textContent, String(role)).toBe(expected);
      await m.unmount();
    }
  });

  it("is not a writer outside any project", async () => {
    function Outside() {
      return createElement("output", null, String(useCanWriteOrNot()));
    }
    const m = await mount(createElement(Outside), null);
    expect(m.one("output").textContent).toBe("false");
    await m.unmount();
  });
});
