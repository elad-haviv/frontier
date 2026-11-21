# Stage 10: comments on a passage, and more export formats

Status: Built, 2026-11-21. Author: Elad Haviv. Parent: [Frontier](frontier.md).

Elad asked on 2026-11-21 for two things from the list of what could come next: comments on a
passage (the last part of the "AI co-editing" idea in the backlog), and the export formats that
[stage 9](stage-9-export.md) left out.

## Comments on a passage

### What the author does

1.  In the editor, he selects a passage (or puts the cursor in a paragraph) and presses
    **Comment** in the toolbar. He writes the comment and says who it is for: **me** or **the
    AI**.
2.  Commented passages are highlighted in the editor. **Comments** in the editor's bar opens the
    list for the entry. Tapping a comment selects its passage.
3.  A comment for the AI has **Work on it**: the passage is rewritten as the comment asks, shown as
    a difference, and put in the text only when he presses Replace. This is the same rewrite as
    writing help, with the comment as the request.
4.  **Done** removes a comment. Replacing the passage with the AI's work also removes it.
5.  The entry's page says how many comments are open, with a link to them in the editor.

### Decisions (the two open questions in the backlog)

*   **Where comments are stored**: on the server, as working files in
    `/data/state/comments.json`, like lore conversations. They are not lore: not in the library, its
    history or any export, and the backup carries them as it carries the other working files.
*   **Published text or drafts**: both. A comment holds the words of its passage and about forty
    characters on each side, not a position, so it stays with its passage while the text around it
    changes, and does not care whether the text is a draft. When the passage itself is rewritten
    beyond recognition, the comment stays in the list marked "passage not found", and can still be
    read and removed.
*   **Renames**: a comment follows its entry when a rename is saved, through the publisher's
    existing rename hook.
*   **Quarantine**: Work on it is refused for a note waiting in quarantine, so the AI never reads one.

### Finding the passage again

`locate(text, comment)`: every place the passage's words occur is scored by how many characters of
the text before and after match the comment's stored surroundings; the best place wins. No
occurrence means "passage not found". This runs in the browser, on the editor's current text.

### API

| Method and path | Body | Response |
| --- | --- | --- |
| `GET /api/comments?path=` | | `{ comments }` for one entry |
| `GET /api/comments/count?path=` | | `{ open }` |
| `POST /api/comments` | `{ path, quote, prefix, suffix, text, for }` | `{ comment }` |
| `PATCH /api/comments/:id` | `{ text?, for? }` | `{ comment }` |
| `DELETE /api/comments/:id` | | `{ ok }` |
| `POST /api/comments/:id/work` | `{ before, after }` | `{ text }`: the rewrite, not saved |

Limits: a comment's words up to 2,000 characters, its passage up to 6,000, at most 300 comments on
one entry.

## More export formats

Added to the Export page beside web pages, Word and PDF. The same rules hold: only saved text, only
the chosen entries, appendices and quarantined notes never, links to entries left out marked.

| Kind | What | Links to entries left out |
| --- | --- | --- |
| **Markdown** | A zip: a `.md` file per entry, `README.md` listing them by folder, and `images/`. Links between entries are ordinary Markdown links between the files, so it reads on GitHub or in any Markdown editor. | Their words followed by "†", explained in `README.md` |
| **JSON** | One `.json` for other tools: per entry its title, path, folder, other names, properties, text in Markdown, and the entries it links to. Images are named, not included. | The same "†"; `unshared` lists their names per entry |
| **Slides** | One `.pptx` made by pandoc: a title slide per entry, a slide per section (`##` heading). Opens in PowerPoint, Keynote and Google Slides. | The same "†", with a closing slide explaining it |

Long sections make crowded slides; slides are a starting point to edit, not a finished deck.

## Files

| File | What |
| --- | --- |
| `apps/server/src/comments/store.ts` | The comments file |
| `apps/server/src/routes/comments.ts` | The routes |
| `apps/web/src/components/anchor.ts` | Finding a passage again; tested |
| `apps/web/src/components/commentMarks.ts` | Highlights in the editor |
| `apps/web/src/components/CommentsPanel.tsx` | The list, adding, Work on it |
| `apps/server/src/export/formats.ts` | `markdown`, `json`, `slides` |

## Verification

*   **Server**: comments added, listed, changed, removed, refused past the limits; following a
    rename; Work on it refused in quarantine and without a model. Each new export's contents.
*   **Web unit**: `locate` with a moved passage, a repeated passage, a lost passage.
*   **Browser**: a comment added on a selection, highlighted, worked on by the stand-in AI and
    replaced; a Markdown export downloaded.
