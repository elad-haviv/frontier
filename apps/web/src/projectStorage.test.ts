import { describe, expect, it } from "vitest";
import { fileUnfiled, projectKey } from "./projectStorage.ts";

/** A browser's storage, in memory. */
function storage(initial: Record<string, string> = {}): Storage {
  const data = new Map(Object.entries(initial));
  return {
    get length() {
      return data.size;
    },
    key: (i: number) => [...data.keys()][i] ?? null,
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, v),
    removeItem: (k: string) => void data.delete(k),
    clear: () => data.clear(),
  };
}

const names = (s: Storage) =>
  Object.keys(Object.fromEntries([...Array(s.length).keys()].map((i) => [s.key(i)!, 1]))).sort();

describe("what the device remembers for a library", () => {
  it("is filed under the project's id", () => {
    expect(projectKey("frontier.maps.recent", "avalymia01")).toBe(
      "frontier.maps.recent:avalymia01",
    );
    expect(projectKey("frontier.maps.recent", undefined)).toBe("frontier.maps.recent");
  });

  it("moves what an earlier build kept unfiled to the first project, once", () => {
    const s = storage({
      "frontier.keepGoing.v1": '{"recents":[]}',
      "frontier.maps.recent": "[]",
      "frontier.explore.abcd1234": "{}",
      "frontier.chronicle.folded.abcd1234": "1",
      "frontier.pendingProposals:person1": "[]",
      "frontier.folderRun:person1": "{}",
      // A device setting is not a library's.
      "frontier.shell.left": "300",
      "frontier:map-curve": "smooth",
      "frontier.aiKeys:person1": "{}",
    });
    fileUnfiled("avalymia01", s);
    expect(names(s)).toEqual(
      [
        "frontier.aiKeys:person1",
        "frontier.chronicle.folded.abcd1234:avalymia01",
        "frontier.explore.abcd1234:avalymia01",
        "frontier.folderRun:person1:avalymia01",
        "frontier.keepGoing.v1:avalymia01",
        "frontier.maps.recent:avalymia01",
        "frontier.pendingProposals:person1:avalymia01",
        "frontier.projects.filed",
        "frontier.shell.left",
        "frontier:map-curve",
      ].sort(),
    );
    expect(s.getItem("frontier.keepGoing.v1:avalymia01")).toBe('{"recents":[]}');

    // A second project never takes over what is left, and a key already filed stays as it is.
    s.setItem("frontier.maps.recent", "[1]");
    s.setItem("frontier.explore.zzzz9999:otherproj1", "{}");
    fileUnfiled("otherproj1", s);
    expect(s.getItem("frontier.maps.recent")).toBe("[1]");
    expect(s.getItem("frontier.maps.recent:otherproj1")).toBeNull();
    expect(s.getItem("frontier.explore.zzzz9999:otherproj1")).toBe("{}");
  });

  it("does not file a key that is already filed, even before the mark is made", () => {
    const s = storage({ "frontier.explore.abcd1234:avalymia01": "{}" });
    fileUnfiled("otherproj1", s);
    expect(s.getItem("frontier.explore.abcd1234:avalymia01")).toBe("{}");
    expect(s.getItem("frontier.explore.abcd1234:avalymia01:otherproj1")).toBeNull();
  });

  it("does nothing where storage is blocked", () => {
    expect(() => fileUnfiled("avalymia01", null)).not.toThrow();
  });
});
