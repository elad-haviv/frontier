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
  it("is filed under the person and the project's id", () => {
    expect(projectKey("frontier.maps.recent", "avalymia01", "person1")).toBe(
      "frontier.maps.recent:person1:avalymia01",
    );
    // Another person's session reads another key, so it never meets the first person's recents.
    expect(projectKey("frontier.maps.recent", "avalymia01", "person2")).not.toBe(
      projectKey("frontier.maps.recent", "avalymia01", "person1"),
    );
    expect(projectKey("frontier.maps.recent", "avalymia01", null)).toBe(
      "frontier.maps.recent:avalymia01",
    );
    expect(projectKey("frontier.maps.recent", undefined, "person1")).toBe("frontier.maps.recent");
  });

  it("moves what an earlier build kept unfiled to the legacy project and its owner, once", () => {
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
    fileUnfiled("person1", "avalymia01", s);
    expect(names(s)).toEqual(
      [
        "frontier.aiKeys:person1",
        "frontier.chronicle.folded.abcd1234:person1:avalymia01",
        "frontier.explore.abcd1234:person1:avalymia01",
        "frontier.folderRun:person1:avalymia01",
        "frontier.keepGoing.v1:person1:avalymia01",
        "frontier.maps.recent:person1:avalymia01",
        "frontier.pendingProposals:person1:avalymia01",
        "frontier.projects.filed:person1",
        "frontier.shell.left",
        "frontier:map-curve",
      ].sort(),
    );
    expect(s.getItem("frontier.keepGoing.v1:person1:avalymia01")).toBe('{"recents":[]}');

    // A second person never takes over what is left, and a key already filed stays as it is.
    s.setItem("frontier.maps.recent", "[1]");
    s.setItem("frontier.explore.zzzz9999:person1:otherproj1", "{}");
    fileUnfiled("person2", "avalymia01", s);
    expect(s.getItem("frontier.maps.recent:person2:avalymia01")).toBe("[1]");
    fileUnfiled("person1", "otherproj1", s);
    expect(s.getItem("frontier.explore.zzzz9999:person1:otherproj1")).toBe("{}");
  });

  it("does not take another person's per-person keys, nor refile a key already filed", () => {
    const s = storage({
      "frontier.explore.abcd1234:person1:avalymia01": "{}",
      "frontier.pendingProposals:person2": "[2]",
    });
    fileUnfiled("person1", "avalymia01", s);
    expect(s.getItem("frontier.explore.abcd1234:person1:avalymia01")).toBe("{}");
    expect(s.getItem("frontier.explore.abcd1234:person1:avalymia01:person1:avalymia01")).toBeNull();
    expect(s.getItem("frontier.pendingProposals:person2")).toBe("[2]");
  });

  it("files what the first stage-31b build kept under a project alone under its person", () => {
    const s = storage({ "frontier.maps.recent:avalymia01": "[3]" });
    fileUnfiled("person1", "avalymia01", s);
    expect(s.getItem("frontier.maps.recent:person1:avalymia01")).toBe("[3]");
    expect(s.getItem("frontier.maps.recent:avalymia01")).toBeNull();
  });

  it("does nothing where storage is blocked", () => {
    expect(() => fileUnfiled("person1", "avalymia01", null)).not.toThrow();
  });
});
