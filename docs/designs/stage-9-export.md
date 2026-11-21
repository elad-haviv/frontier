# Stage 9: export

Status: Draft, 2026-11-21. Author: Elad Haviv. Parent: [Frontier](frontier.md).

## Overview

The library can already be exported whole, as a zip for Obsidian. This stage adds exports meant
for reading and sharing. The author decided on 2026-11-21:

1.  **Four kinds**: styled web pages, Word documents, PDF, and pictures of maps.
2.  **Links to entries outside an export** stay as their words, **marked as unpublished**, so a
    reader sees there is more that was not shared.

## What is exported

*   **Which entries.** A folder (with everything under it) or entries picked one by one, on the new
    **Export** page. A single entry can be exported from its own page.
*   **Which text.** What is published: the library as of the last saved version, as the zip export
    is. Unsaved changes are not exported, and the page says so when the chosen entries have some.
*   **Never exported**: appendices (`99 Appendices/`), Frontier's own files, and notes waiting in
    quarantine.
*   **Order.** By folder, then by title, as in the folder list. An entry's own heading is its title;
    the headings inside it are moved one level down so the document reads as one.
*   **Properties** (the block at the top of an entry) are left out. Other names are not shown.

## Links and embeds

Every link is rewritten from the index's own record of it, so it matches what the reader shows.

| Link to | Web pages | Word and PDF |
| --- | --- | --- |
| An entry in the export | A link to its page, and to the heading when one is named | Its words, as an internal link where the format allows |
| An entry not in the export | Its words, dotted underline, "not shared" on hover | Its words followed by "†"; a note at the start says what "†" means |
| An entry that does not exist | Its words | Its words |
| A web address | Kept | Kept |
| An embedded image | Copied into the export and shown, at its width when one is given | Embedded |
| An embedded note | Its words, as a link or marked as above | The same |

## The four kinds

*   **Web pages**: a zip holding `index.html` (the title, and the entries by folder), one page per
    entry, `style.css` in Frontier's paper look with a dark mode, and `images/`. No script. It opens
    from the disk without a server. Markdown is rendered and sanitised as in the reader.
*   **Word**: one `.docx`, made by pandoc from the entries joined in order, with images embedded.
*   **PDF**: one `.pdf`, made by pandoc writing Typst and the Typst compiler typesetting it, with a
    title page and a table of contents. No LaTeX: the Typst compiler is a library of the server.
*   **Map pictures**: on a map's page, "Save a picture" draws the map as it is shown (view,
    projection, layers, images, and the year when time is on) at one, two or four times the screen's
    size, with markers and labels, and saves a PNG. It is made in the browser; nothing is sent to the
    server.

## API

| Method and path | Body | Response |
| --- | --- | --- |
| `POST /api/export/site` | `{ title, folder? , paths? }` | the zip |
| `POST /api/export/docx` | the same | the `.docx` |
| `POST /api/export/pdf` | the same | the `.pdf` |
| `POST /api/export/preview` | the same | `{ entries: [{ path, title }], unsaved, skipped }` |

## Files

| File | What |
| --- | --- |
| `apps/server/src/export/{entries,links,site,documents}.ts` | Choosing entries; rewriting links; the web pages; Word and PDF |
| `apps/server/src/routes/export.ts` | The routes |
| `apps/web/src/pages/Export.tsx` | The Export page |
| `apps/web/src/map/picture.ts`, `pages/MapPage.tsx` | Saving a map picture |
| `Dockerfile` | A base image whose pandoc writes Typst (3.1.2 or later) |

New dependencies: `yazl` (writing zips), `rehype-stringify` (HTML), `@myriaddreamin/typst-ts-node-compiler`
(PDF). Pandoc is a program of the server image.

## Risks

| Risk | Effect | Answer |
| --- | --- | --- |
| An export carries more than meant | Unshared lore leaves | Only chosen entries; outside links are words only; appendices and quarantined notes never; the preview lists what goes |
| A large export is slow | The request times out | Pandoc and Typst run with a time limit of two minutes; the page shows the wait |
| Pandoc missing on a server | Word and PDF fail | The status page and the Export page say so; web pages still work |

## Verification

*   **Server**: choosing by folder and by paths; appendices, quarantine and unsaved changes; each
    kind of link in each format; images copied; the zip opens and its pages link to each other; a
    `.docx` and a `.pdf` are made and start with their signatures.
*   **Browser**: exporting a folder as web pages, and a map picture saved at twice the size.
