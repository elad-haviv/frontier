import { describe, expect, it } from "vitest";
import { movedSection, SECTIONS } from "./shared.tsx";

describe("the settings sections", () => {
  it("put the AI keys and the offline copy under This device, and what is yours under You", () => {
    const at = (path: string) => SECTIONS.find((s) => s.path === path);
    expect(at("device/ai-keys")).toMatchObject({ title: "AI keys", group: "This device" });
    expect(at("device/ai-keys")?.offline).toBe(true);
    expect(at("device/offline")).toMatchObject({ title: "Offline copy", group: "This device" });
    expect(at("you/ai-models")).toMatchObject({ title: "AI models", group: "You" });
    expect(at("you/ai-spending")).toMatchObject({ title: "Your AI spending", group: "You" });
    expect(at("you/folder-run")).toMatchObject({ title: "Propose for a folder", group: "You" });
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
    expect(movedSection("device/ai-keys")).toBeNull();
    expect(movedSection("ai/models/nothing")).toBeNull();
    expect(movedSection("account")).toBeNull();
    expect(movedSection("")).toBeNull();
  });
});
