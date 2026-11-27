# Stage 29: generating pictures for entries

Approved by Elad on 2026-11-27, with all recommendations. Mockup:
https://claude.ai/artifact/AzD5iv1Urzvq4Qa1uEp9ZJ (desktop editor with the dialog open on Generate and two
tries made; the phone opens it from the toolbar's "⋯"; a switch shows the no-model, offline and failure
states).

## What's wrong today

- Frontier can already make pictures: Settings › Models has a picture model (concept art) and an art
  style. Only a map discovery uses them; an entry cannot.
- To illustrate an entry the author leaves the app, prompts another tool with text copied from the entry,
  downloads the file, comes back and uploads it.
- The art style written in Settings is lost on that trip, so pictures across the library do not match.

## The design

- **Where.** The "Add an image" dialog gets two tabs, **Library** (the dialog as it was) and **Generate**.
  A new command, **Generate an image…**, opens it straight on Generate: in the editor's right-click menu,
  in the toolbar's "⋯" where the insert group is folded into it (always on a phone), and on
  **Ctrl+Alt+I**. The image button opens the dialog on Library, with Generate one click away.
- **The prompt** starts from the selected text, or else the entry's title and its first paragraph of prose.
  Links become plain names (`[[Mira]]` → Mira); embeds, marks and HTML are dropped. "Use the selection" and
  "Use the opening instead" switch between the two.
- **Style.** The art style from Settings is put before the prompt ("<style>\n\nThe subject: <prompt>"). It
  shows folded under the prompt and can be changed for this picture only.
- **Shape.** Square, Wide (3:2) or Tall (2:3), sent to models that take a size and ignored by those that
  do not.
- **One picture per press.** Generate makes one; the button then reads **Again**. Every try joins a strip;
  the chosen one is shown large with a **Save as** field, which starts as the entry's title.
- **Insert** keeps the chosen picture as an unpublished image in the upload folder, named as the field says
  and made unique, and puts `![[name]]` under the selected text as a paragraph of its own (at the cursor
  when nothing was selected). The selected text stays. Nothing reaches the library until Publish.
- **Cost.** Each picture counts toward the monthly cap. The line under the button gives the price of a
  picture (the middle of the last five made with the chosen model) and what is left of the month's cap.

## Phone and desktop

Desktop: the prompt, style and shape on the left, the picture on the right, the tries under it. Phone: the
dialog fills the screen in one column (prompt, style, shape, button, picture, tries), with Cancel and Insert
at the bottom. There is no right-click menu on a phone, so the command is in the toolbar's "⋯".

## Empty and problem states

- **No picture model, or its provider not connected:** "Pictures can't be made yet" with the reason and a
  button to the settings page that puts it right. The Generate tab still shows, so the feature is found.
- **Offline:** Generate is disabled and says "Making a picture needs a connection." The command itself
  says "Images need a connection" as uploads do.
- **Cap reached or the model fails:** the provider's message under the picture, with a link to the
  settings when there is a place to fix it; the prompt is kept and Again is ready.
- **Before the first try:** an empty frame in the chosen shape, "Your picture appears here."

## Keys

- **Ctrl+Enter** in the prompt: Generate (or Again).
- **← →** on the strip of tries: move between them. **Enter** in Save as: Insert.
- **Esc**: close. A picture still being made finishes on the server and is among the tries next time.
- **Ctrl+Alt+I** in the editor: Generate an image…

## Decisions (as approved)

- **1.** Generating is a tab in the image dialog, not a side-bar panel.
- **2.** One picture per press, with Again.
- **3.** The prompt starts from the selection, else the title and first paragraph.
- **4.** Tries not inserted are kept on the server for 7 days, shown for their entry.

## Not in this stage

Editing a picture with a second prompt, a library image as a reference, several named art styles (stage 34), and
generating from the reading page.

## As built

- **Server.** `ai/pictures.ts` (`EntryPictures`) keeps the tries in `DATA_DIR/assets/generated/entries/`
  (each picture as `<id>.<ext>` and the list in `tries.json`), which the backup already covers. Tries over
  seven days old are dropped whenever the list is read. Routes in `routes/pictures.ts`:
  `GET /api/pictures?entry=` (whether pictures can be made, the style, the price, what is left, the entry's
  tries, newest first), `POST /api/pictures` (one picture; at most 12 a minute), `GET /api/pictures/:id`
  (the picture, `w` for a smaller one) and `POST /api/pictures/:id/insert` (keeps it as an upload through
  `saveImage`, then forgets the try). The picture's format is read from its bytes (PNG, JPEG or WebP).
- **Shapes** go to the providers as OpenRouter's `aspect_ratio`, Gemini's `imageConfig.aspectRatio` and
  OpenAI's `size` (1536×1024 for gpt-image, 1792×1024 for DALL·E 3, nothing for DALL·E 2). xAI and other
  servers are sent no size.
- **Web.** `images/GeneratePanel.tsx` is the tab; `images/pictureBrief.ts` makes the starting prompts;
  `insertEmbedsAfter` in `editCommands.ts` puts the embed under the selection. The tool is `generateImage`
  in `editorTools.ts` (menu-only, in the insert group), its key `editor.generateImage`.
- **On a wide desktop** the toolbar's "⋯" shows only groups that do not fit, so there the command is in the
  right-click menu and on its key, and the image button's dialog has the tab.
- **Tests.** `apps/server/test/pictures.test.ts`, the adapter cases in `providers.test.ts`,
  `pictureBrief.test.ts`, the `insertEmbedsAfter` case in `editCommands.test.ts`, and CUJ 29 in
  `apps/web/e2e/pictures.spec.ts` (desktop).

## Under people and projects (added when merged with stage 31)

- **Who may.** Making a picture, listing and fetching the tries, and inserting one are writers'. The
  dialog is in the editor, which readers do not have.
- **Keys and cost.** There is no server-wide key and no monthly cap any more: each picture is made
  with the key of the person pressing Generate (from their device, with the request), and paid to
  their own provider. No key on the device, or none for the picture model's provider, is said in the
  dialog before anything is asked ("Add one under AI keys") and answers `ai_key_missing`; a key the
  provider turns away answers `ai_key_rejected`. The line under the button gives the price of a
  picture (from the person's own last five) and no longer what is left of a cap. The call is logged
  with the person. The providers are the ones this branch supports (OpenRouter, OpenAI, Gemini and
  the others with a key per person); the shapes go to them as before. There is no custom
  OpenAI-compatible endpoint any more, so none is needed.
- **Per person, per project.** Tries are each person's own (`PicturesResponse.tries` holds only the
  caller's; fetching or inserting another person's is `not_found`) and live in the project's own
  `assets/generated/entries/`. An inserted picture is an unsaved change of the person who inserted it.
