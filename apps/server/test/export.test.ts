import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import yauzl from "yauzl";
import { makeTestApp, type TestApp } from "./helpers/app.js";

let t: TestApp;
afterEach(() => t.close());

const A = "03 Places/Tide Market.md";
const B = "03 Places/Salt Pier.md";
const OUT = "04 People/Ilsa Varn.md";
const APPX = "99 Appendices/Talk.md";
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

async function start() {
  t = await makeTestApp({}, { settleMs: 0 });
  await t.login();
  const stage = join(t.repo.root, "outside", "99 Appendices", "Images");
  execFileSync("mkdir", ["-p", stage]);
  writeFileSync(join(stage, "quay.png"), PNG);
  t.repo.pushFromOutside({
    [A]:
      "---\naliases: [Market]\n---\n# Tide Market\n\nA town by the [[Salt Pier#Stones|quay]], home of [[Ilsa Varn]].\n" +
      "Nobody knows [[Gone Place]].\n\n## Trade\n\nSalt and *fish*. See [the web](https://example.org).\n\n![[quay.png|200]]\n",
    [B]: "# Salt Pier\n\n## Stones\n\nOld stones, back to [[Tide Market]].\n",
    [OUT]: "# Ilsa Varn\n\nShe lives in [[Tide Market]].\n",
    [APPX]: "# Talk\n\nNotes.\n",
  });
  await t.services.sync();
}

const unzip = (bytes: Buffer): Promise<Record<string, string>> =>
  new Promise((resolve, reject) => {
    yauzl.fromBuffer(bytes, { lazyEntries: true }, (err, zip) => {
      if (err || !zip) return reject(err);
      const files: Record<string, string> = {};
      zip.readEntry();
      zip.on("entry", (entry: yauzl.Entry) => {
        zip.openReadStream(entry, (e, stream) => {
          if (e || !stream) return reject(e);
          const parts: Buffer[] = [];
          stream.on("data", (c: Buffer) => parts.push(c));
          stream.on("end", () => {
            files[entry.fileName] = Buffer.concat(parts).toString("latin1");
            zip.readEntry();
          });
        });
      });
      zip.on("end", () => resolve(files));
    });
  });

describe("choosing what to export", () => {
  it("takes a folder in reading order, and never appendices", async () => {
    await start();
    const res = await t.post("/api/export/preview", { folder: "03 Places" });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().entries.map((e: { title: string }) => e.title)).toEqual([
      "Salt Pier",
      "Tide Market",
    ]);
    const picked = await t.post("/api/export/preview", { paths: [A, APPX, "nowhere.md"] });
    expect(picked.json()).toMatchObject({
      entries: [{ path: A }],
      skipped: [APPX, "nowhere.md"],
      unsaved: [],
    });
  });

  it("says which chosen entries have unsaved changes", async () => {
    await start();
    await t.put("/api/drafts", {
      id: "a".repeat(12),
      path: A,
      kind: "edit",
      text: "x",
      revision: 0,
    });
    expect((await t.post("/api/export/preview", { folder: "03 Places" })).json().unsaved).toEqual([
      A,
    ]);
  });
});

describe("web pages", () => {
  it("makes linked pages, marks links to unshared entries, and copies images", async () => {
    await start();
    const res = await t.post("/api/export/site", { title: "The Harbor", folder: "03 Places" });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.headers["content-disposition"]).toContain("The%20Harbor.zip");
    const files = await unzip(res.rawPayload);
    expect(Object.keys(files).sort()).toEqual([
      "images/quay.png",
      "index.html",
      "salt-pier.html",
      "style.css",
      "tide-market.html",
    ]);
    const town = files["tide-market.html"]!;
    expect(town).toContain("<h1>Tide Market</h1>");
    // Its own title is not repeated, and its headings go down a level.
    expect(town.match(/Tide Market<\/h1>/g)).toHaveLength(1);
    expect(town).toContain("<h3>Trade</h3>");
    expect(town).toContain('<a href="salt-pier.html#stones">quay</a>');
    expect(town).toContain(
      '<span class="unshared" title="Not shared in this export">Ilsa Varn</span>',
    );
    expect(town).toContain("Nobody knows Gone Place.");
    expect(town).toContain('<a href="https://example.org">the web</a>');
    expect(town).toContain('<img src="images/quay.png" alt="quay" width="200">');
    expect(town).not.toContain("aliases");
    expect(files["salt-pier.html"]).toContain('<a href="tide-market.html">Tide Market</a>');
    expect(files["index.html"]).toContain('<a href="salt-pier.html">Salt Pier</a>');
  });

  it("refuses when nothing is chosen", async () => {
    await start();
    expect((await t.post("/api/export/site", { folder: "Nowhere" })).statusCode).toBe(400);
  });
});

describe("documents", () => {
  it("makes a Word document of the entries, with the mark explained", async () => {
    await start();
    const res = await t.post("/api/export/docx", { title: "The Harbor", folder: "03 Places" });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.rawPayload.subarray(0, 2).toString()).toBe("PK");
    const files = await unzip(res.rawPayload);
    const body = files["word/document.xml"]!.replace(/<[^>]+>/g, "");
    expect(body).toContain("Tide Market");
    // The mark is written in UTF-8; the zip reader here gives the bytes as Latin-1.
    expect(Buffer.from(body, "latin1").toString("utf8")).toContain("Ilsa Varn†");
    expect(body).toContain("marks the name of an entry that is not part of this document");
    expect(Object.keys(files).some((f) => f.startsWith("word/media/"))).toBe(true);
  });

  it("makes a PDF", async () => {
    await start();
    const res = await t.post("/api/export/pdf", { title: "The Harbor", folder: "03 Places" });
    expect(res.statusCode, res.body).toBe(200);
    expect(res.rawPayload.subarray(0, 5).toString()).toBe("%PDF-");
    const dir = mkdtempSync(join(tmpdir(), "pdf-"));
    writeFileSync(join(dir, "out.pdf"), res.rawPayload);
    expect(readFileSync(join(dir, "out.pdf")).length).toBeGreaterThan(5000);
  });
});
