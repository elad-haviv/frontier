import { afterEach, describe, expect, it, vi } from "vitest";
import {
  appUrl,
  currentProject,
  inProject,
  isOutsideProject,
  movedInto,
  onProjectChange,
  projectRoot,
  setCurrentProject,
  withoutProject,
} from "./project.ts";

afterEach(() => setCurrentProject(null));

describe("addresses in a project", () => {
  const avalymia = { id: "avalymia01", slug: "avalymia" };

  it("puts the project in front of an address written as if there were one library", () => {
    expect(inProject("/e/Places/Harbor.md", avalymia)).toBe("/p/avalymia/e/Places/Harbor.md");
    expect(inProject("/maps", avalymia)).toBe("/p/avalymia/maps");
    expect(inProject("/settings/you/ai-models", avalymia)).toBe(
      "/p/avalymia/settings/you/ai-models",
    );
    // Query and hash stay where they were.
    expect(inProject("/edit/A.md?new=1#top", avalymia)).toBe("/p/avalymia/edit/A.md?new=1#top");
  });

  it("makes the root of the library the project's Home", () => {
    expect(inProject("/", avalymia)).toBe("/p/avalymia");
    expect(inProject("/?x=1", avalymia)).toBe("/p/avalymia?x=1");
    expect(inProject("/#top", avalymia)).toBe("/p/avalymia#top");
  });

  it("leaves alone what names a project or none, and what is not an absolute address", () => {
    expect(inProject("/p/other/e/A.md", avalymia)).toBe("/p/other/e/A.md");
    expect(inProject("/projects", avalymia)).toBe("/projects");
    expect(inProject("/projects?new=1", avalymia)).toBe("/projects?new=1");
    expect(inProject("/login", avalymia)).toBe("/login");
    expect(inProject("/join/abc", avalymia)).toBe("/join/abc");
    expect(inProject("?edit=1", avalymia)).toBe("?edit=1");
    expect(inProject("#heading", avalymia)).toBe("#heading");
    expect(inProject("https://example.com/x", avalymia)).toBe("https://example.com/x");
    expect(inProject("//example.com/x", avalymia)).toBe("//example.com/x");
    // A name that only starts like a reserved word is a page of the project.
    expect(inProject("/projects-list", avalymia)).toBe("/p/avalymia/projects-list");
  });

  it("adds nothing when no project is open, so the old-address redirect decides", () => {
    expect(inProject("/e/A.md", null)).toBe("/e/A.md");
    expect(appUrl("/maps")).toBe("/maps");
  });

  it("follows the open project", () => {
    setCurrentProject(avalymia);
    expect(appUrl("/maps")).toBe("/p/avalymia/maps");
    setCurrentProject({ id: "other00001", slug: "other" });
    expect(appUrl("/maps")).toBe("/p/other/maps");
  });

  it("writes an address that needs it encoded", () => {
    expect(projectRoot("a b")).toBe("/p/a%20b");
  });

  it("takes the project off an address", () => {
    expect(withoutProject("/p/avalymia/e/A%20B.md")).toEqual({
      slug: "avalymia",
      rest: "/e/A%20B.md",
    });
    expect(withoutProject("/p/avalymia")).toEqual({ slug: "avalymia", rest: "/" });
    expect(withoutProject("/p/a%20b/maps")).toEqual({ slug: "a b", rest: "/maps" });
    expect(withoutProject("/projects")).toEqual({ slug: null, rest: "/projects" });
    expect(withoutProject("/e/A.md")).toEqual({ slug: null, rest: "/e/A.md" });
  });

  it("moves an old address into a project, with its query and hash", () => {
    const at = (pathname: string, search = "", hash = "") => ({ pathname, search, hash });
    expect(movedInto("avalymia", at("/e/A.md", "?x=1", "#h"))).toBe("/p/avalymia/e/A.md?x=1#h");
    expect(movedInto("avalymia", at("/maps"))).toBe("/p/avalymia/maps");
    expect(movedInto("avalymia", at("/"))).toBe("/p/avalymia");
  });

  it("knows which addresses belong to no project", () => {
    for (const path of ["/projects", "/settings/profile", "/login", "/join/x"]) {
      expect(isOutsideProject(path), path).toBe(true);
    }
    for (const path of ["/e/A.md", "/maps", "/", "/p/x/maps", "/projects-list"]) {
      expect(isOutsideProject(path), path).toBe(false);
    }
  });
});

describe("the open project", () => {
  it("tells those who keep a library's data when another project opens, not when only its address changes", () => {
    const heard = vi.fn();
    const stop = onProjectChange(heard);
    setCurrentProject({ id: "avalymia01", slug: "avalymia" });
    expect(heard).toHaveBeenCalledTimes(1);
    // The owner renamed the address: the same project.
    setCurrentProject({ id: "avalymia01", slug: "avalymia-2" });
    expect(heard).toHaveBeenCalledTimes(1);
    expect(currentProject()?.slug).toBe("avalymia-2");
    // The same project again changes nothing.
    setCurrentProject({ id: "avalymia01", slug: "avalymia-2" });
    expect(heard).toHaveBeenCalledTimes(1);
    setCurrentProject({ id: "other00001", slug: "other" });
    expect(heard).toHaveBeenCalledTimes(2);
    expect(heard).toHaveBeenLastCalledWith(
      { id: "other00001", slug: "other" },
      { id: "avalymia01", slug: "avalymia-2" },
    );
    setCurrentProject(null);
    expect(heard).toHaveBeenCalledTimes(3);
    stop();
    setCurrentProject({ id: "avalymia01", slug: "avalymia" });
    expect(heard).toHaveBeenCalledTimes(3);
  });
});
