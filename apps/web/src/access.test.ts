// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from "vitest";
import {
  clearAccessNotice,
  isLeaving,
  markLeaving,
  noteAccessLost,
  unmarkLeaving,
} from "./access.ts";

afterEach(() => {
  clearAccessNotice();
  unmarkLeaving("sample");
});

describe("losing access to a project", () => {
  it("names the project and says what may have happened, in plain words", async () => {
    const { useAccessNotice } = await import("./access.ts");
    expect(useAccessNotice).toBeTypeOf("function");
    noteAccessLost("Sample");
    // Read through a store subscription as a page does.
    let said: string | null = null;
    const { createElement, act } = await import("react");
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const { createRoot } = await import("react-dom/client");
    const host = document.createElement("div");
    const root = createRoot(host);
    function Show() {
      said = useAccessNotice();
      return null;
    }
    await act(async () => root.render(createElement(Show)));
    expect(said).toContain("You are no longer in Sample.");
    expect(said).toContain("taken you out");
    await act(async () => clearAccessNotice());
    expect(said).toBeNull();
    await act(async () => root.unmount());
  });

  it("remembers a project being left on purpose, so leaving is not reported as a loss", () => {
    expect(isLeaving("sample")).toBe(false);
    markLeaving("sample");
    expect(isLeaving("sample")).toBe(true);
    unmarkLeaving("sample");
    expect(isLeaving("sample")).toBe(false);
  });
});
