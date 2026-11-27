# Stage 28: the library as a pane on desktop

Approved by Elad on 2026-11-26, with all recommendations. Mockup:
https://claude.ai/artifact/35xA9YyjD2oKe5qxdT3g8y (docked pane, the folded sidebar, and the floating pane on
a narrower window; the first frame is live). The phone keeps stage 26 (a full-drawer panel).

## What's wrong today

The desktop sidebar stacks search, New entry, Random entry, six places, Working on, then the Library tree,
then the footer. The tree gets what is left, about 6 to 10 rows at 800 px high, and scrolls inside that box.
Folders are the main way to browse and they are the cramped part.

## The design

- The tree leaves the sidebar. A **Library** row joins the places (after Ask), with the entry count. It is a
  toggle button (`aria-pressed`). The sidebar gets shorter; Working on and the footer stay in it (decision C).
- Clicking it opens the **Library pane** immediately to the right of the sidebar: full window height, 17 rem
  wide, with the title "Library", the new entry and new folder buttons and a **close (×)** button. The page
  content moves right and narrows to make room (docked, decision A).
- The pane stays open while reading, so entries can be clicked through. It closes with × or by clicking the
  Library row again. Open or closed is remembered on this device (decision B: open the first time).
- The tree works as now: open and close folders, drag to move or reorder, F2 to rename, the context menu,
  arrow keys, stub counts. The entry being read is highlighted and kept in view.
- In the folded sidebar (the rail) a Library icon opens the same pane.
- Under about 1100 px wide the pane floats over the page (with a shadow, the page dimmed a little) and closes
  when an entry is picked, so the reading area is never squeezed too narrow. Esc closes a floating pane.
- The pane sits to the right of the sidebar, since a pane cannot sit to the left of a sidebar at the left
  edge (decision D).
- On a phone nothing changes.

## Empty states and keys

An empty library shows "No entries yet" and a New entry button in the pane. Offline or a failed tree shows
today's messages inside the pane. New key: **g l** toggles the Library pane (a chord, like `g h` and
`g r`); where it clashes the existing key wins and the nearest free one is used. The Library row is a real
button; focus moves into the pane when it opens by keyboard and back to the row when it closes. Motion
respects reduced motion.

## Decisions (as approved)

- **A.** Docked pane that pushes the page on wide windows; floating on narrow ones.
- **B.** Open the first time, then as left, per device.
- **C.** Working on (pins) stays in the sidebar.
- **D.** The pane sits immediately to the right of the sidebar.

## As built

- **Key.** `g l` was free in the app scope, so it is the key. (On the map page, where `g` alone places with
  AI while editing, the page's `g` wins, as for `g h` and `g r`.)
- **Where it lives.** The pane is drawn inside the page area, to the right of the side bar's splitter (and
  of the rail), so the side bar's width is still the device's and the pane never counts in it.
- **Open or closed** is kept per kind of screen on this device, beside the side bar prefs of that kind
  (`library` in `ScreenPrefs`, `shell/panels.tsx`). Maps, chronicles and the graph start with it closed (they
  start with the rail too); entries and other pages start open. The one per-device value the first build kept
  (`frontier.shell.library`) is the default for entries and other pages, so nobody loses a choice. It is kept
  only from a docked window: on a floating one it starts closed on every visit, and closing it by picking an
  entry, Esc or a click on the dimmed page is not remembered, so the choice made while docked stays.
- **Floating** is decided by the room, not the window: the shell measures the main panel (the room right of
  the side bar, with a ResizeObserver) and the pane floats when it is under 17 rem plus 560 px
  (`LIBRARY_PANE_REM`, `LIBRARY_PAGE_MIN`, `libraryFloats` in `shell/libraryState.ts`), so a wide side bar or
  an open right bar floats it, and a splitter dragged across the line switches it. Before the first
  measurement the window's width stands in (`LIBRARY_DOCK_MIN`, 1100 px) so nothing flickers. The shell puts
  `is-floating` on the pane, so CSS has no copy of the number. A change between docked and floating takes
  the state of its new case: a pane left open closes (it is not thrown over the page, dimming it, as a side
  bar is dragged or the right bar opens) and comes back docked, as the device left it, when there is room
  again. The Library place still opens it floating while there is no room.
- **Focus.** Opening by click or key asks once for the focus to go in: the shell's `focusAsk` counter rises
  only on that open and the tree (or the empty or failed state's first button) takes the focus and marks the
  ask spent (`onFocusTaken`). Nothing else gives it: a tree that loads again after a failure, a library that
  stops being empty, a window that docks the pane again, or opening to show a folder (from Home) lets the tree
  focus that folder only. Closing by ×, the Library place or `g l` puts the focus back on the place (or the
  rail's icon) and spends any ask.
- **The key sheet** lists `g l` only where the key works (`listWhenBound` in the keys registry): on a phone
  it is not bound, so it is not listed.
