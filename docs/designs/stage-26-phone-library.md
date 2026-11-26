# Stage 26: the library as a menu item on the phone

Approved by Elad on 2026-11-26, with all four recommendations. Mockup:
https://claude.ai/artifact/YUP79TdpetbZXKCiPkoYn6 (three phone drawers; the first is live).

## What's wrong today

The phone drawer stacks the header, New entry, Random entry, six places, Working on, the Library and the
footer (Unsaved, Inbox, Compare, connection). The Library gets whatever height is left, which on a phone
is about one row, so the folders cannot be browsed.

## The design

- **Library** becomes a row in the menu, after Ask: a folder icon, the word, the number of entries and a
  chevron. The small "new entry" and "new folder" buttons leave the menu.
- Tapping it slides the library in over the drawer, filling the drawer's width and full height. The menu
  slides a little to the left behind it.
- The library's top bar has **‹ Menu** on the left, the title "Library" and the new entry and new folder
  buttons on the right.
- The tree works as now: tap a folder to open or close it, tap an entry to read it (the drawer closes),
  long-press for the folder menu, drag to move where it works today on touch.
- Back to the menu: the ‹ Menu button, swiping right from the left edge, the browser's Back, or Esc.
  Closing the drawer from the library closes both.
- Desktop and the collapsed rail are unchanged.

## Decisions (as approved)

- **A.** A panel that replaces the menu, not a section that expands in place.
- **B.** Working on (pins) stays in the menu, not in the library panel.
- **C.** The footer (Unsaved, Inbox, Compare) is hidden while the library is open.
- **D.** The library opens with the open entry's folder revealed and scrolled into view, and the folders
  opened last time still open.

## Empty states and keys

An empty library says "No entries yet" with a New entry button. A failed or offline tree shows today's
message inside the panel. The Library row is a real button; focus moves to the panel's Back button when
it opens and returns to the Library row when it closes; Esc goes back. Motion respects reduced motion.
