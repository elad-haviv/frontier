# Consolidated Goldfish review: Stage 11 design

**Target:** [`docs/designs/stage-11-foundations-shell-tree.md`](docs/designs/stage-11-foundations-shell-tree.md).
FeatureRange is lines 1–553; DetailedRange is lines 554–802.
**Date:** 2026-11-22. **Mode:** consolidated (all five stages, no pauses).

## Reviewer status

| Stage                      | Reviewers                                         | Status    | Raw report                                       |
| -------------------------- | ------------------------------------------------- | --------- | ------------------------------------------------ |
| 5 Zoom out                 | zoom-out, inventive-catalyst                      | completed | `.egm/review/zoom_out_report.md`                 |
| 6 Comprehension            | comprehension                                     | completed | `.egm/review/comprehension_report.md`            |
| 7 Critic                   | design, structural, style                         | completed | `.egm/review/critic_report.md`                   |
| 8 Intermediate zoom out    | zoom-out                                          | completed | `.egm/review/intermediate_zoom_out_report.md`    |
| 9 Implementation readiness | implementation-readiness, codebase-details, style | completed | `.egm/review/implementation_readiness_report.md` |

The reviewers raised about 120 findings, with heavy overlap. Stage 8 sorted the stage 5–7 fixes into adopt,
simplify, defer and reject, so the stage does not grow into stage 15. The action items below follow its
verdicts. Stage 9 then added concrete corrections tied to the code.

## Action items

### 🔴 Blockers

1. **CUJ 3 fails against today's code.**
   - The phone sends `draftId` and a revision above 0 for a draft that the laptop's publish cleared.
     `drafts.ts:200` throws `invalid` before any base check runs.
   - Fix: add a small rule table for the case where no draft exists and the revision is above 0:

     | `baseBlob`              | Result                      |
     | ----------------------- | --------------------------- |
     | differs                 | kept copy, `stale_revision` |
     | matches                 | fresh draft                 |
     | missing                 | today's behaviour           |
     | path deleted or renamed | kept copy, `stale_revision` |

   - Order of checks: the `op` check runs first, then the revision check.
   - The published text for the server-made draft comes from an extended `PublishedInfo`.
   - `clearPublished` keeps a draft that only has kept copies.
   - Add a unit test for the whole sequence.
   - Sources: S8-1, S7d-M3, S9c-M5, S9c-32.
2. **The device header becomes a file name without validation.**
   - Validate it as an `Id` and refuse anything else.
   - Store a save without the header under `unknown`.
   - Make the device name from the user agent once, keep it in `meta`, send it URI-encoded and cut it to
     40 characters.
   - Sources: S9r-B1, S9c-B3, S7d-n.
3. **Folder delete wipes unpublished edits.**
   - Simplify instead of building new machinery: refuse a folder delete while any file under it has an
     unpublished draft or is an image, with the reason.
   - Drop the delete Undo; the count confirm and Discard in the unpublished list are enough.
   - Sources: S7d-B1, S8-4.
4. **Map and chronicle saves cannot go through a page-less queue as planned.**
   - The record gains `kind` and `link`. Links from consecutive changes are unioned by feature or span id.
   - Each kind's sender owns its merge (`mergeMaps` or `mergeChronicles` from `@frontier/schema`) and
     uses the stored `base`.
   - `subscribe(key)` hands the server's returned value and `unlinked` back to a mounted page.
   - A clash keeps this device's side and the notice names the clashed items. The link to history is
     dropped. Kept copies for item files wait for stage 15.
   - Sources: S7d-B2, S8-3, S9r-M6, S9c-B2, S5i-5.
5. **The attention count is planned in the wrong place.**
   - Build the list of kept copies in `routes/status.ts` from `s.drafts`.
   - Add the count to `StatusSnapshot.attention` (`packages/schema/src/status.ts`,
     `apps/server/src/status/status.ts`).
   - Send a status event when a kept copy is stored.
   - Sources: S9r-B2, S9c-M7, S7d-M14.

### 🟡 Major

6. **Narrow G4.** The queue carries entry text (including delete drafts), maps, chronicles and the folder
   file. Comments, renames, folder delete and apply-type stay direct online calls, refused while offline.
   Stage 15 decides about queueing them. (S8-2, S7d-M13, S5z-7, S9r-M7)
7. **Connection service.**
   - One sender per browser, through `navigator.locks`.
   - When the stream fails, fetch `/api/status` once: a 401 means signed out, a network error means
     offline.
   - The server sends a heartbeat comment every 20 seconds.
   - Write to IndexedDB on every `put`.
   - The sender skips records in back-off or needing attention.
   - Drop the `slow` state.
   - (S8-8, S7d-M5/M6/M7, S5i-3)
8. **After a note's `stale_revision`, drop the queue record.** The server has stored the kept copy, so
   attention points to `/versions/:id`. Records refused with any other 4xx answer appear in one small
   list, opened from the unsent count, with Retry and Discard. Add a step for that list. (S8-11, S5i-4,
   S6-7)
9. **Folder types.**
   - Lay the folder file's types over the schema's lists once, in `readSchema`, and drop step 54.
   - The server reads the folder file's draft, then the published file, then the schema, so CUJ 1 works
     before "Save a version".
   - A published rename writes `folders.json`, building it from the schema if it is missing.
   - (S8-6, S5z-3, S9c-M17, S7d-M10)
10. **New-entry `type:` is written in the client.** `NewEntry`/`Edit.tsx` sets it with
    `setFrontmatterKey`, using `TreeFolder.type`. `routes/entries.ts` is not where it happens. (S9r-M15,
    S9c-M18)
11. **Folder file rules.**
    - Delete the drop rule; lines are never dropped on read.
    - Renaming an empty folder only changes its line.
    - Refuse a move while the queue holds records under the affected paths.
    - A folder with a pending rename has its settings and "new subfolder" turned off.
    - Restate the reason for Alternative M.
    - (S8-5/7, S5i-1/2, S7d-M4/M11, S9c-M20/M22)
12. **Moved notes in the tree.** Before publish, a moved note's tree link opens it at its old path, so it
    does not 404. (S9c-M19)
13. **Rename preview.** No new route. `POST /api/renames` makes the intent and returns `affected`, and
    Cancel deletes it. CUJ 2 is reworded to the counts that exist: entries moved (from the tree) and
    other entries whose links change. (S8-14 against S7d-M9, S9r-M12; stage 8's verdict is adopted)
14. **Top-ten mapping.** One table of the ten findings, each marked closed in 11a, 11b or 11c, or deferred
    to a named stage. Fixes-only 11a ships before the foundations. Map hover and selection (MP-1, MP-2)
    **move to stage 13** after MapPage is split. **The author must agree, because this departs from the
    brief.** (S8-9, S5z-4/5/6, S7s-M3, S6-4)
15. **Part 11a needs `Shell.tsx` and `App.tsx`.** These mount:
    - NewEntry;
    - the keys registry listener and the KeySheet;
    - the notices;
    - a login dialog over the page when the queue pauses on a 401.

    The connection, unsent and attention marks sit in the existing top bar until 11b. (S9r-M8, S9c-M11,
    S6-8)

16. **File list corrections.**
    - The map and chronicle `Save` bodies are in `routes/maps.ts` and `routes/chronicles.ts`.
    - `Maps.tsx` and `History.tsx` save directly today.
    - Delete and Discard live in `Edit.tsx`.
    - `op` is added to `saveFrom` and `serverChange`.
    - The tests are in `publish.test.ts` and `ai.test.ts`.
    - `ai/fields.ts:185` and `fields.test.ts` are affected.
    - `mergeItemLists` gets a key adapter.
    - Pages that use `useAsync` show `Progress` and `Problem`.
    - The logout step is missing.
    - Web tests need a DOM environment or stubs.
    - (S9r-M3/M4/M5/M13/M14/M16/M17, S9c-M4/M6/M9/M10/M12/M16/M21/M23/M24)
17. **E2E.**
    - SaveStatus keeps today's class names and texts (`.save-<state>`, `.ch-saving`).
    - Rebuild the list of specs to update from the real selectors: `.topnav`, `.menu`, `.new-entry`,
      `.tree-folder`, the Rename link, the strict-mode History link.
    - Add `shell` and `tree` to the desktop project's `testMatch` in `playwright.config.ts`.
    - (S9r-M10/M11, S9c-M13/M14/M15)
18. **Risks & Mitigations section.** Add it. It lists:
    - iOS eviction: the same exposure as today, handled in stage 15;
    - the fallback device id, kept in `localStorage`;
    - `versions/`, bounded because a merge clears it;
    - react-arborist with React 19, fixed row height and no touch drag, settled by a one-day spike with a
      plain-list fallback;
    - honest rollback wording: merge the kept copies before rolling back.
    - (S7st-M1, S7d-M16, S8-10/12, S7s-M1)
19. **Readability.**
    - A context paragraph linking the parent designs.
    - Three defined terms: unsent, unpublished, kept copy. "Version" is kept for "Save a version".
    - A one-line statement of the only-writer rule.
    - One trade-off sentence per rejected alternative.
    - Two added alternatives: queue keyed by draft id, and polling instead of the event stream.
    - (S8-13/15, S6-1..3/9..11, S7s-M6, S7st-M2, S7d-M17/M18)
20. **Dependencies and values.**
    - Name the versions and React 19 peer checks.
    - Give hex values for the text tokens and the 8 folder colours.
    - Give the list of icon names.
    - Validate the folder file's fields with zod.
    - Move the constants into the implementation plan.
    - (S9r-M16/M18, S9c-n30/31, S7d-n21, S5z-13)

### 🟢 Nits

- Keys:
  - four document listeners, plus the element `onKeyDown` handlers listed;
  - library keys appear in the "?" sheet as labels only;
  - Mod-i takes precedence over basicSetup's binding;
  - Esc then Tab is built into CodeMirror.
- Step 11 is removed, because there is nothing to allow.
- Step 61 comes before step 59.
- SITEMAP already lists the design.
- Name the frontier.md lines on the browser buffer.
- Verification names its pass criteria. The web workspace has no coverage threshold.
- Wording:
  - split step 24 into its parts;
  - one term each for "response" and "side bar";
  - quote UI strings exactly;
  - fix the emoji alignment in the diagram, and ⌘K against Ctrl+K;
  - add a "Covers: G…" line to each CUJ;
  - remove the "Drafted with EGM" footer.

## Rejected or deferred proposals (stage 8)

| Proposal                                                                             | Verdict                                   |
| ------------------------------------------------------------------------------------ | ----------------------------------------- |
| Queue intents (renames, deletes, comments) with `op`                                 | Rejected for stage 11; stage 15           |
| Translation layer for folder paths during pending renames                            | Rejected; guards instead                  |
| `empty: true` flag and import reconciler                                             | Rejected; the drop rule is deleted        |
| Kept copies for maps, chronicles and the folder file                                 | Deferred to stage 15                      |
| BroadcastChannel leader election, shared stream across tabs, rolling-median slowness | Rejected; Web Locks and one probe         |
| Rename dry-run endpoint                                                              | Rejected; the existing create-then-cancel |
| Dual-writing `content.v2` for rollback                                               | Rejected; honest wording                  |
| `navigator.storage.persist()` and its interface                                      | Deferred to stage 15                      |
| Moving MapPage onto `useItemFile`                                                    | Rejected for stage 11                     |

## Traceability

Source keys: S5z/S5i are the stage 5 zoom-out and inventive reviewers. S6 is comprehension. S7d/S7st/S7s
are design, structural and style. S8 is the intermediate zoom-out. S9r/S9c/S9s are readiness, codebase
and style. Each item above cites its sources, and the raw findings are in `.egm/review/`.
