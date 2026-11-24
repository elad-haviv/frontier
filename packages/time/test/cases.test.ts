import { describe, expect, it } from "vitest";
import { SHIPPED_CASES } from "../src/index.js";

describe("the shipped cases", () => {
  it("each says what starts and stops its clock, its source and a quotation", () => {
    expect(SHIPPED_CASES.length).toBeGreaterThan(0);
    expect(new Set(SHIPPED_CASES.map((k) => k.id)).size).toBe(SHIPPED_CASES.length);
    for (const k of SHIPPED_CASES) {
      expect(k.low).toBeGreaterThan(0);
      expect(k.low).toBeLessThanOrEqual(k.high);
      for (const text of [k.name, k.from, k.to, k.source, k.quotation, k.caveat]) {
        expect(text.trim()).not.toBe("");
      }
      expect(k.checked).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });
});
