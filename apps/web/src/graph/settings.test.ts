// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { readDepth, readView, writeDepth, writeView } from "./settings.ts";

afterEach(() => {
  vi.unstubAllGlobals();
  sessionStorage.clear();
  localStorage.clear();
});

describe("the graph's settings", () => {
  it("keep the view for the session and the depth on the device", () => {
    writeView({ kind: "flat", x: 12, y: -3, k: 1.4 });
    expect(sessionStorage.getItem("frontier.graph.view")).toBe('{"x":12,"y":-3,"k":1.4}');
    expect(readView()).toEqual({ kind: "flat", x: 12, y: -3, k: 1.4 });
    writeDepth(2);
    expect(readDepth()).toBe(2);
    writeDepth(1);
    expect(readDepth()).toBe(1);
  });

  it("give the defaults when nothing is kept, or what is kept cannot be read", () => {
    expect(readView()).toBeNull();
    expect(readDepth()).toBe(1);
    sessionStorage.setItem("frontier.graph.view", "{not json");
    expect(readView()).toBeNull();
    sessionStorage.setItem("frontier.graph.view", '{"x":1,"y":2,"k":0}');
    expect(readView()).toBeNull();
    sessionStorage.setItem("frontier.graph.view", '{"x":1,"y":"2","k":1}');
    expect(readView()).toBeNull();
    localStorage.setItem("frontier.graph.depth", "7");
    expect(readDepth()).toBe(1);
  });

  it("go on without storage that throws", () => {
    const blocked = {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("full");
      },
    };
    vi.stubGlobal("sessionStorage", blocked);
    vi.stubGlobal("localStorage", blocked);
    expect(() => writeView({ kind: "flat", x: 0, y: 0, k: 1 })).not.toThrow();
    expect(() => writeDepth(2)).not.toThrow();
    expect(readView()).toBeNull();
    expect(readDepth()).toBe(1);
  });
});
