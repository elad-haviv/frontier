# Feature concept: Frontier interface overhaul and offline work (stages 11 to 15)

Author: Elad Haviv. Date: 2026-11-22.

Frontier is a single-author web app (React + Vite front end in apps/web, Node server in apps/server,
shared packages in packages/) for writing a fantasy world kept as a folder of Markdown notes in
Frontier's own Git repository. Designs live in docs/designs/ (master: frontier.md; newer:
own-library.md and stage-N docs). An independent UX review of the current app is in
ux-review/expert-review.md, with screenshots in ux-review/shots/. The author's original list of
wishes is in docs/BACKLOG.md under "Ideas inbox", entry dated 2026-11-22.

Anchored hypothesis, in five stages built in this order:

11. Shell and shared parts. Remove the top bar; a collapsible left side bar holds everything, with an
    app menu at the bottom. Icons, styled tooltips, context menus and keyboard shortcuts across the
    app. A tabbed, resizable right side bar in which panels stack as tabs. A folder tree that can be
    fully edited: add, nest, move, reorder, rename, style, delete, with drag and drop, quick buttons
    beside a folder's name and a context menu. Each folder has an icon, a colour and a default type
    (the entry `type` field from stage 3) kept in a Frontier-only file; custom order is visible only
    inside Frontier (Obsidian keeps alphabetical order after export). A clearer "New entry" that
    lets the author choose a folder. Clear loading and connection states for a bad network. The UX
    review's top fixes.
12. Entries and editor. Sticky breadcrumb of the current heading path while scrolling, with a button
    opening a table of contents pane on the right. A full-width toggle. Rename inline with a pencil;
    move with a combobox that suggests folders. History, export and properties move into the right
    side bar (history with an expand button). A redone editor toolbar: clear icons, styled tooltips,
    a status bar naming the hovered tool, a style picker (paragraph, headings, ...), bullet and
    numbered lists, Tab indenting (Tab does not work now), code blocks, quotes, strikethrough and
    underline (`<u>`), a context menu, and comment in toolbar and context menu. A shared image gallery
    dialog: browse the library's images, upload or drop, paste, enter a URL (the server downloads and
    stores the image), search the library's own images.
13. Maps. The same gallery when choosing a map image; the same entry combobox for markers and for
    "map of this place"; the right side bar for map panels (layers, feature properties). A viewing
    mode beside editing, with hover highlights, tooltips and floating entry previews. Library-wide
    kinds for paths (river, road, border, ...) and zones, each with its own style. Straight or
    curved paths. While drawing, a line from the last point to the cursor. A + at the middle of each
    segment of a path or zone to add a point. Drag a whole zone by holding inside it. Context menu
    and keyboard shortcuts.
14. Graph. A screen showing entries as nodes and links as edges (as in Obsidian), to look and click
    through to entries; plus a local graph of one entry's neighbours.
15. Offline. The app itself and the author's recently opened files (a limited number) are kept on the
    device. Offline the author can read and edit those, add new entries, and change maps and
    chronicles. When the network returns the differences are sent; a clash with a newer server copy
    goes to the existing conflict screen. One author, possibly on several devices (phone, laptop).
