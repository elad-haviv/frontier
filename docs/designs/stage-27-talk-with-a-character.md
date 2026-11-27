# Stage 27: Talk with a character, rethought

- **Status:** Approved by the author (2026-11-26).
- **Mockup:** shared in the session (`talk-mockup.html`).

Follows [stage 8c](stage-8-ai-companion.md); this reverses its choice that "the conversation is not
kept".

## 1. What was wrong

- **The empty page had no order.** "Draft a profile" and "Add a trait" were two quiet buttons with
  nothing between them, and the one primary button approved an empty profile.
- **Traits were a flat list**, each a dropdown, a text box and "Remove", so what the character
  knows could not be told from what they believe at a glance.
- **The year gave no feedback**: nothing said which entries it keeps from the character.
- **The profile vanished once approved**, so while talking the author could not see what the
  character spoke from.
- **The conversation was a form**: a labelled box and a button, Enter did nothing, and everything
  was lost on leaving the page.

## 2. The design

- **No profile yet:** one card that says what a profile is and names its four kinds, with one
  primary action, "Draft a profile from the entries", and a quiet "Write it yourself instead".
- **Reviewing the draft:** traits are grouped under the four kinds and edited in place. Each shows
  its source entry and quote beneath, or "Added by you" / "The entries don't say". "Move…" files a
  trait under another kind; each group has its own "Add".
- **The moment** is a side panel: "Speaks from", the year, and a line that says which of the
  entries read for the profile begin after that year and are kept from the character. "Approve and
  start talking" is in a bar that stays at the bottom.
- **Talking:** the author's words on the right, the character's lines in the serif face with their
  sources beneath. An improvised line has a dashed edge and an "Improvised" tag. The profile stays
  beside the conversation with "Edit"; each "Not known" trait has "Ask", which puts a question in
  the box. A new conversation offers these as starters.
- **Saved conversations:** every conversation is saved on the server as it is spoken. The page
  opens on the latest. "Conversations (n)" lists them, newest first: the first thing said, the
  date, the moment spoken from, the number of lines and how many were added to the entry. Each can
  be opened, exported as Markdown, or deleted (after "Delete / Keep"). "New conversation" starts
  another; the old one stays.
- **Phone:** one column. The moment sits below the traits and the approve bar stays in place.
  While talking, "Profile" in the header opens the profile over the page.
- **Keyboard:** Enter says the line, Shift+Enter makes a new line. In a trait, Enter finishes the
  edit and Backspace on an empty trait removes it.

## 3. Decisions

1. **Profile beside the conversation**, not behind "Change the profile".
2. **Traits grouped by kind**, edited in place.
3. **Conversations are saved on the server.** All are kept until the author deletes them; he can
   export one. (The recommendation was the last 20 per character; the author chose to keep all.)
4. **The year says which entries it keeps from the character.**
5. **Editing the profile mid-conversation continues the conversation.** A conversation records the
   moment it was last spoken from.
6. **An old conversation can be gone on with.** The character answers from today's profile and
   entries.

## 4. As built (2026-11-26)

- **Server:** `apps/server/src/ai/talks.ts` (`Talks`, one file each in `/data/state/talks/`, kept
  by the entry's id so a conversation follows a rename). `POST /api/characters/say` takes
  `{ path, message, talk }` and answers `{ talk, lines }`; `POST /api/characters/line` takes the
  conversation and the line's place and marks it added; `GET /api/characters/talks?path=`,
  `GET` and `DELETE /api/characters/talks/:id`; `GET /api/characters/moment?path=&year=` answers
  `{ read, withheld }`. Tests in `apps/server/test/lore.test.ts`.
- **Web:** `apps/web/src/pages/Talk.tsx`, `apps/web/src/talkExport.ts`. Tests in
  `apps/web/src/talkExport.test.ts` and CUJ 12 of `apps/web/e2e/ai.spec.ts`.
- **Differences from the mockup:** adding a line to the entry has no "Undo"; it is undone on the
  unsaved changes page, as before. The steps "1 Profile, 2 Conversation" beside the title were
  left out. The conversations of an entry that is later deleted stay in the folder, out of sight.
  Not in any export of the library; the author exports a conversation himself.
