// @vitest-environment happy-dom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { api, apiFor, bareUrl, imageUrl, mapImageUrl, projectUrl, uploadVault } from "./api.ts";
import { setCurrentProject } from "./project.ts";

/** The calls that are the server's, not a project's: they keep their own addresses. */
const SERVER_WIDE =
  /^\/api\/(session|login|logout|passkeys|me|settings|ai|notices|projects|join|auth)(?:[/?]|$)/;

afterEach(() => {
  vi.unstubAllGlobals();
  setCurrentProject(null);
});

const answer = () =>
  new Response("{}", { status: 200, headers: { "content-type": "application/json" } });

describe("the web app's calls to the server", () => {
  it("never write an unprefixed project address in api.ts", () => {
    // The server's old unprefixed addresses are for builds from before projects. Every `/api/`
    // address api.ts writes is the server's own (listed above), or is made by `projectUrl`.
    const code = readFileSync(join(import.meta.dirname, "api.ts"), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    const text = code;
    const written = [...text.matchAll(/[`"'](\/api\/[^`"'$?]*)/g)].map((m) => m[1]!);
    const strays = written.filter(
      (a) => !SERVER_WIDE.test(a) && !a.startsWith("/api/p/") && a !== "/api/",
    );
    expect(strays).toEqual([]);
  });

  it("send every project call to /api/p/<slug>, whatever the call", async () => {
    const urls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        urls.push(url);
        return answer();
      }),
    );
    setCurrentProject({ id: "avalymia01", slug: "avalymia" });
    const calls = Object.entries(api).filter(([name]) => !/^(login|logout|session|me)$/.test(name));
    for (const [, call] of calls) {
      // Dummy arguments are enough to make each call; one that needs more fails before it asks.
      await Promise.resolve((call as (...a: unknown[]) => unknown)("a", "b", "c")).catch(
        () => undefined,
      );
    }
    expect(urls.length).toBeGreaterThan(80);
    const strays = urls.filter((u) => !SERVER_WIDE.test(u) && !u.startsWith("/api/p/avalymia/"));
    expect(strays).toEqual([]);
    // The project calls really were made as the project's.
    expect(urls.some((u) => u.startsWith("/api/p/avalymia/entries"))).toBe(true);
    expect(urls.some((u) => u.startsWith("/api/p/avalymia/drafts"))).toBe(true);
  });

  it("go to the project a queued save belongs to, not the open one", async () => {
    const urls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        urls.push(url);
        return answer();
      }),
    );
    setCurrentProject({ id: "other00001", slug: "other" });
    await apiFor("avalymia").saveDraft({
      id: "d",
      path: "A.md",
      kind: "edit",
      text: "x",
      revision: 0,
    });
    await api.tree();
    expect(urls).toEqual(["/api/p/avalymia/drafts", "/api/p/other/tree"]);
  });

  it("fail with no open project rather than ask for an unprefixed address", async () => {
    const fetched = vi.fn();
    vi.stubGlobal("fetch", fetched);
    await expect(api.tree()).rejects.toMatchObject({ code: "no_project" });
    expect(fetched).not.toHaveBeenCalled();
  });

  it("put the project in the address of images and exports", () => {
    expect(projectUrl("/entries?path=A.md", "a b")).toBe("/api/p/a%20b/entries?path=A.md");
    expect(imageUrl("x y.png", 640, "avalymia")).toBe(
      "/api/p/avalymia/images?path=x%20y.png&w=640",
    );
    expect(mapImageUrl("m.png", 2560, "avalymia")).toBe("/api/p/avalymia/images?path=m.png&w=2560");
    setCurrentProject({ id: "avalymia01", slug: "avalymia" });
    expect(imageUrl("x.png")).toBe("/api/p/avalymia/images?path=x.png");
    expect(bareUrl("/api/p/avalymia/entries?path=A.md")).toBe("/api/entries?path=A.md");
    expect(bareUrl("/api/projects")).toBe("/api/projects");
  });

  it("send a vault zip to the project named, with its progress", async () => {
    const sent: string[] = [];
    const progress: number[] = [];
    class FakeRequest {
      upload: { onprogress: ((e: unknown) => void) | null } = { onprogress: null };
      onload: (() => void) | null = null;
      onerror: (() => void) | null = null;
      status = 200;
      responseText = JSON.stringify({ files: 3, commit: "abc" });
      withCredentials = false;
      open(method: string, url: string) {
        sent.push(`${method} ${url}`);
      }
      setRequestHeader() {}
      send() {
        this.upload.onprogress?.({ lengthComputable: true, loaded: 5, total: 10 });
        this.onload?.();
      }
    }
    vi.stubGlobal("XMLHttpRequest", FakeRequest);
    const result = await uploadVault(
      "fresh",
      new File(["zip"], "vault.zip"),
      "Imported",
      (done, total) => progress.push(Math.round((done / total) * 100)),
    );
    expect(sent).toEqual(["POST /api/p/fresh/import/vault"]);
    expect(progress).toEqual([50]);
    expect(result).toEqual({ files: 3, commit: "abc" });
  });
});
