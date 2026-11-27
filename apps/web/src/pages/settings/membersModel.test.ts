import { describe, expect, it } from "vitest";
import {
  isOnlyOwner,
  lastActive,
  LAST_OWNER,
  peopleLine,
  ROLE_MAY,
  ROLE_ORDER,
  timeLeft,
  withArticle,
} from "./membersModel.ts";

const NOW = Date.parse("2026-11-27T12:00:00Z");
const ago = (seconds: number) => new Date(NOW - seconds * 1000).toISOString();

describe("how long an invite link has left", () => {
  it("is said in days, hours or minutes, the largest that fits", () => {
    expect(timeLeft(7 * 86400)).toBe("7 days left");
    expect(timeLeft(6 * 86400 + 3600)).toBe("6 days left");
    expect(timeLeft(47 * 3600)).toBe("47 hours left");
    expect(timeLeft(3600)).toBe("1 hour left");
    expect(timeLeft(40 * 60)).toBe("40 minutes left");
    expect(timeLeft(60)).toBe("1 minute left");
    expect(timeLeft(20)).toBe("less than a minute left");
    expect(timeLeft(0)).toBe("no time left");
    expect(timeLeft(-5)).toBe("no time left");
  });
});

describe("when a person was last here", () => {
  it("says nothing exact: the server keeps it to within a few minutes", () => {
    expect(lastActive(null, NOW)).toBe("not here since joining");
    expect(lastActive(ago(60), NOW)).toBe("active just now");
    expect(lastActive(ago(40 * 60), NOW)).toBe("active this hour");
    expect(lastActive(ago(3 * 3600), NOW)).toBe("active 3 hours ago");
    expect(lastActive(ago(26 * 3600), NOW)).toBe("active yesterday");
    expect(lastActive(ago(5 * 86400), NOW)).toBe("active 5 days ago");
    expect(lastActive(ago(30 * 86400), NOW)).toMatch(/^active [A-Za-z0-9]/);
  });
});

describe("roles in words", () => {
  it("puts the safe role first, and says what each may do", () => {
    expect(ROLE_ORDER).toEqual(["reader", "writer", "owner"]);
    expect(ROLE_MAY.reader).toContain("Cannot change anything");
    expect(ROLE_MAY.writer).toContain("saves versions");
    expect(ROLE_MAY.owner).toContain("deleting the project");
    expect(withArticle("Owner")).toBe("an Owner");
    expect(withArticle("Writer")).toBe("a Writer");
  });

  it("knows the only owner, and counts people plainly", () => {
    const rows = [{ role: "owner" as const }, { role: "writer" as const }];
    expect(isOnlyOwner(rows[0]!, rows)).toBe(true);
    expect(isOnlyOwner(rows[1]!, rows)).toBe(false);
    const two = [{ role: "owner" as const }, { role: "owner" as const }];
    expect(isOnlyOwner(two[0]!, two)).toBe(false);
    expect(LAST_OWNER).toContain("always needs an owner");
    expect(peopleLine(1, "Sample", true)).toBe("Only you so far. Invite someone below.");
    expect(peopleLine(1, "Sample", false)).toBe("Only you so far.");
    expect(peopleLine(3, "Sample", true)).toBe("3 people can open Sample.");
  });
});
