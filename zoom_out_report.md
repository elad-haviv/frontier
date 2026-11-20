# Goldfish Review Report: Stage 5, Initial Zoom Out

**Target:** `docs/designs/frontier.md` (lines 1-1059)

## Reviewer Status

| Reviewer | Status |
| --- | --- |
| `egm-zoom-out` | completed |
| `egm-inventive-catalyst` | completed |

Totals after merging duplicates: 1 Blocker, 14 Major, 11 Nit. Findings raised by both reviewers are marked
"both".

## What holds up

Both reviewers found these sound: files as canon; drafts are not commits; one container; a rebuildable
in-memory index at 500 notes; the `git` program behind one gateway module; byte-preserving frontmatter
edits; optional calendar conversion; deferring stages 3 to 9 to their own designs. The calendar assumptions
match the vault notes, and the rules match `AGENTS.md`.

## Prioritized Findings (Blockers -> Major -> Nits)

### B1. The map renderer decision rests on reuse that does not exist - Severity: Blocker

* **Reviewer Lens:** both (`egm-zoom-out` Blocker, `egm-inventive-catalyst` Major)
* **Affected Scope:** decision table (line 312), Maps: Renderer (541-554), `packages/geo` (620), alternatives
  (701-707)
* **Discrepancy Description**: The design says projections and inverse projections are "taken from
  `map-reprojector`". Checked against the code: `projections.ts` is a 24-line list that hands every
  projection to the `d3-geo` library. `reprojection.worker.ts` has hand-written inverse maths for two
  projections only (globe and equirectangular), runs on the processor, and assumes a full-globe source
  image. `pixelMapper.ts` is an older copy of the same loop. The design draws in a WebGL shader, where
  d3's JavaScript cannot run, so each projection needs new shader maths, and Robinson and Winkel Tripel
  have no closed formula. The design also does not say how one shader reads from many tiles at once.
  MapLibre and Leaflet were rejected partly because the custom option "builds on that maths".
* **Rationale & Recommendation**: State the real reuse: d3-geo for projecting markers, lines and areas and
  for hit testing, plus two inverse formulas as a starting point. Choose a drawing method that needs only
  forward projection, which d3 has for every projection: draw each image tile as a mesh whose corners are
  projected. Keep d3-geo for lines and areas, since it already handles great circles and the edges of the
  globe. Allow small libraries for gestures and hit testing; the author chose a custom renderer, not zero
  libraries. Put the corrected cost back to the author, or leave the drawing method as an open question
  for the stage 4 design.

### M1. The nine stages are never listed - Severity: Major

* **Reviewer Lens:** both
* **Affected Scope:** lines 35-40 and every later mention of a stage number
* **Discrepancy Description**: The document refers to "nine build stages listed in `concepts_brief.md`",
  a file that was removed. Stages 6 and 7 are never described.
* **Rationale & Recommendation**: Add a stage table: number, name, what it delivers, which goals it closes.

### M2. The document disagrees with itself on where unapproved material lives - Severity: Major

* **Reviewer Lens:** both
* **Affected Scope:** answered Q7 (190-192), decision table (310), data table (358-361), inbox (455-476)
* **Discrepancy Description**: The Q7 answer says a discovery "stays in Frontier's own store". The
  architecture puts discoveries on `frontier/` branches in the canon repo. The inbox rule "any branch
  other than `main` is a proposal" also matches `frontier/` branches and stray branches. Accepting an
  agent proposal "publishes one commit on `main`" in one place and "copies to drafts, nothing reaches
  `main` except through Publish" in another.
* **Rationale & Recommendation**: Make the four places agree. Limit the agent inbox to the `proposal/`
  prefix. State once that accepting always produces drafts.

### M3. Proposals as branch snapshots go stale and are heavy for small changes - Severity: Major

* **Reviewer Lens:** both
* **Affected Scope:** decision table (310), inbox (462-476), unconfirmed proposals in views (519-525)
* **Discrepancy Description**: A one-key field proposal is stored as a full copy of the entry on a branch
  forked from an older `main`. Compared with today's `main` it shows every later change as a reversal,
  and accepting it overwrites newer canon or becomes a conflict. Each tap in exploration becomes a commit
  and a push to GitHub. The "not proposed again after rejection" memory has no home once the branch is
  deleted. Concept art for discoveries is only on the server disk, so "discoveries survive disk loss" is
  only half true.
* **Rationale & Recommendation**: Two options were proposed. (a) Keep Frontier's own proposals and
  discoveries as files in `/data/state`, backed up, and use branches only for outside agents; this
  reverses the author's storage choice. (b) Keep them in Git but store each proposal as a small list of
  operations (set this field, insert this text, create this file) applied to current `main` at accept
  time, saved once per session, under a hidden ref namespace that does not show as branches. For agent
  branches, compare against the point where the branch forked and merge three ways. This is the author's
  decision.

### M4. Publish conflicts are whole-file and manual - Severity: Major

* **Reviewer Lens:** `egm-inventive-catalyst`
* **Affected Scope:** Git gateway: Publish, Conflict (379-385), CUJ 3, CUJ 4
* **Discrepancy Description**: Any change to a file on `main` forces a hand merge, even far from the
  author's edit, and on a phone. A rename touching 20 files is blocked if an agent touched one. The text
  does not say whether the other drafts in the same Publish still go through.
* **Rationale & Recommendation**: The base version is already recorded, so run a three-way merge. When it
  is clean, show the result for one-tap confirmation; never apply it unseen. Store a rename as an intent
  and work out its link rewrites at Publish time. State that conflicted drafts are held back and the rest
  proceed, except a group that must stay together.

### M5. Agents pushing to `main` are detected only after Hindsight has ingested - Severity: Major

* **Reviewer Lens:** `egm-inventive-catalyst`
* **Affected Scope:** lines 478-480, goal G8
* **Discrepancy Description**: `main` is left unprotected because Obsidian pushes to it. A push by an
  agent is ingested by Hindsight before Frontier shows "arrived unreviewed". Telling agents from Obsidian
  by commit author is weak if agents use the author's token.
* **Rationale & Recommendation**: Give agents their own GitHub identity and add a rule that only the
  author and Frontier may update `main`. Whether such rules are available on this repository's plan was
  not checked.

### M6. Build order serves the fourth pain before the first - Severity: Major

* **Reviewer Lens:** `egm-zoom-out`
* **Affected Scope:** The Problem (50-53), G5 (84-87), implementation plan (808-1039)
* **Discrepancy Description**: The main pain is that places and events cannot be followed. Stages 1 and 2
  rebuild Obsidian's editor; no timeline or map exists before stage 4 or 5. The author chose editor-first;
  the document does not record what that costs.
* **Rationale & Recommendation**: Record the delay in the decisions table. Consider trimming stage 2 to
  what the write-and-publish loop needs (source editing, link autocomplete, create from link, rename,
  search, backlinks, image upload) and moving syntax-hiding live preview, table editing and hover preview
  to a later increment.

### M7. Later stages are specified in detail now, against the document's own reasoning - Severity: Major

* **Reviewer Lens:** `egm-zoom-out`
* **Affected Scope:** art styles and timing, marker sets, export formats, dilation tables, four coordinate
  spaces, eight projections (180-186, 513-516, 532-538, 575-588, 607-609)
* **Discrepancy Description**: The document says file-level plans for stages 3 to 9 would be wrong if
  written now, then fixes many details of those stages. The old map file has no markers and the vault has
  about ten numbered dates, so these details are untested guesses.
* **Rationale & Recommendation**: Reduce each to one sentence of intent plus what the architecture must not
  block. Leave the rest to the stage designs.

### M8. Goal G10 contradicts the accepted map fallback - Severity: Major

* **Reviewer Lens:** `egm-zoom-out`
* **Affected Scope:** G10 (101-104), map risk (549-554)
* **Discrepancy Description**: G10 requires a working map of each of four space types. The fallback is to
  ship flat and globe only.
* **Rationale & Recommendation**: Require flat and sphere; make cylinder and schematic later items.

### M9. The exception to goal G1 is a workaround - Severity: Major

* **Reviewer Lens:** both (`egm-inventive-catalyst` as Nit)
* **Affected Scope:** G1 (73-75), data table (355), exception (366-368)
* **Discrepancy Description**: New large map images live outside Git, so the headline check "rebuild from a
  fresh clone" fails by design. "Large" has no threshold. Obsidian cannot see these images. The vault
  already commits images up to 9 MB.
* **Rationale & Recommendation**: Commit them like existing images or use Git LFS, decided in stage 4, and
  remove the exception. If it stays: set a size threshold, check the manifest at start, and show a missing
  original in the status area.

### M10. The `id` batch commit is unnecessary and under-specified - Severity: Major

* **Reviewer Lens:** both
* **Affected Scope:** entry identity (407-410), rollout (794-796)
* **Discrepancy Description**: Ids are added on first edit and again in a batch over 500 notes, which
  needs the outside sync agent changed first. Adding ids on edit contradicts "stages 1 and 2 change
  nothing in the vault". Notes created by agents or Obsidian arrive without an id, and a note duplicated
  in Obsidian copies its id.
* **Rationale & Recommendation**: Add an id only when something first refers to the entry (a map feature,
  a profile, a proposal), starting in stage 3. Drop the batch. Detect missing and duplicate ids when the
  index is built and show them.

### M11. A feature with no dates cannot show borders that change - Severity: Major

* **Reviewer Lens:** `egm-inventive-catalyst`
* **Affected Scope:** Maps: Features (535-538), CUJ 9
* **Discrepancy Description**: Visibility comes from the entry's single time interval. A realm whose
  borders shift needs several shapes for one entry, each valid for a different span. It is not stated
  which events open and close an entry's existence.
* **Rationale & Recommendation**: Let a feature bind its visibility to a named pair of events on its entry.
  Dates stay on entries. The schema marks which event kinds begin and end existence.

### M12. Character profiles are placed in an append-only folder - Severity: Major

* **Reviewer Lens:** `egm-inventive-catalyst`
* **Affected Scope:** G14 (116-121), non-goal on `99 Appendices` (155-156), append-only guard (411)
* **Discrepancy Description**: Profiles go in `99 Appendices/09 Agents/`, where existing files cannot be
  edited, so a profile can never be revised. The model file `Yagon.md` has no knowledge limits and no
  moment of speaking. Renaming an entry linked from an appendix file must break either the link or the
  guard.
* **Rationale & Recommendation**: Apply append-only to what `AGENTS.md` names (session logs and reports)
  and exempt `09 Agents`, or keep profiles elsewhere. On rename, add the old name as an alias when an
  appendix file links to it.

### M13. "No keystroke is lost" against a 24-hour loss window - Severity: Major

* **Reviewer Lens:** `egm-inventive-catalyst`
* **Affected Scope:** G6, drafts (445-447), backup (803-804)
* **Discrepancy Description**: Server drafts are protected only by a nightly copy.
* **Rationale & Recommendation**: Keep the browser's copy of a draft until it is published, or copy the
  drafts folder to backup within minutes of a change. Show "last backup" in the status area.

### M14. Goal G2 does not hold through the editor - Severity: Major

* **Reviewer Lens:** `egm-inventive-catalyst`
* **Affected Scope:** Parsing (393-396), G2 tests
* **Discrepancy Description**: The byte-for-byte tests run through `packages/vault`, not through the
  editor. CodeMirror normalises line endings, so one keystroke in one of the 18 CRLF files can rewrite
  every line.
* **Rationale & Recommendation**: Detect and keep each file's line ending, flag files with mixed endings,
  and add a browser test: one keystroke in the CRLF fixture gives a one-line difference.

### Nits

* **N1. The main pain is met slowly** (`egm-inventive-catalyst`, raised as Major): proposals come only as
  entries are published, so 500 existing notes reach the timeline one edit at a time. Since unconfirmed
  proposals are already drawn apart, an on-request run per folder with a cost estimate would not break the
  "no mass backfill" rule.
* **N2. Unconfirmed proposals and contradictions** (`egm-inventive-catalyst`): show "accepting this would
  contradict X" on the proposal, apart from the canon contradiction list.
* **N3. Stale items in the file plan** (both): items 8 to 11 name files already deleted or created.
* **N4. Backup lists disagree** (both): item 101 omits `/data/assets/generated`.
* **N5. Encrypted secrets** (`egm-zoom-out`): put keys in Coolify environment variables and drop the
  encryption. This conflicts with the author's request for a settings screen for the Hindsight connection.
* **N6. Server-sent events for one user** (`egm-zoom-out`): polling the status route is less code.
* **N7. Webhook plus timer** (`egm-zoom-out`): start with the timer and a fetch before Publish.
* **N8. `rebuild-index` command** (`egm-zoom-out`): `/health` already reports the same.
* **N9. G4 does not test Obsidian parity** (`egm-zoom-out`): the baseline comes from Frontier's own
  resolver, and the appendix tie-break is not an Obsidian rule. Reword the goal or seed the baseline from
  Obsidian's list of unresolved links.
* **N10. Spending cap kept only in a local log** (`egm-inventive-catalyst`): set the limit on the provider
  key as the hard stop.
* **N11. Formatting-only changes skip Hindsight** (`egm-inventive-catalyst`): confirmed dates and aliases
  never reach the bank. State this as an accepted limit.
* **N12. Low-level detail in architecture sections** (`egm-zoom-out`): temp-file rename, the one-second
  delay and cookie flags belong in the implementation plan.
