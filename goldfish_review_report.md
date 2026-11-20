# Goldfish Annotated Review Report

**Target:** `docs/designs/frontier.md` (Detailed Implementation Plan), findings from Stage 9
(`implementation_readiness_report.md`). The earlier report on Stages 6 and 7 is in Git history.

Counts: 15 PROPOSE FIX (all Blockers and Majors), 0 CONTEST, 0 ESCALATE; of 9 Nits, 7 PROPOSE FIX and 2
DECLINE. Three proposals contain a choice the author may want to change; they are marked **Author's call**.

## Prioritized Findings & AI Suggestions

### R1. The API is not defined - Severity: Blocker

*   ***AI Suggestion:*** PROPOSE FIX
*   ***Proposed Edit:*** Add a route table: method, path, request body, response, errors, stage. JSON
    throughout; errors as `{ error: { code, message } }` with a fixed list of codes. Add the Publish
    sequence as two calls. `POST /api/publish/plan` fetches, classifies every selected draft and returns
    a plan: ready drafts, clean merges with merged text, conflicts, rename rewrite lists, and a plan id
    tied to the `main` commit it was computed against. `POST /api/publish/confirm` sends the plan id, the
    confirmed merge ids and the message; the server refuses it with `main_moved` if `main` has changed
    since the plan, otherwise builds and pushes the commit. The server holds a plan in memory for 15
    minutes; nothing else is held between the two calls.

### R2. The stored form of drafts is not defined - Severity: Blocker

*   ***AI Suggestion:*** PROPOSE FIX
*   ***Proposed Edit:*** Specify `/data/state/drafts/<id>/` holding `record.json` and `content` (text or
    image bytes); a second version from another device is `content.v2` plus `record.v2.json` in the same
    folder; rename intents in `/data/state/drafts/renames/<id>.json`. Give the record's fields with types
    and one worked example. Ids are 12-character random strings. The browser store has one table,
    `drafts`, keyed by draft id, holding text, revision and a "sent" flag. The record types live in
    `packages/schema`.

### R3. The Git mechanics are left open - Severity: Blocker

*   ***AI Suggestion:*** PROPOSE FIX
*   ***Proposed Edit:*** State the commands. Commit without touching the working copy: a temporary index
    file (`GIT_INDEX_FILE`), `read-tree` of `main`, `hash-object -w` and `update-index --cacheinfo` per
    file, `write-tree`, `commit-tree`, then `push origin <commit>:refs/heads/main`. Merge:
    `git merge-file -p --diff3` on three temporary files; "overlap" means it exits with conflicts.
    Authentication: `@octokit/auth-app` produces an installation token, renewed before it expires and
    passed to `git` for each call through an `http.extraheader` setting, never written to disk. Commit
    author: `COMMIT_AUTHOR_NAME` and `COMMIT_AUTHOR_EMAIL` variables (the author's); committer: the App's
    bot identity. One lock around every Git operation, held at most 60 seconds, after which the operation
    fails with `git_busy`.

### R4. Link resolution does not cover forms that exist in the vault - Severity: Blocker

*   ***AI Suggestion:*** PROPOSE FIX
*   ***Proposed Edit:*** Extend rule 1 in the architecture and item 20: a trailing `.md` is ignored; path
    matching ignores letter case, and if two paths differ only in case the link is ambiguous; a path to a
    file that is not a note, or inside an excluded folder, resolves to nothing and is shown as an external
    file reference, not as a missing entry; a standard Markdown image with a relative path resolves
    against the folder of the note that contains it.

### R5. Libraries and settings are not chosen - Severity: Major

*   ***AI Suggestion:*** PROPOSE FIX
*   ***Proposed Edit:*** A dependency table per workspace. Server: `fastify`, `@fastify/static`,
    `@fastify/secure-session`, `@fastify/rate-limit`, `@fastify/multipart`, `argon2`, `sharp`,
    `file-type`, `minisearch`, `@octokit/auth-app`, `@aws-sdk/client-s3`. Vault package: `yaml`. Schema
    package: `zod`. Web: `react`, `react-router`, CodeMirror 6 packages, `unified` with `remark-parse`,
    `remark-gfm` (tables), `remark-rehype`, `rehype-sanitize`, `rehype-react`, `idb`, `diff`. Tests:
    `vitest`, `@vitest/coverage-v8`, `@playwright/test`. Settings: session lasts 30 days; login limited
    to 5 attempts per 15 minutes per address; cookie same-site mode `lax`; the content security policy
    written out in full; backup variables `BACKUP_S3_ENDPOINT`, `BACKUP_S3_BUCKET`,
    `BACKUP_S3_ACCESS_KEY`, `BACKUP_S3_SECRET_KEY`.

### R6. Backup and restore are under-specified - Severity: Major

*   ***AI Suggestion:*** PROPOSE FIX
*   ***Proposed Edit:*** The server marks state as changed on every write and runs a copy 5 minutes after
    the first unsaved change; a full copy runs at 03:00 server time. Bucket layout:
    `latest/` mirrors `/data/state`, and `nightly/<date>/` keeps 14 days. One background job runs at a
    time through a single queue shared with image resizing. Add `apps/server/src/cli/restore.ts`, which
    fills an empty `/data/state` from `latest/` or a named night.

### R7. The file list is incomplete - Severity: Major

*   ***AI Suggestion:*** PROPOSE FIX
*   ***Proposed Edit:*** Add `package-lock.json`, `playwright.config.ts`, `vitest.config.ts` per
    workspace with the coverage thresholds, a `typecheck` script, tests for `packages/schema`, for search
    and for the entry routes. Move the baseline script into `packages/vault/scripts/`. Run unit tests in
    all workspaces. Renumber every item in order under its own package heading and move entries that are
    not files into prose.

### R8. The fixture vault does not contain the cases its tests need - Severity: Major

*   ***AI Suggestion:*** PROPOSE FIX
*   ***Proposed Edit:*** Replace the description of item 25 with a table of fixture files by path and the
    case each covers, adding every case the reviewers listed.

### R9. Behaviours in the architecture have no home in the plan - Severity: Major

*   ***AI Suggestion:*** PROPOSE FIX
*   ***Proposed Edit:*** Add: `apps/web/src/links/AmbiguousLink.tsx` (stage 2); an "Attention" screen
    listing ambiguous image names, files with mixed endings and appendix links broken by a rename, with
    its route (stage 1); folder suggestion for create-from-link is the folder of the note containing the
    link; a colliding image name gets ` 2`, ` 3` before the extension, checked across the whole vault and
    ignoring letter case; the append-only guard is enforced in `paths.ts` and checked again in
    `drafts.ts`. `99 Appendices/03 Recycle Bin` is treated like any appendix folder and is left out of
    autocomplete and search unless asked for.

### R10. The stage split is not settled inside files - Severity: Major

*   ***AI Suggestion:*** PROPOSE FIX
*   ***Proposed Edit:*** Mark every item S1 or S2, and split the items that mix both. Decide: image
    serving and resizing is S1 (reading needs it), upload is S2; create and delete are S1 and are added to
    the stage 1 journeys; rename logic in `packages/vault` and the server is S1 with its tests, its screen
    is S2; the properties panel is S2; search is S2 with its own timed test. Add a stage 1 completion
    test: the stage 1 goal checks pass and the author has published one real edit to the vault from the
    deployed app.

### R11. Goal checks cite tests that do not exist - Severity: Major

*   ***AI Suggestion:*** PROPOSE FIX
*   ***Proposed Edit:*** Add tests for live preview and full-text search; timed tests for search (100 ms
    server time on the fixture scaled to 500 notes), index build (5 seconds) and typing (50 ms in a
    50,000-word editable fixture note); a webhook test for a valid push leading to a reindex. Coverage is
    enforced by Vitest's thresholds in CI. "4G" is 9 Mbit/s down, 170 ms latency.

### R12. Folder notes and image names: counts and rules - Severity: Major

*   ***AI Suggestion:*** PROPOSE FIX
*   ***Proposed Edit:*** A folder note is a note whose name equals its folder's name, nothing else; 73
    exist. The five near-matches are ordinary notes and are listed once for the author, who may rename
    them. Image names are compared ignoring letter case, giving 12 duplicated names.

### R13. How an embedded image's size is written is undefined - Severity: Major

*   ***AI Suggestion:*** PROPOSE FIX
*   ***Proposed Edit:*** Use Obsidian's own form, `![[name.png|300]]`, where the number is a width in
    pixels. The link parser reads it; "resizing" in stage 2 means setting this number by dragging.

### R14. The frontmatter library's behaviour is stated as fact - Severity: Major

*   ***AI Suggestion:*** PROPOSE FIX
*   ***Proposed Edit:*** State the fallback: if the real-vault test shows the `yaml` package changing any
    other line, `frontmatter.ts` edits the key's own lines directly and uses `yaml` only to read.

### R15. The link baseline copies real note titles into the app's repository - Severity: Major

*   ***AI Suggestion:*** PROPOSE FIX. **Author's call.**
*   ***Justification:*** The baseline is data about the vault, so it belongs with the vault.
*   ***Proposed Edit:*** Keep the baseline in the vault repository at `.frontier/baseline/links.json`,
    with the vault commit it was made from recorded inside it. This makes `.frontier/` appear in stage 1
    after all, with this one file. The real-vault test reports "baseline is from another commit" and
    lists the differences. The alternative is to accept real note titles in the `frontier` repository.

### Nits proposed for fixing

*   ***AI Suggestion:*** PROPOSE FIX
*   Correct the count to 428 lore notes. State that one editable note has Windows line endings. Add a
    50,000-word editable fixture note for the typing target. State behaviour for malformed frontmatter
    (the note opens as plain text with a warning and its fields are not indexed). State that adding or
    removing a note re-resolves links by that name. Fix the MiniSearch sentence and item 38's wording.
    Replace unmeasurable wording with figures.
*   **Author's call:** Obsidian has no attachment folder set, so images pasted in Obsidian land in the
    vault root. The plan will recommend setting Obsidian's attachment folder to `99 Appendices/01 Images`;
    that is a change to the vault's Obsidian settings and is left to the author.
*   **Author's call:** search field weights (title 3, aliases 3, headings 2, body 1) and a snippet of 160
    characters are proposed starting values.

### Nits declined

*   ***AI Suggestion:*** DECLINE
*   Re-wrapping long lines. Renaming "two steps" in the Dockerfile item is folded into the renumbering,
    not treated separately.
