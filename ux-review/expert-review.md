# Frontier: expert UX/UI review

Reviewer: independent senior product designer. Basis: the 27 screenshots in `ux-review/shots/`, the source in `apps/web/src/`, and hands-on checks of the running instance with Playwright (desktop 1440x900 and iPhone 13). Extra captures I took are in the session scratchpad, not in the repo.

Severity: 🔴 high (blocks or misleads users, or risks lost work) · 🟡 medium (friction a regular user feels every week) · 🟢 low (polish).

---

## 1. Overall verdict

Frontier's reading surface is its strongest part. The serif prose on warm paper, a comfortable measure (about 75 characters), link hover previews, "Mentioned in" backlinks and a capable Ctrl+K switcher make the vault pleasant to read and navigate. Around that core the app behaves like a set of separate admin pages rather than one workspace. It has a flat 11-link top bar, a second copy of the same links at the foot of the sidebar, form-first pages for Maps and Chronicles, and native unstyled controls that clash with the visual language. Writers who know Obsidian will miss the basics: a context menu or drag and drop in the tree, choosing a folder when creating an entry, formatting shortcuts, tooltips, and an editor that looks like prose rather than code. The map editor works, but it gives almost no hover or selection feedback and has no keyboard model, and on a phone its Done button is pushed off-screen. Feedback for saving and going offline is better than average in the text editor: drafts are buffered locally and the status line is honest. That status text is small and low-contrast, though, and the map editor does not match it. Most fixes are about consistency and affordance rather than new features, so the app could feel markedly more mature with a focused round of work.

---

## 2. Findings by area

### 2.1 Information architecture and navigation

**🔴 IA-1. Flat top bar of 11 equal links, duplicated in the sidebar foot.**
Where: every desktop screenshot (e.g. `01-home.png`); `components/Shell.tsx:158-205` (top nav) and `Shell.tsx:213-228` (sidebar foot repeats Maps, Ask, Chronicles, Gallery, Import, Export, Versions, Inbox, Settings, Status, Log out).
Why it matters: daily destinations (Maps, Chronicles, Gallery) sit at the same weight as rare or admin ones (Import, Status, Settings, Log out). The eye has nowhere to land, and the duplicate list makes users wonder whether the two lists differ. They do: "Versions" appears only in the sidebar.
Recommendation: split the links into three tiers. (a) Workspace views as icon+label tabs or a left rail: Entries, Maps, Chronicles, Gallery, Ask. (b) Status chips: Unpublished (n), Inbox (n). (c) An avatar or "⋯" menu for Import, Export, Versions, Status, Settings, Log out. Obsidian's left ribbon and Notion's sidebar sections both work this way. Remove the sidebar-foot duplicate on desktop and keep it only in the phone drawer.

**🟡 IA-2. Nav items change position depending on state.**
Where: `Shell.tsx:159-174`. "Inbox" renders before "Unpublished" when there are proposals, and after it otherwise. Compare `01-home.png` (Inbox first, Unpublished second) with `11b-new-map.png`.
Why it matters: muscle memory breaks. A link that jumps is easy to mis-click.
Recommendation: give each item a fixed slot and let only the badge appear or disappear.

**🟡 IA-3. Map and chronicle pages keep the 300px entry tree.**
Where: `12-map-view.png`, `13-map-edit.png`, `17-chronicles.png`.
Why it matters: on a map the tree is irrelevant, yet it takes about 21% of the canvas width. Panels then open on top of the map (`13b`, `15`).
Recommendation: make the sidebar collapsible (a toggle plus Ctrl+\ as in Obsidian and VS Code) and collapse it by default on map and chronicle routes. Use the freed column for the map's own layer or feature list.

**🟡 IA-4. "Home" is simply the README.**
Where: `pages/Home.tsx:6-13`, `01-home.png`.
Why it matters: there is no place for recent entries, unpublished drafts or recently edited maps. Returning writers have to rebuild their context from scratch.
Recommendation: offer a light home with Recent entries, Drafts waiting, Maps and Chronicles, plus the README below. Notion's "Jump back in" and World Anvil's dashboard do this.

**🟢 IA-5. Vocabulary drift.**
The same ideas go by several names: History (entry) / Versions (sidebar) / Status; Unpublished / Unsaved (`Shell.tsx:20-27`); "Make the entry" / "Make the map" / "Make the chronicle"; Done (editor) / Done (path sketch) / Done (map). Pick one term per concept and one verb pattern for creation ("Create entry", "Create map").

### 2.2 Visual hierarchy and consistency

**🟡 VH-1. Native, unstyled controls next to styled ones.**
Where: `10-export.png` (FOLDER `<select>` is a tiny OS control), `15-map-layers.png` ("Lies under" select, crammed against the IMAGES heading), `19-settings.png` (Style textarea in mono with a black border), `11-maps-list.png` ("Choose File" button).
Why it matters: these read as broken or unfinished and undercut trust in an otherwise careful aesthetic.
Recommendation: style `select`, `textarea` and `input[type=file]` once in `styles.css` with the same field tokens as `.field input`. Replace the file input with a dropzone button ("Upload image…").

**🟡 VH-2. Button hierarchy is inconsistent and destructive actions sit next to safe ones.**
Where: `05-editor.png`. Preview (accent text), Comments, Delete, Discard and Done are all boxed buttons in one row, and Delete sits between Comments and Discard. `13-map-edit.png`: "Delete map" sits in the drawing toolbar beside Undo/Redo. `10-export.png`: six identical solid primary buttons.
Why it matters: there is no single obvious primary action, and destructive actions are one slip away from common ones.
Recommendation: give each surface one primary button (Done). Move Delete and Delete map into a "⋯" overflow menu with a danger style, as in Notion's page menu and Figma's file menu. On Export, make the formats a radio list or cards with one "Export" button.

**🟡 VH-3. Low-contrast secondary text everywhere.**
Where: `--ink-faint #8f8676` on `--paper #f7f3ea` gives **3.25:1** (fails WCAG AA for body text). It is used for page intros (`08`, `09`, `11`, `17`), "Draft saved", "Saved as a draft", tree counts and backlink paths. Disabled primary buttons ("Rename" in `09`, "Make the map" in `11`, "Make the chronicle" in `17`) are about 2.5:1 white on pink.
Why it matters: the save status, the most important reassurance in the editor, is the hardest text to read. Disabled buttons look merely pale, not unavailable.
Recommendation: darken `--ink-faint` to about #6f6757 (≥4.5:1). Show disabled buttons as outlined grey with helper text that says why ("Enter a title").

**🟢 VH-4. Page-title scale is uniform for every page type.**
"History of Harbor", "Export", "Settings" and "Maps" all use the 48px display serif heading that entries use (`08`, `10`, `19`). Tool pages would read as utilities with a smaller sans heading, which would keep the display serif special for content.

**🟢 VH-5. Rendering seam in the feature panel.**
Where: `13b-map-marker-placed.png`. There is a vertical hard edge on the globe at the panel's right edge (x≈662, y 235–440), as if a region were blitted or clipped. Check the panel's backdrop and stacking against the WebGL canvas.

### 2.3 Iconography and affordances

**🔴 IC-1. The editor toolbar uses cryptic glyphs with no tooltips.**
Where: `05/06/07-editor*.png` (the "hover" and "image tool" screenshots are byte-identical to `05`: hovering shows nothing). `components/EditToolbar.tsx:83-179`. `[[ ]]`, `H`, `•`, `▣` (image), `✎` (comment) and `↶ ↷` have `aria-label` but no `title` (only Comment, AI and the table buttons have one). Playwright confirmed `title` is null on Heading.
Why it matters: `▣` does not say "image" and `✎` usually means "edit", not "comment". New users cannot learn the tools by hovering.
Recommendation: use a consistent line icon set (Lucide or Phosphor: link, heading, list, bold, italic, image, message-square, undo, redo). Add a styled tooltip with name and shortcut ("Bold Ctrl+B"), as in Google Docs and Notion.

**🟡 IC-2. Layer and image rows in the map layer panel use bare symbols.**
Where: `15-map-layers.png`. `⌖ ↑ ↓ ✕` per row, with the red ✕ repeated on every row. Layer names are truncated ("Routes and realr").
Recommendation: put reordering behind drag handles (⋮⋮) and move delete into a row "⋯" menu. Let names use the full width. Figma's and Felt's layer lists are the model.

**🟡 IC-3. Marker icon picker is nearly invisible.**
Where: `13b`. The second icon option is a faint dot on white.
Recommendation: show icons at 20–24px with a label tooltip and a clear selected state.

**🟢 IC-4. Tree twisties are small text glyphs (▸ ▾) with a 1–2 number badge.** The badge counts the folder's own page too, so "Harbor 2" expands to one child (`02-entry-harbor.png`; `Tree.tsx:29` counts `folder.notes.length` including `own`). Exclude the folder note from the count, or drop the count entirely.

### 2.4 Discoverability: tooltips, context menus, shortcuts

**🔴 DI-1. No context menu anywhere.**
Where: right-clicking "Mira" in the tree shows the browser menu (checked live). There is no `onContextMenu` in the codebase.
Why it matters: Obsidian and Notion users expect right-click on a tree item to offer New note here, Rename, Move, Duplicate, Delete, Copy link and Open in new tab. Today every one of these needs a page navigation.
Recommendation: add a tree context menu and a matching "⋯" hover button on each row, the touch-friendly equivalent, as in Notion.

**🟡 DI-2. Missing keyboard shortcuts.**
Only Ctrl+K (switcher) and the CodeMirror defaults exist. There is no Ctrl+B or Ctrl+I, no Ctrl+S (pressing it opens the browser's "Save page" dialog), no Esc or Ctrl+Enter for Done, and no E to edit an entry. The map has no tool keys, no Delete for the selected feature and no Ctrl+Z (`MapPage.tsx:858-868` handles Escape only in "focus box" mode). Chronicles do have Ctrl+Z (`ChroniclePage.tsx:128`), so the app is inconsistent with itself.
Recommendation: add the standard set: Mod-B/I/K (link) in the editor, Mod-S as "save now" with a visible flash of "Saved", and Mod-Enter for Done. On the map: V/M/P/Z/R for tools, Del/Backspace to delete, Esc to cancel a sketch, Enter to finish, Mod-Z/Shift-Mod-Z. Add a "?" shortcut sheet, as in Figma and Linear.

**🟢 DI-3. Ctrl+K is the best navigation feature and is hidden behind an unlabeled magnifier.**
Where: `01-home.png`. Show it as a search field ("Search or jump… Ctrl K") in the top bar, as in Notion and Linear.

### 2.5 Folder tree and creating entries

**🔴 TR-1. "New entry" cannot choose a folder.**
Where: `20-new-entry.png`; `Shell.tsx:94-111`. The folder is guessed from the current entry. From the README or any non-entry page, the new note goes to the vault root, and the dialog then says nothing about where it will go (`folder ? body : nothing`).
Why it matters: writers organise by folder ("02 People"). Creating at the root and then moving through a separate Rename page is a three-step detour.
Recommendation: add a folder picker (combobox, prefilled with the current folder) to the dialog, plus a "+" on folder rows on hover. Obsidian and Notion both offer "new note in this folder".

**🟡 TR-2. No drag and drop to move entries.**
Moving an entry means opening Rename and typing a path (`09-rename-move.png`).
Recommendation: support drag and drop in the tree with a drop-target highlight and an undo toast, and keep the Rename page for bulk or path editing. For the folder field, use a folder combobox, not free text.

**🟡 TR-3. Folder expansion state is not kept and does not follow navigation.**
Where: `Tree.tsx:23`. `useState(holdsCurrent || depth === 0)` runs only on mount. Opening an entry inside a collapsed folder via a link does not reveal it in the tree, and collapsed or expanded state is lost on reload.
Recommendation: open the ancestors of the current entry whenever `current` changes, scroll the active row into view, and keep open folders in localStorage. Obsidian has a "Reveal active file" command for this.

**🟡 TR-4. No tree filter and no "collapse all".**
With a real vault of hundreds of notes this becomes a long scroll. Note the README sits at the very bottom, under "99 Appendices".
Recommendation: add a filter box at the top of the tree and Collapse-all / Expand-all buttons.

**🟢 TR-5. The "+ New entry" button is a dashed placeholder style.** It reads as an empty drop zone, not a button. Use a solid secondary button, or a compact "+" icon button beside a "Entries" header.

### 2.6 Reading experience on long entries

**🟡 RD-1. Actions and context scroll away.**
Where: `04-entry-long-scrolled.png`. Once you scroll past the title there is no title, no Edit and no way back up. The entry header is not sticky. There is only `scroll-padding-top`.
Recommendation: once the H1 leaves the viewport, show the entry name, Edit and "⋯" in the top bar. Add a back-to-top control or let the Home key work. Medium.com and Notion do the former.

**🟡 RD-2. The table of contents is collapsed, at the top, and only for 3+ headings.**
Where: `02-entry-harbor.png` ("▶ ON THIS PAGE"); `Entry.tsx:190-203`.
Why it matters: on long lore entries the outline is most useful mid-read, which is exactly when it has scrolled off.
Recommendation: at ≥1200px, show a sticky right-rail outline with scroll-spy highlighting, as in Obsidian's Outline pane and docs sites such as MDN. Keep the collapsible version for narrow screens.

**🟢 RD-3. Entry action links are low-emphasis grey text.**
Rename / History / Export (`02`) at `--ink-faint` look disabled. Group them into a "⋯" menu and keep only Edit visible.

**🟢 RD-4. Backlinks list uses "·" with empty trailing context for root notes** ("README ·", `02-entry-harbor.png`). Omit the separator when the path is empty.

### 2.7 Editor and toolbar

**🔴 ED-1. The "Preview" button does not preview.**
Where: `05-editor.png`; `Edit.tsx:383-393`. It toggles live-preview _marks hiding_. It is on by default, shown as red text, with only a title tooltip to explain it. Users will click it expecting a rendered reading view and see almost nothing change.
Recommendation: rename it to a two-state segmented control, "Live preview | Source", as Obsidian names exactly this feature, and show which state is active. Consider also offering a real "Reading view" toggle.

**🟡 ED-2. The editor body is monospace while headings are serif.**
Where: `05-editor.png`, `phone-editor` capture. `CodeEditor.tsx:15` sets `fontFamily: var(--mono)` for all content.
Why it matters: writers draft prose here. Monospace slows reading and makes the jump between editing and reading jarring.
Recommendation: in live-preview mode use the reading serif (or a readable sans) at the reading measure, and reserve mono for code and front matter, as Obsidian's Live Preview, Typora and iA Writer do.

**🟡 ED-3. Front matter is shown twice.**
Where: `05-editor.png`. A collapsed "Properties" panel sits above raw YAML (`---aliases: - The Port…---`) that is still fully visible in the editor.
Recommendation: when Properties is available, fold the YAML block in live-preview mode (Obsidian folds it into its Properties widget) and show it raw only in Source mode.

**🟡 ED-4. Toolbar placement and behaviour.**
The toolbar is pinned to the bottom (a phone keyboard pattern, `EditToolbar.tsx:38-42`), so on desktop it is far from the text being formatted and floats mid-page on short documents (offline capture). Buttons show no active state (Bold inside bold text looks the same). Heading always inserts `## `. Bold with no selection inserts `****`.
Recommendation: on desktop, put the toolbar at the top under the editor bar, or show a floating selection toolbar (as in Notion and Medium). Reflect the active state. Make Heading a dropdown (H1–H3). Keep the bottom bar for touch.

**🟡 ED-5. The save-state line causes a layout jump and is hard to read.**
Where: offline capture. "Offline: kept on this device, will send when back" wraps the editor bar onto two lines and pushes every action down. "Could not save" offers no retry button (`Edit.tsx:229-232`, `413-420`).
Recommendation: use a fixed-width status pill with an icon (✓ Saved · ⟳ Saving · ⚠ Offline) and put the long explanation in a tooltip. On failure, show a banner with "Retry" and "Copy text". Notion and Google Docs use a cloud icon for this.

**🟢 ED-6. Done while offline navigates to the entry page, which shows the old server text.**
`Edit.tsx:319-323`. The buffer survives, but the reader view does not say that unsent local changes exist. Show a "1 change not yet sent" note on the entry, or keep the user in the editor until the draft is sent.

### 2.8 Map editor

**🔴 MP-1. No hover feedback on map features.**
Where: `MapPage.tsx` has no hover hit-testing. The pointer stays `grab` over a marker (verified live: `cursor: grab` at the Green Heart). Paths and zones do not highlight. Markers without a label show no name on hover.
Why it matters: users cannot tell what is clickable or what they are about to select, especially thin paths on a globe.
Recommendation: on pointer move, hit-test (you already have `shapeAt`), set `cursor: pointer`, draw a hover halo or thicker stroke, and show a small name tooltip. This is standard in Felt, Google My Maps and Figma.

**🔴 MP-2. Weak selection feedback and a detached feature panel.**
Where: `14b-map-selected-marker.png` shows no visible difference for the "selected" marker. `map-click-read` capture: the read-mode card for The Green Heart appears at the bottom-left corner of the map, far from the marker, and holds only a title. `13b`: the editor panel covers the left third of the globe and its content is cut off at the bottom ("Make a chronicle to say when this…"), with Delete below the fold.
Recommendation: give the selected feature a strong, consistent selection style (accent ring plus handles for every type). Dock the editor in a right-hand inspector column that does not overlap the canvas, as Figma's and Felt's properties panels do, with sections (Link, Label, Style, Layer, Time) and a sticky footer for Delete. In read mode, anchor a popover to the feature and include the linked entry's summary and an "Open entry" button.

**🟡 MP-3. Drawing a path is undiscoverable to finish and uses touch language on desktop.**
Where: `14-map-drawing-path.png`. The hint says "Tap to add points." and has a Done button, while a second "Done" in the top bar exits edit mode entirely. You finish by clicking the last point again (`MapPage.tsx:676-684`). There is no double-click or Enter to finish, no Esc to cancel, and no backspace to remove the last point.
Recommendation: on pointer devices write "Click to add points · double-click or Enter to finish · Esc to cancel". Rename the hint button "Finish path", and add a rubber-band segment from the last point to the cursor. This is the Google My Maps and Figma pen-tool convention.

**🟡 MP-4. Tool state resets after each marker.**
`MapPage.tsx:672-673` switches back to Select after placing one marker. Placing five towns means five trips to the toolbar.
Recommendation: keep the tool active (Esc or V returns to Select), or support Shift-click to stay in tool, as Figma does.

**🟡 MP-5. Map header controls are unlabeled selects.**
Where: `12-map-view.png`. "Globe" and "Picture" are bare `<select>`s. "Picture" actually means "Save image…".
Recommendation: label the view switcher (a segmented "Globe | Flat | Projection ▾") and turn Picture into an "Export image" item under a "⋯" or Share menu.

**🟡 MP-6. Layer panel hierarchy.**
Where: `15-map-layers.png`. "LIES UNDER" and its select sit on the same line and run straight into "IMAGES". There is no active-layer indicator, even though new markers go to `activeLayer`. "Open the map like this" is unclear.
Recommendation: put map settings in their own section. Mark the layer new features go into, with a radio or a "drawing into" pill, as Photoshop and Felt do. Rename the button to "Save current view as default".

**🟢 MP-7. Edit mode shifts the canvas down by one toolbar height** (`12` → `13`: the globe moves about 24px). Overlay the tool strip on the canvas, or keep the bar height constant, so entering edit mode does not move the map under the cursor.

### 2.9 Feedback: loading, saving, slow or lost network

**🟡 FB-1. Loading states are bare text ("Opening…", "Loading…").**
`App.tsx:43`, `Entry.tsx:72`, `Shell.tsx:210`. On a slow network the content area blanks on every navigation, and the previous entry disappears.
Recommendation: keep the previous page visible with a thin top progress bar (as GitHub and YouTube do), and use skeletons for the tree and entry.

**🟡 FB-2. No global connection indicator.**
Offline is surfaced only inside the editor and map save labels. The reader, the tree, the switcher (errors are silently swallowed: `Switcher.tsx` `.catch(() => ({results: []}))`, so search simply shows "nothing") and other pages give no sign the server is unreachable.
Recommendation: add an app-level "Offline: changes are kept on this device" banner driven by `online`/`offline` events and failed fetches. Show "Couldn't search, you're offline" instead of empty results.

**🟢 FB-3. Map save label differs from the editor's** ("Saved as a draft" vs "Draft saved"; `MapPage.tsx:76-82` vs `Edit.tsx:18-25`). Share one SaveStatus component.

### 2.10 Mobile

**🔴 MO-1. On a phone, the map's Done/Edit, Undo/Redo and Delete are off-screen.**
Where: phone map edit capture (iPhone 13). The bar shows "‹ Sample world [Saved as a draft] Layers" and clips the rest. The tool strip clips after "Measure". `22-phone-map.png` shows "L…" clipped in view mode. Nothing signals that these rows scroll horizontally.
Why it matters: a user can enter edit mode and not find the way out or undo.
Recommendation: on narrow screens, collapse the header to "‹ Title [Done]" plus a "⋯" menu. Make the tool strip an icon-only bottom bar (Select, Marker, Path, Zone, Measure, Undo) as in Felt's and Google Maps' mobile editors. Hide the save label behind an icon.

**🟡 MO-2. Secondary navigation is buried at the bottom of the tree drawer.**
Where: the phone drawer capture. Maps, Chronicles, Gallery, Settings and the rest only appear after scrolling past every folder (`Shell.tsx:213`).
Recommendation: add a bottom tab bar (Entries, Maps, Chronicles, Search, More), or put these links at the top of the drawer.

**🟡 MO-3. The phone editor spends about 25% of the screen on chrome before the text.**
Where: phone editor capture. Two rows of buttons, Properties and raw YAML all come before the first sentence.
Recommendation: one row ("Done" plus "⋯"), with Properties folded and the YAML hidden as in ED-3.

**🟢 MO-4. The phone map leaves a large empty band below the globe** (`22-phone-map.png`). Fit the globe to the available height, or use the space for a feature list or bottom sheet.

### 2.11 Accessibility basics

**🟡 AX-1. No skip link. Keyboard users tab through 12 header stops and then every tree row (two stops per folder) before reaching content.**
Verified: 25 Tabs from page load only reach "Mira" in the tree.
Recommendation: add "Skip to content" as the first focusable element. Make the tree a single tab stop with arrow-key navigation (WAI-ARIA tree pattern, `role="tree"`/`treeitem`), as in VS Code's explorer.

**🟡 AX-2. Contrast**: see VH-3 (3.25:1 secondary text, about 2.5:1 on disabled buttons). The dark theme's `--ink-faint` (#7f7768 on #171512) is 4.1:1, still under AA for small text.

**🟡 AX-3. The canvas map has no non-visual equivalent.**
Features are reachable only by pointer.
Recommendation: provide a "Features" list (searchable, keyboard-navigable) that selects and centres features. It doubles as a power-user tool for finding a marker on a busy map.

**🟢 AX-4. Focus ring is good** (`styles.css:75-79`, 2px accent, visible in captures). The image button in the editor toolbar is a `<label>` around a hidden file input. Make sure it is reachable by keyboard and shows the same focus ring.

---

## 3. Top 10 changes, in priority order

1. **Fix the phone map editor header and toolbar** (MO-1): Done, Undo and Delete must be reachable. Collapse to Title + Done + ⋯, with an icon tool bar at the bottom.
2. **Add hover and selection feedback on the map** (MP-1, MP-2): pointer cursor, hover halo, name tooltip, strong selection ring, and a docked right-hand inspector that does not cover the map or cut off its content.
3. **Let "New entry" choose its folder and add a tree context menu** (TR-1, DI-1): New here, Rename, Move, Duplicate, Delete, Copy link, plus "+" and "⋯" on row hover.
4. **Restructure navigation** (IA-1, IA-2, MO-2): primary workspace tabs, status chips with fixed positions, a "⋯"/account menu for admin pages, no duplicate sidebar list on desktop, and a bottom tab bar on phone.
5. **Make the editor feel like a writing tool** (ED-1, ED-2, ED-3): "Live preview | Source" toggle, prose font in live preview, YAML folded into Properties.
6. **Toolbar icons, tooltips and shortcuts** (IC-1, DI-2): real icons, tooltips with shortcut hints, Mod-B/I/K/S, Mod-Enter for Done, map tool keys, Delete and Undo, and a "?" cheat sheet.
7. **Move destructive actions out of primary rows** (VH-2): Delete entry and Delete map go in overflow menus, with one primary button per surface and a single Export button.
8. **Raise contrast and fix disabled states** (VH-3, AX-2): darken `--ink-faint` to ≥4.5:1 and explain disabled buttons.
9. **Reading aids for long entries** (RD-1, RD-2): a sticky mini-header with Edit, and a sticky right-rail outline with scroll-spy.
10. **Unify feedback for saving and connection** (ED-5, FB-1, FB-2, FB-3): one SaveStatus pill shared by the editor and map, a Retry on failure, an app-level offline banner, and a top progress bar instead of blanking pages.
