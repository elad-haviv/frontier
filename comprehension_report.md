# Goldfish Review Report: Stage 6, Comprehension Test

**Target:** `docs/designs/frontier.md` (FeatureRange 1-950, DetailedRange 951-1225)

| Reviewer | Status |
| --- | --- |
| `egm-comprehension` | completed |

The reviewer read only the design document. Totals: 2 Blocker, 14 Major, 15 Nit.

## What this proposes

Frontier is a single-user, self-hosted web app (React in the browser, one Fastify container on Coolify) for
writing, reading and exploring a fantasy world kept as about 500 Markdown notes in the
`elad-haviv/avalymia` GitHub repository. The Markdown stays the source of truth. Frontier keeps an
in-memory index, holds unpublished work as files on a server disk (`/data/state`) with a browser copy, and
writes to `main` only through an explicit Publish: one commit, pull before push, never forced, conflicts
shown to the author.

Nine stages are planned. Stages 1 and 2 (foundation, then reader and editor at Obsidian parity on desktop
and phone) are planned file by file. Stages 3 to 9 are described at the level of intent and each gets its
own design later: review inbox, maps, time, time-aware maps, more projections, AI companion, export.

Stages 1 and 2 build an npm-workspace monorepo with three packages and two apps:

- `packages/vault` does byte-preserving frontmatter and line-ending handling, link resolution and rename,
  tested on a fixture vault and by hand on the real vault.
- `packages/schema` holds shared types.
- `apps/server` holds the Git gateway, drafts, Publish with three-way merge and journal, index, search,
  images, login, status and backup.
- `apps/web` holds the reader, CodeMirror editor, draft buffer, publish and conflict screens, and
  Playwright tests for CUJs 1 to 4.

## How the existing system works, per this document

The author writes in an Obsidian vault that is mirrored to GitHub (the diagram implies the obsidian-git
plugin) and pushed straight to an unprotected `main`. A "Hindsight memory bank" named `worldbuilding` is
refreshed by a separate "sync agent" on every push to `main`; it ingests whole notes, including
`99 Appendices/04 AI Conversations`. AI agents made 48 of the 55 commits and push directly to `main`, with
approval happening informally in chat.

The vault has "vault rules": AI proposes and the author approves, `99 Appendices` is append-only, one
logical change per commit, and lore is never quoted from the bank. Notes carry no machine-readable dates or
positions. Maps are image files, with an unused Leaflet plugin and a `Main.json`. There are 18 CRLF files,
77 folder notes, 11 duplicated image names and two same-name note pairs. A separate `map-reprojector` app
exists and is not reused.

The reviewer could not paraphrase one section: how unreviewed agent pushes are quarantined (B1). That gap
sits in stage 3 scope; it does not stop the stage 1 and 2 build.

## Findings

### Blocker

* **B1. The quarantine mechanism contradicts itself and has no stated actor** (lines 165-167, 185-186, 331,
  358-359, 527-547, 743-745). Four places state a per-commit rule ("ingests a commit only when pushed by
  the author or Frontier"); line 528 says the guard works per note. It is not said who quarantines a note,
  nor whether the sync checks the pusher, reads Frontier's review-state file, or both. If it reads the
  file, the sync receives the agent's push before Frontier has committed the updated file. How the sync
  treats Frontier's own commit of that file is unstated. A commit fetched by timer has an unknown pusher,
  which would quarantine the author's own Obsidian push whenever a notification is missed.
  *Recommendation*: one rule used everywhere, a named deciding component, the order of events for an agent
  push, and the missed-notification case.
* **B2. The stage 1 plan contradicts the architecture on Frontier's credential** (419-421, 534-536 against
  980, 1192-1193, 748). The architecture requires a machine account or GitHub App; item 102 and the
  `GITHUB_TOKEN` variable describe a fine-grained token with no owner.
  *Recommendation*: say which identity owns the credential and in which stage it is created.

### Major

* **M1. The boundary between stage 1 and stage 2 is not drawn in the plan** (43-46, 1195-1205). Stage 1 is
  said to close goals that need an interface (G6, G7, G12), but every web file reads as stage 2; backup is
  the last step yet stage 1 closes G12 for backup failures. *Recommendation*: label each step and file
  group with its stage.
* **M2. Hindsight is never defined** (59, 165-167, 203-209, 665-672, 914): what the bank stores, what recall
  returns, what the sync agent is and who owns it.
* **M3. "Stage 5 review" collides with build stage 5** (185-186, 842-843, 870). "Goldfish review", "the
  brainstorm", "EGM" and the report files are also undefined. *Recommendation*: rename the review steps and
  say in one sentence what the review process is.
* **M4. Stage 3 depends on AI parts assigned to stage 8** (47, 242-249, 514-519, 673-677 against 52,
  140-142, 1064-1065): field proposals need the provider interface, key, cost log and cap. CUJ 5 shows a
  proposal on the timeline, which is stage 5.
* **M5. The plan's draft records contradict the architecture** (479-483 against 1061-1063, 1145-1147): no
  id, revision or published/discarded record in items 38 and 83; two devices editing one draft is not
  covered.
* **M6. Several goal checks and critical files have no test file** (84-142, 1101-1114, 1162-1180,
  1219-1221): G12 failure triggers, G11 timed load, G6 phone lock, the Publish journal, backup, image
  serving, the timer fetch, the search target, and G1's "fresh clone" check.
* **M7. G4 claims Obsidian's behaviour but declares an intended difference** (95-96, 435-442). Obsidian's
  rule is not stated; the baseline is made by Frontier's own resolver; "nearest folder" does not say
  nearest to what.
* **M8. Publish has unspecified outcomes** (398-416): a second rejected push; when local commits could
  exist; whether the journal and lock span the pause for confirming a merge; the rule for finishing or
  abandoning; a delete against a changed file.
* **M9. Image uploads are "drafts" but drafts are defined as text** (394-396, 1080-1081): storage of binary
  drafts and name collisions in the append-only images folder.
* **M10. Where line endings are restored, and in what form a draft is held, is unclear** (430-434,
  1171-1174).
* **M11. The appendix rename rule covers only bare-name links** (443-446): an appendix file linking by
  path, or a move without rename, is not rescued by an alias.
* **M12. Entry ids do not connect** (447-451, 47, 187-189, 710): ids are written when a map feature or
  profile is accepted (stages 4 and 8) yet "start in stage 3"; "missing id" is undefined when ids are
  assigned lazily.
* **M13. The index overlays drafts, yet some readers must see published text only** (456-459, 1066-1068
  against 138-139, 671-672). Which view search, backlinks and link resolution read is not stated; "stale
  index" is undefined.
* **M14. "Pulse" carries the common time axis and is never defined** (110-113, 268-269, 591-595).

### Nit

* **N1.** Item 11 sits under the wrong heading; items 99a-99e are out of order (991-993).
* **N2.** Backup is described three ways (475-476, 946, 1189-1191).
* **N3.** The phone bar differs between architecture and plan (501-502 against 1124-1125, 1141-1142).
* **N4.** Cylinder and schematic spaces are "stage 7" and "designed in stage 4" (114-115 against 613-616).
* **N5.** The G2 check, item 28 and item 99b describe different tests.
* **N6.** G11 claims every screen works at 375 px; its check is only a load time.
* **N7.** "Agents", "vault rules" and `AGENTS.md` are not introduced.
* **N8.** Lore names (Ezob, Derdama, Amarah, Nirani, Era of Man, time dilation) are used as if known.
* **N9.** "Mesh method" and `map-reprojector` are used before they are explained.
* **N10.** "Space views", "layers" and "drill-down" are not defined.
* **N11.** "Originals up to 9 MB are never sent to a phone" reads as if larger ones are.
* **N12.** "The limits applied" on the settings screen is unexplained.
* **N13.** Items 7 and 10 assume repository state the document does not describe.
* **N14.** Coolify is never explained.
* **N15.** CUJ 4 says Frontier "never merges on its own", while Publish merges and asks for confirmation.
