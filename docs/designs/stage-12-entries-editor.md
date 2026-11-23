# Stage 12: reading and writing entries

- **Author:** Elad Haviv
- **Status:** Approved after a Goldfish review (2026-11-23; findings in `.egm/review-12/`)
- **Date:** 2026-11-23
- **Parent:** [Stage 11](stage-11-foundations-shell-tree.md), which provides the shared pieces this stage
  uses: icons, tooltips, menus, the combobox, the keys registry, the save queue, the right side bar and
  the phone's slim top line. Comes from [`concepts_brief.md`](../../concepts_brief.md) (stages 11 to 15)
  and the author's list of 2026-11-22 in [`BACKLOG.md`](../BACKLOG.md). Review IDs (RD-1 and so on) are
  from [the UX review](../../ux-review/expert-review.md).

---

## Overview

Frontier is a single-author web app for writing the world of Avalymia as a library of Markdown entries.
Terms (draft, unpublished, rename intent, kept copy) are as in
[Stage 11, Terms](stage-11-foundations-shell-tree.md#terms). Stage 12 reworks the two screens the author
uses most, in two releases:

- **12a, reading.** Where am I (a sticky line on desktop, the slim line on a phone), an Outline tab,
  full width, renaming and moving in place, and History and Export as side-bar tabs.
- **12b, writing.** A toolbar with clear groups and a style picker; lists, indenting, code blocks,
  quotes, strikethrough and underline; a right-click menu on desktop; a clear Live preview / Source
  switch; and one image dialog (library, upload, paste, web address, search), which stage 13 reuses.

Properties, Comments and Writing help are already right-side-bar tabs since 11b. "Comment" opens the
comment form for the selection (stage 10); "Writing help" opens the AI panel that rewrites or asks the
lore about the selection (stage 8). This stage only gives them places in the new toolbar and menu.

## The Problem

- **Long entries lose the reader.** The title and Edit scroll away; the "On this page" outline is a
  collapsed box at the top that is gone once the reader scrolls (RD-1, RD-2).
- **Reading width is fixed** at a measure that suits prose but not tables or wide images.
- **Renaming and moving take a separate page** with a free-text path.
- **History and Export take the reader away** to separate pages.
- **The editor's tools are few.** No numbered lists, code blocks, quotes, strikethrough or underline
  except by typing Markdown; no style picker; no right-click menu; and "Preview" only hides marks, which
  is not clear (ED-1).
- **Images come only from the device.** Paste and drop into the editor already work, and the image
  button opens the file picker; but there is no way to pick an image already in the library, or take
  one from a web address, and the Gallery is a separate page.

## Goals

- **G1.** Once the title has scrolled away: on desktop a sticky line shows folder › entry › the current
  heading, with an outline button, Edit and "⋯"; on a phone the slim top line shows entry › heading and
  an outline button instead, with no second bar. It updates as the reader scrolls. (RD-1)
- **G2.** An Outline tab in the right side bar lists the headings (levels 1–3), marks the current one,
  and scrolls to one when chosen. The in-page "On this page" box is removed. (RD-2)
- **G3.** A full-width switch, remembered on the device, for reading and writing; it is in the entry's
  and the editor's "⋯" menus, and on the desktop sticky line.
- **G4.** Rename in place (a pencil beside the title) and "Move to…" (the folder combobox). An entry has
  at most one pending rename: a second rename or move replaces it. The page shows the pending name and
  folder. `/rename/…` redirects to the entry.
- **G5.** History and Export are right-side-bar tabs. History lists the versions that touched the entry;
  each opens the History page at that version. Export offers Web page, Word, PDF, Markdown and Slides for
  this entry.
- **G6.** The toolbar has, in groups: a style picker (Paragraph, Heading 1–6, Quote, Code block); Bold,
  Italic, Strikethrough, Underline, Inline code; Bullet list, Numbered list, Task list, Indent, Outdent;
  Link to an entry, Image, Horizontal rule; Comment, Writing help; Undo, Redo. The table group still
  appears while the cursor is in a table. Groups that do not fit go into a "⋯" at the end.
- **G7.** On desktop, right-clicking in the text opens a menu with Cut, Copy, Paste, the formatting
  commands, Style ▸, Link to an entry, Add an image, Comment and Writing help. Shift+right-click opens the
  browser's own menu (spelling suggestions). Phones use the toolbar's "⋯" instead.
- **G8.** Underline is written `<u>…</u>` and shown as underline in the editor, the reader, the web-page
  export and the Word, PDF and slide exports. Ctrl+U makes underline in the editor.
- **G9.** A Live preview / Source switch replaces "Preview". (ED-1)
- **G10.** One image dialog: the library's images (folders, search by file name or by entry, images used
  by entries first, then the rest, each by name; unpublished uploads included and marked), an "Upload…"
  button for several files, a "Paste image" button, and a web-address field. The Gallery page shows the
  same library view.
- **G11.** A web address is downloaded by the server with the safeguards in section 7.
- **G12.** No regressions; the browser tests cover each journey below.

## Non-Goals

- Callouts, table dialogs, footnotes, math. Typing Markdown still works.
- Searching the web for images (the author's answer: search is over the library's own images).
- Resizing or cropping in the dialog. Size is set in the editor, as today.
- Uploading images while offline. Upload, paste and web address need a connection until stage 15
  decides; the brief accepted this only for web addresses, so stage 15 must answer it.

## Decisions

| Decision                                                                    | Date       | Source                                                     |
| --------------------------------------------------------------------------- | ---------- | ---------------------------------------------------------- |
| Image search is over the library's own images                               | 2026-11-22 | author, brief                                              |
| Underline is `<u>`, shown everywhere                                        | 2026-11-23 | this design: Obsidian shows `<u>`; Markdown has none       |
| One outline: the sticky line (or slim line) and the Outline tab             | 2026-11-22 | brief, Alternatives Weighed                                |
| Web-address import stays, with the safeguards in section 7                  | 2026-11-22 | brief                                                      |
| History and Export stay side-bar tabs, as the author asked                  | 2026-11-23 | author's list; the review offered a menu instead (Alt. E)  |
| No right-click menu on phones                                               | 2026-11-23 | review: a long press conflicts with the phone's own selection |

## Critical User Journeys (CUJs)

### CUJ 1: Where am I in a long entry?

- **Covers:** G1, G2.
- **Given**: a long entry in `03 Places` with ten sections.
- **When**: he scrolls to the seventh section, presses the outline button, and chooses the third heading.
- **Then**: the sticky line read "03 Places › Harbor › Tides"; the Outline tab opened with "Tides" marked;
  choosing the third heading scrolls there, and the line follows. On a phone the slim line showed
  "Harbor › Tides".

### CUJ 2: Rename and move without leaving the entry

- **Covers:** G4.
- **When**: he presses the pencil beside "Harbor", types "Greywater Harbor" and presses Enter; then
  chooses "Move to…", types "isl" and picks "Islands".
- **Then**: the title shows "Greywater Harbor" and the line shows "Islands", marked unpublished. A toast
  gives the number of other entries whose links change, with Undo. There is one pending rename, from
  `03 Places/Harbor.md` to `Islands/Greywater Harbor.md`.

### CUJ 3: Write with the toolbar

- **Covers:** G6, G8, G9.
- **When**: he picks "Heading 2", writes a line, selects a word and presses Underline, makes three lines a
  numbered list, indents the second with Tab, and switches to Source.
- **Then**: the text holds `## …`, `<u>word</u>`, `1.`, `   1.`, `2.`; live preview shows a heading, an
  underlined word and a nested list; Source shows plain Markdown.

### CUJ 4: Add an image three ways

- **Covers:** G10, G11.
- **When**: he opens Image, searches "lamp" and picks one; opens it again and uploads two files; opens it
  again and enters a web address of a PNG.
- **Then**: each inserts `![[name]]` at the cursor, one per line for several. New images are unpublished.
  A web address that fails gives one plain reason and inserts nothing.

### CUJ 5: Right-click menu

- **Covers:** G7.
- **When**: on desktop he selects a phrase and right-clicks it, then chooses Comment; later he
  Shift+right-clicks a misspelt word.
- **Then**: our menu offered Cut, Copy, Paste, the formats, Style ▸, Link, Add an image, Comment and
  Writing help; Comment opened the form for that phrase. Shift+right-click showed the browser's menu.

## Technical Plan (Architecture)

### 1. Where am I (12a)

- **Headings are found in the rendered page,** not matched by text or line: the entry page watches the
  `h1`–`h3` elements inside `.prose` with one `IntersectionObserver` whose root is the main scrolling area
  (after 11b, the shell's main pane). The current heading is the last one above the top of that area.
  Their text is the rendered text, so marks never show, and two headings with the same text are separate.
  Links to `#heading-text` keep working as today.
- **Desktop:** the sticky line appears once the title has scrolled out, and holds the folder, the entry
  name, the current heading, the outline button, the full-width button, Edit and "⋯". The folder is
  written as stored (`03 Places`); choosing it opens the left bar's tree at that folder through
  `revealInTree(path)` from the shell. Levels shorten to "…" when they do not fit.
- **Phone:** the entry calls `usePageTitle` (the shell's slim-line hook) with "entry › heading" and the
  outline button once the title has scrolled out.
- **Outline tab:** registered with `usePanel` on the entry page when it has at least one heading, and on
  the editor page. In the editor, headings come from `extractHeadings` on the document (marks stripped
  for display) and the current one from the cursor line, reported by the editor's new `onCursor`
  callback; choosing a heading moves the cursor there. The outline button calls `openPanel("outline")`, a
  call 12a adds to the shell's panel registry.

### 2. Full width (12a)

A device setting (`localStorage` key `frontier:wide`, read with a fallback) adds the class `is-wide` to
the entry and editor page roots, which widens the measure from 44 rem (entry) and 52 rem (editor) to
72 rem. No shortcut: Ctrl+Shift+W closes the browser window and cannot be taken.

### 3. Rename and move in place (12a)

- **One pending rename per entry.** `EntryResponse` gains `rename: { id, to } | null`. Renaming or moving
  an entry that already has one deletes it and makes one intent from the published path to the new final
  path, so intents never chain. The page shows `to`'s name and folder, marked unpublished.
- **Rename:** the pencil turns the title (the file name without `.md`) into a field. Enter checks the name
  with `checkEntryName` (one helper in `@frontier/vault`, also used by New entry and the 11c tree), then
  calls `POST /api/renames` `{ from, to }`. Esc or leaving the field cancels; a refusal shows in place.
- **Move to…** opens the folder combobox (made openable from a menu, with the folder list shared with New
  entry), then the same call with the same name.
- Both are direct calls (as all renames are, because the server must work out which links change),
  refused while offline ("Needs a connection") and while the queue holds an unsent change to this entry
  ("Wait until your changes are sent"). The toast gives `affected`'s count with Undo, which deletes the
  intent (and restores the one it replaced, if any).
- The pencil, "Move to…", History and Export are hidden for read-only entries and entries marked for
  deletion, as the "⋯" menu is today. `Rename.tsx` is deleted; `/rename/*` redirects to the entry.

### 4. History and Export tabs (12a)

- **History:** the versions from `GET /api/history?path=` (date, line of description); each opens
  `/history/…` at that version. History follows the entry across saved renames (Git follows renames); a
  pending rename is not yet in it.
- **Export:** Web page, Word, PDF, Markdown and Slides, through `downloadExport(kind, { title: <entry
  name>, paths: [path] })`. JSON is left out: it is for other tools, on the Export page. An export uses the
  last saved version; with unpublished changes the tab says so, as the Export page does. Disabled offline.

### 5. The editor's tools (12b)

- **Commands live in the existing `editCommands.ts`,** which the toolbar and the keys registry already
  share. Each is written as a function of the editor state returning a change (testable without a view),
  with a small wrapper for the view:
  - block style: paragraph, heading level, quote `> `, code fence;
  - inline: toggle `**`, `*`, `~~`, `<u>…</u>`, `` ` `` on the selection or the word at the cursor;
    toggling again removes the marks;
  - lists: toggle `- `, `1. ` or `- [ ] ` on the selected lines; renumbering uses
    `@codemirror/lang-markdown`'s list handling where it exists;
  - indent: in a list item, Tab indents it under the item above by that item's marker width (2 for `- `,
    3 for `1. `); a first item does not move. In a table, Tab moves between cells, as today. Elsewhere,
    Tab indents as today. Shift+Tab does the reverse. The registry's `editor.indent` and `editor.outdent`
    are rebound to these;
  - insert: horizontal rule; link (opens the entry combobox at the cursor; inserts `[[name]]`, using the
    file's stem when it is unique in the library and its path otherwise, the rule renames already use);
    image (opens the dialog).
- **Toolbar:** groups divided by thin rules; the style picker is a menu whose trigger shows the current
  line's style. CSS container queries hide groups at set widths, last group first, and "⋯" holds whatever
  is hidden, so the toolbar never wraps or scrolls and nothing is measured in script. The table group
  appears in a table. The hidden file input stays, for "Upload…".
- **Right-click menu (desktop only):** a wrapping element is the Radix context-menu trigger. The editor
  selection is read on `pointerdown` and kept; focus returns to the editor when the menu closes.
  Shift+right-click is left to the browser. Cut writes with `navigator.clipboard.writeText` and deletes
  only after it succeeds, in one undo step. Paste reads with `navigator.clipboard.read()`: images go to
  the upload path, text is inserted as a paste (`input.paste`, line endings normalised); if the browser
  refuses, the item shows "Use Ctrl+V".
- **Live preview / Source:** two buttons in a group (`aria-pressed`), keeping today's `frontier.preview`
  setting. Source already shows Markdown in the monospace font.
- **Live preview** hides `~~` and `<u>`/`</u>` away from the cursor and styles the text, as for `**`.

### 6. Underline everywhere (12b)

- **Reader and web-page export:** one remark plugin, `remarkUnderline` in `@frontier/vault` (no runtime
  dependency; types only), turns an inline `<u>` and its matching `</u>` among the same parent's inline
  children (paragraph, heading, list item, table cell) into an underline node rendered as `<u>`.
  Unmatched tags stay as text. A `<u>` alone on a line is an HTML block in Markdown and stays as text. Both
  sanitize schemas allow `u`.
- **Word, PDF and slides:** pandoc reads `<u>` as raw HTML and drops it, so the server rewrites each
  matched `<u>x</u>` to `[x]{.underline}` (outside code spans and fences) when it builds pandoc's input;
  pandoc turns that into underline for docx, Typst and pptx.
- **Readers of raw text:** AI quotes (`plainForQuotes`) and search snippets strip `<u>` and `</u>` as they
  strip `**`. Comment anchors match the raw text, tags included, as they already do for other marks.

### 7. The image dialog and web addresses (12b)

**`ImagePicker`** returns a list of paths; the editor inserts one `![[name]]` per line (name as for links,
section 5). It holds:

- **the library view** (`LibraryView`, also used by the Gallery page in its browsing mode with its
  used/unused/icons filters): folders down the side, a grid of thumbnails (the existing 320 px variant)
  rendered lazily, a search field over file names and the titles of entries that use each image. Order:
  used by entries first, then the rest, each by name. `GET /api/gallery` adds unpublished uploaded images,
  marked;
- **Upload…**: the file picker for several files, each through `POST /api/images` as today;
- **Paste image**: reads the clipboard with `navigator.clipboard.read()` (a button, so it works on a
  phone); pasting into the editor itself keeps working as today;
- **a web address field**: `POST /api/images/from-url`.

**`POST /api/images/from-url`** `{ url }` (at most 2,048 characters) → `{ path, embed }`, like an upload:

- **Where it may go:** only `http:` and `https:`, only ports 80 and 443. The host is resolved with a
  c-ares resolver under a 3-second timeout; every address returned must be ordinary public unicast
  (checked with `ipaddr.js`, after turning IPv4-mapped IPv6 back into IPv4), and none may be one of the
  server's own public addresses (found from `PUBLIC_URL`'s host at start). If any address fails, the
  request is refused. The connection is pinned to the checked address (an undici agent whose lookup
  returns it), with the original host name for TLS; proxy settings are not used.
- **Redirects** are followed by hand, at most 3, each checked as above.
- **Limits:** 15 seconds in all; `Accept-Encoding: identity`; a `Content-Length` over 25 MB is refused at
  once, and the body stops at 25 MB.
- **What it accepts:** the bytes must be an image `sharp` reads as JPEG, PNG, WebP, GIF or AVIF (saved as
  `.jpg`, `.png`, `.webp`, `.gif`, `.avif`); everything else, SVG included, is refused. The name is the
  address's last part, decoded, cleaned as uploads are, cut to 80 characters (or "image"), then made
  unique.
- **Answers:** one plain message for every network or safety failure ("Frontier could not get an image
  from that address."), code `image_fetch_failed`; `invalid` for a malformed address. Details (host,
  size, result, reason) go to the server log only, never the address's query.
- **Rate:** at most 10 a minute, through `@fastify/rate-limit` on this route.
- **Tests:** a config switch, `IMAGE_FETCH_ALLOW_LOOPBACK`, off by default and refused when
  `NODE_ENV=production`, lets the tests fetch from a local test server.

## Risks & Mitigations

| Risk | Mitigation |
| --- | --- |
| The web-address route reaches internal services or the host's own ports | Allow-list of public unicast addresses, all resolved addresses checked, pinned connection, ports 80/443 only, the host's own addresses refused, one generic error; tests for loopback, private, CGNAT, IPv4-mapped, redirect-to-private, own address, odd port |
| An image from the web carries script (SVG) | SVG refused; only raster formats accepted |
| Slow DNS ties up the server | c-ares resolver with a timeout, not the shared thread pool |
| `<u>` shows as text somewhere | One plugin for remark pipelines, the pandoc rewrite for documents, and the raw-text readers listed; a test for each |
| Our right-click menu hides spelling suggestions | Shift+right-click gives the browser's menu |
| A long press clashes with the phone's text selection | No long-press menu on phones |
| Many uploads by mistake | Each is an unpublished image that Discard (in the list of unsaved changes) removes |
| A shortcut the browser reserves | No new key on Ctrl+Shift+W, Ctrl+Alt+digit (AltGr on European keyboards) or other reserved keys |

## Alternatives Considered

### Alternative A: Keep "On this page" and add a breadcrumb

- **Cons**: Three ways to show one outline.
- **Reason for Rejection**: One line plus one tab shows the place and the outline once (brief).

### Alternative B: Underline as `++text++` or a custom mark

- **Cons**: Obsidian and pandoc show it as text.
- **Reason for Rejection**: `<u>` is shown by Obsidian; pandoc needs only a rewrite on the way in.

### Alternative C: The browser fetches the web address

- **Cons**: Most image hosts refuse other sites' requests, and the page allows images from Frontier only.
- **Reason for Rejection**: The server can fetch, with the safeguards.

### Alternative D: A separate fetch service or worker for web addresses

- **Pros**: Isolates the fetch from the server's network.
- **Cons**: A second deployment for one author's occasional use.
- **Reason for Rejection**: The address checks, pinning and port limits cover the risk in-process.

### Alternative E: History and Export as menu items, not tabs

- **Pros**: Export is five one-off actions; History's diff is cramped in a panel.
- **Reason for Rejection**: The author asked for them in the side bar. History's tab lists versions and
  opens the full page, so nothing is cramped.

### Alternative F: Keep the browser's right-click menu, tools only in the toolbar

- **Pros**: No conflict with spelling suggestions.
- **Reason for Rejection**: The author asked for a context menu; Shift+right-click keeps the browser's.

### Alternative G: A rich-text (block) editor

- **Reason for Rejection**: The master design keeps Markdown as written ([frontier.md](frontier.md)).

---

## Detailed Implementation Plan

Two releases. Each must pass the Verification Plan before it is merged and deployed.

### Release 12a: reading

1. `packages/vault/src/names.ts` (Create), exported from `index.ts` (Modify): `checkEntryName(name)`,
   the rules New entry and Rename use today. `packages/vault/test/names.test.ts` (Create).
2. `packages/schema/src/api.ts` (Modify): `EntryResponse.rename: { id, to } | null`.
3. `apps/server/src/routes/entries.ts` (Modify): fills `rename` from the draft store's intents.
4. `apps/server/src/routes/drafts.ts` (Modify): `POST /api/renames` replaces an existing intent whose
   `from` (or whose `to`) is the given `from`, keeping one per entry, and returns `{ id, affected,
   replaced }`. `apps/server/test/publish.test.ts` (Modify): rename then move gives one intent.
5. `apps/web/src/components/shell/panels.tsx` (Modify): `openPanel(id)`; `apps/web/src/components/shell/`
   (Modify) `revealInTree(path)`. (`usePageTitle` comes from 11b.)
6. `apps/web/src/components/entry/StickyLine.tsx` + `.css`, `entry/useCurrentHeading.ts`,
   `entry/OutlinePanel.tsx` + `.css`, `entry/HistoryPanel.tsx` + `.css`, `entry/ExportPanel.tsx` +
   `.css`, `entry/RenameField.tsx` + `.css` (Create).
7. `apps/web/src/pages/Entry.tsx` (Modify): the sticky line or slim-line title, the pencil, "Move to…" and
   full width in "⋯", the panels; removes the "On this page" box.
8. `apps/web/src/components/ui/Combobox.tsx` (Modify): an `open`/`onOpenChange` pair so a menu can open
   it. `apps/web/src/components/folders.ts` (Create): the folder list from the tree, moved out of
   `NewEntry.tsx` (Modify), which uses `checkEntryName`.
9. `apps/web/src/components/CodeEditor.tsx` (Modify): `onCursor(line)`. `apps/web/src/pages/Edit.tsx`
   (Modify): the Outline panel from the document; full width.
10. `apps/web/src/width.ts` (Create): the `frontier:wide` setting and hook.
11. `apps/web/src/pages/Rename.tsx` (Delete); `apps/web/src/App.tsx` (Modify): `/rename/*` redirects to
    `/e/*`.
12. `apps/web/src/styles.css` (Modify): remove `.outline*`; add `.is-wide`.
13. E2E (Modify): `navigate.spec.ts` (the outline test at 74–77 becomes the Outline tab; the rename tests
    at 55 and after use the pencil; CUJ 2), `reader.spec.ts` (CUJ 1, desktop), `export.spec.ts` and
    `library.spec.ts` (the Export and History tabs).

### Release 12b: writing

14. `packages/vault/src/underline.ts` (Create), `packages/vault/package.json` (Modify: `@types/mdast` as a
    dev dependency), `index.ts` (Modify). `packages/vault/test/underline.test.ts` (Create): matched,
    unmatched, inside bold, in a heading and a table cell, a block `<u>` line, across lines (text).
15. `apps/web/src/render/Markdown.tsx` (Modify): the plugin; `u` allowed. `apps/web/src/render/
    markdown.test.ts` (Create): `<u>` renders.
16. `apps/server/src/export/formats.ts` (Modify): the plugin and `u` in the web-page pipeline; the
    `[x]{.underline}` rewrite in the pandoc input. `apps/server/test/export.test.ts` (Modify): underline in
    web pages, the Word XML (`<w:u`), and the Typst source (`#underline`).
17. `apps/server/src/ai/lore.ts` (Modify, `plainForQuotes`), `apps/server/src/index/search.ts` (Modify,
    snippets): strip `<u>`/`</u>`; tests in `lore.test.ts` and `search.test.ts` (Modify).
18. `apps/web/src/components/editCommands.ts` (Modify): the commands of section 5;
    `editCommands.test.ts` (Create).
19. `apps/web/src/keys.ts` (Modify): rebinds `editor.indent`/`editor.outdent`; adds `editor.underline`
    (Ctrl+U), `editor.strike` (Ctrl+Shift+X), `editor.numbered` (Ctrl+Shift+7), `editor.bullets`
    (Ctrl+Shift+8), `editor.heading1`…`6` (Ctrl+Shift+1…6), `editor.paragraph` (Ctrl+Shift+0), each with a
    label.
20. `apps/web/src/components/ui/ContextMenu.tsx` (Modify): submenus; `ui/Menu.tsx` (Modify): a text
    trigger.
21. `apps/web/src/components/EditToolbar.tsx` + `.css` (Rewrite): groups, style picker, container-query
    overflow, the table group, the file input.
22. `apps/web/src/components/EditorContextMenu.tsx` + `.css` (Create).
23. `apps/web/src/components/livePreview.ts` (Modify): `~~` and `<u>`.
24. `apps/web/src/pages/Edit.tsx` (Modify): the Live preview / Source pair; the context menu; the image
    dialog.
25. `apps/web/src/components/images/ImagePicker.tsx` + `.css`, `images/LibraryView.tsx` + `.css`,
    `images/UrlField.tsx` (Create). `apps/web/src/pages/Gallery.tsx` (Modify): uses `LibraryView`.
26. `apps/web/src/api.ts` (Modify): `imageFromUrl(url)`; the gallery's `unpublished` flag.
27. `apps/server/src/images/save.ts` (Create): the upload's save step, moved out of `routes/images.ts`
    (Modify) and shared by both routes. `apps/server/src/images/fromUrl.ts` (Create): section 7.
    `apps/server/package.json` (Modify): `ipaddr.js`, `undici`.
28. `apps/server/src/routes/images.ts` (Modify): `POST /api/images/from-url` with its rate limit;
    `/api/gallery` adds unpublished images. `apps/server/src/config.ts` (Modify):
    `IMAGE_FETCH_ALLOW_LOOPBACK`.
29. `packages/schema/src/api.ts` (Modify): `ImageFromUrlRequest = z.object({ url: z.string().max(2048) })`.
30. `apps/server/test/upload.test.ts` (Modify): every case in the Risks table's first row against a local
    test server, size and time limits, SVG refused, name rules.
31. E2E (Modify): `editor.spec.ts` (CUJ 3, CUJ 5; "Preview" becomes "Live preview"/"Source" at lines 66,
    78, 101, 118, 156, 160, 338; the toolbar count at 333; the upload test at 16 goes through "Upload…"),
    `write.spec.ts` (the Heading button becomes the style picker; "Link to an entry" uses the combobox),
    `ai.spec.ts` (Writing help and Comment through "⋯" at phone size), `gallery.spec.ts` (the library view;
    CUJ 4 library and upload; paste by dispatching a `ClipboardEvent` from `page.evaluate`).

### Verification Plan

- `npm run typecheck && npm run lint && npm run format && npm test && npm run build && npm run e2e`.
- Vault keeps 90% branch coverage.
- First-load JS gzipped (Vite's build output) stays within 80 KB of 506.32 kB, the size before stage 11.
- Screens at desktop and phone size: an entry scrolled halfway, the editor toolbar, the image dialog.
