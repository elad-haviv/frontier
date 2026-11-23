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

function make(fetch: typeof globalThis.fetch) {
  FakeSource.made = [];
  const events = new EventTarget();
  const c = new Connection({
    fetch,
    EventSource: FakeSource as unknown as typeof EventSource,
    events: events as unknown as Window,
    maxDelayMs: 10,
  });
  return { c, events };
}

describe("the connection service", () => {
  it("takes the status from the stream and says online", () => {
    const { c } = make(vi.fn());
    c.start();
    const [source] = FakeSource.made;
    expect(source!.url).toBe("/api/status/events");
    source!.send("status", { unpublished: 3 });
    expect(c.state).toBe("online");
    expect(c.snapshot).toEqual({ unpublished: 3 });
    c.stop();
  });

  it("asks /api/status once when the stream fails: a 401 means signed out", async () => {
    const fetch = vi.fn(() => answer(401, { error: { code: "unauthenticated" } }));
    const { c } = make(fetch as unknown as typeof globalThis.fetch);
    c.start();
    FakeSource.made[0]!.fail(true);
    // Two failures at once make one probe.
    c.unauthorised();
    await c.probe();
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch.mock.calls[0]).toEqual(["/api/status", { credentials: "same-origin" }]);
    expect(c.state).toBe("signed-out");
    // While signed out the stream is not opened again by itself.
    await new Promise((r) => setTimeout(r, 30));
    expect(FakeSource.made).toHaveLength(1);
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

  it("treats any other answer to the probe as online", async () => {
    const { c } = make(vi.fn(() => answer(503)) as never);
    await c.probe();
    expect(c.state).toBe("online");
  });
});
