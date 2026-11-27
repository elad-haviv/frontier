import { readFileSync } from "node:fs";
import { join } from "node:path";
import { PROJECT_COLOURS } from "@frontier/schema";
import { describe, expect, it } from "vitest";
import { letterOf } from "./ProjectMark.tsx";

/** WCAG contrast of white text on a colour. */
function contrastWithWhite(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 1.05 / (0.2126 * r! + 0.7152 * g! + 0.0722 * b! + 0.05);
}

const css = readFileSync(join(import.meta.dirname, "../../styles.css"), "utf8");
const lightBlock = css.slice(
  css.indexOf(":root {"),
  css.indexOf("@media (prefers-color-scheme: dark)"),
);
const darkBlock = css.slice(css.indexOf("@media (prefers-color-scheme: dark)"), css.indexOf("* {"));

describe("a project's letter mark", () => {
  it("is the first letter or digit of the name, in capitals", () => {
    expect(letterOf("Avalymia")).toBe("A");
    expect(letterOf("  the sample")).toBe("T");
    expect(letterOf("“Éclat”")).toBe("É");
    expect(letterOf("7 seas")).toBe("7");
    expect(letterOf("")).toBe("?");
    expect(letterOf("…")).toBe("?");
  });

  it("has a colour token for each of the eight colours, which white text reads on, in both themes", () => {
    for (const [theme, block] of [
      ["light", lightBlock],
      ["dark", darkBlock],
    ] as const) {
      for (let i = 0; i < PROJECT_COLOURS; i++) {
        const hex = new RegExp(`--project-${i}:\\s*(#[0-9a-f]{6})`).exec(block)?.[1];
        expect(hex, `--project-${i} in ${theme}`).toBeDefined();
        expect(contrastWithWhite(hex!), `--project-${i} in ${theme}`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });
});
