// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import { CURVE_KEY, readCurve, writeCurve } from "./curveSetting.ts";

describe("the Straight / Curved choice", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    window.localStorage.clear();
  });

  it("is straight until curves are chosen, and is kept on the device", () => {
    expect(readCurve()).toBe(false);
    writeCurve(true);
    expect(window.localStorage.getItem(CURVE_KEY)).toBe("smooth");
    expect(readCurve()).toBe(true);
    writeCurve(false);
    expect(readCurve()).toBe(false);
  });

  it("falls back to straight when storage is refused", () => {
    window.localStorage.setItem(CURVE_KEY, "smooth");
    vi.spyOn(window, "localStorage", "get").mockImplementation(() => {
      throw new Error("refused");
    });
    expect(() => writeCurve(true)).not.toThrow();
    expect(readCurve()).toBe(false);
  });
});
