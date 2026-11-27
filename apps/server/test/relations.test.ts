import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { RelationsResponse } from "@frontier/schema";
import { yearOf } from "../src/relations/collect.js";
import { makeTestApp, type TestApp } from "./helpers/app.js";

let t: TestApp;
afterEach(() => t.close());

const ALDRIC = "02 People/Aldric Vane.md";
const CORIN = "02 People/Corin Vane.md";
const WREN = "02 People/Wren Vane.md";
const NESSA = "02 People/Nessa Pike.md";
const GARROW = "02 People/Garrow Pike.md";

const NOTES: Record<string, string> = {
  [ALDRIC]:
    '---\ntype: person\ntime:\n  - what: born\n    when: "212"\n  - what: died\n    when: "c. 281 EM"\n' +
    'relations:\n  - what: child\n    who: "[[Corin Vane]]"\n---\n# Aldric Vane\n',
  // Corin says the same as Aldric, the other way round, and adds an adoption Wren does not mention.
  [CORIN]:
    '---\nrelations:\n  - what: father\n    who: "[[Aldric Vane]]"\n  - what: child\n    who: "[[Wren Vane]]"\n    how: adopted\n---\n# Corin Vane\n',
  [WREN]:
    "---\nrelations:\n  - what: parent\n    who: \"[[Corin Vane]]\"\n  - what: partner\n    who: \"[[Garrow Pike]]\"\n    when: from 288\n" +
    '  - what: child\n    who: "[[Nessa Pike]]"\n    with: "[[Garrow Pike]]"\n  - what: friend\n    who: "[[Odo]]"\n  - what: rival\n    who: "[[Unwritten One]]"\n---\n# Wren Vane\n',
  [NESSA]: "# Nessa Pike\n",
  [GARROW]: "# Garrow Pike\n",
};

beforeEach(async () => {
  t = await makeTestApp();
  await t.login();
  t.repo.pushFromOutside(NOTES);
  await t.services.sync();
});

const relations = async () => {
  const res = await t.get("/api/relations");
  expect(res.statusCode, res.body).toBe(200);
  return RelationsResponse.parse(res.json());
};
const textOf = async (path: string) =>
  ((await t.get(`/api/entries?path=${encodeURIComponent(path)}`)).json() as { text: string }).text;

describe("reading relations", () => {
  it("merges a fact written on both entries, whichever word and way round", async () => {
    const r = await relations();
    const parents = r.facts.filter((f) => f.kind === "parent");
    const aldric = parents.find((f) => f.a === ALDRIC)!;
    expect(aldric.b).toBe(CORIN);
    expect(aldric.sources.map((s) => s.path).sort()).toEqual([ALDRIC, CORIN]);
    expect(aldric.disagree).toBeNull();
  });

  it("says when the two entries disagree", async () => {
    const r = await relations();
    const wren = r.facts.find((f) => f.kind === "parent" && f.b === WREN)!;
    expect(wren.how).toBe("adopted");
    expect(wren.disagree).toBe("Only one of Corin Vane and Wren Vane says it is adopted.");
  });

  it("keeps the other parent, the time, names with no entry and unknown words", async () => {
    const r = await relations();
    const nessa = r.facts.find((f) => f.b === NESSA)!;
    expect(nessa).toMatchObject({ kind: "parent", a: WREN, with: GARROW });
    expect(r.facts.find((f) => f.kind === "partner")).toMatchObject({ when: "from 288" });
    const rival = r.facts.find((f) => f.kind === "rival")!;
    expect([rival.a, rival.b]).toContain("?Unwritten One");
    expect(r.people.find((p) => p.key === "?Unwritten One")).toMatchObject({ path: null });
    expect(r.unknown).toEqual([{ path: WREN, index: 3, word: "friend" }]);
  });

  it("reads years from the dates for the cards", async () => {
    const r = await relations();
    expect(r.people.find((p) => p.key === ALDRIC)).toMatchObject({
      born: 212,
      died: 281,
      dates: "212 – c. 281 EM",
    });
    expect(yearOf("after the flood")).toBeNull();
    expect(yearOf("-50")).toBe(-50);
    expect(yearOf("3rd age")).toBeNull();
  });
});

describe("adding and removing", () => {
  it("writes one item on one entry only, and the tree sees it at once", async () => {
    const res = await t.post("/api/relations", { path: NESSA, what: "partner", who: "Odo Vane" });
    expect(res.statusCode, res.body).toBe(200);
    expect(await textOf(NESSA)).toBe('---\nrelations:\n  - what: partner\n    who: "[[Odo Vane]]"\n---\n# Nessa Pike\n');
    expect(await textOf(GARROW)).toBe("# Garrow Pike\n");
    const r = await relations();
    expect(r.facts.some((f) => f.kind === "partner" && [f.a, f.b].includes("?Odo Vane"))).toBe(true);
  });

  it("links an entry by its path, and can make a new entry in the same folder", async () => {
    await t.post("/api/relations", { path: GARROW, what: "child", who: NESSA, with: WREN });
    expect(await textOf(GARROW)).toContain('who: "[[Nessa Pike]]"\n    with: "[[Wren Vane]]"');
    const made = await t.post("/api/relations", { path: NESSA, what: "child", who: "Tamsin", create: true });
    expect(made.json()).toMatchObject({ made: "02 People/Tamsin.md" });
    expect(await textOf("02 People/Tamsin.md")).toBe("# Tamsin\n\n");
    const r = await relations();
    expect(r.facts.find((f) => f.b === "02 People/Tamsin.md")).toMatchObject({ a: NESSA });
  });

  it("removes an item only if it is still the one shown", async () => {
    const stale = await t.post("/api/relations/remove", { path: WREN, index: 0, what: "partner", who: "x" });
    expect(stale.statusCode).toBe(409);
    const ok = await t.post("/api/relations/remove", {
      path: WREN,
      index: 0,
      what: "parent",
      who: "[[Corin Vane]]",
    });
    expect(ok.statusCode, ok.body).toBe(200);
    expect(await textOf(WREN)).not.toContain("[[Corin Vane]]");
  });

  it("refuses to write a list it cannot read", async () => {
    t.repo.pushFromOutside({ [NESSA]: "---\nrelations: lots\n---\n# Nessa Pike\n" });
    await t.services.sync();
    const res = await t.post("/api/relations", { path: NESSA, what: "rival", who: "Wren Vane" });
    expect(res.statusCode).toBe(403);
    const unreadable = t.services.index.attention().unreadableFields;
    expect(unreadable).toContainEqual({ path: NESSA, problems: ["`relations` is not a list."] });
  });
});
