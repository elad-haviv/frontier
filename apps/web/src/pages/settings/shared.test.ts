import { describe, expect, it } from "vitest";
import { movedSection, SECTIONS, sectionsFor } from "./shared.tsx";

describe("the settings sections", () => {
  it("put the AI keys and the offline copy under This device, and what is yours under You", () => {
    const at = (path: string) => SECTIONS.find((s) => s.path === path);
    expect(at("device/ai-keys")).toMatchObject({ title: "AI keys", group: "This device" });
    expect(at("device/ai-keys")?.offline).toBe(true);
    expect(at("device/offline")).toMatchObject({ title: "Offline copy", group: "This device" });
    expect(at("you/ai-models")).toMatchObject({ title: "AI models", group: "You" });
    expect(at("you/ai-spending")).toMatchObject({ title: "Your AI spending", group: "You" });
    expect(at("you/folder-run")).toMatchObject({ title: "Propose for a folder", group: "You" });
    expect(at("you/keep-going")).toMatchObject({ title: "Keep going", group: "You" });
    // The project's own sections: Members (31c), General, Types and dates, Backups and export.
    expect(SECTIONS.filter((s) => s.group === "This project").map((s) => s.title)).toEqual([
      "Members",
      "General",
      "Types and dates",
      "Backups and export",
    ]);
    // Only the sections that read the device work with no connection.
    expect(SECTIONS.filter((s) => s.offline).map((s) => s.path)).toEqual([
      "device/ai-keys",
      "device/offline",
    ]);
    // No address is the start of another, so each opens the one section it names.
    for (const a of SECTIONS) {
      for (const b of SECTIONS) {
        if (a !== b) expect(b.path.startsWith(`${a.path}/`)).toBe(false);
      }
    }
  });

  it("send the old addresses to where the sections are now", () => {
    expect(movedSection("ai/providers")).toBe("device/ai-keys");
    expect(movedSection("ai/models")).toBe("you/ai-models");
    expect(movedSection("ai/models/extraction")).toBe("you/ai-models/extraction");
    expect(movedSection("ai/models/art")).toBe("you/ai-models/art");
    expect(movedSection("ai/spending")).toBe("you/ai-spending");
    expect(movedSection("ai/folder-run")).toBe("you/folder-run");
    expect(movedSection("device")).toBe("device/offline");
    expect(movedSection("library/types")).toBe("types");
    expect(movedSection("library/backups")).toBe("backups");
    expect(movedSection("library/keep-going")).toBe("you/keep-going");
    // The server's own address for Signing in, where its Google trips come back (stage 31c).
    expect(movedSection("you/signing-in")).toBe("account");
    expect(movedSection("device/ai-keys")).toBeNull();
    expect(movedSection("ai/models/nothing")).toBeNull();
    expect(movedSection("account")).toBeNull();
    expect(movedSection("")).toBeNull();
  });

  it("keeps the AI folder run from a reader, and nothing else of theirs", () => {
    const paths = (canWrite: boolean) => sectionsFor(true, canWrite).map((s) => s.path);
    expect(paths(true)).toContain("you/folder-run");
    expect(paths(false)).not.toContain("you/folder-run");
    // A reader keeps the project's read-only pages, Members first, and what is theirs.
    expect(paths(false).slice(0, 4)).toEqual(["members", "general", "types", "backups"]);
    expect(paths(false)).toEqual(expect.arrayContaining(["profile", "account", "device/ai-keys"]));
  });

  it("show the project's sections only inside a project", () => {
    expect(sectionsFor(false).some((s) => s.group === "This project")).toBe(false);
    expect(sectionsFor(true)).toEqual(SECTIONS);
    // What is yours and the device's is reachable with no project open.
    expect(sectionsFor(false).map((s) => s.path)).toContain("profile");
    expect(sectionsFor(false).map((s) => s.path)).toContain("device/offline");
  });
});
