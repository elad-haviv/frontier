import { describe, expect, it } from "vitest";
import { DISTANCE, EDGE, INSET, isSwipeBack } from "./swipe.ts";

describe("a swipe back from the library", () => {
  it("is a swipe right that starts at the left edge", () => {
    expect(isSwipeBack({ x: INSET + 4, y: 300 }, { x: INSET + 4 + DISTANCE + 10, y: 310 })).toBe(
      true,
    );
    expect(isSwipeBack({ x: EDGE, y: 300 }, { x: EDGE + DISTANCE, y: 300 })).toBe(true);
  });

  it("is not one that starts away from the edge", () => {
    expect(isSwipeBack({ x: EDGE + 1, y: 300 }, { x: 250, y: 300 })).toBe(false);
  });

  it("is not one that starts at the screen's own edge, where the browser's swipe back begins", () => {
    expect(isSwipeBack({ x: INSET - 1, y: 300 }, { x: 200, y: 300 })).toBe(false);
    expect(isSwipeBack({ x: 0, y: 300 }, { x: 200, y: 300 })).toBe(false);
    expect(isSwipeBack({ x: INSET, y: 300 }, { x: INSET + DISTANCE, y: 300 })).toBe(true);
  });

  it("is not a short swipe or one to the left", () => {
    expect(isSwipeBack({ x: INSET, y: 300 }, { x: INSET + DISTANCE - 1, y: 300 })).toBe(false);
    expect(isSwipeBack({ x: 20, y: 300 }, { x: 0, y: 300 })).toBe(false);
  });

  it("is not a mostly vertical gesture, such as scrolling the folders", () => {
    expect(isSwipeBack({ x: INSET + 4, y: 100 }, { x: 90, y: 400 })).toBe(false);
    expect(isSwipeBack({ x: INSET + 4, y: 100 }, { x: 140, y: 160 })).toBe(true);
  });
});
