import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SwitcherResponse } from "@frontier/schema";
import { snippet } from "../src/index/search.js";
import { makeTestApp, type TestApp } from "./helpers/app.js";

let t: TestApp;
beforeAll(async () => {
  t = await makeTestApp();
  await t.login();
});
afterAll(() => t.close());

const names = async (query = "") =>
  SwitcherResponse.parse((await t.get(`/api/switcher${query}`)).json()).results;

describe("names for the quick switcher and link autocomplete", () => {
  it("returns every lore note and alias when there is no query, without appendix notes", async () => {
    const all = await names();
    const labels = all.map((r) => r.alias ?? r.title);
    expect(labels).toEqual(
      expect.arrayContaining(["Harbor", "The Port", "Greywater", "Mira", "Lamp", "README"]),
    );
    expect(all.some((r) => r.path.startsWith("99 Appendices/"))).toBe(false);
    expect(all.some((r) => r.path.startsWith(".obsidian/"))).toBe(false);
  });

  it("matches names and aliases, with names that start with the query first", async () => {
    const r = await names("?q=har");
    expect(r[0]).toEqual({ path: "01 Places/Harbor/Harbor.md", title: "Harbor" });
    const port = await names("?q=port");
    expect(port).toEqual([
      { path: "01 Places/Harbor/Harbor.md", title: "Harbor", alias: "The Port" },
    ]);
    expect(await names("?q=zzzz")).toEqual([]);
  });

  it("marks names shared by two notes, so a link can be written with its path", async () => {
    const twins = await names("?q=twin");
    expect(twins).toEqual([
      { path: "02 People/Twin.md", title: "Twin", shared: true },
      { path: "03 Things/Twin.md", title: "Twin", shared: true },
    ]);
    expect((await names("?q=mira"))[0]!.shared).toBeUndefined();
  });

  it("includes appendix notes on request", async () => {
    const r = await names("?q=session&appendices=1");
    expect(r.map((x) => x.path)).toEqual(["99 Appendices/Logs/Session.md"]);
    expect(await names("?q=session")).toEqual([]);
  });

  it("includes a new entry that is still a draft and leaves out one marked for deletion", async () => {
    await t.put("/api/drafts", {
      id: "switcher0001",
      path: "01 Places/Saltmother.md",
      kind: "create",
      text: "# S\n",
      revision: 0,
    });
    await t.put("/api/drafts", {
      id: "switcher0002",
      path: "03 Things/Plain.md",
      kind: "delete",
      text: "",
      revision: 0,
    });
    expect((await names("?q=saltmother")).map((r) => r.path)).toEqual(["01 Places/Saltmother.md"]);
    expect(await names("?q=plain")).toEqual([]);
  });

  it("needs a session and rejects an over-long query", async () => {
    expect((await t.app.inject({ method: "GET", url: "/api/switcher" })).statusCode).toBe(401);
    expect((await t.get(`/api/switcher?q=${"x".repeat(300)}`)).statusCode).toBe(400);
  });
});

describe("full-text search", () => {
  const search = async (query: string) =>
    (await t.get(`/api/search${query}`)).json().results as {
      path: string;
      title: string;
      snippet: string;
    }[];

  it("finds notes by words in the text and shows the place", async () => {
    const r = await search("?q=fishers");
    expect(r.map((x) => x.path)).toEqual(["01 Places/Harbor/Harbor.md"]);
    expect(r[0]!.snippet).toContain("Founded by fishers.");
  });

  it("puts a match in the name above a match in the text", async () => {
    const r = await search("?q=harbor");
    expect(r[0]!.path).toBe("01 Places/Harbor/Harbor.md");
    expect(r.length).toBeGreaterThan(3);
  });

  it("needs every word, matches the start of a word, and forgives a small slip", async () => {
    expect((await search("?q=grey%20water")).map((x) => x.title)).toContain("Harbor");
    expect(await search("?q=fishers%20zebra")).toEqual([]);
    expect((await search("?q=fish")).map((x) => x.title)).toEqual(["Harbor"]);
    expect((await search("?q=fishrs")).map((x) => x.title)).toEqual(["Harbor"]);
  });

  it("finds by alias and by heading", async () => {
    expect((await search("?q=greywater"))[0]!.title).toBe("Harbor");
    // A heading match ranks above a match in the running text.
    expect(
      (await search("?q=tides"))
        .slice(0, 2)
        .map((x) => x.title)
        .sort(),
    ).toEqual(["Harbor", "Old Quay"]);
  });

  it("leaves appendix notes out unless asked, and returns nothing for an empty query", async () => {
    expect(await search("?q=profile")).toEqual([]);
    expect((await search("?q=profile&appendices=1")).map((x) => x.path)).toEqual([
      "99 Appendices/Agents/Shade.md",
    ]);
    expect(await search("?q=")).toEqual([]);
    expect(await search("")).toEqual([]);
  });

  it("does not show frontmatter in a snippet, and trims a long text at word ends", async () => {
    const r = await search("?q=lantern");
    const lantern = r.find((x) => x.path === "03 Things/Lantern.md")!;
    expect(lantern.snippet).not.toContain("aliases");
    const long = (await search("?q=marsh%20salt%20bell")).find((x) => x.title === "Long")!;
    expect(long.snippet.length).toBeLessThan(175);
    expect(long.snippet.endsWith(" …")).toBe(true);
  });

  it("leaves underline tags out of a snippet", () => {
    expect(snippet("A <u>marked</u> word.", ["marked"])).toBe("A marked word.");
  });

  it("sees a new note after the vault changes", async () => {
    t.repo.pushFromOutside({ "01 Places/Reef.md": "# Reef\n\nWhere the kelpwrights dive.\n" });
    await t.services.sync();
    expect((await search("?q=kelpwrights")).map((x) => x.title)).toEqual(["Reef"]);
  });

  it("answers within 100 ms on a 500-note vault", async () => {
    const { execFileSync } = await import("node:child_process");
    const { rmSync } = await import("node:fs");
    const { dirname, join } = await import("node:path");
    const { fileURLToPath } = await import("node:url");
    const { VaultIndex } = await import("../src/index/build.js");
    const { SearchIndex } = await import("../src/index/search.js");
    const vaultPackage = join(dirname(fileURLToPath(import.meta.url)), "../../../packages/vault");
    execFileSync("npx", ["tsx", "scripts/make-big-fixture.ts", "search"], {
      cwd: vaultPackage,
      stdio: "ignore",
    });
    // A folder of this test's own: the other timing test makes one at the same time.
    const big = join(vaultPackage, "test", ".big-fixture", "search");
    try {
      const index = new VaultIndex(big);
      index.build("timing");
      const s = new SearchIndex(index);
      s.search("warm up");
      const started = performance.now();
      const hits = s.search("stray space");
      expect(performance.now() - started).toBeLessThan(100);
      expect(hits.length).toBeGreaterThan(0);
    } finally {
      rmSync(big, { recursive: true, force: true });
    }
  });
});

describe("previews", () => {
  it("returns the opening of an entry without its frontmatter", async () => {
    const res = (await t.get("/api/preview?path=01%20Places%2FHarbor%2FHarbor.md")).json();
    expect(res.text.startsWith("# Harbor")).toBe(true);
    expect(res.text).not.toContain("aliases");
    const long = (await t.get("/api/preview?path=03%20Things%2FLong.md")).json();
    expect(long.text.length).toBeLessThan(610);
    expect(long.text.endsWith(" …")).toBe(true);
    expect((await t.get("/api/preview?path=nope.md")).statusCode).toBe(404);
  });
});
