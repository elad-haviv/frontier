import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  BackupState,
  DraftRecord,
  ERROR_STATUS,
  ErrorBody,
  Health,
  Id,
  ImageQuery,
  makeId,
  PublishConfirmRequest,
  PublishPlan,
  RenameIntent,
  SaveDraftRequest,
  Settings,
  StatusSnapshot,
  statusOf,
  TreeResponse,
  VaultPath,
} from "../src/index.js";

/** The worked example from the design document. */
const record = {
  id: "k3f9x2ab7qpd",
  revision: 4,
  path: "03 Gazetteer (Places & Locations)/Planes of Existence/Ezob/Ezob.md",
  kind: "edit",
  baseBlob: "9c1e0f",
  lineEnding: "lf",
  binary: false,
  updatedAt: "2026-11-20T18:04:11Z",
};

describe("stored files", () => {
  it("accepts the worked draft record and rejects one with a field missing", () => {
    // A record written before origins existed reads as a draft the author typed.
    expect(DraftRecord.parse(record)).toEqual({ ...record, origins: [] });
    const accepted = {
      ...record,
      origins: [
        { kind: "branch", ref: "proposal/architect/x", tip: "8a41" },
        { kind: "fields", ref: "p4k2m9x0aa7q", model: "some/model" },
      ],
    };
    expect(DraftRecord.parse(accepted)).toEqual(accepted);
    expect(DraftRecord.safeParse({ ...record, origins: [{ kind: "other" }] }).success).toBe(false);
    for (const key of Object.keys(record)) {
      const copy: Record<string, unknown> = { ...record };
      delete copy[key];
      expect(DraftRecord.safeParse(copy).success, key).toBe(false);
    }
  });

  it("rejects a mixed line ending, a negative revision and an unknown kind", () => {
    expect(DraftRecord.safeParse({ ...record, lineEnding: "mixed" }).success).toBe(false);
    expect(DraftRecord.safeParse({ ...record, revision: -1 }).success).toBe(false);
    expect(DraftRecord.safeParse({ ...record, kind: "rename" }).success).toBe(false);
  });

  it("accepts a rename intent, settings and backup state", () => {
    const intent = {
      id: "abcdefgh1234",
      from: "a/Old.md",
      to: "a/New.md",
      createdAt: "2026-11-20T18:04:11Z",
    };
    expect(RenameIntent.parse(intent)).toEqual(intent);
    expect(RenameIntent.safeParse({ ...intent, to: "" }).success).toBe(false);
    expect(Settings.parse({ passwordHash: "$argon2id$..." })).toBeTruthy();
    expect(Settings.safeParse({}).success).toBe(false);
    expect(BackupState.parse({ lastSuccessAt: null, lastError: null })).toBeTruthy();
    expect(BackupState.safeParse({ lastSuccessAt: "yesterday", lastError: null }).success).toBe(
      false,
    );
  });
});

describe("paths and ids", () => {
  it("keeps paths inside the vault", () => {
    expect(VaultPath.safeParse("a/b.md").success).toBe(true);
    expect(VaultPath.safeParse("/a/b.md").success).toBe(false);
    expect(VaultPath.safeParse("a/../../b.md").success).toBe(false);
    expect(VaultPath.safeParse("").success).toBe(false);
  });

  it("makes ids of 12 lower-case letters and digits", () => {
    for (let i = 0; i < 50; i++) expect(Id.safeParse(makeId(randomBytes)).success).toBe(true);
    expect(Id.safeParse("SHORT").success).toBe(false);
  });

  it("redraws bytes that would favour some characters", () => {
    let call = 0;
    const id = makeId((n) => new Uint8Array(n).fill(call++ === 0 ? 255 : 0));
    expect(id).toBe("aaaaaaaaaaaa");
    expect(call).toBe(2);
  });
});

describe("API shapes", () => {
  it("accepts a save and rejects one without an id", () => {
    const save = { id: "k3f9x2ab7qpd", path: "a/b.md", kind: "edit", text: "x", revision: 0 };
    expect(SaveDraftRequest.parse(save)).toEqual(save);
    expect(SaveDraftRequest.safeParse({ ...save, id: undefined }).success).toBe(false);
  });

  it("accepts the worked publish plan", () => {
    const plan = {
      planId: "p7d2k1m9x0aa",
      mainCommit: "4e1b",
      ready: ["k3f9x2ab7qpd"],
      merges: [
        {
          id: "m1",
          draftId: "k3f9x2ab7qpd",
          path: "a.md",
          mergedText: "m",
          mainText: "t",
          baseText: "b",
        },
      ],
      conflicts: [
        {
          draftId: "k3f9x2ab7qpd",
          path: "b.md",
          reason: "overlap",
          mine: "1",
          theirs: "2",
          base: "0",
        },
      ],
      renames: [{ id: "abcdefgh1234", from: "a/Old.md", to: "a/New.md", affected: ["c.md"] }],
      groups: [["k3f9x2ab7qpd", "abcdefgh1234"]],
    };
    expect(PublishPlan.parse(plan)).toEqual(plan);
    expect(PublishPlan.safeParse({ ...plan, mainCommit: undefined }).success).toBe(false);
  });

  it("requires a publish message", () => {
    const base = { planId: "p7d2k1m9x0aa", confirmedMergeIds: [] };
    expect(PublishConfirmRequest.safeParse({ ...base, message: "   " }).success).toBe(false);
    expect(PublishConfirmRequest.parse({ ...base, message: " Add Harbor " }).message).toBe(
      "Add Harbor",
    );
  });

  it("accepts a nested tree", () => {
    const tree = {
      folders: [
        {
          path: "01 Places",
          folders: [{ path: "01 Places/Harbor", folders: [], notes: [] }],
          notes: [{ path: "01 Places/Unwritten.md", title: "Unwritten", state: "published" }],
        },
      ],
      notes: [{ path: "README.md", title: "README", state: "unpublished" }],
    };
    expect(TreeResponse.parse(tree)).toEqual(tree);
  });

  it("allows only the fixed image widths", () => {
    expect(ImageQuery.parse({ path: "a.png", w: "640" }).w).toBe(640);
    expect(ImageQuery.parse({ path: "a.png" }).w).toBeUndefined();
    expect(ImageQuery.safeParse({ path: "a.png", w: "999" }).success).toBe(false);
  });

  it("accepts a status snapshot and a health reply", () => {
    const snapshot = {
      lastFetchAt: "2026-11-20T18:04:11Z",
      lastPushAt: null,
      failedPush: null,
      unpublished: 2,
      conflicts: 0,
      indexCommit: "4e1b",
      indexStale: false,
      lastBackupAt: null,
      backupError: "bucket unreachable",
      inbox: { branches: 1, operations: 2 },
      ai: { on: false, lastError: null },
      serverDraftChanges: 0,
      problems: [],
      attention: {
        ambiguousLinks: 0,
        duplicateImages: 12,
        mixedEndings: 0,
        brokenAppendixLinks: 0,
        nearFolderNotes: 5,
        unreadableFields: 0,
        duplicateIds: 0,
      },
    };
    expect(StatusSnapshot.parse(snapshot)).toEqual(snapshot);
    expect(StatusSnapshot.safeParse({ ...snapshot, attention: {} }).success).toBe(false);
    expect(
      Health.parse({ ok: true, indexCommit: null, lastFetchAt: null, lastBackupAt: null }).ok,
    ).toBe(true);
  });
});

describe("errors", () => {
  it("maps every code to a status", () => {
    expect(statusOf("main_moved")).toBe(409);
    expect(statusOf("git_busy")).toBe(503);
    expect(statusOf("proposal_moved")).toBe(409);
    expect(statusOf("not_allowed")).toBe(403);
    expect(Object.keys(ERROR_STATUS)).toHaveLength(19);
  });

  it("accepts an error body with a known code only", () => {
    expect(
      ErrorBody.parse({ error: { code: "stale_revision", message: "older", id: "k3f9x2ab7qpd" } }),
    ).toBeTruthy();
    expect(ErrorBody.safeParse({ error: { code: "nope", message: "x" } }).success).toBe(false);
  });
});
