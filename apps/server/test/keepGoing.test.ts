import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  AfterPublishResponse,
  FromHereResponse,
  GraphResponse,
  LinkItResponse,
  PinsResponse,
  QueueResponse,
  RandomResponse,
  SettingsResponse,
  TreeResponse,
} from "@frontier/schema";
import { makeTestApp, type TestApp } from "./helpers/app.js";

let t: TestApp;
afterEach(() => t.close());

const WORDS = (n: number, word = "stone") => Array(n).fill(word).join(" ");

const ALPHA = "10 Test/Alpha.md";
const BETA = "10 Test/Beta.md";
const GAMMA = "10 Test/Gamma.md";
const DELTA = "10 Test/Delta.md";
const LONELY = "10 Test/Lonely.md";
const TABLE = "10 Test/Table.md";
const WATER = "10 Test/Water.md";

const NOTES: Record<string, string> = {
  // Typed, long and with a picture: needs nothing but is the centre of the others.
  [ALPHA]:
    "---\ntype: place\naliases: [The First, Alpha Town]\n---\n# Alpha\n\n" +
    `${WORDS(160)} [[Beta]] and [[Gamma]], and [[Missing One]]. ![[photo.png]]\n`,
  // A stub three entries link to, with no type, an empty heading and a to-do mark.
  [BETA]: "# Beta\n\nA short note, TODO more.\n\n## Empty\n\n## Other\n\nSome words.\n",
  [GAMMA]:
    "---\ntype: place\n---\n# Gamma\n\nSee [[Beta]] and [[Missing One]] and [[missing one]].\n\n" +
    "The road to Alpha is long, and Alpha Town is far. " +
    `${WORDS(90)}\n`,
  [DELTA]:
    "---\ntype: place\n---\n# Delta\n\n[[Beta]] and [[Missing Two]]. " +
    `${WORDS(90)}\n\n## About Alpha\n\n\`Alpha\` stays as code.\n\n\`\`\`\nAlpha in a block\n\`\`\`\n\n` +
    "A web address https://example.com/Alpha stays.\n",
  [LONELY]: "---\ntype: place\n---\n# Lonely\n\nNobody links here, but it goes to [[Alpha]].\n",
  [TABLE]: "---\ntype: place\n---\n# Table\n\n| name | note |\n| --- | --- |\n| alpha | here |\n",
  [WATER]: "---\ntype: place\n---\n# Water\n\nWater is everywhere. " + `${WORDS(90)}\n`,
  "10 Test/Rain.md":
    "---\ntype: place\n---\n# Rain\n\nIn the hills the water falls. " + `${WORDS(90)}\n`,
  "10 Test/Wells.md": "---\ntype: place\n---\n# Wells\n\nA deep water well. " + `${WORDS(90)}\n`,
  "10 Test/Rivers.md": "---\ntype: place\n---\n# Rivers\n\nThe water runs. " + `${WORDS(90)}\n`,
};

beforeEach(async () => {
  t = await makeTestApp();
  await t.login();
  t.repo.pushFromOutside(NOTES);
  await t.services.sync();
});

const queue = async () => {
  const res = await t.get("/api/keep-going/queue");
  expect(res.statusCode, res.body).toBe(200);
  return QueueResponse.parse(res.json());
};
const fromHere = async (path: string) => {
  const res = await t.get(`/api/keep-going/from-here?path=${encodeURIComponent(path)}`);
  expect(res.statusCode, res.body).toBe(200);
  return FromHereResponse.parse(res.json());
};
const entry = async (path: string) =>
  (await t.get(`/api/entries?path=${encodeURIComponent(path)}`)).json() as {
    text: string;
    draft: { id: string; revision: number } | null;
  };

describe("the work queue", () => {
  it("lists entries that need love, each with its reasons, most linked first", async () => {
    const q = await queue();
    const beta = q.needsLove.rows.find((r) => r.path === BETA)!;
    expect(beta.reasons.map((r) => r.rule)).toEqual([
      "stub",
      "emptyHeadings",
      "noType",
      "todoMarks",
    ]);
    expect(beta.reasons[0]!.text).toBe("Stub: 7 words, linked from 3 entries");
    expect(beta.reasons[1]!.text).toBe('Empty heading: "Empty"');
    expect(beta.reasons[3]!.text).toBe("Marked TODO");
    expect(beta.linkedFrom).toBe(3);
    expect(beta.folder).toBe("10 Test");
    expect(beta.title).toBe("Beta");
    // Alpha has a type, a picture and no marks: it needs nothing.
    expect(q.needsLove.rows.some((r) => r.path === ALPHA)).toBe(false);
    // Ranked by how many link to the entry.
    const linked = q.needsLove.rows.map((r) => r.linkedFrom);
    expect(linked).toEqual([...linked].sort((a, b) => b - a));
    expect(q.needsLove.total).toBe(q.needsLove.rows.length);
  });

  it("never lists the README, appendices or Frontier's own files", async () => {
    const q = await queue();
    const all = [...q.needsLove.rows, ...q.orphans.rows, ...q.deadEnds.rows].map((r) => r.path);
    expect(all.some((p) => p.endsWith("README.md"))).toBe(false);
    expect(all.some((p) => p.startsWith("99 Appendices/") || p.startsWith(".frontier/"))).toBe(
      false,
    );
    expect(q.folders.map((f) => f.folder)).not.toContain("99 Appendices");
  });

  it("trips the picture rule only for entries of 150 words or more", async () => {
    t.repo.pushFromOutside({
      "10 Test/Wide.md": `---\ntype: place\n---\n# Wide\n\n${WORDS(150)}\n`,
      "10 Test/Narrow.md": `---\ntype: place\n---\n# Narrow\n\n${WORDS(149)}\n`,
    });
    await t.services.sync();
    const rows = (await queue()).needsLove.rows;
    expect(rows.find((r) => r.path === "10 Test/Wide.md")!.reasons).toEqual([
      { rule: "noPicture", text: "No picture (150 words)" },
    ]);
    expect(rows.some((r) => r.path === "10 Test/Narrow.md")).toBe(false);
  });

  it("counts open comments and names several empty headings", async () => {
    await t.services.comments.add({
      path: ALPHA,
      quote: "stone",
      prefix: "",
      suffix: "",
      text: "Check",
      for: "me",
    });
    await t.services.comments.add({
      path: ALPHA,
      quote: "stone",
      prefix: "",
      suffix: "",
      text: "Again",
      for: "me",
    });
    t.repo.pushFromOutside({
      "10 Test/Bare.md":
        "---\ntype: place\n---\n# Bare\n\n## One\n\n## Two\n\n### Deep\n\n## Code\n\n```\n??\nTODO\n```\n",
    });
    await t.services.sync();
    const rows = (await queue()).needsLove.rows;
    expect(rows.find((r) => r.path === ALPHA)!.reasons).toEqual([
      { rule: "openComments", text: "2 open comments" },
    ]);
    const bare = rows.find((r) => r.path === "10 Test/Bare.md")!;
    // The "??" is in a code block, so it is not a mark. "Two" holds only "Deep", which is empty
    // too; "Bare" holds the section of code, so it is not.
    expect(bare.reasons).toEqual([{ rule: "emptyHeadings", text: '3 empty headings, from "One"' }]);
  });

  it("lists wanted names with how many entries mention them and a likely folder", async () => {
    const wanted = (await queue()).wanted.rows;
    const one = wanted.find((w) => w.name === "Missing One")!;
    // Alpha and Gamma, and the second spelling counts once.
    expect(one.mentions).toBe(2);
    expect(one.folder).toBe("10 Test");
    expect(one.examples.map((e) => e.path)).toEqual([ALPHA, GAMMA]);
    expect(wanted.find((w) => w.name === "Missing Two")!.mentions).toBe(1);
    expect(wanted[0]!.mentions).toBeGreaterThanOrEqual(wanted.at(-1)!.mentions);
    // An embed of an image is not a wanted entry.
    expect(wanted.some((w) => /photo/i.test(w.name))).toBe(false);
  });

  it("lists orphans and dead ends", async () => {
    const q = await queue();
    expect(q.orphans.rows.map((r) => r.path)).toContain(LONELY);
    expect(q.orphans.rows.map((r) => r.path)).not.toContain(BETA);
    expect(q.deadEnds.rows.map((r) => r.path)).toContain(BETA);
    expect(q.deadEnds.rows.map((r) => r.path)).not.toContain(ALPHA);
    expect(q.orphans.rows.find((r) => r.path === LONELY)!.linksTo).toBe(1);
  });

  it("counts the stubs of each top folder, in the tree's order", async () => {
    const q = await queue();
    const test = q.folders.find((f) => f.folder === "10 Test")!;
    const files = q.folders.map((f) => f.folder);
    expect(test.entries).toBe(Object.keys(NOTES).length);
    // Beta, Lonely and Table are short.
    expect(test.stubs).toBe(3);
    expect(files).toEqual(
      [...files].sort((a, b) => a.localeCompare(b, undefined, { numeric: true })),
    );
    expect(q.entries).toBeGreaterThan(Object.keys(NOTES).length);
  });

  it("switches a rule off in the settings, and reports the rules", async () => {
    expect((await t.get("/api/settings")).json().keepGoing.needsLove.stub).toBe(true);
    const res = await t.put("/api/settings/keep-going", {
      needsLove: { stub: false, noType: false },
    });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().needsLove).toEqual({
      stub: false,
      emptyHeadings: true,
      noType: false,
      noPicture: true,
      openComments: true,
      todoMarks: true,
    });
    const q = await queue();
    expect(q.rules.stub).toBe(false);
    expect(q.needsLove.rows.find((r) => r.path === BETA)!.reasons.map((r) => r.rule)).toEqual([
      "emptyHeadings",
      "todoMarks",
    ]);
    expect(
      SettingsResponse.parse((await t.get("/api/settings")).json()).keepGoing.needsLove.stub,
    ).toBe(false);
    // A rule left out of the request keeps its setting.
    await t.put("/api/settings/keep-going", { needsLove: { stub: true } });
    expect((await queue()).rules).toMatchObject({ stub: true, noType: false });
    expect(
      (await t.put("/api/settings/keep-going", { needsLove: { stub: "yes" } })).statusCode,
    ).toBe(400);
  });

  it("is fast on a library of a few thousand entries", async () => {
    const many: Record<string, string> = {};
    for (let i = 0; i < 2500; i++) {
      many[`20 Many/Entry ${i}.md`] =
        `---\ntype: place\n---\n# Entry ${i}\n\n${WORDS(60)} [[Entry ${(i + 1) % 2500}]] [[Entry ${(i * 7) % 2500}]] [[Wanted ${i % 40}]]\n`;
    }
    t.repo.pushFromOutside(many);
    await t.services.sync();
    const started = Date.now();
    const q = await queue();
    const second = await t.get(
      `/api/keep-going/from-here?path=${encodeURIComponent("20 Many/Entry 5.md")}`,
    );
    expect(second.statusCode).toBe(200);
    expect(q.entries).toBeGreaterThan(2500);
    expect(q.wanted.rows.length).toBeGreaterThan(40);
    expect(Date.now() - started).toBeLessThan(5000);
  });
});

describe("from here", () => {
  it("lists this entry's links that have no entry, with library-wide counts", async () => {
    const here = await fromHere(ALPHA);
    expect(here.missing).toEqual([
      expect.objectContaining({ name: "Missing One", mentions: 2, folder: "10 Test" }),
    ]);
    // Gamma has the same name twice, in two spellings: once.
    expect((await fromHere(GAMMA)).missing.map((m) => m.name)).toEqual(["Missing One"]);
  });

  it("finds entries that name this one without linking, with the sentence", async () => {
    const here = await fromHere(ALPHA);
    // Gamma names it twice, once by an alias; Delta only in places that do not count.
    expect(here.unlinked).toEqual([
      {
        path: GAMMA,
        title: "Gamma",
        sentence: expect.stringContaining("The road to Alpha is long"),
        at: [12, 17],
        name: "Alpha",
      },
      expect.objectContaining({ path: TABLE, name: "alpha" }),
    ]);
    expect(here.unlinkedMore).toBe(false);
    expect(here.unlinked[0]!.sentence.slice(...here.unlinked[0]!.at)).toBe("Alpha");
    // Entries that link to it already are not offered.
    expect(here.unlinked.some((m) => m.path === LONELY)).toBe(false);
  });

  it("matches another name of the entry, and treats an ordinary word by its capital", async () => {
    const water = await fromHere(WATER);
    // "water" is written in lower case in three other entries: only "Water" as a name counts.
    expect(water.unlinked).toEqual([]);
    t.repo.pushFromOutside({ "10 Test/Sea.md": "# Sea\n\nThe sea meets Water at the cliffs.\n" });
    await t.services.sync();
    expect((await fromHere(WATER)).unlinked.map((m) => m.path)).toEqual(["10 Test/Sea.md"]);
  });

  it("caps the mentions", async () => {
    const many: Record<string, string> = {};
    for (let i = 0; i < 25; i++)
      many[`30 Mentions/M${String(i).padStart(2, "0")}.md`] = `# M${i}\n\nAlpha again.\n`;
    t.repo.pushFromOutside(many);
    await t.services.sync();
    const here = await fromHere(ALPHA);
    expect(here.unlinked).toHaveLength(20);
    expect(here.unlinkedMore).toBe(true);
  });

  it("lists neighbours that need love, and related entries", async () => {
    const here = await fromHere(ALPHA);
    expect(here.thin.map((n) => [n.path, n.direction])).toEqual([[BETA, "links"]]);
    expect(here.thin[0]!.reasons.map((r) => r.rule)).toContain("stub");
    expect(here.thin[0]!.words).toBe(7);
    // Delta shares Beta with Alpha and is not linked to it.
    expect(here.related).toEqual([{ path: DELTA, title: "Delta", shared: 1 }]);
    const beta = await fromHere(BETA);
    expect(beta.thin).toEqual([]);
    expect(beta.related.map((r) => r.path)).toContain(LONELY);
  });

  it("gives the entries either side in the folder", async () => {
    const mid = await fromHere(BETA);
    expect(mid.previous).toEqual({ path: ALPHA, title: "Alpha" });
    expect(mid.next).toEqual({ path: DELTA, title: "Delta" });
    expect((await fromHere(ALPHA)).previous).toBeNull();
    expect((await fromHere("10 Test/Wells.md")).next).toBeNull();
  });

  it("answers for an entry that is only a draft, and refuses one that is not there", async () => {
    await t.put("/api/drafts", {
      id: "newdraft0001",
      path: "10 Test/Fresh.md",
      kind: "create",
      text: "# Fresh\n",
      revision: 0,
    });
    const fresh = await fromHere("10 Test/Fresh.md");
    expect(fresh).toMatchObject({ missing: [], unlinked: [], previous: null, next: null });
    const res = await t.get("/api/keep-going/from-here?path=Nope.md");
    expect(res.statusCode).toBe(404);
  });
});

describe("Link it", () => {
  it("links the first mention as an ordinary unpublished draft, keeping the words shown", async () => {
    const res = await t.post("/api/keep-going/link-it", { path: GAMMA, target: ALPHA });
    expect(res.statusCode, res.body).toBe(200);
    const made = LinkItResponse.parse(res.json());
    expect(made.before).toContain("The road to Alpha is long");
    expect(made.after).toContain("The road to [[Alpha]] is long");
    const now = await entry(GAMMA);
    expect(now.text).toContain("The road to [[Alpha]] is long, and Alpha Town is far.");
    expect(now.draft).toMatchObject({ revision: 1 });
    // Undo is a token the server keeps the rest for, not what the page may decide.
    expect(Object.keys(made.undo)).toEqual(["token"]);
    // Nothing is published.
    expect(t.repo.remoteFile(GAMMA)).not.toContain("[[Alpha]]");
    // The next one is the alias, kept as the words shown.
    await t.post("/api/keep-going/link-it", { path: GAMMA, target: ALPHA });
    expect((await entry(GAMMA)).text).toContain("[[Alpha|Alpha Town]] is far");
  });

  it("keeps the words as written when only the letter case differs, and escapes a table bar", async () => {
    const res = await t.post("/api/keep-going/link-it", { path: TABLE, target: ALPHA });
    expect(res.statusCode, res.body).toBe(200);
    expect((await entry(TABLE)).text).toContain("| [[Alpha\\|alpha]] | here |");
  });

  it("builds on the author's own draft, and Undo puts that draft back", async () => {
    const own = (await entry(GAMMA)).text.replace("Gamma", "Gamma, edited");
    expect(
      (
        await t.put("/api/drafts", {
          id: "gammadraft01",
          path: GAMMA,
          kind: "edit",
          text: own,
          revision: 0,
          baseBlob: (await entry(GAMMA)).draft
            ? undefined
            : (
                (await t.get(`/api/entries?path=${encodeURIComponent(GAMMA)}`)).json() as {
                  blob: string;
                }
              ).blob,
        })
      ).statusCode,
    ).toBe(200);
    const made = LinkItResponse.parse(
      (await t.post("/api/keep-going/link-it", { path: GAMMA, target: ALPHA })).json(),
    );
    const linked = await entry(GAMMA);
    expect(linked.text).toContain("# Gamma, edited");
    expect(linked.text).toContain("[[Alpha]]");
    // A device still holding the older revision is told, as for any change from the server.
    const old = await t.put("/api/drafts", {
      id: "gammadraft01",
      path: GAMMA,
      kind: "edit",
      text: own + "more",
      revision: 1,
      baseBlob: (
        (await t.get(`/api/entries?path=${encodeURIComponent(GAMMA)}`)).json() as { blob: string }
      ).blob,
    });
    expect(old.statusCode).toBe(409);
    expect(old.json().error.code).toBe("stale_revision");
    // Undo puts the author's own draft back, not the text before it.
    expect((await t.post("/api/keep-going/link-it/undo", made.undo)).statusCode).toBe(200);
    const back = await entry(GAMMA);
    expect(back.draft).not.toBeNull();
    expect(back.text).toBe(own);
  });

  it("Undo removes a draft Link it made, or restores the text before", async () => {
    const made = LinkItResponse.parse(
      (await t.post("/api/keep-going/link-it", { path: GAMMA, target: ALPHA })).json(),
    );
    const undone = await t.post("/api/keep-going/link-it/undo", made.undo);
    expect(undone.statusCode, undone.body).toBe(200);
    const back = await entry(GAMMA);
    expect(back.draft).toBeNull();
    expect(back.text).not.toContain("[[Alpha]]");
    // Once undone, there is nothing to undo again.
    expect((await t.post("/api/keep-going/link-it/undo", made.undo)).statusCode).toBe(404);
  });

  it("refuses Undo when the draft changed since, and a mention that is gone", async () => {
    const made = LinkItResponse.parse(
      (await t.post("/api/keep-going/link-it", { path: GAMMA, target: ALPHA })).json(),
    );
    const draft = (await entry(GAMMA)).draft!;
    await t.services.drafts.serverChange(draft.id, "# Gamma\n\nChanged.\n");
    const undone = await t.post("/api/keep-going/link-it/undo", made.undo);
    expect(undone.statusCode).toBe(403);
    expect(undone.json().error.code).toBe("not_allowed");
    const gone = await t.post("/api/keep-going/link-it", { path: DELTA, target: ALPHA });
    expect(gone.statusCode).toBe(404);
    expect(
      (await t.post("/api/keep-going/link-it", { path: GAMMA, target: "Nope.md" })).statusCode,
    ).toBe(404);
    expect(
      (await t.post("/api/keep-going/link-it", { path: "Nope.md", target: ALPHA })).statusCode,
    ).toBe(404);
  });

  it("changes nothing in an append-only entry", async () => {
    t.repo.pushFromOutside({
      "99 Appendices/Logs/Alpha log.md": "# Alpha log\n\nAlpha was here.\n",
    });
    await t.services.sync();
    const res = await t.post("/api/keep-going/link-it", {
      path: "99 Appendices/Logs/Alpha log.md",
      target: ALPHA,
    });
    expect(res.statusCode).toBe(403);
  });

  it("writes the link with a path when another entry shares the name", async () => {
    t.repo.pushFromOutside({
      "11 Other/Alpha.md": "# Alpha\n\nAnother one.\n",
      "10 Test/Mentioner.md": "# Mentioner\n\nThe Alpha here.\n",
    });
    await t.services.sync();
    const res = await t.post("/api/keep-going/link-it", {
      path: "10 Test/Mentioner.md",
      target: "11 Other/Alpha.md",
    });
    expect(res.statusCode, res.body).toBe(200);
    expect((await entry("10 Test/Mentioner.md")).text).toContain("[[11 Other/Alpha|Alpha]]");
    const both = await t.post("/api/keep-going/link-it", {
      path: "10 Test/Mentioner.md",
      target: ALPHA,
    });
    expect(both.statusCode).toBe(404);
  });
});

describe("random entry", () => {
  const random = async (query = "") => {
    const res = await t.get(`/api/keep-going/random${query}`);
    expect(res.statusCode, res.body).toBe(200);
    return RandomResponse.parse(res.json()).entry;
  };

  it("picks any entry but not the README, an appendix or the one given", async () => {
    for (let i = 0; i < 15; i++) {
      const e = (await random(`?not=${encodeURIComponent(ALPHA)}`))!;
      expect(e.path).not.toBe(ALPHA);
      expect(e.path).not.toMatch(/README|^99 Appendices/);
    }
  });

  it("picks a stub, or from a folder", async () => {
    for (let i = 0; i < 10; i++) {
      expect((await random("?kind=stub"))!.words).toBeLessThan(80);
      expect((await random(`?kind=folder&folder=${encodeURIComponent("10 Test")}`))!.path).toMatch(
        /^10 Test\//,
      );
    }
    expect(await random("?kind=folder&folder=Nowhere")).toBeNull();
    expect((await t.get("/api/keep-going/random?kind=folder")).statusCode).toBe(400);
    expect((await t.get("/api/keep-going/random?kind=sideways")).statusCode).toBe(400);
  });

  it("picks an entry untouched for six months, and none while all are recent", async () => {
    // Everything was written just now.
    expect(await random("?kind=old")).toBeNull();
    t.services.keepGoingHistory["d"].now = () => new Date(Date.now() + 200 * 24 * 60 * 60 * 1000);
    expect(await random("?kind=old")).not.toBeNull();
  });
});

describe("pins", () => {
  const pins = async () => PinsResponse.parse((await t.get("/api/pins")).json()).pins;
  const pin = (path: string) => t.post("/api/pins", { path });

  it("starts empty and pins entries in order, each once", async () => {
    expect(await pins()).toEqual([]);
    expect((await pin(ALPHA)).statusCode).toBe(200);
    expect((await pin(BETA)).statusCode).toBe(200);
    await pin(ALPHA);
    expect(await pins()).toEqual([
      { path: ALPHA, title: "Alpha", words: expect.any(Number) },
      { path: BETA, title: "Beta", words: 7 },
    ]);
  });

  it("is saved at once as the library's pins file, an unpublished change", async () => {
    await pin(ALPHA);
    const file = (await t.get("/api/library-files/pins")).json().file;
    expect(file).toEqual({ version: 1, pins: [{ path: ALPHA }] });
    const unpublished = (await t.get("/api/unpublished")).json().drafts as {
      path: string;
      text: string;
    }[];
    const draft = unpublished.find((d) => d.path === ".frontier/pins.json")!;
    expect(draft.text).toBe(`{\n  "version": 1,\n  "pins": [\n    {"path":"${ALPHA}"}\n  ]\n}\n`);
  });

  it("unpins, and orders", async () => {
    await pin(ALPHA);
    await pin(BETA);
    await pin(GAMMA);
    const res = await t.put("/api/pins", { paths: [GAMMA, "10 Test/Unknown.md", ALPHA] });
    expect(PinsResponse.parse(res.json()).pins.map((p) => p.path)).toEqual([GAMMA, ALPHA, BETA]);
    // The same order again changes nothing.
    const revision = (await t.get("/api/library-files/pins")).json().revision;
    await t.put("/api/pins", { paths: [GAMMA, ALPHA, BETA] });
    expect((await t.get("/api/library-files/pins")).json().revision).toBe(revision);
    const gone = await t.del(`/api/pins?path=${encodeURIComponent(ALPHA)}`);
    expect(PinsResponse.parse(gone.json()).pins.map((p) => p.path)).toEqual([GAMMA, BETA]);
    // Unpinning what is not pinned writes nothing.
    await t.del(`/api/pins?path=${encodeURIComponent(ALPHA)}`);
    expect((await t.get("/api/library-files/pins")).json().revision).toBe(revision + 1);
  });

  it("does not create the file when nothing is pinned", async () => {
    await t.del(`/api/pins?path=${encodeURIComponent(ALPHA)}`);
    expect((await t.get("/api/unpublished")).json().drafts).toEqual([]);
  });

  it("refuses what is not an entry, a pin beyond the limit, and bad input", async () => {
    expect((await pin("10 Test/Nowhere.md")).statusCode).toBe(404);
    expect((await pin("10 Test/Alpha.png")).statusCode).toBe(400);
    expect((await pin("../x.md")).statusCode).toBe(400);
    expect((await t.post("/api/pins", {})).statusCode).toBe(400);
    for (let i = 0; i < 30; i++) {
      t.repo.pushFromOutside({ [`40 Pins/P${i}.md`]: `# P${i}\n` });
    }
    await t.services.sync();
    for (let i = 0; i < 30; i++) expect((await pin(`40 Pins/P${i}.md`)).statusCode).toBe(200);
    const over = await pin(ALPHA);
    expect(over.statusCode).toBe(400);
    expect(over.json().error.message).toContain("30");
  });

  it("leaves out a pin whose entry is gone, and drops it at the next change", async () => {
    await pin(ALPHA);
    await pin(BETA);
    t.repo.pushFromOutside({ [BETA]: null });
    await t.services.sync();
    expect((await pins()).map((p) => p.path)).toEqual([ALPHA]);
    await pin(GAMMA);
    expect((await t.get("/api/library-files/pins")).json().file.pins).toEqual([
      { path: ALPHA },
      { path: GAMMA },
    ]);
    // An entry marked for deletion is gone too, and so is one the author deleted.
    const draft = await t.put("/api/drafts", {
      id: "deletegamma1",
      path: GAMMA,
      kind: "delete",
      text: "",
      revision: 0,
      baseBlob: (
        (await t.get(`/api/entries?path=${encodeURIComponent(GAMMA)}`)).json() as { blob: string }
      ).blob,
    });
    expect(draft.statusCode, draft.body).toBe(200);
    expect((await pins()).map((p) => p.path)).toEqual([ALPHA]);
  });

  it("follows a rename when it is published", async () => {
    await pin(BETA);
    const renamed = await t.post("/api/renames", { from: BETA, to: "10 Test/Beta Prime.md" });
    expect(renamed.statusCode, renamed.body).toBe(200);
    const ids = (await t.get("/api/unpublished")).json() as {
      drafts: { id: string }[];
      renames: { id: string }[];
    };
    const plan = await t.post("/api/publish/plan", {
      draftIds: ids.drafts.map((d) => d.id),
      renameIds: ids.renames.map((r) => r.id),
    });
    expect(plan.statusCode, plan.body).toBe(200);
    const done = await t.post("/api/publish/confirm", {
      planId: plan.json().planId,
      confirmedMergeIds: [],
      message: "Rename Beta",
    });
    expect(done.statusCode, done.body).toBe(200);
    expect((await pins()).map((p) => p.path)).toEqual(["10 Test/Beta Prime.md"]);
  });
});

describe("after Publish", () => {
  const after = async (paths: string[]) => {
    const res = await t.post("/api/keep-going/after-publish", { paths });
    expect(res.statusCode, res.body).toBe(200);
    return AfterPublishResponse.parse(res.json()).steps;
  };

  it("offers a stub one of them links to, and a link with no entry", async () => {
    const steps = await after([ALPHA]);
    expect(steps).toEqual([
      {
        kind: "stub",
        path: BETA,
        title: "Beta",
        words: 7,
        from: { path: ALPHA, title: "Alpha" },
      },
      {
        kind: "missing",
        name: "Missing One",
        mentions: 2,
        folder: "10 Test",
        from: { path: ALPHA, title: "Alpha" },
      },
    ]);
  });

  it("adds a random entry untouched for six months, never one just published", async () => {
    t.services.keepGoingHistory["d"].now = () => new Date(Date.now() + 200 * 24 * 60 * 60 * 1000);
    const steps = await after([ALPHA, BETA]);
    expect(steps.map((s) => s.kind)).toEqual(["stub", "missing", "old"]);
    const old = steps[2]!;
    expect(old.kind === "old" && [ALPHA, BETA].includes(old.path)).toBe(false);
  });

  it("offers nothing for entries that are not there, and refuses an empty list", async () => {
    expect(await after(["Nowhere.md"])).toEqual([]);
    expect((await t.post("/api/keep-going/after-publish", { paths: [] })).statusCode).toBe(400);
  });
});

describe("words and the AI flag in other answers", () => {
  it("gives the graph, tree, search and switcher the words of an entry", async () => {
    const graph = GraphResponse.parse((await t.get("/api/graph")).json());
    expect(graph.nodes.find((n) => n.path === BETA)!.words).toBe(7);
    const tree = TreeResponse.parse((await t.get("/api/tree")).json());
    const test = tree.folders.find((f) => f.path === "10 Test")!;
    expect(test.notes.find((n) => n.path === BETA)!.words).toBe(7);
    const found = (await t.get("/api/search?q=beta")).json().results as {
      path: string;
      words?: number;
    }[];
    expect(found.find((r) => r.path === BETA)!.words).toBe(7);
    const names = (await t.get("/api/switcher?q=beta")).json().results as {
      path: string;
      words?: number;
    }[];
    expect(names.find((r) => r.path === BETA)!.words).toBe(7);
    // A draft's node counts the draft's words.
    await t.put("/api/drafts", {
      id: "freshdraft01",
      path: "10 Test/Fresh.md",
      kind: "create",
      text: "# Fresh\n\none two three\n",
      revision: 0,
    });
    const next = GraphResponse.parse((await t.get("/api/graph")).json());
    expect(next.nodes.find((n) => n.path === "10 Test/Fresh.md")!.words).toBe(3);
  });

  it("says whether lore conversations can run: a model is chosen", async () => {
    expect((await t.get("/api/lore")).json().ready).toBe(false);
  });
});

describe("Link it under pressure", () => {
  const link = async (path: string, target = ALPHA) =>
    (await t.post("/api/keep-going/link-it", { path, target })).statusCode;

  it("keeps what the author saves while Link it is reading the entry", async () => {
    await t.services.changer.apply(GAMMA, (x) => x + "\nfirst draft line\n");
    const draft = t.services.drafts.byPath(GAMMA)!;
    // An editor save lands just after the first read of the draft's text.
    const drafts = t.services.drafts;
    const real = drafts.text.bind(drafts);
    let armed = true;
    drafts.text = async (id: string) => {
      const text = await real(id);
      if (armed && id === draft.id) {
        armed = false;
        await drafts.serverChange(id, text + "TYPED BY AUTHOR\n");
      }
      return text;
    };
    expect(await link(GAMMA)).toBe(200);
    drafts.text = real;
    const now = (await entry(GAMMA)).text;
    expect(now).toContain("TYPED BY AUTHOR");
    expect(now).toContain("The road to [[Alpha]] is long");
    expect(now).toContain("first draft line");
  });

  it("links in a file with Windows line endings and keeps them", async () => {
    t.repo.pushFromOutside({
      "10 Test/Crlf.md": "# Crlf\r\n\r\nThe road to Alpha is long.\r\n\r\nMore.\r\n",
    });
    await t.services.sync();
    expect(await link("10 Test/Crlf.md")).toBe(200);
    const draft = t.services.drafts.byPath("10 Test/Crlf.md")!;
    expect(draft.lineEnding).toBe("crlf");
    expect((await entry("10 Test/Crlf.md")).text).toContain("The road to [[Alpha]] is long.");
    expect((await entry("10 Test/Crlf.md")).text).not.toContain("\r\r");
  });

  it("escapes the bar in a table row with no pipe at its start, and not elsewhere", async () => {
    t.repo.pushFromOutside({
      "10 Test/Bare.md": "# Bare\n\nname | note\n--- | ---\nalpha town | here\n",
      "10 Test/Prose.md": "# Prose\n\nSee [[Beta|the b]] and alpha town.\n",
    });
    await t.services.sync();
    expect(await link("10 Test/Bare.md")).toBe(200);
    expect((await entry("10 Test/Bare.md")).text).toContain("[[Alpha\\|alpha town]] | here");
    expect(await link("10 Test/Prose.md")).toBe(200);
    expect((await entry("10 Test/Prose.md")).text).toContain("and [[Alpha|alpha town]].");
  });

  it("leaves footnotes, reference links, addresses, setext headings and code alone", async () => {
    const skipped =
      "See the note[^Alpha] and [Alpha][a] and www.alpha.com or mail alpha@example.com.\n\n" +
      "[^Alpha]: a note\n\n[a]: ./Alpha.md\n\nAlpha again\n===========\n\n" +
      "    Alpha in indented code\n\n";
    t.repo.pushFromOutside({
      "10 Test/Foot.md": `# Foot\n\n${skipped}Then Alpha at last.\n`,
      "10 Test/Foot2.md": `# Foot2\n\n${skipped}`,
    });
    await t.services.sync();
    // Only the plain one is offered, and only the plain one is linked.
    const offered = FromHereResponse.parse(
      (await t.get(`/api/keep-going/from-here?path=${encodeURIComponent(ALPHA)}`)).json(),
    ).unlinked.map((m) => m.path);
    expect(offered).toContain("10 Test/Foot.md");
    expect(offered).not.toContain("10 Test/Foot2.md");
    expect(await link("10 Test/Foot.md")).toBe(200);
    expect((await entry("10 Test/Foot.md")).text).toBe(
      `# Foot\n\n${skipped}Then [[Alpha]] at last.\n`,
    );
    expect(await link("10 Test/Foot2.md")).toBe(404);
  });

  it("takes an Undo back only for a token it gave, and only for a while", async () => {
    const bogus = await t.post("/api/keep-going/link-it/undo", {
      token: "this-token-was-never-given-out",
    });
    expect(bogus.statusCode).toBe(404);
    expect(bogus.json().error.message).toContain("15 minutes");
    expect((await t.post("/api/keep-going/link-it/undo", { path: GAMMA })).statusCode).toBe(400);
    const made = LinkItResponse.parse(
      (await t.post("/api/keep-going/link-it", { path: GAMMA, target: ALPHA })).json(),
    );
    const keeper = t.services.keepGoing as unknown as { d: { now?: () => Date } };
    keeper.d.now = () => new Date(Date.now() + 16 * 60_000);
    expect((await t.post("/api/keep-going/link-it/undo", made.undo)).statusCode).toBe(404);
    // The draft is still there: an expired Undo takes nothing back.
    expect((await entry(GAMMA)).text).toContain("[[Alpha]]");
    keeper.d.now = () => new Date(Date.now() + 14 * 60_000);
    const again = LinkItResponse.parse(
      (await t.post("/api/keep-going/link-it", { path: GAMMA, target: ALPHA })).json(),
    );
    expect((await t.post("/api/keep-going/link-it/undo", again.undo)).statusCode).toBe(200);
  });

  it("does not trust what a page sends about the draft", async () => {
    const made = LinkItResponse.parse(
      (await t.post("/api/keep-going/link-it", { path: GAMMA, target: ALPHA })).json(),
    );
    // Extra fields a page might invent change nothing: the draft is removed as the server knows.
    const res = await t.post("/api/keep-going/link-it/undo", {
      ...made.undo,
      draftId: "someotherdraft",
      revision: 99,
      previousText: "# Gamma\n\nhijacked\n",
    });
    expect(res.statusCode, res.body).toBe(200);
    const back = await entry(GAMMA);
    expect(back.draft).toBeNull();
    expect(back.text).not.toContain("hijacked");
  });

  it("keeps only the newest Undo records", async () => {
    const keeper = t.services.keepGoing as unknown as { undos: Map<string, unknown> };
    const first = LinkItResponse.parse(
      (await t.post("/api/keep-going/link-it", { path: GAMMA, target: ALPHA })).json(),
    );
    for (let i = 0; i < 205; i++) {
      keeper.undos.set(`filler-${i}-xxxxxxxxxxxxxxxx`, { expires: 1e18 });
    }
    await t.post("/api/keep-going/link-it", { path: GAMMA, target: ALPHA });
    expect(keeper.undos.size).toBeLessThanOrEqual(200);
    expect(keeper.undos.has(first.undo.token)).toBe(false);
  });
});

describe("pins at the same time", () => {
  it("keeps every pin, in one draft of the file", async () => {
    const paths = [ALPHA, BETA, GAMMA, DELTA];
    const answers = await Promise.all(paths.map((path) => t.post("/api/pins", { path })));
    expect(answers.map((a) => a.statusCode)).toEqual([200, 200, 200, 200]);
    const now = PinsResponse.parse((await t.get("/api/pins")).json()).pins.map((p) => p.path);
    expect([...now].sort()).toEqual([...paths].sort());
    const drafts = t.services.drafts.list().filter((d) => d.path === ".frontier/pins.json");
    expect(drafts).toHaveLength(1);
  });

  it("does not lose an unpin or an order that runs with a pin", async () => {
    await t.post("/api/pins", { path: ALPHA });
    await t.post("/api/pins", { path: BETA });
    await Promise.all([
      t.post("/api/pins", { path: GAMMA }),
      t.del(`/api/pins?path=${encodeURIComponent(ALPHA)}`),
      t.put("/api/pins", { paths: [BETA] }),
    ]);
    const now = PinsResponse.parse((await t.get("/api/pins")).json()).pins.map((p) => p.path);
    expect(now).toEqual([BETA, GAMMA]);
  });
});
