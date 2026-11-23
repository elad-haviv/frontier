# Stage 12: reading and writing entries

*   **Author:** Elad Haviv
*   **Status:** Proposed
*   **Date:** 2026-11-23
*   **Parent:** [Stage 11](stage-11-foundations-shell-tree.md), which provides the shared pieces this stage
    uses: icons, tooltips, menus, the combobox, the keys registry, the save queue and the right side bar.
    Comes from [`concepts_brief.md`](../../concepts_brief.md) (stages 11 to 15) and the author's list of
    2026-11-22 in [`BACKLOG.md`](../BACKLOG.md).

--------------------------------------------------------------------------------

## Overview

Frontier is a single-author web app for writing the world of Avalymia as a library of Markdown entries
(see [Stage 11, Overview](stage-11-foundations-shell-tree.md#overview) and its Terms). Stage 12 reworks
the two screens the author spends most time on: reading an entry and writing one. It ships in two
releases:

*   **12a, reading.** A sticky line on long entries showing where the reader is (folder › entry › heading),
    an Outline tab in the right side bar, a full-width switch, renaming in place, moving with the folder
    combobox, and History and Export as right-side-bar tabs.
*   **12b, writing.** A toolbar with clear groups and a style picker; lists, indenting, code blocks,
    quotes, strikethrough and underline; a context menu; a clear Live preview / Source switch; and one
    image dialog (browse the library, upload or drop, paste, a web address the server downloads, search),
    which stage 13 reuses for maps.

## The Problem

*   **Long entries lose the reader.** The title and Edit scroll away; the "On this page" outline is a
    collapsed box at the top that is gone once the reader scrolls (UX review RD-1, RD-2).
*   **Reading width is fixed** at a measure that suits prose but not tables or wide images.
*   **Renaming and moving take a separate page.** Rename opens `/rename/…`, a form with a free-text path;
    moving means typing a folder path by hand.
*   **History and Export take the reader away** from the entry to separate pages.
*   **The editor's tools are few and hidden.** There is no way to make a numbered list, a code block, a
    quote, strikethrough or underline except by typing Markdown; no style picker; no context menu; and
    the "Preview" button only hides marks, which is not clear (ED-3).
*   **Adding an image is narrow.** The image button opens the device's file picker. There is no way to
    pick an image already in the library, paste one, or take one from the web, and the Gallery page is
    separate from the editor.

## Goals

*   **G1.** On an entry longer than one screen, a sticky line shows folder › entry › the current heading,
    with Edit and the "⋯" menu, and updates as the reader scrolls. (RD-1)
*   **G2.** An Outline tab in the right side bar lists the headings, marks the current one, and scrolls
    to a heading when chosen. The sticky line has a button that opens it. The in-page "On this page"
    box is removed. (RD-2)
*   **G3.** A full-width switch, remembered on the device, applies to reading and writing.
*   **G4.** Rename in place: a pencil beside the title turns it into a field; Enter renames, Esc cancels.
    Move: "Move to…" opens the folder combobox. Both make a rename intent, as today. The `/rename/` page
    redirects to the entry.
*   **G5.** History and Export are right-side-bar tabs on the entry. History lists the versions that
    touched the entry and shows one's difference in the panel, with "Open full page" for the existing
    History page. Export offers this entry's formats.
*   **G6.** The editor toolbar has, in groups: a style picker (Paragraph, Heading 1–6, Quote, Code
    block); Bold, Italic, Strikethrough, Underline, Inline code; Bullet list, Numbered list, Task list,
    Indent, Outdent; Link to an entry, Image, Horizontal rule; Comment, Writing help; Undo, Redo. On a
    phone, what does not fit goes into a "⋯" at its end.
*   **G7.** A context menu in the editor (right-click, or long press on touch) with Cut, Copy, Paste,
    the formatting commands, Link to an entry, Add an image, Comment and Writing help.
*   **G8.** Underline is written as `<u>…</u>` (Markdown has no underline; Obsidian shows `<u>`), and is
    shown as underline in the editor, the reader, the web-page export and the Word, PDF and slide
    exports. Ctrl+U makes underline in the editor.
*   **G9.** A clear Live preview / Source switch replaces "Preview". (ED-3)
*   **G10.** One image dialog with tabs: Library (browse by folder, search by name or by entry, newest
    used first), Upload (pick or drop several files), Paste (an image on the clipboard) and Web address.
    The Gallery page uses the same Library view.
*   **G11.** A web address is downloaded by the server, safely (section 6), and saved like an upload.
*   **G12.** No regressions; the browser tests cover each journey below.

## Non-Goals

*   **Callouts, tables made from a dialog, footnotes, math.** Typing Markdown still works; tools for them
    can come later.
*   **Searching the web for images.** "Search" is over the library's own images (author's answer,
    2026-11-22).
*   **Resizing or cropping images in the dialog.** Image size is set in the editor, as today.
*   **Offline image import.** Upload, paste and web address need a connection (accepted in the brief).

## Decisions

| Decision | Date | Source |
| --- | --- | --- |
| Image search is over the library's own images | 2026-11-22 | author, brief |
| Underline is `<u>`, shown everywhere | 2026-11-23 | this design (Obsidian renders `<u>`; Markdown has no underline) |
| The three outlines become one: the sticky line and the Outline tab | 2026-11-22 | brief, Alternatives Weighed |
| Web-address import stays, with the guards in section 6 | 2026-11-22 | brief |

## Critical User Journeys (CUJs)

### CUJ 1: Where am I in a long entry?

*   **Covers:** G1, G2.
*   **Given**: a long entry with ten sections.
*   **When**: he scrolls to the seventh section, then presses the outline button on the sticky line and
    chooses the third heading.
*   **Then**: the sticky line read "Places › Harbor › Tides" while he was in that section; the Outline tab
    opened with "Tides" marked; choosing the third heading scrolls there and the line updates.

### CUJ 2: Rename and move without leaving the entry

*   **Covers:** G4.
*   **When**: he presses the pencil beside "Harbor", types "Greywater Harbor", presses Enter; then
    chooses "Move to…" in "⋯", types "isl", and picks "Islands".
*   **Then**: the title shows the new name, marked unpublished; a toast says how many links will change;
    after the move the sticky line shows the new folder. Both are pending rename intents until a version
    is saved.

### CUJ 3: Write with the toolbar

*   **Covers:** G6, G8, G9.
*   **When**: in the editor he picks "Heading 2" from the style picker, writes a line, selects a word and
    presses Underline, then makes three lines a numbered list, indents the second with Tab, and switches
    to Source.
*   **Then**: the text holds `## …`, `<u>word</u>` and `1.`, `   1.`, `2.`; live preview shows a heading,
    an underlined word and a nested list; Source shows the plain Markdown in monospace.

### CUJ 4: Add an image four ways

*   **Covers:** G10, G11.
*   **When**: he opens Image; searches "lamp" in Library and picks one; then opens it again and drops a
    file; then pastes a screenshot; then enters a web address of a PNG.
*   **Then**: each inserts `![[name]]` at the cursor. Uploaded, pasted and downloaded images are new
    unpublished images in the upload folder. A web address that is not an image, too large, or
    unreachable gives a clear reason and inserts nothing.

### CUJ 5: Context menu

*   **Covers:** G7.
*   **When**: he selects a phrase and right-clicks it (or long-presses on the phone).
*   **Then**: the menu offers Cut, Copy, Paste, Bold, Italic, Strikethrough, Underline, Style ▸, Link to
    an entry, Add an image, Comment and Writing help; choosing Comment opens the comment form for that
    phrase.

## Technical Plan (Architecture)

### 1. The sticky line and the Outline tab (12a)

*   The entry page already receives each heading with its line (`headings` from the server index). Each
    rendered heading carries an id. One `IntersectionObserver` tracks which heading's section is at the
    top of the reading area; that is the "current" heading.
*   The sticky line appears once the title has scrolled out of view, sits below the phone's slim line,
    and holds: the folder (a link to the folder in the tree), the entry's name, the current heading, the
    outline button, Edit, and "⋯". Breadcrumb levels shorten to "…" when they do not fit.
*   The Outline panel registers with `usePanel` on entry and editor pages. In the editor it reads
    headings from the CodeMirror document (the same parser, `extractHeadings` from `@frontier/vault`) and
    the current one from the cursor; choosing one moves the cursor there.

### 2. Full width (12a)

A device setting (`localStorage`, read with a fallback) toggles a class on the main area that lifts the
reading measure. A button on the sticky line and in the editor's "⋯", and the shortcut Ctrl+Shift+W
(through the keys registry).

### 3. Rename and move in place (12a)

*   The pencil (an `IconButton`) turns the title into a text field holding the name. Enter calls
    `POST /api/renames` with the new path in the same folder; Esc or leaving the field cancels. Names are
    checked in the browser with the same rules as today's Rename page (no `/`, no characters the vault
    forbids, not empty), and the server's answer shows in place if it refuses.
*   "Move to…" opens the folder combobox (from 11a-1); choosing a folder calls the same route with the
    new folder and the same name.
*   Both are direct calls, refused while offline ("Needs a connection"), and give a toast with the count
    of entries whose links change and Undo (which deletes the intent), as folder moves do in 11c.
*   `/rename/*` redirects to the entry with the field open.

### 4. History and Export tabs (12a)

*   **History** lists `GET /api/history?path=` entries (date, message); choosing one shows its
    difference in the panel with the existing `Diff` component and "Restore this version" (which goes
    through the queue, as History does since 11a-2). "Open full page" goes to `/history/…`.
*   **Export** offers Web page, Word, PDF, Markdown and slides for this one entry, with the same calls as
    the Export page (`downloadExport(kind, { title, paths: [path] })`).

### 5. The editor's tools (12b)

*   **Commands.** Each tool is a CodeMirror command in one module, `editorCommands.ts`, used by the toolbar,
    the context menu and the keys registry, so a tool behaves the same from all three:
    *   style: set the line's block style (paragraph, heading level, quote `> `, code block fence);
    *   inline: wrap or unwrap the selection (`**`, `*`, `~~`, `<u>…</u>`, `` ` ``); with no selection,
        the word at the cursor;
    *   lists: toggle `- `, `1. ` or `- [ ] ` on each selected line, renumbering numbered lists; indent and
        outdent by the list's indent unit (Tab and Shift+Tab call the same commands);
    *   insert: horizontal rule, link (opens the entry combobox, inserts `[[name]]`), image (opens the
        dialog).
*   **Toolbar.** Groups separated by thin rules; the style picker is a `Menu` showing the current line's
    style. The toolbar measures its width and moves the tools that do not fit into a "⋯" menu, last group
    first, so it never wraps or scrolls.
*   **Context menu.** A Radix `ContextMenu` around the editor. It keeps CodeMirror's selection while open.
    Cut and Copy write the selection with `navigator.clipboard.writeText`; Paste reads with
    `navigator.clipboard.readText`, and where the browser refuses, the item says "Use Ctrl+V".
*   **Live preview / Source.** A two-state switch replaces "Preview". Source turns live preview off and
    shows Markdown in the monospace font.
*   **Live preview of new marks.** `livePreview.ts` hides `~~` and `<u>`/`</u>` away from the cursor and
    styles their text, as it does for `**`.

### 6. Underline everywhere (12b)

One remark plugin, `remarkUnderline` in `@frontier/vault` (used by both the web app and the server),
turns an inline `<u>` and its matching `</u>` in one paragraph into an `underline` node, rendered as
`<u>`. Unmatched tags stay as text. The reader (`render/Markdown.tsx`) and the web-page export (the
server's remark pipeline in `export/formats.ts`) add it and allow `u` in their sanitize schema. Pandoc
reads `<u>` as underline for Word, PDF and slides; a test checks the Word output. Comment anchors work on
the text without tags, as for other marks.

### 7. The image dialog (12b)

One component, `ImagePicker`, opened by the editor's Image tool and (in stage 13) by maps. Its result is
an image path; the editor inserts `![[name]]`.

| Tab | How |
| --- | --- |
| Library | `GET /api/gallery`: folders down the side, thumbnails (the existing 320 px variant) in a grid, images used by entries first. A search field filters by file name or by the title of an entry that uses the image |
| Upload | a drop zone and a file picker taking several files; each goes through `POST /api/images` as today |
| Paste | while the dialog is open, a pasted image is uploaded the same way; the tab says "Press Ctrl+V" |
| Web address | a field; `POST /api/images/from-url` (below) |

The Gallery page renders the same Library view, with its tabs for icons kept.

**`POST /api/images/from-url`**, `{ url }` → `{ path, embed }`, the same answer as an upload:

*   only `http:` and `https:`; at most 2,048 characters;
*   the host is resolved first, and the request goes to that address only if it is public: loopback,
    private (10/8, 172.16/12, 192.168/16, fc00::/7), link-local (169.254/16, fe80::/10, including the
    cloud metadata address), multicast, `0.0.0.0` and `::` are refused. The connection is made to the
    resolved address with the original host name sent, so a second lookup cannot change it;
*   at most 3 redirects, each checked the same way;
*   15 seconds in all; the body is read up to 25 MB and the request stops beyond that;
*   the bytes must be an image `sharp` can read; the name comes from the address's last part (or
    "image"), with the extension of the real type;
*   at most 10 a minute, with the existing rate limiter;
*   each attempt is logged with the host, size, result and reason, never the full address's query.

Saved as an image draft, exactly as an upload.

## Risks & Mitigations

| Risk | Mitigation |
| --- | --- |
| The web-address route reaches internal services | The checks in section 7, tested against loopback, private, link-local and redirect-to-private cases with a local test server |
| A wrong click inserts many uploads into the library | Each upload is an unpublished image that Discard removes; nothing is saved until "Save a version" |
| `<u>` appears as text in a renderer that was missed | One plugin shared by every Markdown pipeline; a test per pipeline |
| The context menu fights the browser's own on touch | Long press opens ours only inside the editor's text; the browser's text selection handles still work |
| The toolbar's overflow measuring flickers | Widths are measured once per resize with `ResizeObserver`, not per render |

## Alternatives Considered

### Alternative A: Keep the in-page "On this page" box and add a breadcrumb

*   **Cons**: Three ways to show one outline.
*   **Reason for Rejection**: One sticky line plus one Outline tab shows the place and the outline without
    repeating them (brief).

### Alternative B: Underline as `++text++` or a custom mark

*   **Cons**: Obsidian and pandoc show it as plain text.
*   **Reason for Rejection**: `<u>` is shown by Obsidian and read by pandoc.

### Alternative C: A web-address field that the browser fetches

*   **Cons**: Most image hosts refuse other sites' requests (no CORS headers), and the page's own rules
    allow images from Frontier only.
*   **Reason for Rejection**: The server can fetch, with guards.

### Alternative D: A rich-text (block) editor

*   **Cons**: Rewrites the editor, and the master design rejected it to keep the Markdown as written
    ([frontier.md](frontier.md), "A block-style editor").
*   **Reason for Rejection**: CodeMirror commands give the same tools while the file stays plain Markdown.

--------------------------------------------------------------------------------

## Detailed Implementation Plan

Two releases. Each must pass the Verification Plan before it is merged and deployed.

### Release 12a: reading

1.  `apps/web/src/pages/Entry.tsx` (Modify): heading ids; the sticky line component; the pencil and
    rename field; "Move to…" in "⋯"; removes the "On this page" box; registers the Outline, History and
    Export panels.
2.  `apps/web/src/components/entry/StickyLine.tsx`, `entry/useCurrentHeading.ts`,
    `entry/OutlinePanel.tsx`, `entry/HistoryPanel.tsx`, `entry/ExportPanel.tsx`,
    `entry/RenameField.tsx` (Create), each with CSS where it draws anything.
3.  `apps/web/src/pages/Edit.tsx` (Modify): registers the Outline panel fed from the editor; full-width
    class.
4.  `apps/web/src/width.ts` (Create): the full-width device setting and hook; the shortcut in `keys.ts`
    (Modify).
5.  `apps/web/src/pages/Rename.tsx` (Modify): redirects to the entry with the field open.
6.  `apps/web/src/api.ts` (Modify): `history(path)` typed if not already.
7.  `apps/web/e2e/reader.spec.ts` (Modify): CUJ 1 at desktop size; the outline box test becomes the
    Outline tab. `apps/web/e2e/navigate.spec.ts` (Modify): rename and move through the title and "⋯"
    (CUJ 2). `apps/web/e2e/export.spec.ts`, `library.spec.ts` (Modify): the entry's Export and History
    tabs.

### Release 12b: writing

8.  `packages/vault/src/underline.ts` (Create), exported from `packages/vault/src/index.ts` (Modify):
    `remarkUnderline`. `packages/vault/test/underline.test.ts` (Create): matched, unmatched, nested in
    bold, across lines (left as text).
9.  `apps/web/src/render/Markdown.tsx` (Modify): the plugin; `u` allowed.
10. `apps/server/src/export/formats.ts` (Modify): the plugin in the web-page pipeline; `u` allowed.
    `apps/server/test/export.test.ts` (Modify): underline in web pages and in the Word document's XML.
11. `apps/web/src/components/editorCommands.ts` (Create) and `editorCommands.test.ts` (Create, on an
    `EditorState` with no view): every command, including renumbering and indenting nested lists.
12. `apps/web/src/components/EditToolbar.tsx` (Rewrite): groups, the style picker, the overflow menu.
13. `apps/web/src/components/EditorContextMenu.tsx` (Create).
14. `apps/web/src/components/livePreview.ts` (Modify): strikethrough and underline marks.
15. `apps/web/src/keys.ts` (Modify): Ctrl+U, Ctrl+Shift+X (strikethrough), Ctrl+Shift+7 (numbered),
    Ctrl+Shift+8 (bullets), Ctrl+Alt+1…6 (headings), Ctrl+Alt+0 (paragraph), Shift+Tab (outdent).
16. `apps/web/src/pages/Edit.tsx` (Modify): the Live preview / Source switch replaces Preview; mounts the
    context menu.
17. `apps/web/src/components/images/ImagePicker.tsx`, `images/LibraryView.tsx`, `images/UploadTab.tsx`,
    `images/UrlTab.tsx` (Create), with CSS.
18. `apps/web/src/pages/Gallery.tsx` (Modify): uses `LibraryView`.
19. `apps/server/src/images/fromUrl.ts` (Create): the guarded fetch of section 7 (Node `dns.lookup` with
    `all: true`, `net.BlockList` for the ranges, `http`/`https` request with a `lookup` that returns the
    checked address, redirects followed by hand).
20. `apps/server/src/routes/images.ts` (Modify): `POST /api/images/from-url`, rate-limited, saving through
    the same code as an upload (extracted into one function).
21. `packages/schema/src/api.ts` (Modify): `ImageFromUrlRequest`.
22. `apps/server/test/images.test.ts` (Modify): a local HTTP server serving a PNG, a text file, a large
    body and a redirect; loopback refused unless the test turns on an allow-list for it; private and
    link-local addresses refused; redirect to a refused address refused; size and time limits.
23. `apps/web/e2e/editor.spec.ts` (Modify): CUJ 3 and CUJ 5. `apps/web/e2e/gallery.spec.ts` (Modify): the
    Library view; CUJ 4's library, upload and paste paths (the web-address path is covered by server
    tests, since the browser tests have no outside network).

### Verification Plan

*   `npm run typecheck && npm run lint && npm run format && npm test && npm run build && npm run e2e`.
*   First-load JS gzipped stays within 80 KB of the measure taken before stage 11.
*   Screens: an entry scrolled halfway at desktop and phone size, the editor toolbar at both sizes, the
    image dialog's four tabs.
