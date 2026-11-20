# Goldfish Review Report: Stage 7, Critic Review

**Target:** `docs/designs/frontier.md` (lines 1-950, the feature specification)

## Reviewer Status

| Reviewer | Status | Blocker | Major | Nit |
| --- | --- | --- | --- | --- |
| `egm-design` | completed | 0 | 8 | 4 |
| `egm-structural` | completed | 1 | 3 | 10 |
| `egm-style` | completed | 0 | 6 | 8 |

After merging duplicates: 1 Blocker, 14 Major, 14 Nit. The Stage 6 findings were still open in the document
when this stage ran, so several appear again here.

## Prioritized Findings (Blockers -> Major -> Nits)

### C1. Rejected alternatives give attribution, not a reason - Severity: Blocker

* **Reviewer Lens:** `egm-structural` (Blocker), `egm-design` (Major)
* **Affected Scope:** Alternatives Considered (752-904)
* **Discrepancy Description**: Seventeen of twenty alternatives end "Rejected by author" and three cite an
  unlinked review. Several reasons only restate the choice: "one container", "custom renderer", "agents
  push branches", "working files stay on the server disk", "the Hindsight sync checks who pushed".
* **Rationale & Recommendation**: The standard requires a concrete trade-off for each rejection. Rewrite
  each reason as the deciding technical or scope trade-off, drawn from its Cons. The choices stand.

### C2. Quarantine has two owners and no path from release to ingestion - Severity: Major

* **Reviewer Lens:** `egm-design` (also Stage 6 B1)
* **Affected Scope:** 527-547, 743-745
* **Discrepancy Description**: Frontier and the sync each work out the quarantine set from their own push
  notification, so the two can differ. A commit Frontier sees only by timer has an unknown pusher; every
  deploy restarts the server, so the author's own Obsidian pushes during a restart would be quarantined in
  Frontier while the sync ingests them. A release changes only the review-state file, and nothing makes
  the sync ingest the released note.
* **Rationale & Recommendation**: Name one owner of the set. On a timer fetch, get the pusher from GitHub's
  repository activity record. Add a third sync change: ingest notes released by a change to the
  review-state file.

### C3. Alias resolution differs from Obsidian - Severity: Major

* **Reviewer Lens:** `egm-design` (from knowledge of Obsidian, not tested)
* **Affected Scope:** G3, G4 (95-96), link resolution and rename (435-446)
* **Discrepancy Description**: Obsidian does not resolve a bare `[[Alias]]` to the note declaring that
  alias; aliases feed autocomplete, which writes `[[Note|Alias]]`. So Frontier's resolver differs from
  Obsidian in more than the one stated way, and the appendix rename rule (add the old name as an alias)
  keeps old links working in Frontier only. In Obsidian they would be unresolved, failing G3's check.
* **Rationale & Recommendation**: Verify in Obsidian first. Then either drop alias matching from
  resolution, or record it as a second intended difference and narrow G3's check.

### C4. Links inside `when` text may not survive a rename in Obsidian - Severity: Major

* **Reviewer Lens:** `egm-design` (from knowledge of Obsidian, not tested)
* **Affected Scope:** Structured fields (558-573)
* **Discrepancy Description**: Obsidian tracks a link in a property only when the whole value is a link,
  not when it is part of a sentence inside a nested list. The document asserts the opposite.
* **Rationale & Recommendation**: Test it in stage 3. If it fails, Frontier repairs relations after a
  fetch using Git's rename detection, or relations refer by `id`.

### C5. Goal G8 is not true as stated - Severity: Major

* **Reviewer Lens:** `egm-design`, `egm-style`
* **Affected Scope:** G8 (108-109), 331, 545
* **Discrepancy Description**: The vault rules say every Markdown file on `main` is canon, and the design
  accepts that unreviewed agent text can sit on `main`. The check covers only Frontier's own code.
* **Rationale & Recommendation**: Reword G8 to "no AI text reaches the bank or Frontier's AI answers
  without approval, and Frontier itself writes none to `main`"; add the quarantine test to its check.

### C6. Other absolute claims the document contradicts - Severity: Major

* **Reviewer Lens:** `egm-style`
* **Affected Scope:** G6 "no keystroke is lost" (101-103) against loss of "minutes" (482-483); "never
  merges on its own" (240) against the three-way merge (401-403); "G1 holds without exception" (384)
  against undecided Git LFS and "text file" for images (86-87)
* **Rationale & Recommendation**: State the bound in each case.

### C7. The index mixes draft and published state - Severity: Major

* **Reviewer Lens:** `egm-design` (also Stage 6 M13)
* **Affected Scope:** 458, 672, 137-139
* **Rationale & Recommendation**: Specify a published index plus a draft overlay, and say which one each
  reader uses: search, backlinks, timeline, autocomplete, AI.

### C8. Two devices editing one draft is unspecified - Severity: Major

* **Reviewer Lens:** `egm-design` (also Stage 6 M5)
* **Affected Scope:** 479-483, 496-498
* **Rationale & Recommendation**: Reject an older revision arriving after a newer one and show both, as
  for Publish conflicts. Last-write-wins would lose text.

### C9. No rule for cleaning rendered Markdown - Severity: Major

* **Reviewer Lens:** `egm-design`
* **Affected Scope:** Reader (494), agent proposals (508-510), security (912-918)
* **Discrepancy Description**: Agent branches are untrusted and are displayed in a session that can
  publish to canon and spend AI budget. Raw HTML in a proposal is a way to run script in that session.
* **Rationale & Recommendation**: Require HTML sanitisation of all rendered Markdown and a content
  security policy.

### C10. No "Risks & Mitigations" section - Severity: Major

* **Reviewer Lens:** `egm-structural`, `egm-design`
* **Affected Scope:** risks scattered at 326-334, 362-365, 484-486, 575-577, 649-657, 699-705, 910-918
* **Rationale & Recommendation**: Add one table: risk, impact, mitigation, stage. Also missing: a numeric
  AI cost estimate; one password guarding the push credential; tiling and backup sharing the API process.

### C11. A broken list attaches the core Publish rules to the wrong item - Severity: Major

* **Reviewer Lens:** `egm-structural`
* **Affected Scope:** 405-416
* **Rationale & Recommendation**: Add a blank line before line 407 and split the journal and retry text
  into their own bullets.

### C12. "Stage 5 review" collides with build stage 5; process terms undefined - Severity: Major

* **Reviewer Lens:** `egm-structural`, `egm-style` (also Stage 6 M3)
* **Affected Scope:** 185, 842, 870; "Goldfish review" (806, 814, 821); "brainstorm" (754); "(was Q1...)"
* **Rationale & Recommendation**: Rename the review steps, drop the question numbers, and give technical
  reasons in place of process history.

### C13. Targets written as facts; unmeasurable wording - Severity: Major

* **Reviewer Lens:** `egm-style`
* **Affected Scope:** "a rebuild takes seconds" (459); "image generation is the largest cost" (930); "may
  need a paid GitHub plan" (861); "readable", "usable", "clear message", "no visible lag", "every few
  minutes", "several thousand"
* **Rationale & Recommendation**: Cite the stated target, mark estimates as estimates, and give each
  requirement a number or an observable test.

### C14. Terms drift and rules are restated - Severity: Major

* **Reviewer Lens:** `egm-style`
* **Affected Scope:** "entry"/"note"; "bank"/"memory bank"/"Hindsight"; "unreviewed"/"quarantined";
  "exploring session"/"discovery session". Frontier's identity, the sync rules, "never writes to the bank"
  and the backup schedule are each stated in three or four places.
* **Rationale & Recommendation**: Define each term once. Keep one statement of each rule and refer to it.

### Nits

* **N1.** Frontmatter edits: "rewrites only that key's lines" is asserted; add a frontmatter case to the
  real-vault test (`egm-design`).
* **N2.** After a second rejected push, behaviour is undefined (`egm-design`; Stage 6 M8).
* **N3.** Removing `Main.json` is a deletion the append-only guard forbids; name the exception path, and
  say where deleted entries go given the existing recycle bin (`egm-design`, `egm-structural`).
* **N4.** Heading names differ from the standard's "Problem Statement" and "Proposed Architecture"
  (`egm-structural`).
* **N5.** Open Questions says "None" above a list of settled items in the order Q8, Q1...Q7 (both).
* **N6.** Stray blank lines split lists at 24, 123, 181; "five jobs" is followed by a sixth (both).
* **N7.** Long unwrapped lines where text was inserted (both).
* **N8.** Unlabelled bullets among bold-labelled ones at 473, 545, 697 (both).
* **N9.** Stage table: mixed content in "Goals closed"; G12's AI part is missing from stage 8; export has
  no goal (`egm-structural`).
* **N10.** Alternatives are grouped by when they arose, splitting the renderer options (`egm-structural`).
* **N11.** Horizontal rules fence off one section only (`egm-structural`).
* **N12.** Subjective wording: "awkward on a phone", "polished", "mature", "good touch handling"
  (`egm-style`).
* **N13.** The Skyrim licensing note belongs under marker sets or export; vault counts need a date
  (`egm-style`).
* **N14.** Ambiguous "It" at 640-641 (`egm-style`).
