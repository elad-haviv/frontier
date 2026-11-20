import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildLinkBaseline,
  detectLineEnding,
  diffBaselines,
  isNote,
  type LinkBaseline,
  normaliseLineEndings,
  readFrontmatter,
  removeFrontmatterKey,
  restoreLineEndings,
  setFrontmatterKey,
  splitFrontmatter,
} from "../src/index.js";
import { changedLines, listFiles, readRaw } from "./helpers.js";

/**
 * Checks against the author's real vault. They run only when VAULT_PATH points at a checkout:
 *
 *   VAULT_PATH=/path/to/avalymia npm test -w packages/vault
 */
const VAULT = process.env["VAULT_PATH"];
const BASELINE = ".frontier/baseline/links.json";

describe.skipIf(!VAULT)("real vault", () => {
  const root = VAULT ?? "";
  const files = VAULT ? listFiles(root) : [];
  const notes = files.filter(isNote);
  const read = (path: string) => readRaw(root, path);

  it("has notes to check", () => {
    expect(notes.length).toBeGreaterThan(100);
  });

  it("splits and joins every note without changing a byte (G2)", () => {
    for (const path of notes) {
      const raw = read(path);
      const { frontmatter, body } = splitFrontmatter(raw);
      expect((frontmatter ?? "") + body, path).toBe(raw);
    }
  });

  it("restores every note's line endings exactly (G2)", () => {
    for (const path of notes) {
      const raw = read(path);
      const kind = detectLineEnding(raw);
      if (kind === "mixed") continue;
      expect(restoreLineEndings(normaliseLineEndings(raw), kind), path).toBe(raw);
    }
  });

  it("changes one line for a one-character edit to any note (G2)", () => {
    for (const path of notes) {
      const raw = read(path);
      const kind = detectLineEnding(raw);
      if (kind === "mixed" || raw.length === 0) continue;
      const normalised = normaliseLineEndings(raw);
      const at = normalised.search(/[^\n]/);
      if (at === -1) continue;
      const edited = normalised.slice(0, at) + "~" + normalised.slice(at);
      const { removed, added } = changedLines(raw, restoreLineEndings(edited, kind));
      expect(removed.length, path).toBe(1);
      expect(added.length, path).toBe(1);
    }
  });

  it("sets one frontmatter key without changing any other line (G2)", () => {
    let checked = 0;
    for (const path of notes) {
      const raw = read(path);
      if (splitFrontmatter(raw).frontmatter === null || readFrontmatter(raw).error !== null)
        continue;
      const out = setFrontmatterKey(raw, "zz_frontier_probe", "x");
      const { removed, added } = changedLines(raw, out);
      expect(removed, path).toEqual([]);
      expect(added.length, path).toBe(1);
      expect(removeFrontmatterKey(out, "zz_frontier_probe"), path).toBe(raw);
      checked++;
    }
    expect(checked).toBeGreaterThan(0);
  });

  it("resolves links as recorded in the baseline (G4)", () => {
    const baselinePath = join(root, BASELINE);
    if (!existsSync(baselinePath)) {
      console.warn(
        `No baseline at ${BASELINE}. Create it with: npm run baseline -w packages/vault -- <vault>`,
      );
      return;
    }
    const recorded = JSON.parse(readFileSync(baselinePath, "utf8")) as LinkBaseline;
    const head = readHead(root);
    const now = buildLinkBaseline(head, files, read);
    const { removed, added } = diffBaselines(recorded, now);
    if (recorded.vaultCommit !== head) {
      console.warn(
        `The baseline is from commit ${recorded.vaultCommit}; the checkout is at ${head}. ` +
          `${removed.length} entries gone, ${added.length} new. Regenerate the baseline.`,
      );
      return;
    }
    expect({ removed, added }).toEqual({ removed: [], added: [] });
  });
});

/** Reads the checked-out commit without running Git. */
function readHead(root: string): string {
  try {
    const head = readFileSync(join(root, ".git", "HEAD"), "utf8").trim();
    if (!head.startsWith("ref: ")) return head;
    const ref = head.slice(5);
    const loose = join(root, ".git", ref);
    if (existsSync(loose)) return readFileSync(loose, "utf8").trim();
    const packed = readFileSync(join(root, ".git", "packed-refs"), "utf8");
    const line = packed.split("\n").find((l) => l.endsWith(" " + ref));
    return line ? line.split(" ")[0]! : "unknown";
  } catch {
    return "unknown";
  }
}
