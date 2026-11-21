import { describe, expect, it } from "vitest";
import { clampWidth, readImageEmbed, withWidth } from "./embedWidth.ts";

describe("reading an image embed", () => {
  it("reads the name and the width", () => {
    expect(readImageEmbed("![[Sea Chart.png]]")).toEqual({
      target: "Sea Chart.png",
      width: null,
      sizable: true,
    });
    expect(readImageEmbed("![[maps/Sea Chart.png|300]]")).toEqual({
      target: "maps/Sea Chart.png",
      width: 300,
      sizable: true,
    });
    expect(readImageEmbed("![[a.jpg\\|120x80]]")).toMatchObject({ width: 120, sizable: true });
  });
  it("keeps a caption from being taken for a width", () => {
    expect(readImageEmbed("![[a.png|The old quay]]")).toEqual({
      target: "a.png",
      width: null,
      sizable: false,
    });
  });
  it("answers null for embeds of notes and for links", () => {
    expect(readImageEmbed("![[Mira]]")).toBeNull();
    expect(readImageEmbed("[[a.png]]")).toBeNull();
  });
});

describe("rewriting the width", () => {
  it("adds, changes and removes the width, and nothing else", () => {
    expect(withWidth("![[Sea Chart.png]]", 300)).toBe("![[Sea Chart.png|300]]");
    expect(withWidth("![[Sea Chart.png|300]]", 212)).toBe("![[Sea Chart.png|212]]");
    expect(withWidth("![[Sea Chart.png|300x200]]", 90)).toBe("![[Sea Chart.png|90]]");
    expect(withWidth("![[Sea Chart.png|300]]", null)).toBe("![[Sea Chart.png]]");
    expect(withWidth("![[ odd  name.png#x|3]]", 60)).toBe("![[ odd  name.png#x|60]]");
  });
  it("writes the bar escaped in a table, and keeps one already escaped", () => {
    expect(withWidth("![[a.png]]", 80, true)).toBe("![[a.png\\|80]]");
    expect(withWidth("![[a.png\\|300]]", 80)).toBe("![[a.png\\|80]]");
    expect(withWidth("![[a.png\\|300]]", null)).toBe("![[a.png]]");
  });
});

describe("a dragged width", () => {
  it("is whole pixels, at least 50, and no wider than the editor", () => {
    expect(clampWidth(212.6, 600)).toBe(213);
    expect(clampWidth(12, 600)).toBe(50);
    expect(clampWidth(900, 343.5)).toBe(343);
  });
});
