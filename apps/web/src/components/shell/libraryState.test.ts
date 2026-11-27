// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  LIBRARY_DOCK_MIN,
  LIBRARY_FLOAT_QUERY,
  LIBRARY_PAGE_MIN,
  LIBRARY_PANE_REM,
  libraryFloats,
  readLegacyLibraryOpen,
} from "./libraryState.ts";
import { readPrefs, writePrefs } from "./panels.tsx";

describe("the library pane's open state before it was kept per kind of screen", () => {
  beforeEach(() => localStorage.clear());

  it("is open the first time", () => {
    expect(readLegacyLibraryOpen()).toBe(true);
  });

  it("is what the device had kept", () => {
    localStorage.setItem("frontier.shell.library", "closed");
    expect(readLegacyLibraryOpen()).toBe(false);
    localStorage.setItem("frontier.shell.library", "open");
    expect(readLegacyLibraryOpen()).toBe(true);
  });

  it("is open when the device's storage cannot be read", () => {
    const get = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    expect(readLegacyLibraryOpen()).toBe(true);
    get.mockRestore();
  });
});

describe("the library pane's open state per kind of screen", () => {
  beforeEach(() => localStorage.clear());

  it("starts closed on maps, chronicles and the graph, open on entries and other pages", () => {
    expect(readPrefs("map").library).toBe(false);
    expect(readPrefs("chronicle").library).toBe(false);
    expect(readPrefs("graph").library).toBe(false);
    expect(readPrefs("editor").library).toBe(true);
    expect(readPrefs("page").library).toBe(true);
  });

  it("is kept for its kind only", () => {
    writePrefs("map", { library: true });
    expect(readPrefs("map").library).toBe(true);
    expect(readPrefs("graph").library).toBe(false);
    expect(readPrefs("page").library).toBe(true);
    writePrefs("page", { library: false });
    expect(readPrefs("page").library).toBe(false);
    expect(readPrefs("editor").library).toBe(true);
    expect(readPrefs("map").library).toBe(true);
  });

  it("takes the choice kept for the whole device as the default for entries and pages", () => {
    localStorage.setItem("frontier.shell.library", "closed");
    expect(readPrefs("page").library).toBe(false);
    expect(readPrefs("editor").library).toBe(false);
    // A screen that already had settings but no choice for the pane takes it too.
    localStorage.setItem("frontier.shell.page", JSON.stringify({ width: 300 }));
    expect(readPrefs("page").library).toBe(false);
    expect(readPrefs("page").width).toBe(300);
    // Maps keep their own default whatever the device chose.
    localStorage.setItem("frontier.shell.library", "open");
    expect(readPrefs("map").library).toBe(false);
  });
});

describe("when the pane floats", () => {
  it("floats when the page would keep less than its least width beside the pane", () => {
    expect(LIBRARY_PAGE_MIN).toBe(560);
    const needed = LIBRARY_PANE_REM * 16 + LIBRARY_PAGE_MIN;
    expect(libraryFloats(needed - 1)).toBe(true);
    expect(libraryFloats(needed)).toBe(false);
    // The pane is 17rem, so a larger root font asks for more room.
    expect(libraryFloats(needed, 20)).toBe(true);
  });

  it("uses the window's width until the room is measured: floats up to just under 1100", () => {
    expect(LIBRARY_DOCK_MIN).toBe(1100);
    const max = Number(/max-width: ([\d.]+)px/.exec(LIBRARY_FLOAT_QUERY)![1]);
    expect(max).toBeLessThan(LIBRARY_DOCK_MIN);
    expect(max).toBeGreaterThan(LIBRARY_DOCK_MIN - 1);
  });
});
