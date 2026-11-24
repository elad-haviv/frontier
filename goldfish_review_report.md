Status: resolved (all 19 proposed fixes and item 14 accepted by the author on 2026-11-22; applied to the design)

# Goldfish Annotated Review Report

**Target:** [`docs/designs/stage-11-foundations-shell-tree.md`](docs/designs/stage-11-foundations-shell-tree.md)
(full file). The findings are the 20 action items in
[`consolidated_review_report.md`](consolidated_review_report.md); the raw notes are in `.egm/review/`.

**Count:** 19 PROPOSE FIX, 1 ESCALATE (item 14, your decision), 0 CONTEST. The nits are declined, except
those folded into item 19.

## Prioritized Findings & AI Suggestions

### [1] [design, intermediate zoom-out, codebase] - Severity: Blocker

- **Affected Scope:** Technical Plan §2, CUJ 3, steps 5 and 12.
- **Discrepancy:** The phone's save after the laptop publishes is refused as `invalid`
  (`drafts.ts:200`) before any base check runs.
- _**AI Suggestion:**_ PROPOSE FIX
- _**Justification:**_ Confirmed in the code. CUJ 3 is the main reason for the queue.
- _**Proposed Edit:**_
  - In §2, a rule table for the case where there is no draft and the revision is above 0:

    | `baseBlob`                      | Result                         |
    | ------------------------------- | ------------------------------ |
    | differs                         | kept copy and `stale_revision` |
    | matches                         | fresh draft                    |
    | missing                         | today's `invalid`              |
    | the path was deleted or renamed | kept copy and `stale_revision` |

  - The `op` check runs first.
  - `PublishedInfo` gains `text`.
  - `clearPublished` keeps a draft that has kept copies.
  - Step 12 gets a test of the whole CUJ 3 sequence.

### [2] [readiness, codebase] - Severity: Blocker

- **Affected Scope:** §1, steps 5, 6 and 14.
- **Discrepancy:** The device header becomes a file name without validation, so it can point outside the
  folder. Fetch also refuses header values that are not Latin-1.
- _**AI Suggestion:**_ PROPOSE FIX
- _**Proposed Edit:**_
  - The device id is made with `makeId` and checked against `Id`; anything else is refused as `invalid`.
  - A save without the header is kept under `unknown`.
  - The device name is a short summary of the user agent, made once and kept in `meta`. It is sent
    URI-encoded and cut to 40 characters.

### [3] [design, intermediate zoom-out] - Severity: Blocker

- **Affected Scope:** §6 Delete row, CUJ 2, step 56.
- **Discrepancy:** A delete draft replaces an unpublished edit with `""`, and Undo then loses that edit.
- _**AI Suggestion:**_ PROPOSE FIX (simplified)
- _**Proposed Edit:**_
  - A folder delete is refused while any file under it has an unpublished draft or is an image. The
    refusal reads "Save a version or discard first".
  - There is no Undo for a delete. Discard in the unpublished list reverses it.
  - `POST /api/folders/delete` gets a request and response schema and named refusal codes.

### [4] [design, intermediate zoom-out, readiness, codebase, inventive] - Severity: Blocker

- **Affected Scope:** §1 record table and the item-file row; steps 15 and 22.
- **Discrepancy:** Map and chronicle saves need `link` and get back a value the server changed. A sender
  with no page open cannot merge them.
- _**AI Suggestion:**_ PROPOSE FIX
- _**Proposed Edit:**_
  - The record gains `kind` and `link`. Links from two changes in a row are combined by feature or
    span id.
  - The map sender and the chronicle sender call `mergeMaps` or `mergeChronicles` with the stored
    `base`.
  - `subscribe(key)` gives an open page the server's value and `unlinked`.
  - On a clash this device's side is kept, and the notice names the items that clashed. The history
    link is removed. Kept copies of item files wait for stage 15.

### [5] [readiness, codebase, design] - Severity: Blocker

- **Affected Scope:** §2 "Needs attention", step 9.
- **Discrepancy:** `VaultIndex` cannot see drafts, and the snapshot has no count of kept copies.
- _**AI Suggestion:**_ PROPOSE FIX
- _**Proposed Edit:**_
  - The kept-copy list is built in `routes/status.ts`.
  - The count is added to `StatusSnapshot.attention` (in `packages/schema/src/status.ts` and
    `status/status.ts`).
  - A status event is sent when a kept copy is stored.
  - Step 9 changes to point at these files.

### [6] [intermediate zoom-out, design, comprehension] - Severity: Major

- **Affected Scope:** G4 and §1.
- _**AI Suggestion:**_ PROPOSE FIX
- _**Proposed Edit:**_ G4 lists what the queue carries: entry text (including delete drafts), maps,
  chronicles and the folder file. Comments, renames, folder delete and apply-type are direct calls and
  are refused while offline. Stage 15 decides whether they join the queue.

### [7] [intermediate zoom-out, design, inventive] - Severity: Major

- **Affected Scope:** §1 "Sending", §3.
- _**AI Suggestion:**_ PROPOSE FIX
- _**Proposed Edit:**_
  - One sender at a time, through `navigator.locks`.
  - When the stream fails, fetch `/api/status` once.
  - The server sends a heartbeat every 20 seconds.
  - Write to IndexedDB on every `put`.
  - Each record has its own back-off, and the sender skips records that need attention.
  - Drop the `slow` state.
  - The heartbeat goes into a new step for `routes/status.ts`.

### [8] [intermediate zoom-out, inventive, comprehension] - Severity: Major

- **Affected Scope:** §1 note-stale row, G4.
- _**AI Suggestion:**_ PROPOSE FIX
- _**Proposed Edit:**_
  - A note's `stale_revision` answer means the server has stored the kept copy, so the record is
    dropped and attention links to `/versions/:id`.
  - Records refused with another 4xx error go to a small list, opened from the unsent count, with
    Retry and Discard. The new step is `components/Unsent.tsx`.

### [9] [stage 5 zoom-out, intermediate zoom-out, codebase, design] - Severity: Major

- **Affected Scope:** §7, steps 54 and 58.
- _**AI Suggestion:**_ PROPOSE FIX
- _**Proposed Edit:**_
  - Folder types are laid over the schema in `readSchema`, and step 54 is dropped.
  - The types are read from the folder file's draft first, then the published file, then the schema.
  - A published rename writes `folders.json` if it does not exist yet.
  - `ai/fields.ts:185` and `fields.test.ts` are listed.

### [10] [readiness, codebase] - Severity: Major

- **Affected Scope:** step 59.
- _**AI Suggestion:**_ PROPOSE FIX
- _**Proposed Edit:**_ The `type:` line is written on the client, in NewEntry/`Edit.tsx`, with
  `setFrontmatterKey` and `TreeFolder.type`. It is removed from the entries route.

### [11] [intermediate zoom-out, inventive, design, codebase] - Severity: Major

- **Affected Scope:** §6 "Keyed by path", step 55, Alternative M.
- _**AI Suggestion:**_ PROPOSE FIX
- _**Proposed Edit:**_
  - Delete the drop rule. A line whose folder was removed outside Frontier (import, or GitHub and
    sample modes) shows as an empty folder that can be deleted.
  - Renaming an empty folder is a change to its line only.
  - A move is refused while queued records sit under the folder.
  - A folder with a pending rename has its settings and "new subfolder" turned off.
  - Alternative M is restated.

### [12] [codebase] - Severity: Major

- **Affected Scope:** §6 "The tree shows what is pending", step 59.
- _**AI Suggestion:**_ PROPOSE FIX
- _**Proposed Edit:**_ A moved note is shown at its new place, but its link opens the old path until the
  version is saved.

### [13] [intermediate zoom-out vs design and readiness] - Severity: Major

- **Affected Scope:** CUJ 2, §6 Rename row.
- _**AI Suggestion:**_ PROPOSE FIX (the intermediate zoom-out's simpler form)
- _**Justification:**_ `POST /api/renames` already returns `affected`, and `DELETE` cancels it. A
  dry-run route would duplicate that.
- _**Proposed Edit:**_ The intent is created when the folder is dropped. The confirmation shows the
  number of entries moved (from the tree) and the number of other entries whose links change
  (`affected`). Cancel deletes the intent, and Undo in the toast does the same.

### [14] [stage 5 zoom-out, intermediate zoom-out, structural, style, comprehension] - Severity: Major

- **Affected Scope:** G1, §8, Overview, steps 24 and 25.
- _**AI Suggestion:**_ ESCALATE: the author decides. It departs from the brief.
- _**Proposed Edit:**_
  - A table of all ten review items, each marked closed in 11a, 11b or 11c, or deferred to a named
    stage.
  - 11a is split into 11a-1 (fixes only: contrast, phone map header, reading font, Delete into "⋯",
    icon names) and 11a-2 (foundations).
  - **Map hover and selection (MP-1, MP-2) move to stage 13, after MapPage is split.**

### [15] [readiness, codebase, comprehension] - Severity: Major

- **Affected Scope:** Part 11a.
- _**AI Suggestion:**_ PROPOSE FIX
- _**Proposed Edit:**_
  - `Shell.tsx` and `App.tsx` join 11a. They mount NewEntry, the keys listener, the KeySheet and the
    notices.
  - A new `components/LoginDialog.tsx` opens over the page on a 401.
  - The connection, unsent and attention marks sit in the current top bar until 11b.

### [16] [readiness, codebase] - Severity: Major

- **Affected Scope:** steps 2–37.
- _**AI Suggestion:**_ PROPOSE FIX
- _**Proposed Edit:**_ Correct the file list:
  - route-local `Save` bodies;
  - `Maps.tsx` and `History.tsx`;
  - Delete and Discard in `Edit.tsx`;
  - `op` on `saveFrom` and `serverChange`;
  - `publish.test.ts` and `ai.test.ts`;
  - the `mergeItemLists` key adapter;
  - the pages that use `useAsync`;
  - the logout step;
  - happy-dom for the web tests.

### [17] [readiness, codebase] - Severity: Major

- **Affected Scope:** steps 40–50 and 67, plus `playwright.config.ts`.
- _**AI Suggestion:**_ PROPOSE FIX
- _**Proposed Edit:**_
  - SaveStatus keeps the `.save-<state>` and `.ch-saving` classes and texts.
  - The list of specs is rebuilt from the real selectors:
    - `.topnav` in passkey;
    - `.menu`, `.new-entry` and the dialog in write;
    - `.menu` and `.tree-folder` in reader;
    - the Rename link in navigate;
    - the strict History link in library.
  - The desktop `testMatch` gains `shell`, `tree` and `editor`.

### [18] [structural, design, intermediate zoom-out, style] - Severity: Major

- **Affected Scope:** the whole document; NFR rollback.
- _**AI Suggestion:**_ PROPOSE FIX
- _**Proposed Edit:**_ A new Risks & Mitigations section covering:
  - eviction;
  - the fallback device id kept in `localStorage`;
  - the bound on kept copies;
  - a one-day react-arborist spike, with a plain-list fallback;
  - honest rollback wording, with a step to merge kept copies before rolling back.

### [19] [comprehension, style, structural, design] - Severity: Major

- **Affected Scope:** the whole document.
- _**AI Suggestion:**_ PROPOSE FIX
- _**Proposed Edit:**_
  - A context paragraph.
  - A short Terms section: unsent, unpublished, kept copy, draft, revision, rename intent.
  - "Version" is used only for "Save a version".
  - One line stating the only-writer rule.
  - Each rejected alternative leads with its trade-off and links the brief.
  - Two alternatives are added.
  - The diagram uses ASCII only.
  - Each CUJ gets a "Covers:" line.

### [20] [readiness, codebase, design, stage 5 zoom-out] - Severity: Major

- **Affected Scope:** §4, §6, steps 13 and 37.
- _**AI Suggestion:**_ PROPOSE FIX
- _**Proposed Edit:**_
  - Version ranges are named, and the React 19 peers are checked during the spike.
  - The text-token hex values are worked out against `--paper` in light and dark and stated.
  - The 8 folder colours and about 60 icon names are listed in step 51.
  - The zod schema covers `PUT /api/folders`.
  - The constants move into the plan.

### Nits - DECLINE, except those folded into item 19

The nits are recorded in the consolidated report. These are applied as they cost nothing:

- the count of key listeners;
- step 11 removed;
- step 61 placed before step 59;
- the SITEMAP step removed;
- the frontier.md lines named;
- the footer removed.
