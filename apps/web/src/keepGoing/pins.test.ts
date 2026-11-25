// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Pins = { pins: { path: string; title: string }[] };
const pin = (path: string) => ({ path, title: path });

const server = vi.hoisted(() => ({
  list: [] as { path: string; title: string }[],
  pins: vi.fn(),
  pin: vi.fn(),
  unpin: vi.fn(),
  reorderPins: vi.fn(),
}));
const conn = vi.hoisted(() => ({
  state: "online",
  listeners: new Set<() => void>(),
}));

vi.mock("../api.ts", () => ({ api: server }));
vi.mock("../sync/connection.ts", () => ({
  connection: {
    current: () => ({ state: conn.state }),
    subscribe: (fn: () => void) => {
      conn.listeners.add(fn);
      return () => conn.listeners.delete(fn);
    },
  },
}));

const { HIDDEN_RELOAD_MS, loadPins, resetPins, togglePin } = await import("./pins.ts");
const store = await import("./pins.ts");

const answer = (): Pins => ({ pins: [...server.list] });

beforeEach(() => {
  resetPins();
  server.list = [];
  server.pins.mockReset().mockImplementation(async () => answer());
  server.pin.mockReset().mockImplementation(async (path: string) => {
    server.list.push(pin(path));
    return answer();
  });
  server.unpin.mockReset().mockImplementation(async (path: string) => {
    server.list = server.list.filter((p) => p.path !== path);
    return answer();
  });
});
afterEach(() => vi.useRealTimers());

describe("togglePin", () => {
  it("loads the list first, so an entry pinned elsewhere is unpinned, not pinned twice", async () => {
    server.list = [pin("a.md")];
    expect(await togglePin("a.md")).toBe(false);
    expect(server.pin).not.toHaveBeenCalled();
    expect(server.unpin).toHaveBeenCalledWith("a.md");
  });

  it("ignores a second press while the first is under way", async () => {
    const [first, second] = [togglePin("a.md"), togglePin("a.md")];
    expect(await second).toBeNull();
    expect(await first).toBe(true);
    expect(server.pin).toHaveBeenCalledTimes(1);
    // Done: the next press is a new change.
    expect(await togglePin("a.md")).toBe(false);
  });

  it("lets other entries change at the same time", async () => {
    const both = await Promise.all([togglePin("a.md"), togglePin("b.md")]);
    expect(both).toEqual([true, true]);
  });

  it("is free again after a failure", async () => {
    server.pin.mockRejectedValueOnce(new Error("no"));
    await expect(togglePin("a.md")).rejects.toThrow("no");
    expect(await togglePin("a.md")).toBe(true);
  });
});

describe("loadPins", () => {
  it("loads once, and again when forced", async () => {
    await loadPins();
    await loadPins();
    expect(server.pins).toHaveBeenCalledTimes(1);
    await loadPins(true);
    expect(server.pins).toHaveBeenCalledTimes(2);
  });

  it("a forced load asked after a slow one wins", async () => {
    let release: (v: Pins) => void = () => undefined;
    server.pins.mockImplementationOnce(() => new Promise<Pins>((r) => (release = r)));
    const slow = loadPins();
    server.list = [pin("new.md")];
    await loadPins(true);
    release({ pins: [] });
    await slow;
    expect(store.getPinsForTest()).toEqual([pin("new.md")]);
  });
});

describe("keeping in step with the server", () => {
  const listen = () => store.watchPinsForTest();

  it("reloads when the connection comes back, not on every change", async () => {
    conn.state = "online";
    const stop = listen();
    conn.state = "offline";
    for (const l of conn.listeners) l();
    expect(server.pins).not.toHaveBeenCalled();
    conn.state = "online";
    for (const l of conn.listeners) l();
    expect(server.pins).toHaveBeenCalledTimes(1);
    stop();
    expect(conn.listeners.size).toBe(0);
  });

  it("reloads after the page was hidden more than a minute, not after less", () => {
    vi.useFakeTimers();
    const stop = listen();
    const visibility = (v: "hidden" | "visible") => {
      Object.defineProperty(document, "visibilityState", { value: v, configurable: true });
      document.dispatchEvent(new Event("visibilitychange"));
    };
    visibility("hidden");
    vi.advanceTimersByTime(HIDDEN_RELOAD_MS - 1000);
    visibility("visible");
    expect(server.pins).not.toHaveBeenCalled();
    visibility("hidden");
    vi.advanceTimersByTime(HIDDEN_RELOAD_MS + 1000);
    visibility("visible");
    expect(server.pins).toHaveBeenCalledTimes(1);
    stop();
  });
});
