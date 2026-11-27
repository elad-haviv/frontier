import { describe, expect, it } from "vitest";
import {
  CreateProjectRequest,
  ProjectRecord,
  ProjectSlug,
  ProjectsFile,
  RESERVED_SLUGS,
  ROLE_RANK,
  roleAtLeast,
  slugFromName,
  UpdateProjectRequest,
} from "../src/index.js";

describe("project addresses", () => {
  it("takes lowercase letters, digits and single hyphens, 2 to 40 long", () => {
    for (const ok of ["ab", "avalymia", "my-world-2", "a1"]) {
      expect(ProjectSlug.safeParse(ok).success, ok).toBe(true);
    }
    for (const bad of ["a", "-a", "a-", "a--b", "A", "a b", "a_b", "x".repeat(41), "é"]) {
      expect(ProjectSlug.safeParse(bad).success, bad).toBe(false);
    }
    for (const word of RESERVED_SLUGS)
      expect(ProjectSlug.safeParse(word).success, word).toBe(false);
  });

  it("is made from a name", () => {
    expect(slugFromName("The Avalymia Atlas!")).toBe("the-avalymia-atlas");
    expect(slugFromName("  Café  Noir ")).toBe("cafe-noir");
    expect(slugFromName("日本")).toBe("project");
    expect(slugFromName("x")).toBe("project");
    expect(slugFromName("a".repeat(60)).length).toBe(40);
    expect(ProjectSlug.safeParse(slugFromName("Any name at all 123")).success).toBe(true);
  });

  it("leaves a reserved word to the server to refuse, so the answer is a taken address", () => {
    expect(CreateProjectRequest.safeParse({ name: "N", slug: "new" }).success).toBe(true);
    expect(UpdateProjectRequest.safeParse({ slug: "api" }).success).toBe(true);
    expect(CreateProjectRequest.safeParse({ name: "N", slug: "Bad Slug" }).success).toBe(false);
    expect(CreateProjectRequest.parse({ name: " N ", slug: "ok" })).toEqual({
      name: "N",
      slug: "ok",
      description: "",
      start: "empty",
    });
  });
});

describe("roles", () => {
  it("rank owner above writer above reader", () => {
    expect(roleAtLeast("owner", "writer")).toBe(true);
    expect(roleAtLeast("writer", "writer")).toBe(true);
    expect(roleAtLeast("reader", "writer")).toBe(false);
    expect(ROLE_RANK.owner).toBeGreaterThan(ROLE_RANK.writer);
  });
});

describe("the project file", () => {
  it("reads a record that holds little, and an empty file", () => {
    const record = ProjectRecord.parse({
      id: "abcdefghij",
      slug: "atlas",
      name: "Atlas",
      createdAt: "2026-11-27T10:00:00Z",
      kind: "own",
      layout: "folder",
    });
    expect(record).toMatchObject({ description: "", colour: 0, members: [], previousSlugs: [] });
    expect(record.iconFolder).toBeNull();
    expect(ProjectsFile.parse({})).toEqual({ version: 1, projects: [] });
  });
});
