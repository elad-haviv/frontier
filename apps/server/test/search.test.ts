import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SwitcherResponse } from "@frontier/schema";
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
