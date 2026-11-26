// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  LIBRARY_DOCK_MIN,
  LIBRARY_FLOAT_QUERY,
  readLibraryOpen,
  writeLibraryOpen,
} from "./libraryState.ts";

describe("the library pane's open state", () => {
  beforeEach(() => localStorage.clear());

  it("is open the first time", () => {
    expect(readLibraryOpen()).toBe(true);
  });

  it("is kept on the device", () => {
    writeLibraryOpen(false);
    expect(readLibraryOpen()).toBe(false);
    writeLibraryOpen(true);
    expect(readLibraryOpen()).toBe(true);
  });

  it("is open when the device's storage cannot be read, and writing it does not throw", () => {
    const get = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    const set = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(readLibraryOpen()).toBe(true);
    expect(() => writeLibraryOpen(false)).not.toThrow();
    get.mockRestore();
    set.mockRestore();
  });
});

describe("the width under which the pane floats", () => {
  it("floats up to just under the docking width, and docks from it", () => {
    expect(LIBRARY_DOCK_MIN).toBe(1100);
    const max = Number(/max-width: ([\d.]+)px/.exec(LIBRARY_FLOAT_QUERY)![1]);
    expect(max).toBeLessThan(LIBRARY_DOCK_MIN);
    expect(max).toBeGreaterThan(LIBRARY_DOCK_MIN - 1);
  });
});
