/**
 * What a reader sees (stage 27c): the last saved version of everything, never anyone's unsaved
 * changes, whichever route they ask.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addMember, addPerson, type Client, makeTestApp, type TestApp } from "./helpers/app.js";

let t: TestApp;
let writer: Client;
let reader: Client;
let base: string;
const MIRA = "02 People/Mira.md";
const SECRET = "The unsaved plan nobody has seen yet";
const NEW = "02 People/Draftling.md";

beforeAll(async () => {
  t = await makeTestApp({ LOGIN_ATTEMPTS: "100" });
  await t.login();
  const first = (await t.server.projects.all())[0]!;
  base = `/api/p/${first.slug}`;
  writer = await addPerson(t, "Wren Writer", "writer@example.com");
  reader = await addPerson(t, "Reed Reader", "reader@example.com");
  await addMember(t, first.id, writer.id, "writer");
  await addMember(t, first.id, reader.id, "reader");
  // The writer changes Mira and makes a new entry; neither is saved as a version.
  const mira = (await writer.get(`${base}/entries?path=${encodeURIComponent(MIRA)}`)).json();
  const edit = await writer.put(`${base}/drafts`, {
    id: "draftmira001",
    kind: "edit",
    path: MIRA,
    text: `${mira.text}\n\n${SECRET}\n`,
    revision: 1,
    baseBlob: mira.blob,
  });
  expect(edit.statusCode, edit.body).toBe(200);
  const made = await writer.put(`${base}/drafts`, {
    id: "draftling001",
    kind: "create",
    path: NEW,
    text: "# Draftling\n\nLinks to [[Mira]].\n",
    revision: 1,
    baseBlob: "",
  });
  expect(made.statusCode, made.body).toBe(200);
});
afterAll(() => t.close());

describe("a reader gets the last saved version only", () => {
  it("a writer does see the unsaved text (so the test means something)", async () => {
    const res = await writer.get(`${base}/entries?path=${encodeURIComponent(MIRA)}`);
    expect(res.json().text).toContain(SECRET);
    expect(res.json().draft).not.toBeNull();
  });

  it("GET of an entry returns the saved text, no draft, no revision to build on", async () => {
    const res = await reader.get(`${base}/entries?path=${encodeURIComponent(MIRA)}`);
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.text).not.toContain(SECRET);
    expect(body.draft).toBeNull();
    expect(body.state).toBe("published");
    expect(body.rename).toBeNull();
    // An entry that exists only as someone's unsaved draft is not there.
    const nothing = await reader.get(`${base}/entries?path=${encodeURIComponent(NEW)}`);
    expect(nothing.statusCode).toBe(404);
  });

  it("the tree, graph, switcher and image finder hold nothing unsaved", async () => {
    const tree = (await reader.get(`${base}/tree`)).body;
    expect(tree).not.toContain("Draftling");
    expect(tree).not.toContain("unpublished");
    const graph = (await reader.get(`${base}/graph`)).body;
    expect(graph).not.toContain("Draftling");
    const switcher = (await reader.get(`${base}/switcher?q=Draftling`)).json();
    expect(switcher.results).toEqual([]);
    // For comparison: the writer's tree has it.
    expect((await writer.get(`${base}/tree`)).body).toContain("Draftling");
    expect((await writer.get(`${base}/switcher?q=Draftling`)).json().results).not.toEqual([]);
  });

  it("the status and the attention list say nothing is unsaved or kept", async () => {
    const status = (await reader.get(`${base}/status`)).json();
    expect(status.unpublished).toBe(0);
    expect(status.drafts).toBe(0);
    expect(status.inbox).toEqual({ branches: 0, operations: 0, quarantined: 0 });
    expect((await reader.get(`${base}/attention`)).json().versions).toEqual([]);
    expect((await writer.get(`${base}/status`)).json().drafts).toBeGreaterThan(0);
  });

  it("the library's item files and the exports show the saved library", async () => {
    const files = await reader.get(`${base}/library-files/folders`);
    expect(files.statusCode).toBe(200);
    const preview = await reader.post(`${base}/export/preview`, {
      title: "Book",
      paths: [MIRA, NEW],
    });
    expect(preview.json().unsaved).toEqual([]);
    expect(
      (await writer.post(`${base}/export/preview`, { title: "Book", paths: [MIRA] })).json()
        .unsaved,
    ).toEqual([MIRA]);
  });

  it("the writers' routes (drafts, unsaved changes, inbox, import) are closed to a reader", async () => {
    for (const [method, url] of [
      ["GET", `${base}/unpublished`],
      ["GET", `${base}/inbox`],
      ["PUT", `${base}/drafts`],
      ["POST", `${base}/import`],
      ["POST", `${base}/publish/plan`],
      ["GET", `${base}/comments`],
    ] as const) {
      const res = await t.app.inject({
        method,
        url,
        headers: { cookie: reader.cookie },
        ...(method === "GET" ? {} : { payload: {} }),
      });
      expect(res.statusCode, `${method} ${url}`).toBe(403);
      expect(res.json().error.code).toBe("role_too_low");
    }
  });

  it("the status stream never carries the unsaved count to a reader, and the writer is not affected", async () => {
    await t.app.listen({ port: 0, host: "127.0.0.1" });
    const port = (t.app.server.address() as { port: number }).port;
    const first = async (who: Client) => {
      const stop = new AbortController();
      const res = await fetch(`http://127.0.0.1:${port}${base}/status/events`, {
        headers: { cookie: who.cookie },
        signal: stop.signal,
      });
      const chunk = new TextDecoder().decode((await res.body!.getReader().read()).value);
      stop.abort();
      return JSON.parse(/data: (.*)\n/.exec(chunk)![1]!) as { drafts: number; unpublished: number };
    };
    expect((await first(reader)).drafts).toBe(0);
    expect((await first(writer)).drafts).toBeGreaterThan(0);
  });
});
