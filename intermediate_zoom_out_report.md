# Goldfish Review Report: Stage 8, Intermediate Zoom Out

**Target:** `docs/designs/frontier.md` (lines 1-1334), with focus on what was added since Stage 5

| Reviewer | Status |
| --- | --- |
| `egm-zoom-out` | completed |

Totals: 0 Blocker, 7 Major, 8 Nit. The reviewer found the glossary, stage table, risks table and
operation-based proposals settle what was raised before. The remaining findings are mostly one safeguard
stacked on another.

## Prioritized Findings (Blockers -> Major -> Nits)

### M1. Quarantine depends on agents having their own GitHub identity, which may not hold - Severity: Major

* **Affected Scope:** decisions table (357), Quarantine (570-593), Changes outside (804), goal G8
* **Discrepancy Description**: Quarantine keys on the account that pushed. `AGENTS.md` has the Hermes agent
  pushing with a shared token, and cloud coding sessions normally push under the author's own GitHub
  authorisation (not verified by the reviewer). Such agents pass as the author and are never quarantined,
  so the G8 check cannot pass for them.
* **Rationale & Recommendation**: State which agents can be given a separate identity. Record the rest as
  an accepted limit in G8 and in the risks table.

### M2. The sync becomes a third writer to `main`, and the section contradicts itself - Severity: Major

* **Affected Scope:** Quarantine (575-592)
* **Discrepancy Description**: The sync pushes `.frontier/quarantine.json` to `main`. Its account is not in
  the allowed list, its own push triggers it again, and its pushes add rejected pushes to Publish. One
  line says Frontier does not work out the pusher; another needs Frontier to "hold new foreign commits",
  which requires exactly that. State is split over two files in two services.
* **Rationale & Recommendation**: Name the sync's identity as allowed and say it ignores its own pushes.
  Close the timing gap with one rule: Frontier's AI reads a commit only once the sync's list covers it
  (the list records the last commit processed). Leave the missed-notification case to the stage 3 design.

### M3. Two mechanisms cover one risk, and one still has the hole - Severity: Major

* **Affected Scope:** G6 (132-135), draft revisions (519-523), items 38, 83, 99f
* **Discrepancy Description**: G6 accepts up to 5 minutes of loss on disk failure, and backup delivers
  that. The browser also keeps every draft until Publish and re-sends it, which forced a permanent record
  of published and discarded drafts. After a restore, a draft published in the last 5 minutes has no such
  record, so the browser brings it back anyway.
* **Rationale & Recommendation**: The browser drops its copy once the server acknowledges the revision.
  Remove the published/discarded records.

### M4. The publish journal can be replaced by one rule - Severity: Major

* **Affected Scope:** Crash safety (445-449), items 63b, 63c
* **Discrepancy Description**: Drafts live outside the working copy, so the working copy is disposable.
* **Rationale & Recommendation**: At start and after each fetch, reset the working copy to the fetched
  `main`. A draft whose content equals the file on `main` is already published and is removed; likewise a
  rename intent whose new path exists and old path is gone. This recovers from a crash at any point with
  no journal.

### M5. The automatic retry conflicts with "never an unconfirmed merge" - Severity: Major

* **Affected Scope:** Rejected push (450-452)
* **Discrepancy Description**: Repeating from the fetch can produce new clean merges after the author has
  already given his confirmations.
* **Rationale & Recommendation**: Drop the automatic retry. On rejection, stop and let the author press
  Publish again.

### M6. Link resolution gives two rules for the same case - Severity: Major

* **Affected Scope:** Link resolution (469-478), item 20
* **Discrepancy Description**: Notes with the same name resolve by "shortest path" and also "otherwise
  ambiguous, the author picks", with no order given. The two `Yagon.md` paths are equally deep, so the
  rule as written does not decide the case the exception exists for. The image rule (fewest folder steps)
  is a second departure from Obsidian, so the two tools can show different images, against goal G3.
* **Rationale & Recommendation**: One ordered rule. Where Obsidian's behaviour is not known, mark the link
  ambiguous and have autocomplete write links with a path. Follow Obsidian for images and list the 11
  duplicates for renaming.

### M7. The stage 1 / stage 2 split is by folder, not by journey - Severity: Major

* **Affected Scope:** implementation plan (1015-1022), items 34, 71
* **Discrepancy Description**: "Everything in `apps/server`" puts the image upload, hover preview, quick
  switcher and rename routes in stage 1 while their screens are stage 2. The stage 1 folder tree includes
  rename; the rename dialog is stage 2. Following files through Git rename history is needed in stage 1
  only for "renamed since" links from appendix files, and rename detection is a guess by Git.
* **Rationale & Recommendation**: Move each route to the stage of its screen. In stage 1 show such appendix
  links as unresolved and list them; defer rename-following to stage 3 or 8.

### Nits

* **N1.** Nothing uses `.frontier/` before stage 3; create it then (item 100, line 997).
* **N2.** A sanitiser in `apps/server` "shared with the web app" is the wrong way round; rendering is in
  `apps/web` (item 63g).
* **N3.** Item 40 says "applies drafts on top", item 62 says "kept apart"; align with the two-layer text.
* **N4.** A draft of a note that a rename also rewrites must join the rename's group (442).
* **N5.** "Canon" is defined as `main`, yet quarantined text is on `main`. "Draft" is defined as text but
  includes images, deletions and rename intents. The data table's "Yes, on push to `main`" omits
  quarantine.
* **N6.** First deploy comes last in stage 1; deploy a skeleton early to test the App, webhook and disk.
* **N7.** The risks table should list the dependence of G8 on the sync, which is code outside this
  repository.
* **N8.** Item number 11 is missing.
