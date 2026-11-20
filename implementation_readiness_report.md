# Goldfish Review Report: Stage 9, Implementation Readiness Test

**Target:** `docs/designs/frontier.md` (lines 1029-1359, the Detailed Implementation Plan for stages 1 and 2)

## Reviewer Status

| Reviewer | Status | Blocker | Major | Nit |
| --- | --- | --- | --- | --- |
| `egm-implementation-readiness` | completed | 3 | 7 | 5 |
| `egm-codebase-details` | completed | 2 | 9 | 5 |
| `egm-style` | completed | 0 | 5 | 4 |

After merging duplicates: 4 Blocker, 11 Major, 9 Nit. Verdict from both technical reviewers: the file list
and the order of work are sound, but the plan does not yet pass the rule that an implementer should not
have to make an impactful decision.

## Confirmed against the vault

`99 Appendices/01 Images` exists and holds all 77 embedded images. `ezob-satellite.png` is a JPEG. The only
duplicated note names are `Yagon` and `Common Ezobian`. No callouts, tags, block references or
escaped-pipe links exist. 20 files use Windows line endings and none mixes the two kinds.

## Prioritized Findings (Blockers -> Major -> Nits)

### R1. The API is not defined - Severity: Blocker

* **Reviewer Lens:** `egm-implementation-readiness`, `egm-codebase-details`
* **Affected Scope:** items 14, 49-55, 66
* **Discrepancy Description**: No route paths, methods, request or response shapes, or error codes.
  Publish is a conversation in several steps (fetch, show clean merges to confirm, re-show a changed
  rename list, hold conflicts, report a rejected push), and nothing says what the server holds between
  "merge shown" and "merge confirmed".
* **Rationale & Recommendation**: Add a route table (method, path, body, response, errors, stage) and the
  Publish sequence with its states.

### R2. The stored form of drafts is not defined - Severity: Blocker

* **Reviewer Lens:** `egm-implementation-readiness`
* **Affected Scope:** items 37, 38, 83, 99d
* **Discrepancy Description**: Missing: the folder layout under `/data/state/drafts`, file names, the
  record's fields, how ids are made, how a second version from another device is stored and later merged
  or discarded, how rename intents are stored, and the layout of the browser's store. Backup, restore and
  crash recovery depend on these.
* **Rationale & Recommendation**: Specify the layout and records, with one worked example.

### R3. The Git mechanics are left open - Severity: Blocker

* **Reviewer Lens:** `egm-implementation-readiness`, `egm-codebase-details`
* **Affected Scope:** items 34, 42
* **Discrepancy Description**: No method for building a commit without changing the working copy; no
  named merge tool or definition of "overlap"; no method for authenticating as the GitHub App and getting
  its token to `git`; no source for the commit's author and committer name and email; no lock scope or
  timeout.
* **Rationale & Recommendation**: Fix the exact commands and the authentication library.

### R4. Link resolution does not cover forms that exist in the vault - Severity: Blocker

* **Reviewer Lens:** `egm-codebase-details`
* **Affected Scope:** item 20; link resolution rule in the architecture
* **Discrepancy Description**: "A link with a path resolves to that path" is undefined for: about 60 path
  links that end in `.md` (all in `99 Appendices/04 AI Conversations`); a path that differs from the file
  only in letter case; links into excluded folders or to files that are not notes (`.gemini/...`,
  `helper.py`); and 8 standard Markdown images with relative paths such as `../Maps/...`.
* **Rationale & Recommendation**: State the rule for a `.md` ending, letter case, missing or excluded
  targets, and relative paths.

### R5. Libraries and settings are not chosen - Severity: Major

* **Reviewer Lens:** both technical reviewers
* **Discrepancy Description**: No library is named for: request validation, HTML sanitising, tables in
  the Markdown renderer, the storage bucket client, signed cookies, rate limiting, file upload, the
  browser store, showing differences, detecting image type, test coverage. Unset: session lifetime,
  rate-limit thresholds, the cookie's same-site mode, the exact content security policy, the names of the
  backup variables.
* **Rationale & Recommendation**: Add a dependency table per workspace and the full variable list.

### R6. Backup and restore are under-specified - Severity: Major

* **Reviewer Lens:** `egm-implementation-readiness`
* **Discrepancy Description**: How changes are detected and delayed, the nightly time, the layout in the
  bucket, how long copies are kept, and how "one job at a time at low priority" is done. There is no
  restore command, though the README must explain restoring and a test exercises it.

### R7. The file list is incomplete - Severity: Major

* **Reviewer Lens:** both technical reviewers, `egm-style`
* **Discrepancy Description**: Not listed: `package-lock.json`, `playwright.config.ts`, test and coverage
  configuration, a type-check script, any test for `packages/schema`, for search or for the entry routes.
  The baseline script belongs to no workspace. The sanitiser test sits in `apps/web`, which the stated
  unit-test command does not run. Item numbers 11 and 63c are missing; several items sit under the wrong
  heading.

### R8. The fixture vault does not contain the cases its tests need - Severity: Major

* **Reviewer Lens:** both technical reviewers
* **Discrepancy Description**: Missing from item 25: a file with mixed line endings (needed by two tests);
  any image, including a duplicated image name and a JPEG named `.png`; path links ending in `.md`, with
  mismatched case, and to excluded or non-note targets; same-note heading links; angle-bracket Markdown
  images; a note with both Windows line endings and frontmatter (no real note has both, so only the
  fixture can test it); two lore notes with one name, since both real duplicates fall under the appendix
  tie-break; notes at the vault root and files that are not Markdown.
* **Rationale & Recommendation**: List the fixture files by path with the case each one covers.

### R9. Behaviours in the architecture have no home in the plan - Severity: Major

* **Reviewer Lens:** `egm-implementation-readiness`
* **Discrepancy Description**: The picker for an ambiguous link; the lists of ambiguous image names,
  mixed-ending files and appendix links broken by a rename; the rule for suggesting a folder when creating
  from a link; the number format for an image whose name exists; the module that enforces the append-only
  guard; the treatment of the recycle bin folder, which holds the duplicate `Common Ezobian.md`.

### R10. The stage split is not settled inside files - Severity: Major

* **Reviewer Lens:** all three
* **Discrepancy Description**: Only seven items carry a stage mark. Unsettled: rename logic in stage 1
  files; image serving (needed to read entries in stage 1, listed under stage 2); create and delete in the
  stage 1 tree but not in the stage 1 journeys; the properties panel in neither list; search in stage 2
  but timed in a stage 1 test. Stage 1 has no completion test of its own.

### R11. Goal checks cite tests that do not exist - Severity: Major

* **Reviewer Lens:** all three
* **Discrepancy Description**: Goal G5 requires a test per parity item; none exists for live preview or
  full-text search. The 100 ms search target, the 5-second index build and the 50 ms typing target have no
  test. The webhook is tested only for a bad signature. The coverage requirement names no tool or place
  of enforcement. "4G" has no stated speed.

### R12. Folder notes and image names: counts and rules - Severity: Major

* **Reviewer Lens:** `egm-codebase-details`
* **Discrepancy Description**: 73 notes are named exactly after their folder, not 77. Five more act as
  folder notes under a different name (`Orphans/The Orphans.md`, `Ru'una/Ru'una (Moon).md`,
  `Ataemmia/Ataemia.md`, `Scorched Realm/The Scorched Realm.md`, `Derdaman Sun/The Derdaman Sun.md`).
  Duplicated image names are 11 only if letter case counts; 12 if not. All duplicates sit outside the
  upload folder, so "a name that already exists" must mean anywhere in the vault.

### R13. How an embedded image's size is written is undefined - Severity: Major

* **Reviewer Lens:** `egm-codebase-details`
* **Discrepancy Description**: All 77 embeds are `![[name.png]]` with no size part. "Image upload and
  resizing" names no written form, and the link parser does not read one.

### R14. The frontmatter library's behaviour is stated as fact - Severity: Major

* **Reviewer Lens:** `egm-codebase-details`
* **Discrepancy Description**: The `yaml` package rewrites a document on output and does not promise to
  leave other lines alone. Name the fallback if the real-vault test fails: editing the key's lines
  directly. Frontmatter in use is only `aliases` lists (31 notes) and one appendix note.

### R15. The link baseline copies real note titles into the app's repository - Severity: Major

* **Reviewer Lens:** `egm-codebase-details`
* **Discrepancy Description**: Item 29 commits the vault's titles and link graph into `frontier`, while
  item 25 forbids real lore in the fixture. Decide this, and say where the recorded commit is kept and
  what the test does when the vault is at another commit.

### Nits

* **N1.** 428 notes are under the numbered folders, not "about 500" (`egm-codebase-details`).
* **N2.** Of the 20 files with Windows line endings, 17 are append-only appendix files and 2 are in an
  excluded folder; one is editable (`egm-codebase-details`).
* **N3.** Obsidian's settings name no attachment folder, so images pasted in Obsidian land in the vault
  root, not in `99 Appendices/01 Images` (`egm-codebase-details`).
* **N4.** The largest note is an append-only appendix file, so the typing target is never tested on a file
  that can be edited (`egm-codebase-details`).
* **N5.** Behaviour for malformed frontmatter is unstated; adding or removing a file changes how links in
  other notes resolve; search weights and snippet length are unset (`egm-implementation-readiness`).
* **N6.** "No search library (search runs on the server, with MiniSearch)" reads as a contradiction; item
  38 "rejects ... and keeps" (`egm-style`).
* **N7.** Unmeasurable wording: "clear message", "within the set delay", "about a second", "rate limit
  works" (`egm-style`).
* **N8.** Entries that are not files (items 8, 9, 100) belong in prose; "two steps" in the Dockerfile item
  should not reuse a word used for project stages (`egm-style`).
* **N9.** `SITEMAP.md` is marked Modify but stages 1 and 2 give it no change (`egm-implementation-readiness`).
