# Working on Frontier

## UX/UI changes: mockups first

When the owner asks for a UX or UI change (a new screen, a redesign, a new control or flow), show
it before building it:

1. Have a UX/UI designer look at the current screen (run the app and take screenshots, read the
   code and the stage design docs in docs/designs/), then write a short proposal: what's wrong today,
   the proposed design, phone vs desktop, empty states, keyboard, and 2–4 decisions with a
   recommendation for each.
2. Make a self-contained HTML mockup in Frontier's current look (desktop and phone views,
   interactive where that helps the owner judge it, e.g. dragging or an open combobox).
3. Send the owner the mockup and the proposal, and ask for approval of the design and the
   decisions.
4. Build only after approval, and save the approved proposal as docs/designs/stage-<n>-<topic>.md.

Small, unambiguous tweaks (an icon swap, moving a button, a label) don't need a mockup; just build
them and say what changed.
