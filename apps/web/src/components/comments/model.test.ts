import { describe, expect, it } from "vitest";
import type { PassageComment } from "../../api.ts";
import { changesOf, countSpaced, openCount, roleTag, sourceAnchor, splitThreads } from "./model.ts";

const thread = (id: string, at: string, resolved = false): PassageComment =>
  ({
    id,
    at,
    resolved: resolved ? { by: { id: "x", name: "X", role: null }, at } : null,
  }) as PassageComment;

describe("threads", () => {
  it("splits open from resolved, oldest first, and counts the open", () => {
    const all = [
      thread("b", "2026-02-01"),
      thread("a", "2026-01-01"),
      thread("c", "2026-01-05", true),
    ];
    const { open, resolved } = splitThreads(all);
    expect(open.map((c) => c.id)).toEqual(["a", "b"]);
    expect(resolved.map((c) => c.id)).toEqual(["c"]);
    expect(openCount(all)).toBe(2);
  });
  it("names a role, and nothing for someone who left", () => {
    expect(roleTag({ id: "1", name: "A", role: "reader" })).toBe("Reader");
    expect(roleTag({ id: "1", name: "A", role: null })).toBe("");
  });
});

describe("a selection on the page as a passage of the Markdown", () => {
  const text =
    "# Quay\n\nThe **oldest** stretch of the [waterfront](x), where pilings sank.\n\nThe oldest stretch again.\n";
  it("finds words that have marks between them in the source", () => {
    const a = sourceAnchor(text, "The oldest stretch of the waterfront")!;
    expect(a.quote).toBe("The **oldest** stretch of the [waterfront");
    expect(a.prefix).toContain("Quay");
  });
  it("picks the chosen repeat", () => {
    expect(sourceAnchor(text, "oldest stretch", 1)!.suffix).toBe(" again.\n");
  });
  it("gives up on words that are not there, or too few", () => {
    expect(sourceAnchor(text, "nowhere to be seen")).toBeNull();
    expect(sourceAnchor(text, "ab")).toBeNull();
  });
  it("counts repeats with spaces as one", () => {
    expect(countSpaced("a  b a b", "a b")).toBe(2);
  });
});

describe("changesOf", () => {
  it("counts the stream's comment changes only while they are about this entry", () => {
    expect(changesOf({ changes: 3, path: "A.md" }, "A.md")).toBe(3);
    expect(changesOf({ changes: 4, path: "B.md" }, "A.md")).toBe(0);
    expect(changesOf({ changes: 4, path: null }, "A.md")).toBe(0);
    expect(changesOf(undefined, "A.md")).toBe(0);
  });
});
