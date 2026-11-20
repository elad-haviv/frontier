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

## Now: finishing stages 1 and 2

- [ ] Backup of drafts to a storage bucket, and a restore command
- [ ] Browser test suite committed to the repo (the flows are checked today by a script outside it)
- [ ] Rename and move screen (the server side is built)
- [ ] Link autocomplete while typing `[[`
- [ ] Live preview in the editor (hide Markdown marks away from the cursor)
- [ ] Hover preview of linked entries; outline of an entry's headings
- [ ] Search and quick switcher
- [ ] Image upload and sizing; table editing; properties panel
- [ ] Show a link to a missing image as a missing link, not a broken picture
- [ ] Accept a GitHub token as an alternative to a GitHub App
- [ ] Phone toolbar above the keyboard (link, heading, list, image, undo)

## Waiting on Elad

- [ ] Give Frontier access to `avalymia`: add the repo to the "haviv-pro" GitHub app, or create a
      token or an App
- [ ] Review the link baseline on the `claude/vibrant-gates-ovwcp2` branch of `avalymia`
      (`.frontier/baseline/links.json`) and compare it with Obsidian's unresolved links
- [ ] Check in Obsidian whether a bare `[[Alias]]` link resolves
- [ ] A storage bucket for backups and a persistent disk on the Coolify app
- [ ] Change the preview password once the real vault is connected

## Later stages

Each gets a short design of its own before it is built.

3. Review inbox: agent proposal branches, AI basics, structured fields, Hindsight sync changes
4. Maps: flat and sphere maps, markers, paths, zones, layers, drill-down, measuring
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
