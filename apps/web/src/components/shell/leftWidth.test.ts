// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from "vitest";
import { LEFT_WIDTH, readLeftWidth, writeLeftWidth } from "./panels.tsx";

describe("the left side bar's width", () => {
  beforeEach(() => localStorage.clear());

  it("starts at its usual width", () => {
    expect(readLeftWidth()).toBe(LEFT_WIDTH.fallback);
    localStorage.setItem("frontier.shell.left", "wide");
    expect(readLeftWidth()).toBe(LEFT_WIDTH.fallback);
  });

  it("is kept on the device, within its bounds", () => {
    writeLeftWidth(333.6);
    expect(readLeftWidth()).toBe(334);
    writeLeftWidth(5000);
    expect(readLeftWidth()).toBe(LEFT_WIDTH.max);
    writeLeftWidth(20);
    expect(readLeftWidth()).toBe(LEFT_WIDTH.min);
  });
});
