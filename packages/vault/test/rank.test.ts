import { describe, expect, it } from "vitest";
import { rankNames } from "../src/index.js";

const NOTES = [
  { path: "01 Places/Harbor/Harbor.md", title: "Harbor", aliases: ["The Port", "Greywater"] },
  { path: "01 Places/Harbor/Old Quay.md", title: "Old Quay", aliases: [] },
  { path: "01 Places/Harborside.md", title: "Harborside", aliases: [] },
  { path: "02 People/Twin.md", title: "Twin", aliases: [] },
  { path: "03 Things/Twin.md", title: "Twin", aliases: [] },
  { path: "99 Appendices/Logs/Harbor log.md", title: "Harbor log", aliases: [] },
];

describe("rankNames", () => {
  it("puts names that start with the query first, then shorter ones", () => {
    expect(rankNames(NOTES, "harb").map((r) => r.alias ?? r.title)).toEqual([
      "Harbor",
      "Harborside",
    ]);
    expect(rankNames(NOTES, "port")).toEqual([
      { path: "01 Places/Harbor/Harbor.md", title: "Harbor", alias: "The Port" },
    ]);
  });

  it("finds aliases, and ignores letter case and spaces around the query", () => {
    expect(rankNames(NOTES, "  GREY ")).toEqual([
      { path: "01 Places/Harbor/Harbor.md", title: "Harbor", alias: "Greywater" },
    ]);
  });

  it("marks names two notes share, so a link names the path", () => {
    expect(rankNames(NOTES, "twin")).toEqual([
      { path: "02 People/Twin.md", title: "Twin", shared: true },
      { path: "03 Things/Twin.md", title: "Twin", shared: true },
    ]);
  });

  it("leaves the appendices out unless asked for", () => {
    expect(rankNames(NOTES, "log")).toEqual([]);
    expect(rankNames(NOTES, "log", true).map((r) => r.title)).toEqual(["Harbor log"]);
  });

  it("lists every name and alias with no query, and at most 50 with one", () => {
    expect(rankNames(NOTES, "")).toHaveLength(7);
    const many = Array.from({ length: 80 }, (_, i) => ({
      path: `n/${i}.md`,
      title: `Name ${i}`,
      aliases: [],
    }));
    expect(rankNames(many, "name")).toHaveLength(50);
    expect(rankNames(many, "")).toHaveLength(80);
  });
});
