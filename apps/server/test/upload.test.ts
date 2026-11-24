import { execFileSync } from "node:child_process";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import sharp from "sharp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { EntryResponse, PublishPlan, UnpublishedResponse } from "@frontier/schema";
import {
  FETCH_LIMITS,
  ImageFetcher,
  type ImageFetcherOptions,
  ImageFetchError,
  mayFetchFrom,
  nameFromUrl,
} from "../src/images/fromUrl.js";
import { cleanImageName } from "../src/images/save.js";
import { makeTestApp, type TestApp } from "./helpers/app.js";

let t: TestApp;
let png: Buffer;

beforeAll(async () => {
  t = await makeTestApp({ UPLOAD_FOLDER: "99 Appendices/Images" });
  await t.login();
  png = await sharp({ create: { width: 800, height: 400, channels: 3, background: "#225588" } })
    .png()
    .toBuffer();
});
afterAll(() => t.close());

/** Sends one file as a browser form would. */
function upload(filename: string, content: Buffer, type = "image/png") {
  const boundary = "----frontiertest";
  const body = Buffer.concat([
    Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${type}\r\n\r\n`,
    ),
    content,
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
  return t.app.inject({
    method: "POST",
    url: "/api/images",
    headers: { cookie: t.cookie, "content-type": `multipart/form-data; boundary=${boundary}` },
    payload: body,
  });
}

describe("image upload", () => {
  it("keeps an uploaded image as a draft and returns the text to embed it", async () => {
    const res = await upload("Sea Chart.png", png);
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toEqual({
      path: "99 Appendices/Images/Sea Chart.png",
      embed: "![[Sea Chart.png]]",
    });
    expect(t.repo.remoteFiles()).not.toContain("99 Appendices/Images/Sea Chart.png");
    const draft = t.services.drafts.byPath("99 Appendices/Images/Sea Chart.png")!;
    expect(draft).toMatchObject({ kind: "create", binary: true });
    expect((await t.services.drafts.bytes(draft.id)).equals(png)).toBe(true);
  });

  it("serves the image before it is published, at full size and scaled", async () => {
    const full = await t.get("/api/images?path=99%20Appendices%2FImages%2FSea%20Chart.png");
    expect(full.statusCode).toBe(200);
    expect(full.rawPayload.equals(png)).toBe(true);
    const small = await t.get("/api/images?path=99%20Appendices%2FImages%2FSea%20Chart.png&w=320");
    expect((await sharp(small.rawPayload).metadata()).width).toBe(320);
  });

  it("resolves an embed of the unpublished image in a draft entry", async () => {
    await t.put("/api/drafts", {
      id: "uploadentry1",
      path: "02 People/Mira.md",
      kind: "edit",
      text: "# Mira\n\n![[Sea Chart.png]]\n",
      revision: 0,
    });
    const entry = EntryResponse.parse(
      (await t.get("/api/entries?path=02%20People%2FMira.md")).json(),
    );
    expect(entry.links[0]).toMatchObject({
      kind: "image",
      target: "99 Appendices/Images/Sea Chart.png",
    });
  });

  it("finds the image an embed points at, for the editor to show it", async () => {
    const find = async (name: string) =>
      (
        await t.get(
          `/api/images/find?name=${encodeURIComponent(name)}&from=${encodeURIComponent("02 People/Mira.md")}`,
        )
      ).json();
    expect(await find("Sea Chart.png")).toEqual({ path: "99 Appendices/Images/Sea Chart.png" });
    expect(await find("Nowhere.png")).toEqual({ path: null });
    // A note is not an image, even when the name matches.
    expect(await find("Mira")).toEqual({ path: null });
    expect((await t.get("/api/images/find?name=a%5Bb.png&from=x.md")).statusCode).toBe(400);
    expect(
      (await t.app.inject({ method: "GET", url: "/api/images/find?name=a.png&from=x.md" }))
        .statusCode,
    ).toBe(401);
  });

  it("lists the image among the unpublished changes without treating it as text", async () => {
    const u = UnpublishedResponse.parse((await t.get("/api/unpublished")).json());
    const image = u.drafts.find((d) => d.path.endsWith("Sea Chart.png"))!;
    expect(image).toMatchObject({ kind: "create", binary: true, text: "", mainText: null });
  });

  it("gives a second image with the same name a number, ignoring letter case", async () => {
    expect((await upload("sea chart.PNG", png)).json().path).toBe(
      "99 Appendices/Images/sea chart 2.PNG",
    );
    // "lamp.png" exists in the vault already, in another folder.
    expect((await upload("LAMP.png", png)).json().embed).toBe("![[LAMP 2.png]]");
  });

  it("refuses what is not an image", async () => {
    const message = async (name: string, content: Buffer) =>
      (await upload(name, content)).json().error?.message as string;
    expect(await message("notes.png", Buffer.from("just text"))).toMatch(/not an image/);
    expect(await message("picture", png)).toMatch(/image extension/);
    expect(await message("script.md", png)).toMatch(/image extension/);
    const none = await t.app.inject({
      method: "POST",
      url: "/api/images",
      headers: { cookie: t.cookie, "content-type": "multipart/form-data; boundary=x" },
      payload: "--x--\r\n",
    });
    expect(none.statusCode).toBe(400);
    expect((await t.app.inject({ method: "POST", url: "/api/images" })).statusCode).toBe(401);
  });

  it("strips a folder from the file name, so an upload cannot land elsewhere", async () => {
    const res = await upload("..\\\\..\\\\evil/../Escape.png", png);
    expect(res.json().path).toBe("99 Appendices/Images/Escape.png");
  });

  it("refuses to edit an uploaded image as text", async () => {
    const res = await t.put("/api/drafts", {
      id: "uploadtext01",
      path: "99 Appendices/Images/Sea Chart.png",
      kind: "edit",
      text: "x",
      revision: 0,
    });
    expect(res.statusCode).toBe(400);
  });

  it("publishes the image with the entry that uses it, byte for byte, in one commit", async () => {
    const ids = t.services.drafts
      .list()
      .filter((d) => d.path.endsWith("Sea Chart.png") || d.path === "02 People/Mira.md")
      .map((d) => d.id);
    const plan = PublishPlan.parse(
      (await t.post("/api/publish/plan", { draftIds: ids, renameIds: [] })).json(),
    );
    expect(plan.ready.sort()).toEqual([...ids].sort());
    const res = await t.post("/api/publish/confirm", {
      planId: plan.planId,
      confirmedMergeIds: [],
      message: "Add sea chart",
    });
    expect(res.statusCode, res.body).toBe(200);
    const stored = execFileSync(
      "git",
      ["show", "refs/heads/main:99 Appendices/Images/Sea Chart.png"],
      { cwd: t.repo.remote },
    );
    expect(stored.equals(png)).toBe(true);
    expect(t.repo.remoteFile("02 People/Mira.md")).toContain("![[Sea Chart.png]]");
    expect(t.services.drafts.byPath("99 Appendices/Images/Sea Chart.png")).toBeUndefined();
    // Now it is served from the vault.
    expect(
      (await t.get("/api/images?path=99%20Appendices%2FImages%2FSea%20Chart.png")).statusCode,
    ).toBe(200);
  });

  it("holds an image back when a file took its name on main meanwhile, and drops an identical one", async () => {
    const other = await sharp({
      create: { width: 10, height: 10, channels: 3, background: "#ff0000" },
    })
      .png()
      .toBuffer();
    await upload("Clash.png", png);
    await upload("Same.png", png);
    const { writeFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    writeFileSync(join(t.repo.root, "outside", "99 Appendices", "Images", "Clash.png"), other);
    writeFileSync(join(t.repo.root, "outside", "99 Appendices", "Images", "Same.png"), png);
    t.repo.pushFromOutside({ "x-marker.md": "# x\n" });
    const clash = t.services.drafts.byPath("99 Appendices/Images/Clash.png")!;
    const plan = PublishPlan.parse(
      (await t.post("/api/publish/plan", { draftIds: [clash.id], renameIds: [] })).json(),
    );
    expect(plan.conflicts).toHaveLength(1);
    expect(plan.conflicts[0]).toMatchObject({ draftId: clash.id, reason: "created_on_main" });
    // The identical upload was cleared by the fetch.
    expect(t.services.drafts.byPath("99 Appendices/Images/Same.png")).toBeUndefined();
  });

  it("moves an unpublished image along when its folder is renamed", async () => {
    const local = await makeTestApp({ UPLOAD_FOLDER: "01 Places/Harbor" });
    try {
      await local.login();
      const boundary = "----frontiertest";
      await local.app.inject({
        method: "POST",
        url: "/api/images",
        headers: {
          cookie: local.cookie,
          "content-type": `multipart/form-data; boundary=${boundary}`,
        },
        payload: Buffer.concat([
          Buffer.from(
            `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="quay.png"\r\nContent-Type: image/png\r\n\r\n`,
          ),
          png,
          Buffer.from(`\r\n--${boundary}--\r\n`),
        ]),
      });
      const rename = (
        await local.post("/api/renames", { from: "01 Places/Harbor", to: "01 Places/Port" })
      ).json();
      const image = local.services.drafts.byPath("01 Places/Harbor/quay.png")!;
      const plan = (
        await local.post("/api/publish/plan", { draftIds: [image.id], renameIds: [rename.id] })
      ).json();
      const res = await local.post("/api/publish/confirm", {
        planId: plan.planId,
        confirmedMergeIds: [],
        message: "Move",
      });
      expect(res.statusCode, res.body).toBe(200);
      expect(local.repo.remoteFiles()).toContain("01 Places/Port/quay.png");
      expect(local.repo.remoteFiles()).not.toContain("01 Places/Harbor/quay.png");
      expect(local.services.drafts.list()).toEqual([]);
    } finally {
      await local.close();
    }
  });
});

describe("the gallery", () => {
  it("lists images uploaded but not yet published, marked", async () => {
    await upload("Unpublished Map.png", png);
    const { images } = (await t.get("/api/gallery")).json() as {
      images: { path: string; unpublished?: boolean }[];
    };
    expect(images.find((i) => i.path.endsWith("Unpublished Map.png"))).toMatchObject({
      path: "99 Appendices/Images/Unpublished Map.png",
      icon: false,
      usedBy: [],
      unpublished: true,
    });
    // A published image carries no mark.
    expect(images.find((i) => i.path.endsWith("lamp.png"))).not.toHaveProperty("unpublished");
  });
});

/**
 * A web server on this machine's loopback address, standing in for the web. Every case of the
 * fetch's safeguards is tried against it.
 */
let site: Server;
let base: string;
let port: number;
/** The headers of the last request the test site received. */
let seen: Record<string, string | string[] | undefined> = {};
const formats: Record<string, Buffer> = {};
const SVG = Buffer.from(
  '<svg xmlns="http://www.w3.org/2000/svg" width="4" height="4"><rect width="4" height="4"/></svg>',
);

beforeAll(async () => {
  const picture = sharp({ create: { width: 8, height: 8, channels: 3, background: "#336699" } });
  for (const f of ["jpeg", "png", "webp", "gif", "avif"] as const) {
    formats[f] = await picture.clone()[f]().toBuffer();
  }
  site = createServer((req, res) => {
    seen = req.headers;
    const path = new URL(req.url!, "http://x").pathname;
    const hop = /^\/hop\/(\d+)$/.exec(path);
    if (hop) {
      const left = Number(hop[1]);
      res.writeHead(302, { location: left > 1 ? `/hop/${left - 1}` : "/lamp.png" });
      return res.end();
    }
    const format = /^\/(?:.*\/)?[^/]*\.(jpeg|png|webp|gif|avif)$/.exec(path)?.[1];
    if (format) {
      res.writeHead(200, { "content-type": `image/${format}` });
      return res.end(formats[format]);
    }
    switch (path) {
      case "/":
        res.writeHead(200, { "content-type": "image/png" });
        return res.end(formats.png);
      case "/drawing.svg":
        res.writeHead(200, { "content-type": "image/svg+xml" });
        return res.end(SVG);
      case "/text":
        res.writeHead(200, { "content-type": "image/png" });
        return res.end("just text");
      case "/missing":
        res.writeHead(404);
        return res.end();
      case "/to-private":
        res.writeHead(302, { location: "http://10.0.0.1/lamp.png" });
        return res.end();
      case "/to-file":
        res.writeHead(301, { location: "file:///etc/passwd" });
        return res.end();
      case "/nowhere":
        res.writeHead(302);
        return res.end();
      case "/huge-header":
        // Says it is larger than the limit, then sends nothing: it must be refused at once.
        res.writeHead(200, { "content-length": String(26 * 1024 * 1024) });
        res.flushHeaders();
        return;
      case "/huge-body": {
        // No length given; the body goes on past the limit.
        res.writeHead(200, { "content-type": "image/png" });
        const chunk = Buffer.alloc(1024 * 1024);
        let sent = 0;
        const more = () => {
          while (sent < 27 && res.write(chunk)) sent++;
          if (sent < 27) res.once("drain", more);
          else res.end();
        };
        res.on("error", () => undefined);
        return more();
      }
      case "/slow":
        // Answers nothing at all.
        return;
      case "/slow-body":
        res.writeHead(200, { "content-type": "image/png" });
        res.write(formats.png!.subarray(0, 10));
        return;
      default:
        res.writeHead(404);
        return res.end();
    }
  });
  await new Promise<void>((done) => site.listen(0, "127.0.0.1", done));
  port = (site.address() as AddressInfo).port;
  base = `http://127.0.0.1:${port}`;
});
afterAll(() => {
  site.closeAllConnections();
  site.close();
});

describe("which addresses an image may come from", () => {
  it("allows ordinary public unicast only, IPv4-mapped addresses as their IPv4", () => {
    for (const ok of ["93.184.216.34", "8.8.8.8", "2606:4700:4700::1111", "::ffff:8.8.8.8"]) {
      expect(mayFetchFrom(ok), ok).toBe(true);
    }
    for (const refused of [
      "127.0.0.1", // loopback
      "::1",
      "::ffff:127.0.0.1", // loopback, mapped
      "::ffff:7f00:1",
      "10.1.2.3", // private
      "172.16.0.1",
      "192.168.1.1",
      "::ffff:192.168.1.1",
      "100.64.0.1", // carrier-grade NAT
      "169.254.169.254", // link-local, where clouds keep their metadata
      "fe80::1",
      "fc00::1", // unique local
      "0.0.0.0",
      "::",
      "255.255.255.255",
      "224.0.0.1", // multicast
      "ff02::1",
      "192.0.2.1", // reserved for documentation
      "2001:db8::1",
      "64:ff9b::a00:1", // NAT64, which reaches IPv4 inside
      "2002:a00:1::", // 6to4
      "2001::1", // Teredo
      "not an address",
    ]) {
      expect(mayFetchFrom(refused), refused).toBe(false);
    }
    expect(mayFetchFrom("127.0.0.1", true)).toBe(true);
    expect(mayFetchFrom("::ffff:127.0.0.1", true)).toBe(true);
    expect(mayFetchFrom("10.1.2.3", true)).toBe(false);
  });

  it("names an image after the address's last part, cleaned, cut and with its kind", () => {
    const name = (address: string, ext = ".png") =>
      nameFromUrl(new URL(address), ext, cleanImageName);
    expect(name("https://example.org/maps/Old%20Lamp.jpeg?size=large", ".jpg")).toBe(
      "Old Lamp.jpg",
    );
    expect(name("https://example.org/")).toBe("image.png");
    expect(name("https://example.org/a%5Bb%5D%3A%23.png")).toBe("ab.png");
    expect(name("https://example.org/%E0%A4%A.png")).toBe("%E0%A4%A.png");
    expect(name(`https://example.org/${"x".repeat(120)}.gif`, ".gif")).toBe(
      `${"x".repeat(80)}.gif`,
    );
    expect(name("https://example.org/%5B%5D", ".webp")).toBe("image.webp");
  });
});

describe("fetching an image from a web address", () => {
  const fetcher = (options: Partial<ImageFetcherOptions> = {}) =>
    new ImageFetcher({ publicUrl: "http://192.0.2.10", allowLoopback: true, ...options });
  const refusal = (promise: Promise<unknown>) =>
    promise.then(
      () => "fetched",
      (err: unknown) => (err instanceof ImageFetchError ? err.reason : `other: ${err}`),
    );

  it("keeps the limits of the design", () => {
    expect(FETCH_LIMITS).toEqual({
      ms: 15_000,
      dnsMs: 3_000,
      bytes: 25 * 1024 * 1024,
      redirects: 3,
    });
  });

  it("takes JPEG, PNG, WebP, GIF and AVIF, each by what it is, asking for no compression", async () => {
    const f = fetcher();
    for (const [format, ext] of [
      ["jpeg", ".jpg"],
      ["png", ".png"],
      ["webp", ".webp"],
      ["gif", ".gif"],
      ["avif", ".avif"],
    ] as const) {
      const got = await f.fetch(`${base}/picture.${format}`);
      expect(got.extension).toBe(ext);
      expect(got.bytes.equals(formats[format]!)).toBe(true);
    }
    expect(seen["accept-encoding"]).toBe("identity");
  });

  it("refuses SVG, and what is not an image", async () => {
    expect(await refusal(fetcher().fetch(`${base}/drawing.svg`))).toBe("a svg file");
    expect(await refusal(fetcher().fetch(`${base}/text`))).toBe("not an image");
    expect(await refusal(fetcher().fetch(`${base}/missing`))).toBe("status 404");
  });

  it("refuses loopback unless the tests allow it", async () => {
    const closed = fetcher({ allowLoopback: false });
    expect(await refusal(closed.fetch(`${base}/lamp.png`))).toBe(`port ${port}`);
    expect(await refusal(closed.fetch("http://127.0.0.1/lamp.png"))).toBe(
      "127.0.0.1 is not a public address",
    );
    expect(await refusal(closed.fetch("http://[::1]/lamp.png"))).toBe(
      "::1 is not a public address",
    );
    expect(await refusal(closed.fetch("http://[::ffff:127.0.0.1]/lamp.png"))).toBe(
      "127.0.0.1 is not a public address",
    );
  });

  it("refuses private, carrier-grade NAT, link-local and IPv4-mapped private addresses", async () => {
    const f = fetcher();
    expect(await refusal(f.fetch("http://10.0.0.1/a.png"))).toBe(
      "10.0.0.1 is not a public address",
    );
    expect(await refusal(f.fetch("http://100.64.0.1/a.png"))).toBe(
      "100.64.0.1 is not a public address",
    );
    expect(await refusal(f.fetch("http://169.254.169.254/latest"))).toBe(
      "169.254.169.254 is not a public address",
    );
    expect(await refusal(f.fetch("http://[::ffff:10.0.0.1]/a.png"))).toBe(
      "10.0.0.1 is not a public address",
    );
  });

  it("checks every address a name resolves to, and connects to the one checked", async () => {
    const names: Record<string, string[]> = {
      "pinned.example": ["127.0.0.1"],
      "mixed.example": ["127.0.0.1", "10.0.0.7"],
      "empty.example": [],
      "public.example": ["93.184.216.34"],
    };
    const f = fetcher({ resolve: async (host) => names[host] ?? [] });
    // The name resolves nowhere else, so the image can only come through the pinned address.
    const got = await f.fetch(`http://pinned.example:${port}/lamp.png`);
    expect(got.extension).toBe(".png");
    expect(seen.host).toBe(`pinned.example:${port}`);
    expect(await refusal(f.fetch(`http://mixed.example:${port}/lamp.png`))).toBe(
      "10.0.0.7 is not a public address",
    );
    expect(await refusal(f.fetch(`http://empty.example/lamp.png`))).toBe("the host has no address");
    expect(await refusal(f.fetch(`http://public.example:8080/lamp.png`))).toBe("port 8080");
  });

  it("refuses the server's own addresses", async () => {
    const own = fetcher({ publicUrl: `http://127.0.0.1:3000` });
    expect(await refusal(own.fetch(`${base}/lamp.png`))).toBe("127.0.0.1 is this server's own");
    const byName = fetcher({
      publicUrl: "https://frontier.example",
      resolve: async (host) => (host === "frontier.example" ? ["::ffff:127.0.0.1"] : []),
    });
    expect(await refusal(byName.fetch(`${base}/lamp.png`))).toBe("127.0.0.1 is this server's own");
    // An own address that cannot be found leaves nothing to refuse.
    const unknown = fetcher({
      publicUrl: "https://frontier.example",
      resolve: () => Promise.reject(new Error("no DNS")),
    });
    expect((await unknown.fetch(`${base}/lamp.png`)).extension).toBe(".png");
  });

  it("allows only ports 80 and 443 off loopback, and only http and https", async () => {
    const f = fetcher({ allowLoopback: false });
    expect(await refusal(f.fetch("http://93.184.216.34:8080/a.png"))).toBe("port 8080");
    expect(await refusal(f.fetch("https://93.184.216.34:22/a.png"))).toBe("port 22");
    expect(await refusal(f.fetch("ftp://93.184.216.34/a.png"))).toBe("not http or https");
  });

  it("follows at most three redirects, checking each", async () => {
    const f = fetcher();
    expect((await f.fetch(`${base}/hop/3`)).extension).toBe(".png");
    expect(await refusal(f.fetch(`${base}/hop/4`))).toBe("too many redirects");
    expect(await refusal(f.fetch(`${base}/to-private`))).toBe("10.0.0.1 is not a public address");
    expect(await refusal(f.fetch(`${base}/to-file`))).toBe("not http or https");
    expect(await refusal(f.fetch(`${base}/nowhere`))).toBe("a redirect without a place");
  });

  it("refuses a body said to be over 25 MB at once, and stops one that runs over", async () => {
    const started = Date.now();
    expect(await refusal(fetcher().fetch(`${base}/huge-header`))).toBe(`${26 * 1024 * 1024} bytes`);
    expect(Date.now() - started).toBeLessThan(2000);
    expect(await refusal(fetcher().fetch(`${base}/huge-body`))).toBe(
      `over ${25 * 1024 * 1024} bytes`,
    );
    const small = fetcher({ limits: { bytes: 10 } });
    expect(await refusal(small.fetch(`${base}/lamp.png`))).toBe("over 10 bytes");
  });

  it("gives up when the whole fetch takes too long", async () => {
    const quick = fetcher({ limits: { ms: 300 } });
    expect(await refusal(quick.fetch(`${base}/slow`))).toBe("timed out");
    expect(await refusal(quick.fetch(`${base}/slow-body`))).toBe("timed out");
    const nobody = fetcher({ allowLoopback: false });
    expect(await refusal(nobody.fetch("http://192.0.2.1/a.png"))).toBe(
      "192.0.2.1 is not a public address",
    );
  });

  it("says when nothing answers", async () => {
    const closed = createServer();
    await new Promise<void>((done) => closed.listen(0, "127.0.0.1", done));
    const gone = (closed.address() as AddressInfo).port;
    await new Promise((done) => closed.close(done));
    expect(await refusal(fetcher().fetch(`http://127.0.0.1:${gone}/a.png`))).toMatch(
      /^could not connect/,
    );
  });
});

describe("POST /api/images/from-url", () => {
  let web: TestApp;
  beforeAll(async () => {
    // The image server runs on loopback; a PUBLIC_URL of localhost would make it "this server"
    // wherever the resolver maps localhost to 127.0.0.1, as it does on the CI machines.
    web = await makeTestApp({ IMAGE_FETCH_ALLOW_LOOPBACK: "1", PUBLIC_URL: "http://192.0.2.10" });
    await web.login();
  });
  afterAll(() => web.close());
  /** Each test comes from an address of its own, so the rate limit counts it alone. */
  const from = (url: string, client: string) =>
    web.post("/api/images/from-url", { url }, { "x-forwarded-for": client });

  it("keeps the image as an unpublished upload and returns the text to embed it", async () => {
    const res = await from(`${base}/maps/Old%20Lamp.jpeg?key=secret`, "192.0.2.1");
    expect(res.statusCode, res.body).toBe(200);
    expect(res.json()).toEqual({
      path: "99 Appendices/01 Images/Old Lamp.jpg",
      embed: "![[Old Lamp.jpg]]",
    });
    const draft = web.services.drafts.byPath("99 Appendices/01 Images/Old Lamp.jpg")!;
    expect(draft).toMatchObject({ kind: "create", binary: true });
    expect((await web.services.drafts.bytes(draft.id)).equals(formats.jpeg!)).toBe(true);
    // A name already in the library gets a number.
    expect((await from(`${base}/lamp.png`, "192.0.2.1")).json().embed).toBe("![[lamp 2.png]]");
  });

  it("answers every failure with one plain message, and a malformed address as invalid", async () => {
    for (const url of [
      `${base}/drawing.svg`,
      `${base}/to-private`,
      "http://10.0.0.1/a.png",
      "http://93.184.216.34:8080/a.png",
    ]) {
      const res = await from(url, "192.0.2.2");
      expect(res.statusCode).toBe(422);
      expect(res.json()).toEqual({
        error: {
          code: "image_fetch_failed",
          message: "Frontier could not get an image from that address.",
        },
      });
    }
    const malformed = await from("not an address", "192.0.2.2");
    expect(malformed.statusCode).toBe(400);
    expect(malformed.json().error.code).toBe("invalid");
    expect((await from("file:///etc/passwd", "192.0.2.2")).json().error.code).toBe("invalid");
    const long = await from(`https://example.org/${"a".repeat(2048)}`, "192.0.2.2");
    expect(long.json().error.code).toBe("invalid");
    expect((await from("http://no-such-host.invalid/a.png", "192.0.2.2")).statusCode).toBe(422);
    expect(
      (
        await web.app.inject({
          method: "POST",
          url: "/api/images/from-url",
          payload: { url: `${base}/lamp.png` },
        })
      ).statusCode,
    ).toBe(401);
  });

  it("takes at most ten a minute", async () => {
    const codes: number[] = [];
    for (let i = 0; i < 10; i++) {
      codes.push((await from(`${base}/missing`, "192.0.2.3")).statusCode);
    }
    expect(codes).toEqual(Array(10).fill(422));
    const last = await from(`${base}/lamp.png`, "192.0.2.3");
    expect(last.statusCode).toBe(429);
    expect(last.json().error).toEqual({
      code: "rate_limited",
      message: "Too many images from web addresses at once. Wait a minute and try again.",
    });
  });
});
