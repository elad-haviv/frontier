import { afterEach, describe, expect, it, vi } from "vitest";
import { HEARTBEAT_MS, Presence } from "./presence.ts";

interface Sent {
  url: string;
  method: string;
  body: unknown;
}

function setup(over: { online?: boolean; beacon?: boolean; project?: string | null } = {}) {
  const sent: Sent[] = [];
  const beacons: { url: string; body: Blob }[] = [];
  let online = over.online ?? true;
  let project: string | null = over.project === undefined ? "alpha" : over.project;
  const presence = new Presence({
    fetch: vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
      sent.push({
        url: String(url),
        method: init?.method ?? "GET",
        body:
          typeof init?.body === "string"
            ? JSON.parse(init.body)
            : init?.body instanceof Blob
              ? "blob"
              : init?.body,
      });
      return new Response("{}");
    }) as unknown as typeof fetch,
    project: () => project,
    online: () => online,
    beacon: over.beacon === false ? undefined : (url, body) => (beacons.push({ url, body }), true),
    client: "tab1",
  });
  return {
    presence,
    sent,
    beacons,
    goOffline: () => (online = false),
    open: (slug: string | null) => (project = slug),
  };
}

afterEach(() => vi.useRealTimers());

describe("announcing the entry that is open", () => {
  it("says which published entry is open, with this tab's name", () => {
    const { presence, sent } = setup();
    presence.set("01 Places/Harbor.md");
    expect(sent).toEqual([
      {
        url: "/api/p/alpha/presence",
        method: "PUT",
        body: { path: "01 Places/Harbor.md", client: "tab1" },
      },
    ]);
  });

  it("does not announce the same entry twice for a repeat of the same page", () => {
    const { presence, sent } = setup();
    presence.set("a.md");
    presence.set("a.md");
    expect(sent).toHaveLength(1);
  });

  it("announces the next entry directly, without sending 'none' in between", () => {
    const { presence, sent } = setup();
    presence.set("a.md");
    presence.set("b.md");
    expect(sent.map((s) => (s.body as { path: string }).path)).toEqual(["a.md", "b.md"]);
  });

  it("sends none when the page says there is nothing to announce, and only after one was", () => {
    const { presence, sent } = setup();
    presence.set(null);
    expect(sent).toHaveLength(0);
    presence.set("a.md");
    presence.set(null);
    expect(sent.map((s) => (s.body as { path: string | null }).path)).toEqual(["a.md", null]);
    presence.set(null);
    expect(sent).toHaveLength(2);
  });

  it("sends nothing while the server cannot be reached, or outside a project", () => {
    const off = setup({ online: false });
    off.presence.set("a.md");
    expect(off.sent).toHaveLength(0);
    const none = setup({ project: null });
    none.presence.set("a.md");
    expect(none.sent).toHaveLength(0);
  });

  it("takes the announcement out of the project it was made in when another opens", () => {
    const t = setup();
    t.presence.set("a.md");
    t.open("beta");
    t.presence.set("b.md");
    expect(t.sent.map((s) => [s.url, (s.body as { path: string | null }).path])).toEqual([
      ["/api/p/alpha/presence", "a.md"],
      ["/api/p/alpha/presence", null],
      ["/api/p/beta/presence", "b.md"],
    ]);
  });
});

describe("the heartbeat", () => {
  it("repeats the announcement in under the server's 60 seconds, while the entry stays open", () => {
    vi.useFakeTimers();
    const { presence, sent } = setup();
    expect(HEARTBEAT_MS).toBeLessThan(60_000);
    presence.set("a.md");
    vi.advanceTimersByTime(HEARTBEAT_MS * 2 + 10);
    expect(sent).toHaveLength(3);
    expect(sent.every((s) => (s.body as { path: string }).path === "a.md")).toBe(true);
  });

  it("stops when the entry is closed", () => {
    vi.useFakeTimers();
    const { presence, sent } = setup();
    presence.set("a.md");
    presence.set(null);
    const before = sent.length;
    vi.advanceTimersByTime(HEARTBEAT_MS * 3);
    expect(sent).toHaveLength(before);
  });
});

describe("a tab that is hidden or closing", () => {
  it("says it has left with a JSON Blob beacon naming the tab, and stops repeating", async () => {
    vi.useFakeTimers();
    const { presence, sent, beacons } = setup();
    presence.set("a.md");
    presence.hide();
    expect(beacons).toHaveLength(1);
    expect(beacons[0]!.url).toBe("/api/p/alpha/presence/leave");
    expect(beacons[0]!.body.type).toBe("application/json");
    expect(JSON.parse(await beacons[0]!.body.text())).toEqual({ client: "tab1" });
    const before = sent.length;
    vi.advanceTimersByTime(HEARTBEAT_MS * 3);
    expect(sent).toHaveLength(before);
  });

  it("announces again when it is shown", () => {
    const { presence, sent } = setup();
    presence.set("a.md");
    presence.hide();
    presence.show();
    expect(sent.filter((s) => s.method === "PUT")).toHaveLength(2);
  });

  it("says nothing when there was nothing to take away", () => {
    const { presence, sent, beacons } = setup();
    presence.hide();
    expect(beacons).toHaveLength(0);
    expect(sent).toHaveLength(0);
    presence.show();
    expect(sent).toHaveLength(0);
  });

  it("leaves with a plain request that outlives the page where there is no beacon", () => {
    const { presence, sent } = setup({ beacon: false });
    presence.set("a.md");
    presence.hide();
    expect(sent.at(-1)).toMatchObject({ method: "POST", url: "/api/p/alpha/presence/leave" });
  });
});
