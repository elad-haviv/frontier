import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PublishPlan, UnpublishedResponse } from "@frontier/schema";
import { type App, buildApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { applyLibraryMode } from "../src/sample.js";
import { EMAIL, seedAccount } from "./helpers/app.js";

let dir: string;
let built: App;
let cookie = "";

/** A server on a library of its own: no repository is named anywhere. */
async function start() {
  const env: NodeJS.ProcessEnv = {
    DATA_DIR: dir,
    PUBLIC_URL: "http://localhost:3000",
    SESSION_KEY: Buffer.alloc(32, 4).toString("base64"),
  };
  applyLibraryMode(env);
  const config = loadConfig(env);
  mkdirSync(join(dir, "state"), { recursive: true });
  built = await buildApp(config, {});
  await built.services.git.ensureClone();
  await built.services.sync();
  if ((await built.services.server.people.all()).length === 0) {
    await seedAccount(built.services, "a long password");
  }
  const res = await built.app.inject({
    method: "POST",
    url: "/api/login",
    payload: { email: EMAIL, password: "a long password" },
  });
  cookie = String(res.headers["set-cookie"]).split(";")[0]!;
  return config;
}
const get = (url: string) => built.app.inject({ method: "GET", url, headers: { cookie } });
const send = (method: "POST" | "PUT" | "DELETE", url: string, payload?: unknown) =>
  built.app.inject({ method, url, headers: { cookie }, ...(payload ? { payload } : {}) });

function form(
  url: string,
  fields: Record<string, string>,
  files: { name: string; content: Buffer }[],
) {
  const boundary = "----frontierimport";
  const parts: Buffer[] = [];
  for (const [k, v] of Object.entries(fields)) {
    parts.push(
      Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`),
    );
  }
  for (const f of files) {
    parts.push(
      Buffer.from(
        `--${boundary}\r\nContent-Disposition: form-data; name="files"; filename="${f.name}"\r\nContent-Type: application/octet-stream\r\n\r\n`,
      ),
      f.content,
      Buffer.from("\r\n"),
    );
  }
  parts.push(Buffer.from(`--${boundary}--\r\n`));
  return built.app.inject({
    method: "POST",
    url,
    headers: { cookie, "content-type": `multipart/form-data; boundary=${boundary}` },
    payload: Buffer.concat(parts),
  });
}

async function saveVersion(message: string) {
  const un = UnpublishedResponse.parse((await get("/api/unpublished")).json());
  const plan = PublishPlan.parse(
    (
      await send("POST", "/api/publish/plan", {
        draftIds: un.drafts.map((d) => d.id),
        renameIds: [],
      })
    ).json(),
  );
  // Frontier is the only writer, so nothing is ever waiting to be merged.
  expect(plan.merges).toEqual([]);
  expect(plan.conflicts).toEqual([]);
  const res = await send("POST", "/api/publish/confirm", {
    planId: plan.planId,
    confirmedMergeIds: [],
    message,
  });
  expect(res.statusCode, res.body).toBe(200);
}
const draft = (id: string, path: string, kind: string, text: string, revision = 0) =>
  send("PUT", "/api/drafts", { id, path, kind, text, revision });

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "frontier-own-"));
});
afterEach(async () => {
  await built?.app.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("a library of Frontier's own", () => {
  it("starts with no repository settings, with one welcome note, and keeps it over a restart", async () => {
    const config = await start();
    expect(config.library).toBe("own");
    expect(config.remoteUrl).toBe(join(dir, "library.git"));
    expect(config.githubApp).toBeNull();
    const status = (await get("/api/status")).json();
    expect(status).toMatchObject({ library: "own", backupOutside: false });
    expect((await get("/api/entries?path=Welcome.md")).json().text).toContain(
      "This library is empty",
    );

    await draft("firstnote001", "People/Mira.md", "create", "# Mira\n\nA fisher.\n");
    await saveVersion("Add Mira");
    await built.app.close();
    await start();
    expect((await get("/api/entries?path=People%2FMira.md")).json().text).toContain("A fisher.");
  });

  it("is the GitHub way when a repository is named, and the sample when asked", () => {
    const github: NodeJS.ProcessEnv = { DATA_DIR: dir, VAULT_REPO: "someone/vault" };
    applyLibraryMode(github);
    expect(github["VAULT_REMOTE_URL"]).toBeUndefined();
    expect(github["FRONTIER_LIBRARY"]).toBeUndefined();
    const sample: NodeJS.ProcessEnv = { DATA_DIR: dir, FRONTIER_SAMPLE_VAULT: "1" };
    applyLibraryMode(sample);
    expect(sample["FRONTIER_LIBRARY"]).toBe("sample");
  });

  it("backs the library up with the working files", async () => {
    await start();
    await draft("backupnote01", "Kept.md", "create", "# Kept\n");
    await saveVersion("Add a note");
    await built.services.backup.runNow();
    const packed = execFileSync("find", [join(dir, "backup"), "-path", "*library*", "-type", "f"], {
      encoding: "utf8",
    });
    expect(packed.split("\n").filter(Boolean).length).toBeGreaterThan(3);
  });
});

describe("versions", () => {
  it("lists an entry's versions across a rename, shows what each did, and restores one", async () => {
    await start();
    await draft("historynote1", "Vel Aran.md", "create", "# Vel Aran\n\nFirst telling.\n");
    await saveVersion("Write Vel Aran");
    await draft("historynote2", "Vel Aran.md", "edit", "# Vel Aran\n\nSecond telling.\n");
    await saveVersion("Retell Vel Aran");
    const rename = await send("POST", "/api/renames", {
      from: "Vel Aran.md",
      to: "Places/Vel Aran the White.md",
    });
    const plan = (
      await send("POST", "/api/publish/plan", { draftIds: [], renameIds: [rename.json().id] })
    ).json();
    await send("POST", "/api/publish/confirm", {
      planId: plan.planId,
      confirmedMergeIds: [],
      message: "Move it",
    });

    const path = "Places/Vel Aran the White.md";
    const versions = (await get(`/api/history?path=${encodeURIComponent(path)}`)).json().versions;
    expect(versions.map((v: { message: string }) => v.message)).toEqual([
      "Move it",
      "Retell Vel Aran",
      "Write Vel Aran",
    ]);
    // Each version names the file as it was called then.
    expect(versions[2].paths).toEqual(["Vel Aran.md"]);
    expect(versions[0].at).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    const second = (
      await get(
        `/api/history/version?path=${encodeURIComponent("Vel Aran.md")}&commit=${versions[1].commit}`,
      )
    ).json();
    expect(second).toEqual({
      text: "# Vel Aran\n\nSecond telling.\n",
      before: "# Vel Aran\n\nFirst telling.\n",
    });
    const first = (
      await get(
        `/api/history/version?path=${encodeURIComponent("Vel Aran.md")}&commit=${versions[2].commit}`,
      )
    ).json();
    expect(first.before).toBeNull();
    expect(
      (await get(`/api/history/version?path=Nope.md&commit=${versions[2].commit}`)).statusCode,
    ).toBe(404);

    // Restoring is an ordinary change: the old text in a draft, saved as a new version.
    await draft("restorenote1", path, "edit", first.text);
    await saveVersion("Bring back the first telling");
    const after = (await get(`/api/history?path=${encodeURIComponent(path)}`)).json().versions;
    expect(after).toHaveLength(4);
    expect((await get(`/api/entries?path=${encodeURIComponent(path)}`)).json().text).toContain(
      "First telling.",
    );

    const library = (await get("/api/history")).json().versions;
    expect(library[0]).toMatchObject({ message: "Bring back the first telling", paths: [path] });
    expect(library[library.length - 1].message).toBe("Start the library");
  });
});

describe("import", () => {
  const note = (text: string) => Buffer.from(text);

  it("brings in notes and images as unsaved changes, and refuses other files", async () => {
    await start();
    const png = await sharp({ create: { width: 8, height: 8, channels: 3, background: "#335577" } })
      .png()
      .toBuffer();
    const res = await form("/api/import", { folder: "Gazetteer/Cities", existing: "ask" }, [
      { name: "Vel Aran.md", content: note("# Vel Aran\r\n\r\nFrom Obsidian.\r\n") },
      { name: "C:\\notes\\Old Quay.md", content: note("# Old Quay\n") },
      { name: "harbour.png", content: png },
      { name: "broken.png", content: note("not an image") },
      { name: "sheet.xlsx", content: note("x") },
      { name: "bytes.md", content: Buffer.from([0xff, 0xfe, 0x00]) },
    ]);
    expect(res.statusCode, res.body).toBe(200);
    const body = res.json();
    expect(body.imported).toEqual([
      { name: "Vel Aran.md", path: "Gazetteer/Cities/Vel Aran.md", kind: "note" },
      { name: "Old Quay.md", path: "Gazetteer/Cities/Old Quay.md", kind: "note" },
      { name: "harbour.png", path: "99 Appendices/01 Images/harbour.png", kind: "image" },
    ]);
    expect(body.refused.map((r: { name: string }) => r.name)).toEqual([
      "broken.png",
      "sheet.xlsx",
      "bytes.md",
    ]);
    expect(body.clashes).toEqual([]);

    // Nothing is in the library until a version is saved; Windows line endings are kept.
    expect((await get("/api/history")).json().versions).toHaveLength(1);
    await saveVersion("Import two notes and an image");
    const raw = execFileSync("git", ["show", "main:Gazetteer/Cities/Vel Aran.md"], {
      cwd: join(dir, "library.git"),
    });
    expect(raw.toString()).toBe("# Vel Aran\r\n\r\nFrom Obsidian.\r\n");
  });

  it("asks before touching a note of the same name, then replaces it or keeps both", async () => {
    await start();
    await draft("existingnote", "Mira.md", "create", "# Mira\n\nWritten here.\n");
    await saveVersion("Add Mira");
    const incoming = [{ name: "Mira.md", content: note("# Mira\n\nFrom outside.\n") }];

    const asked = (await form("/api/import", { folder: "", existing: "ask" }, incoming)).json();
    expect(asked).toEqual({
      imported: [],
      clashes: [{ name: "Mira.md", path: "Mira.md" }],
      refused: [],
    });
    expect((await get("/api/unpublished")).json().drafts).toEqual([]);

    const both = (await form("/api/import", { folder: "", existing: "both" }, incoming)).json();
    expect(both.imported).toEqual([{ name: "Mira.md", path: "Mira 2.md", kind: "note" }]);

    const replaced = (
      await form("/api/import", { folder: "", existing: "replace" }, incoming)
    ).json();
    expect(replaced.imported).toEqual([{ name: "Mira.md", path: "Mira.md", kind: "note" }]);
    const un = UnpublishedResponse.parse((await get("/api/unpublished")).json());
    const edit = un.drafts.find((d) => d.path === "Mira.md")!;
    expect(edit).toMatchObject({
      kind: "edit",
      text: "# Mira\n\nFrom outside.\n",
      mainText: "# Mira\n\nWritten here.\n",
    });
    // A second replace while the first is unsaved is refused rather than stacked.
    const again = (await form("/api/import", { folder: "", existing: "replace" }, incoming)).json();
    expect(again.refused).toHaveLength(1);
  });

  it("takes a whole vault from a zip as one version, replacing and adding and never deleting", async () => {
    await start();
    await draft("staysnote001", "Stays.md", "create", "# Stays\n");
    await draft("changesnote1", "Changes.md", "create", "# Changes\n\nOld.\n");
    await saveVersion("Two notes");

    // A zip as GitHub makes them: one folder around everything, and a .git that must be left out.
    const work = mkdtempSync(join(tmpdir(), "frontier-zip-"));
    const vault = join(work, "avalymia-main");
    mkdirSync(join(vault, "01 Places"), { recursive: true });
    mkdirSync(join(vault, ".git"), { recursive: true });
    mkdirSync(join(vault, ".obsidian"), { recursive: true });
    writeFileSync(join(vault, "Changes.md"), "# Changes\n\nNew.\n");
    writeFileSync(
      join(vault, "01 Places", "Harbor.md"),
      "# Harbor\r\n\r\nLinked from [[Changes]].\r\n",
    );
    writeFileSync(join(vault, ".git", "config"), "secret");
    writeFileSync(join(vault, ".obsidian", "app.json"), "{}");
    execFileSync("zip", ["-qr", join(work, "vault.zip"), "avalymia-main"], { cwd: work });
    const zip = (await import("node:fs")).readFileSync(join(work, "vault.zip"));
    rmSync(work, { recursive: true, force: true });

    const res = await form("/api/import/vault", { message: "Bring Avalymia in" }, [
      { name: "vault.zip", content: zip },
    ]);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json().files).toBe(3);
    const files = execFileSync("git", ["ls-tree", "-r", "--name-only", "main"], {
      cwd: join(dir, "library.git"),
      encoding: "utf8",
    })
      .trim()
      .split("\n");
    expect(files.sort()).toEqual(
      [".obsidian/app.json", "01 Places/Harbor.md", "Changes.md", "Stays.md", "Welcome.md"].sort(),
    );
    expect((await get("/api/entries?path=Changes.md")).json().text).toContain("New.");
    // Stage 27d: the import is by the person who made it, as any other version.
    expect((await get("/api/history")).json().versions[0]).toMatchObject({
      message: "Bring Avalymia in",
      by: { id: expect.any(String), name: expect.any(String) },
    });
    // The replaced text is still in the history.
    const versions = (await get("/api/history?path=Changes.md")).json().versions;
    expect(versions).toHaveLength(2);

    // The same zip again changes nothing and says so.
    const same = await form("/api/import/vault", { message: "Again" }, [
      { name: "vault.zip", content: zip },
    ]);
    expect(same.statusCode).toBe(400);
    expect(
      (await form("/api/import/vault", {}, [{ name: "x.zip", content: note("not a zip") }]))
        .statusCode,
    ).toBe(400);
  });
});

describe("export", () => {
  it("gives the library as a zip of its files at the last saved version", async () => {
    await start();
    await draft("exportnote01", "Folder/Kept.md", "create", "# Kept\n");
    await saveVersion("Add a note");
    await draft("exportnote02", "Unsaved.md", "create", "# Not in the export\n");
    const res = await get("/api/export/library.zip");
    expect(res.statusCode).toBe(200);
    expect(res.headers["content-type"]).toBe("application/zip");
    expect(res.headers["content-disposition"]).toMatch(/library-\d{4}-\d{2}-\d{2}\.zip/);
    const out = mkdtempSync(join(tmpdir(), "frontier-export-"));
    writeFileSync(join(out, "library.zip"), res.rawPayload);
    const listing = execFileSync("unzip", ["-Z1", join(out, "library.zip")], { encoding: "utf8" });
    rmSync(out, { recursive: true, force: true });
    expect(
      listing
        .split("\n")
        .filter((l) => l && !l.endsWith("/"))
        .sort(),
    ).toEqual(["Folder/Kept.md", "Welcome.md"]);
  });
});
