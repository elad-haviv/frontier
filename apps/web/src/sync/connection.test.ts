import { describe, expect, it, vi } from "vitest";
import { Connection } from "./connection.ts";

/** An EventSource the test drives. */
class FakeSource {
  static made: FakeSource[] = [];
  readyState = 0;
  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  private listeners = new Map<string, (e: { data: string }) => void>();
  constructor(readonly url: string) {
    FakeSource.made.push(this);
  }
  addEventListener(type: string, l: (e: { data: string }) => void) {
    this.listeners.set(type, l);
  }
  close() {
    this.readyState = 2;
  }
  open() {
    this.readyState = 1;
    this.onopen?.();
  }
  send(type: string, data: unknown) {
    this.listeners.get(type)?.({ data: JSON.stringify(data) });
  }
  fail(closed: boolean) {
    this.readyState = closed ? 2 : 0;
    this.onerror?.();
  }
}

const answer = (status: number, body: unknown = {}) =>
  Promise.resolve(new Response(JSON.stringify(body), { status }));

let slug: string | null = "avalymia";

function make(fetch: typeof globalThis.fetch) {
  slug = "avalymia";
  FakeSource.made = [];
  const events = new EventTarget();
  const c = new Connection({
    fetch,
    EventSource: FakeSource as unknown as typeof EventSource,
    events: events as unknown as Window,
    maxDelayMs: 10,
    project: () => slug,
  });
  return { c, events };
}

describe("the connection service", () => {
  it("takes the status from the stream and says online", () => {
    const { c } = make(vi.fn());
    c.start();
    const [source] = FakeSource.made;
    expect(source!.url).toBe("/api/p/avalymia/status/events");
    source!.send("status", { unpublished: 3 });
    expect(c.state).toBe("online");
    expect(c.snapshot).toEqual({ unpublished: 3 });
    c.stop();
  });

  it("asks the project's status once when the stream fails: a 401 means signed out", async () => {
    const fetch = vi.fn(() => answer(401, { error: { code: "unauthenticated" } }));
    const { c } = make(fetch as unknown as typeof globalThis.fetch);
    c.start();
    FakeSource.made[0]!.fail(true);
    // Two failures at once make one probe.
    c.unauthorised();
    await c.probe();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0]).toEqual(["/api/p/avalymia/status", { credentials: "same-origin" }]);
    expect(c.state).toBe("signed-out");
    // While signed out the stream is not opened again by itself.
    await new Promise((r) => setTimeout(r, 30));
    expect(FakeSource.made).toHaveLength(1);
    c.stop();
  });

  it("says the person's access may have changed when the stream ends and the server still answers (27c)", async () => {
    // The server closes a person's streams when their role changes or they are taken out.
    const fetch = vi.fn(() => answer(200, { unpublished: 0 }));
    const { c } = make(fetch as unknown as typeof globalThis.fetch);
    const heard = vi.fn();
    const stop = c.onAccessMayHaveChanged(heard);
    c.start();
    FakeSource.made[0]!.open();
    expect(heard).not.toHaveBeenCalled();
    FakeSource.made[0]!.fail(false);
    await vi.waitFor(() => expect(heard).toHaveBeenCalledTimes(1));
    // A request refused for want of a role says it directly; a listener taken off hears nothing.
    c.accessMayHaveChanged();
    expect(heard).toHaveBeenCalledTimes(2);
    stop();
    c.accessMayHaveChanged();
    expect(heard).toHaveBeenCalledTimes(2);
    c.stop();
  });

  it("does not say it when the stream ended because the server cannot be reached (27c)", async () => {
    const fetch = vi.fn(() => Promise.reject(new TypeError("down")));
    const { c } = make(fetch as unknown as typeof globalThis.fetch);
    const heard = vi.fn();
    c.onAccessMayHaveChanged(heard);
    c.start();
    FakeSource.made[0]!.fail(true);
    await c.probe();
    await new Promise((r) => setTimeout(r, 20));
    expect(c.state).toBe("offline");
    expect(heard).not.toHaveBeenCalled();
    c.stop();
  });

  it("says access may have changed when a stream opens again after one that ended, but not for the first", async () => {
    // A role changed while no stream was open: the server could not cut it, so nothing said so.
    const { c } = make(vi.fn(() => answer(200, { unpublished: 0 })) as never);
    const heard = vi.fn();
    c.onAccessMayHaveChanged(heard);
    c.start();
    FakeSource.made[0]!.open();
    expect(heard).not.toHaveBeenCalled();
    FakeSource.made[0]!.fail(true);
    await vi.waitFor(() => expect(FakeSource.made.length).toBeGreaterThan(1));
    const before = heard.mock.calls.length;
    FakeSource.made.at(-1)!.open();
    expect(heard.mock.calls.length).toBe(before + 1);
    c.stop();
  });

  it("says offline when the server cannot be reached, and online at its next answer", async () => {
    let up = false;
    const fetch = vi.fn(() =>
      up ? answer(200, { unpublished: 1 }) : Promise.reject(new TypeError("down")),
    );
    const { c, events } = make(fetch as unknown as typeof globalThis.fetch);
    const seen: string[] = [];
    c.subscribe(() => seen.push(c.state));
    c.start();
    FakeSource.made[0]!.fail(true);
    await vi.waitFor(() => expect(c.state).toBe("offline"));
    // The stream is opened again, waiting a little longer each time.
    await vi.waitFor(() => expect(FakeSource.made.length).toBeGreaterThan(1));
    up = true;
    // The browser says it is online: a hint to try at once.
    events.dispatchEvent(new Event("online"));
    await vi.waitFor(() => expect(c.state).toBe("online"));
    expect(c.snapshot).toEqual({ unpublished: 1 });
    expect(seen).toEqual(["offline", "online"]);
    c.stop();
  });

  it("goes back online when any request has an answer, and when the stream opens", async () => {
    const { c } = make(vi.fn(() => Promise.reject(new TypeError("down"))) as never);
    c.start();
    await c.probe();
    expect(c.state).toBe("offline");
    c.reached();
    expect(c.state).toBe("online");
    await c.probe();
    expect(c.state).toBe("offline");
    FakeSource.made.at(-1)!.open();
    expect(c.state).toBe("online");
    c.stop();
  });

  it("starts offline when asked, until the probe answers", async () => {
    let answerProbe: (res: Response) => void = () => undefined;
    const fetch = vi.fn(() => new Promise<Response>((resolve) => (answerProbe = resolve)));
    const { c } = make(fetch as unknown as typeof globalThis.fetch);
    c.startOffline();
    expect(c.state).toBe("offline");
    // The stream is started as usual, and the server is asked at once.
    expect(FakeSource.made).toHaveLength(1);
    expect(fetch).toHaveBeenCalledWith("/api/p/avalymia/status", { credentials: "same-origin" });
    answerProbe(new Response(JSON.stringify({ unpublished: 2 }), { status: 200 }));
    await vi.waitFor(() => expect(c.state).toBe("online"));
    expect(c.snapshot).toEqual({ unpublished: 2 });
    c.stop();
  });

  it("treats any other answer to the probe as online", async () => {
    const { c } = make(vi.fn(() => answer(503)) as never);
    await c.probe();
    expect(c.state).toBe("online");
  });

  it("listens to the project that is open, and shows none of the last one's counts", () => {
    const { c } = make(vi.fn() as never);
    c.start();
    const [first] = FakeSource.made;
    first!.open();
    first!.send("status", { unpublished: 4 });
    expect(c.snapshot).toEqual({ unpublished: 4 });
    // Another project opens: the counts go, and its own stream starts.
    slug = "beta";
    c.projectChanged();
    expect(first!.readyState).toBe(2);
    expect(c.snapshot).toBeNull();
    expect(FakeSource.made.at(-1)!.url).toBe("/api/p/beta/status/events");
    FakeSource.made.at(-1)!.open();
    FakeSource.made.at(-1)!.send("status", { unpublished: 0 });
    expect(c.snapshot).toEqual({ unpublished: 0 });
    // The same project again opens nothing new.
    const count = FakeSource.made.length;
    c.projectChanged();
    expect(FakeSource.made).toHaveLength(count);
    c.stop();
  });

  it("listens to nothing outside a project, and asks who is in instead", async () => {
    const fetch = vi.fn(() => answer(200, { id: "p" }));
    const { c } = make(fetch as never);
    slug = null;
    c.start();
    expect(FakeSource.made).toHaveLength(0);
    await c.probe();
    expect(fetch).toHaveBeenCalledWith("/api/me", { credentials: "same-origin" });
    expect(c.state).toBe("online");
    expect(c.snapshot).toBeNull();
    c.stop();
  });
});
