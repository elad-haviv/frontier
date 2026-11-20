# Goldfish Annotated Review Report

**Target:** `docs/designs/frontier.md` (lines 1-950), findings from Stage 6 (`comprehension_report.md`) and
Stage 7 (`critic_report.md`)

Counts: 27 PROPOSE FIX, 0 CONTEST, 0 ESCALATE, 6 DECLINE. Stage 6 findings that concern only the
implementation plan (lines 951 onward) are listed at the end and are fixed with it, so Stage 9 reads a
consistent plan.

## Prioritized Findings & AI Suggestions

### 1. Rejected alternatives give attribution, not a reason [`egm-structural`, `egm-design`] - Severity: Blocker

*   **Affected Scope:** Alternatives Considered
*   ***AI Suggestion:*** PROPOSE FIX
*   ***Justification:*** Valid. The reasons exist in each entry's Cons but the rejection line does not say
    which one decided it.
*   ***Proposed Edit:*** Rewrite every "Reason for Rejection" as the deciding trade-off, for example:
    one container, "one deployment and no cross-domain login outweigh a short restart on each interface
    change, since drafts survive a restart"; files only, "at 500 notes an in-memory index answers every
    query in memory, so a database adds a service without adding capability". Remove "Rejected by
    author" and the review references. Group the alternatives by decision area.

### 2. Quarantine contradicts itself, has two owners, and no path from release to ingestion [`egm-comprehension` B1, `egm-design`] - Severity: Blocker

*   **Affected Scope:** "Agents that push to `main` anyway", and four restatements of the old rule
*   ***AI Suggestion:*** PROPOSE FIX
*   ***Justification:*** Valid. The section was rewritten after Stage 5 and the older per-commit wording
    was left in four places.
*   ***Proposed Edit:*** One rule, stated once and referred to elsewhere:
    *   The Hindsight sync is the only component that decides quarantine. It already receives every push
        notification with the pusher's identity. A note changed by a push from anyone other than the
        author or Frontier is quarantined by the sync, which records it in its own state.
    *   Frontier does not decide. It asks the sync for the quarantine list (the sync exposes it as a small
        file it commits to `.frontier/quarantine.json`, or as an endpoint; settled in the stage 3 design)
        and shows those notes as "arrived unreviewed".
    *   Release: the author accepts or reverts in Frontier. Frontier records the decision in
        `.frontier/review-state.json` and pushes. The sync, on seeing that file change in a push by
        Frontier, releases the note and ingests it. This is a third change to the sync.
    *   A missed notification affects the sync only, which then asks GitHub's repository activity record
        for the pusher. Frontier no longer infers the pusher, so a Frontier restart cannot quarantine the
        author's own pushes.

### 3. The stage 1 plan gives Frontier a plain token [`egm-comprehension` B2] - Severity: Blocker

*   ***AI Suggestion:*** PROPOSE FIX
*   ***Proposed Edit:*** State that Frontier's GitHub App (or machine account) is created in stage 1, so
    the identity never changes later. Replace `GITHUB_TOKEN` with the App id and private key variables;
    update item 102.

### 4. Alias resolution differs from Obsidian [`egm-design`] - Severity: Major

*   ***AI Suggestion:*** PROPOSE FIX
*   ***Justification:*** I believe the reviewer is right: in Obsidian an alias feeds autocomplete and is
    written as `[[Note|Alias]]`; a bare `[[Alias]]` does not resolve. Not tested here.
*   ***Proposed Edit:*** Remove alias matching from link resolution; autocomplete inserts
    `[[Note|Alias]]` as Obsidian does. Replace the "old name becomes an alias" rule: a link from an
    append-only file to a renamed entry is left as written and becomes unresolved, as it would in
    Obsidian if the file were locked; Frontier's reader follows it through Git's rename history and marks
    it "renamed since". Add to stage 1: verify bare-alias behaviour in Obsidian once.

### 5. Links inside `when` text may not survive a rename in Obsidian [`egm-design`] - Severity: Major

*   ***AI Suggestion:*** PROPOSE FIX
*   ***Justification:*** The document asserts Obsidian rewrites these; that is unverified and probably
    false for a link inside a sentence in a nested list.
*   ***Proposed Edit:*** Remove the assertion. After every fetch Frontier checks time relations whose
    target no longer resolves, finds the new name through Git's rename detection, and proposes the
    rewrite as a draft. State that the stage 3 design tests Obsidian's behaviour and may move the target
    into its own key.

### 6. Goal G8 and other absolute claims are not true as stated [`egm-design`, `egm-style`] - Severity: Major

*   ***AI Suggestion:*** PROPOSE FIX
*   ***Proposed Edit:*** G8: "No AI text reaches the bank or Frontier's AI answers without the author's
    approval, and Frontier itself writes none to `main` without it", with the quarantine test added to the
    check. G6: "typed text survives a closed tab, a locked phone and a lost connection; loss of the server
    disk loses at most the minutes since the last backup". CUJ 4: "never applies a merge the author has
    not confirmed". G1: "a file in the repository" in place of "text file"; drop "without exception".

### 7. The index mixes draft and published state [`egm-design`, `egm-comprehension` M13] - Severity: Major

*   ***AI Suggestion:*** PROPOSE FIX
*   ***Proposed Edit:*** Two layers: a published index built from `main`, and a draft overlay. The
    author's own reading, search, backlinks, autocomplete and timeline read published plus overlay, with
    draft-only results marked. AI grounding, contradiction checks and discovery read the published layer
    only, minus quarantined notes. Define "stale index" as "built from a commit older than the fetched
    `main`".

### 8. Two devices editing one draft [`egm-design`, `egm-comprehension` M5] - Severity: Major

*   ***AI Suggestion:*** PROPOSE FIX
*   ***Proposed Edit:*** The server accepts a save only when it carries the revision the server holds.
    An older revision arriving later is kept as a second version and both are shown for the author to
    merge, as in a Publish conflict.

### 9. No rule for cleaning rendered Markdown [`egm-design`] - Severity: Major

*   ***AI Suggestion:*** PROPOSE FIX
*   ***Proposed Edit:*** Security: all rendered Markdown, from the vault, agent branches and AI output, is
    sanitised (no script, no event handlers, no raw embedded frames); the app sends a content security
    policy that forbids inline script and outside script sources.

### 10. No Risks & Mitigations section [`egm-structural`, `egm-design`] - Severity: Major

*   ***AI Suggestion:*** PROPOSE FIX
*   ***Proposed Edit:*** Add one table (risk, impact, mitigation, stage) gathering: disk loss; no query
    language; unreviewed text on `main`; late bank updates; renderer seams and phone speed; one password
    guarding the push credential (mitigation: rate limit now, passkey in stage 3); tiling and backup
    sharing the API process (mitigation: run both at low priority, one at a time); AI cost, with a first
    estimate per month. Replace the scattered "accepted" notes with references to it.

### 11. Broken list in Publish [`egm-structural`] - Severity: Major

*   ***AI Suggestion:*** PROPOSE FIX
*   ***Proposed Edit:*** Restructure Publish as numbered steps with separate bullets for grouping, the
    journal and the push retry.

### 12. Publish has unspecified outcomes [`egm-comprehension` M8, `egm-design` nit] - Severity: Major

*   ***AI Suggestion:*** PROPOSE FIX
*   ***Proposed Edit:*** After a second rejected push, Publish stops, drafts stay unpublished, the status
    area says "main is changing; try again", and merge confirmations are asked again next time. The
    working copy never has local commits, so "when it has no local commits" is removed. The journal
    covers only the span from building the commit to moving the working copy forward, not the pause for
    confirmations; at start an entry whose commit is on the remote is finished, any other is abandoned. A
    delete of a file that changed on `main` is a conflict.

### 13. Review-process terms collide with build stages [`egm-structural`, `egm-style`, `egm-comprehension` M3] - Severity: Major

*   ***AI Suggestion:*** PROPOSE FIX
*   ***Proposed Edit:*** Remove "stage 5 review", "Goldfish review", "brainstorm" and the "(was Q...)"
    numbers. Rename "Open Questions / Answered by the author" to "Resolved decisions".

### 14. Targets as facts; unmeasurable wording [`egm-style`] - Severity: Major

*   ***AI Suggestion:*** PROPOSE FIX
*   ***Proposed Edit:*** Give numbers: timer fetch every 5 minutes; backup within 5 minutes of a change;
    index rebuild under 5 seconds (target); keystroke-to-screen under 50 ms in the largest note; "clear
    message" replaced by the message's required content; conflict screen defined by what it shows. Mark
    cost statements as estimates. Remove the unverified GitHub plan remark.

### 15. Terms drift; rules restated [`egm-style`] - Severity: Major

*   ***AI Suggestion:*** PROPOSE FIX
*   ***Proposed Edit:*** Add a short glossary after the Overview: entry (a Markdown note of lore), vault,
    canon, the bank (Hindsight, a self-hosted semantic memory service; what it stores and returns), the
    sync (the agent that copies changed notes from `main` into the bank; where it runs), agents,
    `AGENTS.md`, Coolify, pulse, exploring session, quarantined, and the lore names used (Ezob, Derdama,
    Era of Man). Use one term for each thing. Keep one statement each of Frontier's identity, the sync
    rules, "never writes to the bank" and backup, and refer to it elsewhere.

### 16. Hindsight, "pulse" and other terms undefined [`egm-comprehension` M2, M14, N7-N10, N14] - Severity: Major

*   ***AI Suggestion:*** PROPOSE FIX (covered by the glossary in item 15)

### 17. Stage 3 depends on AI parts assigned to stage 8 [`egm-comprehension` M4] - Severity: Major

*   ***AI Suggestion:*** PROPOSE FIX
*   ***Proposed Edit:*** Stage table: stage 3 delivers the provider interface, key in settings, cost log
    and spending cap, and closes G16; stage 8 adds conversation, character chat and discovery. Note on
    CUJ 5 that the timeline part works from stage 5.

### 18. Entry ids do not connect [`egm-comprehension` M12] - Severity: Major

*   ***AI Suggestion:*** PROPOSE FIX
*   ***Proposed Edit:*** Stage 3 builds the id mechanism (reading, duplicate detection); the first ids are
    written in stage 4. Remove "missing id" from the status list; keep "duplicate id" and "reference to an
    id no entry has". Correct "by its full path and its id" to "by its full path, and by `id` where it
    has one".

### 19. Image uploads are "drafts" but drafts are text [`egm-comprehension` M9] - Severity: Major

*   ***AI Suggestion:*** PROPOSE FIX
*   ***Proposed Edit:*** A draft may be a binary file: stored as-is in `/data/state/drafts`, not kept in
    the browser buffer after upload. A new image whose name exists gets a numeric suffix.

### 20. Form of text at each hop; line endings [`egm-comprehension` M10] - Severity: Major

*   ***AI Suggestion:*** PROPOSE FIX
*   ***Proposed Edit:*** State: the editor, browser buffer and draft file hold text with normalised line
    endings plus the file's recorded ending style; the original bytes are restored once, when Publish
    builds the commit; merging is done on normalised text. For a file with mixed endings the server
    applies the draft to the original as changed ranges.

### 21. Appendix files linking by path; moves [`egm-comprehension` M11] - Severity: Major

*   ***AI Suggestion:*** PROPOSE FIX (covered by item 4: left as written, followed through rename history
    in Frontier's reader, listed as unresolved)

### 22. G4 claims Obsidian's behaviour [`egm-comprehension` M7] - Severity: Major

*   ***AI Suggestion:*** PROPOSE FIX
*   ***Proposed Edit:*** G4: "Links resolve as in Obsidian, with one stated exception (the `99 Appendices`
    tie-break)". State Obsidian's rule as understood (exact path; else the note with that name; among
    several, the one whose path is shortest). The author compares both the unresolved list and a sample
    of 50 resolved links with Obsidian once. "Nearest" means the fewest folder steps from the linking
    note.

### 23. Nits accepted for fixing

*   ***AI Suggestion:*** PROPOSE FIX
*   Frontmatter round trip added to the real-vault test. `Main.json` removal named as a one-time exception
    to the guard, made by hand. Deleted entries go to Git history, not the recycle bin folder. "Five jobs"
    becomes six. List breaks, unlabelled bullets and the ambiguous "It" fixed. Stage table "Goals closed"
    made uniform; export stated as having no goal by intent. Skyrim note moved to marker sets. Vault
    counts dated 2026-11-20. Subjective words replaced by the specific shortcoming. "Up to 9 MB" reworded.
    "The limits applied" explained. Phone bar made consistent. Cylinder and schematic: designed and built
    in stage 7.

### 24. Nits declined

*   ***AI Suggestion:*** DECLINE
*   Heading names "The Problem" and "Technical Plan (Architecture)" (they follow the EGM design template).
    Horizontal rules (also from the template). Re-wrapping long lines (no effect on rendering). Removing
    words such as "small" and "plain" throughout. Dating every single count. Reordering the appendix
    items in the plan numbering (renumbered instead when the plan is revised).

### Findings on the implementation plan (lines 951 onward), fixed with it

*   ***AI Suggestion:*** PROPOSE FIX
*   Label every step and file group with stage 1 or 2, and say what interface stage 1 ships (`M1`). Add
    id, revision and the published/discarded record to the draft files (`M5`). Name a test file for each
    goal check, the journal, backup, image serving and the timer fetch, or mark the check manual (`M6`).
    Move `backup.ts` under the server heading and renumber (`N1`). One description of backup (`N2`).
