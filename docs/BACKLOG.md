# Frontier backlog

One place for what is being built, what is waiting, and ideas. The design in
[designs/frontier.md](designs/frontier.md) says how things work; this file says what is next.

## How ideas are handled

- **Any idea goes into "Ideas inbox" first**, in your words, with the date. Adding one never changes
  what is being built right now.
- **When a stage's design is written, the inbox is read** and each idea that fits is moved into that
  stage, turned down with a reason, or left for a later stage.
- **An idea jumps the queue only when you say so.** Then it moves to "Now", and whatever it displaces
  is named here.

## Ideas inbox

- 2026-11-21: **AI co-editing, in the editor.** Highlight text and add a comment for me or the AI
  to work on; ask the AI to change the length or style of a selection; consult the AI about a
  passage without leaving the editor.
  - Probably stage 8 (AI companion), with the AI basics from stage 3 as a prerequisite.
  - Open: where comments are stored, since they are not lore (a file in `.frontier/`, or with the
    draft on the server); whether a comment can stay on published text or only on a draft.
  - Fits the existing rule: an AI change to a selection is a proposal shown as a difference, which
    you accept or reject before it enters the draft.

<!-- Format:
- 2026-11-21: The idea, as said. (Notes: which stage it probably belongs to, open questions.)
-->

- 2026-11-21: **Gallery.** A page for browsing the vault's images. Open: all images or only those
  used in entries (about 80 of 284 are used; most of the rest are icon sets); grouping by folder or
  by the entry that uses them; whether an image links back to its entries. (The lightbox half of
  this idea is built; see Done.)

## Left from stage 2

- [x] Live preview in the editor (hide Markdown marks away from the cursor)
- [x] Image upload (toolbar, paste, drop); Tab between table cells; properties panel (other names, tags)
- [ ] Image sizing in the editor; adding and removing table rows and columns

## Waiting on Elad

- [ ] Say whether the preview should become your own library now, and how the real vault comes in:
      loaded by Claude from the repository, or uploaded by you as a zip
- [ ] Review the link baseline on the `claude/vibrant-gates-ovwcp2` branch of `avalymia`
      (`.frontier/baseline/links.json`) and compare it with Obsidian's unresolved links
- [ ] Check in Obsidian whether a bare `[[Alias]]` link resolves
- [ ] A storage bucket for backups and a persistent disk on the Coolify app
- [ ] Change the preview password once the real vault is connected
- [ ] Read the stage 3 design and answer its four questions: an OpenRouter key and model; which
      GitHub account the Hermes agents push with; whether a rule can protect `main`; whether Obsidian
      rewrites links inside a `when` field
- [ ] Have the sync on the Hermes box changed for quarantine (the changes will be written in
      `docs/sync-changes.md`)

## Now: stage 3

Design: [stage 3](designs/stage-3-review-and-ai-basics.md), a draft the author has not read yet.

- [x] 3a Inbox for agent branches: list, accept, reject, grouped publish, commit trailer
- [x] 3b Fields and ids: reader block, properties panel rows, schema, attention entries, lookup by id,
      `ensureId`
- [x] 3c AI basics: provider, cost log and cap, settings page, field proposals, folder run
- [x] 3d Quarantine, Frontier's side: list, accept, revert, grouped publish, settling. It shows
      nothing until the sync is changed (see `docs/sync-changes.md`)
- [x] 3e Passkey login, with the option to switch the password off

## Now: Frontier's own library

Decided by Elad on 2026-11-21: the knowledge base lives in Frontier, as files, with its own version
history; notes and media are imported; the library is exported as a vault. Design:
[own library](designs/own-library.md).

- [x] A library of Frontier's own when no repository is named; no account needed anywhere
- [x] Versions: history of an entry and of the library, restore
- [x] Import of notes and images, with a choice on a name clash; import of a whole vault from a zip
- [x] Export of the library as a zip
- [ ] Switch the preview from the sample to an own library, on a disk that lasts
- [ ] Bring the real vault in
- [ ] Later: a one-way mirror to GitHub for the memory bank and the agents

## Now: stage 4, maps

Design: [stage 4](designs/stage-4-maps.md), a draft the author has not read yet.

- [x] 4a Map files: form, merging by item, drafts and Publish, marker sets
- [x] 4b Viewer: flat maps and globes in WebGL, pan and zoom, globe and flat view, the place kept
      in the address
- [x] 4c Markers with entries and icons; "On maps" on an entry
- [x] 4d Paths, zones, layers, child maps, undo
- [x] 4e Measuring; a globe's radius and a flat map's scale
- [ ] Left to do: adding a second image to a map and setting an image's extent; reordering
      features; a zone that contains a pole in the flat view
- [ ] Try it on the real vault's images and on a real phone (frame rate)

## Later stages

Each gets a short design of its own before it is built.

5. Time: calendars, vague dates, relative order, timelines, overlap views
6. Time-aware maps
7. More map views: other projections, cylinder and schematic spaces
8. AI companion: lore conversations, character chat, discovery with concept art
9. Export: documents, styled web pages, presentations, map renders

## Done

- Design reviewed and approved (2026-11-20)
- Vault package: notes, frontmatter, line endings, links, link resolution, rename planning
- Server: Git gateway, index, login, status, image serving
- Drafts, two-call Publish with merge and conflicts, renames, crash recovery
- Reader: folder tree, entries with links, embeds and backlinks, status page
- Editor: autosave, new and delete, unpublished list, Publish, merge and conflict screens
- Sample preview at frontier.haviv.pro
- Lightbox for images in an entry: large view, next and previous, full-size zoom, swipe, keyboard
  (from the ideas inbox, moved up on 2026-11-21 at Elad's request; it displaced nothing)
- A link to a missing image shows as a missing link, not a broken picture
- Link autocomplete after `[[`, over names and aliases; an alias is written as `[[Entry|Alias]]`
- Browser test suite in the repo: 23 tests at phone and desktop size, run in CI
- Backup of working files to a folder or S3-compatible bucket, a few minutes after a change and
  nightly; restore command. The bucket path has not run against a real bucket yet.
- Rename and move screen
- Quick switcher: jump to an entry by name or alias (the magnifier, or Ctrl+K)
- Full-text search in the same box as the switcher, with the words around each match
- Outline of an entry's headings; preview of a linked entry on hover (mouse only)
- Editing toolbar for link, heading, list, bold, italic, undo and redo
- A GitHub personal access token works in place of a GitHub App (`GITHUB_TOKEN`); the webhook is
  optional
