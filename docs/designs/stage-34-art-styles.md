# Stage 34: a library of art styles

Approved by Elad on 2026-11-27, with all recommendations. Mockup:
https://claude.ai/artifact/FNjWsRNQEm4RNW3scxqVNK (Settings and the Generate tab, desktop and phone, all
clickable; the pictures are stand-ins drawn by the page).

## What's wrong today

- There is one art style: a single unnamed text box in Settings › AI models. Trying another look means
  overwriting it.
- In the Generate tab the style is a folded line of text. It can be retyped for one picture, but there is
  nothing to choose from and nowhere to keep a variant that worked.
- Styles are only words, so a style cannot be seen before a picture is paid for.

## The design

- **A library of named styles.** Each style has a name (up to 40 characters), what its pictures look like
  (up to 600, as before) and an optional sample picture. A library holds up to 24.
- **Settings › AI models › Concept art.** The text box becomes a grid of cards under the model, across the
  full width of the row: the sample, the name, three lines of the words, and Edit. Clicking a card makes
  it the **usual** style, which discoveries are drawn in and the Generate tab starts on. The last card is
  **New style**.
- **Editing.** Edit opens a dialog with the name, the words, the sample (Make a sample / Make it again),
  and Duplicate and Delete. Delete has Undo, which puts the style back where it was and usual again when
  it was. The last style cannot be deleted.
- **Samples.** Made on request by the picture model, at a picture's cost, with the person's own key.
  Every sample is the same scene (a lighthouse on a cliff above the sea), so styles compare.
- **Generate tab.** The folded line becomes a strip of small style cards, with **No style** at the end
  and the usual one picked. The picked style's words show under the strip. Each try says which style
  made it.
- **Changing a style for one picture.** "Change for this picture" opens the picked style's words for
  editing, as before. "Save as a new style" keeps them in the library, from inside the dialog, and picks
  the new style. "Edit styles" goes to the settings.
- **The style a person had.** It is the first card and the usual one, so nothing changes until another
  is picked: named "My style" when they wrote their own, and the Field notebook starter when it was the
  default.

## Phone and desktop

Desktop: cards in a grid, as many across as fit; the editor is a dialog. Phone: the cards are rows (the
sample at the left, the name, two lines of the words, Edit at the right); the Generate strip scrolls
sideways.

## Empty and problem states

- **No sample:** a hatched space that says "No sample yet".
- **No picture model or no key:** the cards and the editor work; Make a sample says why no picture can be
  made (the app's usual question for a missing key).
- **A name already taken, or 24 styles:** said under the fields; New style is not offered at 24.

## Keys

- **← → ↑ ↓** on the cards and on the strip: move and choose. **Tab** reaches Edit.
- **Esc** closes the editor; **Enter** in the name saves.
- **Ctrl+Enter** in the prompt still generates.

## Decisions (as approved)

- **1.** Cards have sample pictures, made on request; not text-only cards.
- **2.** The library starts with six starter styles (Field notebook, Watercolour wash, Woodcut print, Oil
  on canvas, Atlas engraving, Gouache poster), each the person's own to edit or delete, with "Bring back
  the starter styles".
- **3.** The library is each person's, on every device and in every project; not one per project.
- **4.** The Generate tab opens on the usual style every time; a pick lasts while the dialog is open.

## Not in this stage

A style picker for a single discovery on a map, a library shared by a project's members, reordering the
cards, and remembering the last style used per entry.

## As built

- **Schema.** `ArtStyle` (`id`, `name`, `text`, `sample`), `STARTER_ART_STYLES`, `artLibrary` and
  `withArtLibrary` in `packages/schema/src/state.ts`. A person's settings gain `ai.artStyles` (null until
  the library is first changed; until then `artLibrary` works it out from the one style they had) and
  `ai.usualArtStyle`. `ai.artStyle` stays, and is always what the usual style says, so the discoveries'
  concept art and devices on an earlier build read it as before.
- **Server.** `ai/artStyles.ts` (`ArtStyles`) and `routes/artStyles.ts`: `GET` and `POST
  /api/settings/art-styles` (`id` and `at` put a deleted style back), `PUT` and `DELETE …/:id`, `POST
  …/starters`, `POST …/sample` (draws the scene in the words given; at most 12 a minute) and `GET
  …/sample/:token`. `PUT /api/settings/ai` takes `usualArtStyle`, and its old `artStyle` changes what the
  usual style says. `GET /api/settings` and `GET /api/pictures` carry the styles and the usual one; a try
  keeps `styleName`.
- **Samples** are kept as 640-pixel WebP files in `DATA_DIR/state/art-samples/<person>/<token>.webp`, each
  person's own. A sample is made for the words in the editor and is put on the style when it is saved; one
  no style points at is dropped a day later, at the next change to the library. A duplicate shares its
  original's sample.
- **The starters' pictures.** A starter's `sample` is `starter-<look>`: a drawing of the sample scene that
  the web app ships (`StyleSample.tsx`), so the library is not blank before anything is paid for. The
  editor says so, and Make a sample replaces it with the model's own.
- **Web.** `pages/settings/ArtStyles.tsx` is the grid; `components/images/ArtStyleEditor.tsx` the dialog,
  used by the settings and by the Generate tab (`GeneratePanel.tsx`), over whose dialog it opens;
  `components/images/StyleSample.tsx` and `ArtStyles.css` are shared.
- **Differs from the mockup.** On a phone the editor is the app's usual dialog box, not a full screen.
  The editor does not name a price for a sample, since it is not known before a picture has been made.
- **Tests.** `apps/server/test/artStyles.test.ts`, and CUJ 34 in `apps/web/e2e/artstyles.spec.ts`
  (desktop).
