# Entries and writing

An **entry** is one note in your library: a person, a place, a legend, a rule of magic, a scrap of
an idea. Everything in Frontier is built around entries, and this chapter is about living with
them: reading one, changing its name or folder, writing in it, attaching images and comments,
looking back through its history, exporting it, and seeing how it connects to the rest of your
world.

If you have never opened the app before, read the "Getting started" chapter first and come back.
This chapter assumes you can find your way around the side bar.

**In this chapter**

1. [A note on words: saving and publishing](#a-note-on-words-saving-and-publishing)
2. [Making a new entry](#making-a-new-entry)
3. [Reading an entry](#reading-an-entry)
4. [The Entry actions bar](#the-entry-actions-bar)
5. [Renaming, moving and deleting](#renaming-moving-and-deleting)
6. [Writing: the editor](#writing-the-editor)
7. [The toolbar, button by button](#the-toolbar-button-by-button)
8. [Links between entries](#links-between-entries)
9. [Images](#images)
10. [Tables](#tables)
11. [Autosave and what "saved" means](#autosave-and-what-saved-means)
12. [The Properties panel](#the-properties-panel)
13. [Comments on a passage](#comments-on-a-passage)
14. [Writing help (AI)](#writing-help-ai)
15. [Drafting a new entry by voice or typing (AI)](#drafting-a-new-entry-by-voice-or-typing-ai)
16. [History: look back and restore](#history-look-back-and-restore)
17. [Exporting](#exporting)
18. [The Gallery](#the-gallery)
19. [The Graph](#the-graph)
20. [Finding things: search](#finding-things-search)
21. [Keyboard shortcuts for this chapter](#keyboard-shortcuts-for-this-chapter)
22. [Troubleshooting](#troubleshooting)

---

## A note on words: saving and publishing

Frontier keeps your library as a folder of ordinary Markdown files. Typing in the editor does not
change those files straight away. Your changes first become **unsaved changes** (a draft), and you
turn them into a permanent **version** when you are ready.

- In the usual setup, where Frontier keeps its own library, the buttons and counts say **Unsaved**
  and **Save a version**.
- If your Frontier is connected to a shared repository, the same things are called **Unpublished**
  and **Publish**.

This chapter uses "save a version" and "unsaved changes". If you see "publish" and "unpublished"
on your screen, read them as the same thing. How to review and save your changes is covered in the
chapter on saving versions; here we only point out where it matters.

Two things follow from this and come up again and again:

- **Exports, search and the AI read saved versions.** Text you have typed but not yet saved into a
  version is not in an export, is not found by full-text search, and is not seen by the AI that
  answers questions about your lore.
- **Nothing is lost by waiting.** Unsaved changes are kept safely, on your device and on the
  server, until you save them or discard them.

---

## Making a new entry

You can start a new entry from several places:

| Where | What to press |
| --- | --- |
| The side bar, near the top | **New entry** (the page-with-a-plus icon) |
| The **Library** heading in the side bar | The small **New entry** icon beside the heading |
| A folder in the tree | Hover the folder and press its **+** (**New entry here**), or right-click or use the folder's menu and choose **New entry here** |
| A link to an entry that does not exist yet | Click the faded link, then confirm **Write it** (see [Links between entries](#links-between-entries)) |

All of the first three open the **New entry** dialog.

### The New entry dialog

1. **Name.** Type the entry's name. This becomes the title of the entry and the name of its file.
   Frontier quietly removes characters that cannot go in a file name (`\ / : * ? " < > | # ^ [ ]`),
   drops a `.md` ending if you typed one, and refuses a name that is empty or starts with a dot.
2. **Folder.** It starts as the folder you were looking at. Click it, then type part of a folder's
   name to narrow the list ("Find a folder"), and choose one. **(top of the library)** is the top
   level. If the folder you want does not exist yet, type its name and choose **New folder "…"**;
   the folder is created together with the entry. You can type a path such as `People/Houses` to
   make a nested folder.
3. Press **Make the entry** (or Enter).

The editor opens on the new entry. It starts with the entry's name as a heading, and if the folder
has a **type** (for example, everything in the "People" folder is of type "person"), that type is
written into the entry's properties for you. Nothing is saved as a version until you decide.

---

## Reading an entry

Click an entry in the side bar, follow a link, or use search, and the entry opens in reading view.

### The page, top to bottom

- **Folder trail.** A small line above the title shows the folders the entry lives in. (If the entry
  is waiting to be moved, it says **unpublished** or **unsaved** here.)
- **Title.** The entry's name. The title comes from the entry's name, so if the text itself begins
  with a heading that only repeats the name, that heading is not shown twice. A heading with
  different words is kept as the first section.
- **Other names.** Small rounded tags under the title are the entry's other names (aliases). Hover
  one and it says "Also known as". A **read-only** tag means you cannot edit the entry (for
  example, files in the appendices, which are append-only).
- **Type and dates.** If the entry has a type, or lore dates such as "Founded" or "Died", they are
  listed under the title. A "?" beside a date label means the label is not one Frontier knows, and
  "not in the schema" next to a type means the same for a type. The text still shows; it is a hint
  that you may have a typo.
- **More properties.** Any custom properties you added (see
  [Properties panel](#the-properties-panel)) are listed here as "name: value". Links in a property
  value are clickable.
- **Talk with ...** For entries of type person or deity, when a model for conversations is chosen
  in Settings, a link **Talk with (name)** lets you chat in that character's voice. That feature
  is covered in the AI chapter, [05-ai.md](05-ai.md).
- **Open comments.** If the entry has comments you have not marked done, a line such as "2 open
  comments" links to them.
- **On maps / On chronicles.** If the entry is attached to a place or marker on a map, or to an event
  on a chronicle (timeline), those are listed with links that jump straight there.
- **Propose fields.** If the AI is set up, a **Propose fields** button appears (see
  [below](#propose-fields-ai)).
- **The text.** Your writing, drawn as reading text: headings, bold and italic, lists, tables,
  images, links.
- **Mentioned in.** At the bottom, a list of every entry that links to this one. This is the
  **backlinks** list; each name is a link, and the grey text shows which folder it is in. This is
  often the fastest way to see where a character or place shows up.

### Notices at the top of an entry

Sometimes a shaded note appears under the title. The common ones:

| Notice | Meaning |
| --- | --- |
| **You are reading your unpublished draft** / **A new entry, not published yet** | You have unsaved changes to this entry. The link beside it takes you to the list of unsaved changes, where you can save them as a version. |
| **Marked for deletion** | You deleted this entry; it goes for good when you save a version. Until then you can bring it back from the list of unsaved changes. |
| **Not saved yet: renamed from ...** / **moved from ...** | A rename or move is waiting. **Undo** takes it back. |
| **Not sent yet: this text is on this device and goes to the server when it can** | You wrote while offline. The text is safe on your device and will go up when the connection returns. |
| **This note arrived unreviewed** | The entry came in from outside (for example from another tool) and is waiting for you to accept or revert it in the **Inbox**. |
| **Offline copy from 14:05** | The page is showing a copy kept on this device because the server could not be reached. It refreshes by itself once the connection comes back. |

### The sticky heading line

On a computer, a slim bar stays at the top of the page as you scroll. It shows:

- On the left, **where you are**: the folder trail. Click a folder name to open that folder in the
  side bar's tree.
- Once the big title has scrolled out of view, the bar adds **the entry's name** (click it to jump
  back to the top) and **the heading you have reached** in the text, so in a long entry you always
  know which section you are in.
- On the right, the **Entry actions** (next section).

If the window is narrow, long parts of the trail are shortened to "…".

On a **phone**, the same idea is in the slim top line: it shows the entry's name, and once you
scroll it adds "› section heading". The Edit button and a **⋯** menu with the other actions are on
the right of that line.

### The Outline tab

Press **Outline** (the table-of-contents icon) in the Entry actions to open the **Outline** tab in
the right-hand side bar. It lists the entry's headings (levels 1 to 3), indented by level. The heading you are currently reading is
highlighted as you scroll. Click a heading to jump to it.

- The Outline button only appears when the entry has headings.
- On a phone the outline opens as a sheet; when you pick a heading, the sheet steps aside so you
  can read. On a phone, once you have scrolled past the title, the outline button is also in the
  top line.
- The Outline tab also works inside the editor. There it follows your cursor, and choosing a
  heading puts your cursor at the end of that heading line.

You can also link straight to a section: a link written like `[[Harbor#Tides]]` opens the entry
**Harbor** and scrolls to its **Tides** heading.

### Full width

By default the text sits in a comfortable reading column. Press **Full width** (the arrows icon)
in the Entry actions to let the page use the whole window, which is nice for wide tables. The icon
shows whether it is on. The setting is remembered. The same toggle is in the **⋯ More actions** menu,
and it works in the editor too.

### Hover previews

On a computer with a mouse, rest the pointer on a link to another entry for about a third of a
second and a small card appears with that entry's name and the first lines of its text. This works
in entries and on the Graph. It is switched off on touchscreens, where a tap simply follows the
link.

### Images and the lightbox

Images in an entry are shown in the text, at the width the writer gave them (see
[Images](#images)). **Click or tap an image** to open it large in the **lightbox**:

- If the entry has several images, use the **Previous** and **Next** arrows, the **←** and **→**
  keys, or swipe left and right on a touchscreen. A counter such as "2 / 5" shows where you are.
- Click the image again to see it at full size; click it once more to fit the screen.
- **Original** in the top bar opens the original file in a new tab.
- Close with the **✕** button, **Esc**, a click on the dark area, or (on a phone) a swipe down.

### Links and other names

Links between entries are written as `[[Entry name]]` and appear as ordinary clickable links.
A few kinds look different:

| What you see | What it means |
| --- | --- |
| Normal link | The entry exists. Click to open it. |
| Faded link with a dotted underline, tooltip "Not written yet. Tap to write it." | There is no entry with that name yet. Click it and Frontier offers **Write "(name)" now?**. Confirm with **Write it** and the editor opens on a brand-new entry in the same folder as the current one (or in the folder the link names). |
| Plain text, tooltip "N files share this name: ..." | Two or more entries have that name and the link does not say which. Fix it by writing the link with its folder, such as `[[People/Mira]]`. |
| Plain text, tooltip "A file outside the vault's notes" | The link points at a file that is not an ordinary note. |
| Link with an arrow-style label like "Harbor › Tides" | A link to a section of another entry. |
| Link that opens in a new tab | A normal web address. |

**Other names (aliases).** An entry can be known by more than one name: "The Iron Queen" might
also be "Queen Maren" and "Maren". Add them in the Properties panel under **Other names**. After that:

- Typing `[[Queen Maren]]` links to the same entry.
- Link autocomplete offers each other name as a choice.
- The quick finder (Ctrl+K) finds the entry by any of its names.
- The tags under the title show the other names.

### Backlinks

The **Mentioned in** list at the bottom of the entry shows every entry that links to this one. Use it to see where a person is mentioned, and to decide
whether a rename will affect many entries (it will, and Frontier will tell you how many; see
below).

---

## The Entry actions bar

On a computer the actions for the entry you are reading are on the right of the sticky line. Each
is an icon; hover for its name.

| Button | What it does |
| --- | --- |
| **Outline** | Opens the Outline tab. Only shown when the entry has headings. |
| **Graph** | Opens the entry's local graph: this entry and its neighbours (see [The Graph](#the-graph)). |
| **Full width** | Switches between the reading column and the whole window. |
| **Rename** | Changes the entry's name, in place. |
| **Move to…** | Moves the entry to another folder. |
| **History** | Opens the History tab: the saved versions of this entry. |
| **Export** | Opens the Export tab: download this entry as a web page, Word, PDF, Markdown or slides. |
| **Edit** | Opens the editor. |

In a narrow window the middle group (Full width, Rename, Move to…, History, Export) folds into a
**⋯ More actions** menu; **Outline**, **Graph** and **Edit** stay visible. On a phone, only **Edit**
and **⋯** are in the top line, and the menu holds everything else.

Rename, Move to…, History and Export are only shown for an entry you can change. A read-only entry
shows just Outline, Graph and Full width.

The side-bar tabs on an entry page are **Outline**, **Comments** (only when the entry has
comments), **History**, **Export** and **Graph**. Press the same button again to close the tab. On
a phone the tab opens as a sheet over the page.

---

## Renaming, moving and deleting

### Rename

1. Press **Rename** (or choose it from **⋯**). The title turns into a text field with the name
   selected.
2. Type the new name and press **Enter**. Press **Esc**, or click away, to leave the name as it is.

Frontier checks the name the same way as in the New entry dialog, and shows the reason under the
field if it is not allowed.

When the rename goes through, a message at the bottom says what happens, for example "Renamed to
Mira Vale; links in 4 other entries change when you save a version", with an **Undo** button.
**Links are not broken by a rename.** Frontier works out which other entries link to this one and
rewrites those links when you save a version. Until then the entry shows a note, "Not saved yet:
renamed from ...", with its own **Undo**.

An entry holds one pending rename at a time: renaming it again replaces the first, and changing it
back to its original name cancels the rename.

### Move

1. Press **Move to…**. A folder list opens under the title.
2. Type part of a folder name to narrow the list, then choose the folder. The entry keeps its name.
3. A message tells you what changes, with **Undo**.

Closing the list without choosing leaves everything as it was. You can also drag entries between
folders in the side bar, or use **Move to…** from a folder or entry in the tree, which is handy on
a touchscreen.

### Things that block a rename or move

- **You are offline.** Renaming and moving go to the server, because only the server can find all
  the links that change. The buttons are greyed out with the reason "Needs a connection".
- **The entry has changes still being sent.** The field says "Wait until your changes are sent".
  Wait a moment and try again.

### Delete

To delete an entry, open it in the editor, choose **⋯ More actions** at the right of the editor bar,
and pick **Delete entry**. Confirm "Delete this entry?". The entry is not removed from the library
at once: it is **marked for deletion** and disappears for good when you save a version. Until then
you can bring it back by discarding that change in the list of unsaved changes.

To delete a whole folder of entries, use the folder's menu in the side bar and choose **Delete…**;
Frontier counts what will go before you confirm.

---

## Writing: the editor

Press **Edit** to open an entry in the editor. The editor is a plain Markdown editor with a
formatting toolbar, so you can write by clicking buttons or by typing Markdown marks, whichever you
prefer. Your text is stored exactly as you write it: nothing you did not touch is ever changed.

### The bar at the top

| Control | What it does |
| --- | --- |
| Entry name | Shows which entry you are in. |
| Save status | "Saved as a draft", "Saving…", "Unsent: kept on this device", "Not saved", or "Two texts to compare". See [Autosave](#autosave-and-what-saved-means). |
| **Live preview** / **Source** | Chooses how the text is shown (below). |
| **Properties** | Opens the Properties panel. |
| **Comments** | Opens the Comments panel; a count shows how many are open. |
| **Done** | Saves what is waiting and returns you to reading the entry. |
| **⋯ More actions** | **Discard draft**, **Full width**, **Delete entry**. |

On a phone, **Done** moves up into the slim top line, beside the entry's name.

### Live preview and Source

**Live preview** (the default) shows your text as it will read. The marks for bold, italic,
underline, strikethrough, headings, `[[links]]` and inline code are hidden, and images are drawn.
The line your cursor is on shows its marks, so you can edit them. The block of properties at the top of the entry is folded into a single line such as
"Properties: 2 aliases, type"; click it to open the Properties panel.

**Source** shows every character of the Markdown in a fixed-width font, with nothing hidden. Use
it when you want to see exactly what is written, to fix a stray mark, or to edit the properties
block by hand.

Switching changes only how the text looks, never the text. The choice is remembered on this
device.

### Styles

The **Style** picker at the left of the toolbar sets what kind of line the cursor is on:

| Style | Shortcut |
| --- | --- |
| Paragraph | Ctrl+Shift+0 |
| Heading 1 to Heading 6 | Ctrl+Shift+1 to Ctrl+Shift+6 |
| Quote | (no shortcut) |
| Code block | (no shortcut) |

On a Mac use ⌘ in place of Ctrl. The picker shows the current style; choosing another changes the line
(or all selected lines). Choosing **Paragraph** removes a heading or quote mark.

### Text formats

Select some words (or just put the cursor in a word) and press a format button or its shortcut.
Pressing it again removes the format.

| Format | Shortcut |
| --- | --- |
| **Bold** | Ctrl+B |
| *Italic* | Ctrl+I |
| ~~Strikethrough~~ | Ctrl+Shift+X |
| Underline | Ctrl+U |
| `Inline code` | (button only) |

Underline is written in the text as `<u>…</u>` (this is the one HTML mark Frontier understands). It
is shown underlined in reading view and live preview, and an Obsidian user reading your exported
copy sees the same.

### Lists

| List | Button | Shortcut |
| --- | --- | --- |
| Bullet list | **Bullet list** | Ctrl+Shift+8 |
| Numbered list | **Numbered list** | Ctrl+Shift+7 |
| Task list (checkboxes) | **Task list** | (button only) |

Press Enter at the end of a list item to start the next one; press Enter on an empty item to end the list. Choose the same list button again to turn the lines
back into plain paragraphs. **Indent** (Tab) puts an item under the one above it, making a
sub-list; **Indent less** (Shift+Tab) moves it back out.

### Horizontal rule

**Horizontal rule** inserts a dividing line on a line of its own. (It always leaves a blank line
above it, because in Markdown a line of dashes directly under text would turn that text into a
heading.)

### Undo and redo

**Undo** (Ctrl+Z) and **Redo** (Ctrl+Shift+Z or Ctrl+Y) are the last group on the toolbar. They
step back through your typing in this session.

### Other editor keys

| Key | What it does |
| --- | --- |
| Ctrl+S | **Save now**: send what you have typed to the server immediately instead of after the pause. |
| Ctrl+Enter | **Done**: save and return to reading (inside a table it adds a row instead; see [Tables](#tables)). |
| Ctrl+J | **Writing help** on the selection or paragraph. |
| Ctrl+F | The editor's own find-in-text box. |
| Esc, then Tab | Leave the text and move to the next control (the editor uses Tab for indenting, so this is the way to step out with the keyboard). |
| Ctrl+K | Go to another entry (works everywhere). |
| ? | Show all the keyboard shortcuts (outside of text boxes). |

### The right-click menu

On a computer, right-click inside the text to open a menu with the things you use most:

- **Cut**, **Copy**, **Paste** (if your browser does not allow the menu to read the clipboard, Paste is greyed out and says "Use Ctrl+V").
- **Bold**, **Italic**, **Strikethrough**, **Underline**, **Inline code**.
- **Style**, a sub-menu with the same list as the Style picker.
- **Link to an entry** and **Add an image**.
- **Comment**, **Help with this…** and **Ask the lore about this…**.

Hold **Shift** while right-clicking to get the browser's own menu instead (useful for spelling
suggestions). On a phone or any screen without a mouse the right-click menu is off, because a long
press belongs to the phone's own selection; the toolbar's **⋯** has the same tools.

---

## The toolbar, button by button

The editing toolbar sits at the **bottom** of the screen (above the keyboard on a phone), so it is
always under your thumb. If it is too narrow to show everything, the last groups fold into the
**⋯ More tools** menu at the right end, so the bar never scrolls or wraps. Hover a button to see its name and shortcut.

From left to right:

| Group | Buttons |
| --- | --- |
| **Help** | **Help** (sparkle icon, Ctrl+J). Always on the bar with its name. See [Writing help](#writing-help-ai). |
| **Table tools** | Only while your cursor is inside a table: **Add a row below**, **Delete this row**, **Add a column to the right**, **Delete this column**. |
| **Style** | The style picker (Paragraph, Heading 1–6, Quote, Code block). |
| **Text** | **Bold**, **Italic**, **Strikethrough**, **Underline**, **Inline code**. |
| **Lists** | **Bullet list**, **Numbered list**, **Task list**, **Indent**, **Indent less**. |
| **Insert** | **Link to an entry**, **Add an image**, **Horizontal rule**. |
| **Comment and help** | **Comment**. (**Ask the lore about this…** is in the menus only.) |
| **Undo and redo** | **Undo**, **Redo**. |
| **⋯ More tools** | Everything that did not fit, in the same groups, with shortcuts listed. |

**Buttons that need a connection** (greyed out, with a reason, when you are offline): **Add an
image** ("Images need a connection"), **Comment** and **Ask the lore about this…**. Writing and
formatting work offline.

---

## Links between entries

There are two ways to put a link in your text.

### Typing `[[`

Type two opening square brackets. A list of entries appears, filtered as you type. Names that
start with what you typed come first. Each choice shows its folder beside it; other names show
"→ (the real entry name)". Use the arrow keys and Enter (or click) to choose. Frontier writes the
closing `]]` for you.

- If you choose an other name, the link is written `[[Real name|Other name]]`, so the reader sees
  the other name but the link goes to the real entry.
- If two entries share a name, the link is written with its folder, so it can never be mistaken.

### The Link to an entry button

Put the cursor where the link should go, or **select the words** you want to turn into a link, and
press **Link to an entry** (or choose it from the right-click menu). A small search list opens
beside the cursor; pick the entry. If you had selected words, they stay as the link's visible text:
`[[Entry name|your words]]`.

Press Esc to close the list without writing anything.

### Linking to a heading

Write `[[Entry name#Heading]]`. The link opens the entry scrolled to that heading.

### Showing different words

`[[Entry name|words to show]]` makes the link read "words to show". This is how you write "she"
or "the old queen" and still link to the right entry.

---

## Images

Images are saved in your library as files and shown in the text with an embed such as
`![[harbor-map.png]]`. Frontier accepts PNG, JPG, GIF, WebP, SVG, AVIF and BMP files up to 25 MB
each. If an image with that name already exists, the new one gets a unique name; you never
overwrite another image by accident. **All of these ways need a connection.** If you try offline,
a message says "Images need a connection. Your text stays."

### Ways to add an image

1. **The Add an image dialog.** Press **Add an image** on the toolbar (or in the right-click
   menu). The dialog has:
   - **Upload…** to choose one or more files from your device.
   - **Paste image** to take an image from your clipboard. If your browser does not allow this,
     press **Ctrl+V** while the dialog is open instead.
   - **From a web address**: paste a link to an image (http or https) and press **Add** or Enter;
     the server fetches it for you. (Limited to ten a minute.)
   - **The library**: every image already in the library, with folders on the left, a **Find by name or
     entry** box, and thumbnails. Click thumbnails to choose one or several, then **Insert** (or
     **Insert 3 images**, and so on). Already-used images are listed first.
2. **Paste into the text.** Copy an image (a screenshot, an image from another page) and press
   Ctrl+V in the editor. It is uploaded and embedded where the cursor is. Right-click then **Paste** works too.
3. **Drag and drop** an image file from your computer onto the text.

When more than one image goes in at once, each gets a line of its own.

New images are kept as unsaved changes together with the entry; they become part of the library
when you save a version.

### Sizing an image

In **Live preview**, an image is shown at its real size. To resize it:

- **Drag the handle** on the image's right edge left or right. When you let go, the width is
  written into the embed: `![[harbor-map.png|300]]` means 300 pixels wide.
- To go back to the image's own size, **double-click or double-tap the handle**, or press the small reset button.
- Works with mouse, pen and touch.

You can also type the width yourself after a bar. An embed with other words after the bar
(`![[map.png|The harbor]]`) is treated as a caption and is not resized by the handle.

### Seeing and reusing images

The [Gallery](#the-gallery) shows every image in the library, and which entries use it.

---

## Tables

Frontier edits ordinary Markdown tables:

```
| Rank | Title | Seat |
| --- | --- | --- |
| 1 | Warden | The Keep |
| 2 | Reeve | The Quay |
```

There is no "insert table" button: type the lines with bars, with a row of dashes under the header
row. In reading view the table is drawn as a proper table (and it scrolls sideways inside its box
if it is wide; try **Full width**). In the editor, a table stays in the fixed-width font so the columns line
up as written.

While your cursor is inside a table, four extra buttons appear at the left of the toolbar, and the
table keys work:

| Action | Button | Shortcut |
| --- | --- | --- |
| Next cell | (Tab) | **Tab** |
| Previous cell | (Shift+Tab) | **Shift+Tab** |
| Add a row below | **Add a row below** | Ctrl+Enter |
| Add a column to the right | **Add a column to the right** | Ctrl+Shift+Enter |
| Delete this row | **Delete this row** | Ctrl+Shift+Backspace |
| Delete this column | **Delete this column** | Ctrl+Alt+Backspace |

Only the cells that change are touched; the rest of the table is left exactly as you wrote it.
Some limits: the header row and the separator row cannot be deleted as rows, and the last column
cannot be deleted. A bar you want inside a cell is written `\|`.

---

## Autosave and what "saved" means

You never have to press a save button just to keep your typing.

1. **Every keystroke is kept on your device at once.** If the page crashes, the battery dies or the
   connection drops, your words are still there when you come back.
2. **About a second after you stop typing, the text goes to the server** as a **draft**. The status
   at the top says **Saving…** and then **Saved as a draft**.
3. **A draft is not yet a version.** To make it permanent, **save a version** from the list of
   unsaved changes (the **Unsaved** link at the bottom of the side bar). See the chapter on saving
   versions.

You can press **Ctrl+S** to send immediately instead of waiting, and **Done** also sends before it
closes the editor.

### The save status words

| It says | It means |
| --- | --- |
| **Saved as a draft** | The server has your latest text. |
| **Saving…** | The text is on its way. |
| **Unsent: kept on this device** | There is no connection (or you are signed out). Your text is safe here and will go up by itself when the connection returns. |
| **Not saved** | The server refused the change. A red message under the bar says why. Your text is still on your device. |
| **Two texts to compare** | The entry was changed somewhere else (for example on another device) after you began. Both texts are kept; a banner offers **Compare the two texts**. |

### Discard draft

**⋯ More actions → Discard draft** throws away your unsaved changes to this entry and returns
to the saved version. A question asks you to confirm: "Discard this draft?" and says that
"What is saved in the library stays as it is." This one needs a connection.

### Writing offline

You can open an entry you have visited recently and keep writing without a connection. The editor
shows an **Offline copy from ...** note and **Unsent: kept on this device**. Tools that go to the
server (images, comments, writing help, rename) wait until you are back online. If you come back
to find the entry changed elsewhere in the meantime, Frontier keeps both texts and shows the
**Two texts to compare** banner rather than overwrite either.

---

## The Properties panel

Every entry can start with a **properties block**: a short list of facts between two lines of
`---` at the very top of the file. In Live preview this block is folded into one line; in Source
you see the raw lines. The **Properties** panel lets you change the common ones with forms, so you
never need to type the dashes and colons.

Press **Properties** in the editor's top bar (or click the folded properties line in the text). A
panel opens at the right (a sheet on a phone). Each field changes only its own line; everything
else in the block is left exactly as it was.

| Field | What to enter |
| --- | --- |
| **Other names** | Names that also link to this entry. Separate with commas: `Queen Maren, Maren, The Iron Queen`. Press Enter or click away to apply. Clear the box to remove them. |
| **Tags** | Plain labels, separated by commas. |
| **Type** | Choose what kind of entry this is (person, place, and so on). **From its folder** means "use the folder's type" and writes nothing. The list comes from your world's schema. |
| **Dates** | The lore dates of the entry. See below. |
| **More properties** | Your own properties. See below. |

### Dates

A date is a pair: **what happened** and **when, in the lore's own words**. Press **+ Add a date**;
choose what happened from the list (for example Born, Founded, Died) and type when, like "the
third winter of the Interregnum", or "412 AR". You can use `[[links]]` inside the "when", so a date can point at an entry such as an
era. A row is only written to the entry once both parts are filled in. **✕** (Remove this date)
removes a row.

These dates feed the entry's header (the "Founded: ..." lines) and can show up on chronicles.

### More properties (custom properties)

Press **Add a property** to keep any extra fact about the entry, such as "Motto", "Population" or "Ruler".

1. Give it a **Name**. Names are one line, up to 100 characters; case does not matter, so
   "ruler" and "Ruler" are the same. You cannot reuse a name the entry already has, or one that
   already has a field of its own above (such as type, tags or other names).
2. Choose its **Kind**:

   | Kind | Use for |
   | --- | --- |
   | Text | Any words |
   | Number | A quantity |
   | Date | A date |
   | Checkbox | Yes or no |
   | List of text | Several short items, separated by commas |
   | Link to an entry | Points at another entry, with an entry picker |

3. Press **Add**, then fill in the value. A value that does not fit its kind is refused with a message.

Change a property's name by editing it in place, change its value in its field, and remove it with
the **Remove** button beside it. A property that only the text can show (a nested or unusual
value) is marked "Change this one in the text".

If the properties block has a syntax error, the panel says "The properties block at the top of
this note cannot be read. Fix it in the text." Switch to **Source**, correct the lines at the top,
and the panel works again.

### Propose fields (AI)

On an entry page (not in the editor), if an AI model is set up, a **Propose fields** button
appears under the entry's header. It reads the entry and suggests a **type** and **dates** that
the text already states. It never changes the entry itself. The result says **"N proposed. Decide
in the inbox"** (follow the link to accept or refuse each suggestion), or **"Nothing new to
propose."** Proposed fields show in the header with a small "proposed" mark until you decide.

This button only appears for entries that are saved (not for a brand-new entry that is still a
draft) and only when the AI is on. Setting up the AI is covered in [05-ai.md](05-ai.md).

---

## Comments on a passage

A **comment** is a sticky note attached to a few words in an entry: a reminder to yourself ("check
the founding year against the Chronicle"), or, if you wish, a request for the AI ("make this
sound less modern"). Comments are not part of your lore. They are not in the entry's text, its
history, or any export; they are working notes kept beside it.

### Adding a comment

1. In the editor, **select a few words**, or just put the cursor in a paragraph.
2. Press **Comment** on the toolbar (or right-click → **Comment**). The Comments panel opens at the
   right with the passage quoted.
3. Type the comment ("What should change here, or what to remember…"). Up to 2,000 characters.
4. Choose who it is for: **For me**, or **For the AI**. (**For the AI** is greyed out until you
   have chosen a model for conversations in Settings; see [05-ai.md](05-ai.md).)
5. Press **Keep the comment**.

You need to select at least a few letters (three or more); a very short selection says "Select a few
words, or put the cursor in a paragraph, to comment on it." A passage cannot be longer than about
a page (6,000 characters). A comment needs a connection.

### Seeing comments

- In the editor, commented passages are **highlighted in amber**.
- The **Comments** button in the editor bar shows a count, and opens the **Comments panel**, a
  list of every open comment with its quoted passage.
- When the side panel is closed and the window is wide enough, comments also appear as **bubbles in
  the margin**, level with their passages, on both the entry page and the editor. Click a
  bubble to open that comment in full. Bubbles for AI comments have a sparkle instead of a speech
  icon.
- On the entry page, the **Comments** tab (shown when the entry has comments) lists them. Click a
  quoted passage and the page scrolls to it. Adding comments and the AI's work are in the editor.
- Under an entry's title, "N open comments" links straight to the panel.

### Working with a comment

In the Comments panel each comment has buttons:

| Button | What it does |
| --- | --- |
| The quoted passage (a link) | Selects that passage in the editor, or scrolls to it on the entry page. |
| **Suggest a change** | Only on a comment **for the AI**: the AI reads your comment and proposes a rewrite of the passage, shown in the writing help card under the passage (see [Writing help](#writing-help-ai)). Keep it, and the comment is marked done automatically. |
| **Give to the AI** / **Make it mine** | Switches who the comment is for. |
| **Done** | Removes the comment. |

### If the passage moves or disappears

A comment remembers the words it is about, not a position in the page, so it stays with its
passage while you edit around it. If you rewrite the passage so much that Frontier cannot find it,
the comment stays in the list marked **(passage not found)**; you can still read it and mark it
Done.

Comments follow an entry when it is renamed.

---

## Writing help (AI)

Writing help rewrites a passage of your own text on request, always as a suggestion you can accept
or refuse. It never changes your text by itself, and it is told to keep every name and fact and add
nothing new ("Keeps every name and fact. Adds nothing new.").

It needs an AI model chosen in Settings (see [05-ai.md](05-ai.md)). If none is chosen, the **Help** button is still
there, but the card it opens says "Writing help needs an AI model. Choose one once in Settings
and it works in every entry." with an **Open Settings** button. If you are offline, it says
"Writing help needs a connection. Your text is safe; try again when you are back online."

### Asking for help

1. **Choose the passage**: select some words, or put the cursor in a paragraph. (Up to about a
   page, 6,000 characters.)
2. Press **Help** on the toolbar, **Ctrl+J**, or right-click → **Help with this…**.
3. A card opens **right under the passage**, and the passage is softly highlighted so you can see
   what will change. Either:
   - type what should change in the box ("What should change? For example: tell it as a legend an
     elder would…") and press Enter or **Go**; or
   - press one of the ready-made requests: **Shorter**, **Longer**, **Simpler**, **More vivid**,
     **Fix spelling and grammar**.
4. The card says "Writing a suggestion…". Press **Stop** (or Esc) to cancel.
5. The suggestion appears in the card as readable text. Two buttons at the top right switch the
   view: **Changes** (word by word: removed words struck out, new words highlighted) and
   **Clean** (just the new text). The card opens on Changes when few words changed and on Clean
   when most did.

### Deciding

| Button | Result |
| --- | --- |
| **Keep** (Enter) | Replaces the passage with the suggestion in one step. A message "Passage replaced" stays six seconds with **Undo**; Ctrl+Z works as usual. |
| **Try again** | Asks for a different version of the same request. "1 of 2" arrows step between versions. |
| **Discard** (Esc) | Closes the card; nothing changed. |
| **⋯ → Put it below the passage** | Keeps your original and adds the suggestion after it. |
| **Change it further…** box | Type a refinement ("keep the first sentence", "less formal") and press Enter. It refines the suggestion on screen, not the original. |

If you change the passage after asking, the card says "You changed this passage after asking. The
suggestion is for the older wording." and offers **Ask again with the new wording**, so a stale
suggestion can never overwrite text you wrote since.

If the model gives no usable answer, the card says "The model did not answer this time. Nothing in
your text changed." with **Try again**.

### Ask the lore about this…

In the right-click menu and the toolbar's **⋯**, **Ask the lore about this…** opens the **Ask**
page with your passage quoted as the start of a question. That is not an edit; it is a
conversation with your library. See [05-ai.md](05-ai.md).

### Entries waiting in the inbox

An entry that arrived from outside and has not been accepted yet is kept away from the AI. Asking
for help or a suggestion on it is refused with a short message.

---

## Drafting a new entry by voice or typing (AI)

You can describe a new idea in your own words, spoken or typed, and have Frontier shape it into an
entry that fits the lore you already have. This lives on the **Ask** page, where it needs an AI
model chosen in Settings (see [05-ai.md](05-ai.md)).

### Dictation

Wherever you see a **microphone button**, you can speak instead of typing: on the Ask page, and
in the "Change this…" box when you are polishing a draft (below). The editor itself has no
microphone button; on a phone, use the keyboard's own dictation key there.

- Press the **microphone** (tooltip "Dictate (Ctrl+Shift+M)", or ⌘+Shift+M on a Mac). It turns red and pulses while it
  listens, and the status says "Listening. Tap to stop."
- Speak. Your words appear in the box as you say them, after whatever was already there.
- Press the button again (now a square, "Stop dictation") or press **Esc** to stop. On a phone, a
  **Listening** bar with a Stop button sits at the bottom of the screen.
- You can then edit the text before sending.

Dictation uses your browser's built-in speech recognition, so it depends on the browser:

| Problem you may see | What to do |
| --- | --- |
| "Dictation is not available in this browser. You can type." | Dictation depends on the browser (Chrome and Edge usually have it; some browsers do not). Use one that does, or type. |
| "Microphone access was refused…" | Allow the microphone for this site in the browser's settings. |
| "No microphone was found." | Connect one. |
| "Dictation needs a connection in this browser." | Some browsers send speech to an online service. Reconnect, or type. |
| "Heard nothing. Try again." | Speak a little closer or louder. |

### Draft entry

1. On the **Ask** page, say or type your idea in the box, "A question or an idea". For example,
   "The ferrymen of the Marsh keep a lantern lit at every crossing; whoever lets one go out loses
   their licence."
2. Press **Draft entry** (the main button; **Ask** is the quieter one beside it).
3. Frontier looks up related lore and writes a draft: a **title**, a **folder**, and a few
   **paragraphs** in your own words. It lists the entries it looked at, the **links** it would add
   (marking names that **would be new** entries), and **Not said yet**: questions the entry still
   leaves open.
4. The draft is a working copy, not a verdict. You can:
   - change the **title** and the **folder** (a drop-down);
   - edit any paragraph directly in its box. A paragraph you change is **rechecked** against the lore
     when you click out of it ("Checking against the lore…", then "Edited by you. Rechecked.");
   - press **Change this…** under a paragraph, then say or type what to change ("make her the
     eldest warden") or press **Shorter**, **Simpler**, **More vivid**, and press **Suggest**. The
     suggestion is shown word by word; **Accept** it, **Edit first**, or **Dismiss** it;
   - press **Undo** to put a paragraph back as it was drafted.
5. **Conflicts.** If a paragraph contradicts an existing entry, it is marked **Conflicts with the
   lore**, with the quote and a link to that entry. For each conflict you must choose before you can
   keep the draft: **Fix it for me** (the AI makes the smallest change that makes the paragraph
   agree) or **Keep mine anyway** (the entry's file will say the line was kept against the lore).
6. If a title is already taken, a notice offers to open the existing entry or choose another title.
7. When you are happy, press **Keep as unsaved change**. The new entry is created as an unsaved
   change; the message says where to find it. It is not part of the library until you save a
   version. **Discard** throws the draft away.

---

## History: look back and restore

Every time you save a version, Frontier remembers what each entry looked like. You can look back at
any earlier state of an entry and bring it back.

### The History tab

Press **History** in the Entry actions (or **⋯ → History**). The right-hand side bar lists the
saved versions that changed this entry, newest first, each with its date and time and the first line
of the note saved with it. Frontier follows the entry through saved renames, so
the history continues under the old name. A rename you have not saved yet is not in it.

If you have never saved a version that touched this entry, the tab says "No saved version yet: it
is in the history once you save a version."

### The history page

Click any version in the tab to open the full **History of (entry name)** page, with that version
open and scrolled into view. The page lists every saved version of the entry. For each:

1. Press **Show what changed**. A comparison appears: lines added are marked **+** and shown in
   green, lines removed are marked **−** and shown in red, and long stretches that did not change
   are folded into "N unchanged lines". If the entry had a different name at that time, a note says
   "Then named ...".
2. Press **Restore this version** to bring that text back. (The newest version has no Restore button; it is the
   current one.)

Restoring does not delete anything. It puts the old text into the entry as an **unsaved change**,
the same as if you had typed it, and takes you to the entry. Everything in between is still in the
history, and you can still undo the restore by discarding the unsaved change or by restoring a
newer version. When you are happy, save a version as usual.

**You cannot restore while the entry has unsaved changes.** The page says "This entry has unsaved
changes. Save or discard them first." Do one or the other, then restore.

### History of the whole library

From the **App menu** (the menu at the bottom of the side bar), choose **History of the library**.
This is the **Versions** page: the last hundred saved versions of the whole library, each with its date,
note, and a fold-out list of the files it changed. Click a note file name to see that entry's
history. The page also has a link to export the whole library as a zip.

---

## Exporting

Exporting gives you a copy of your writing to read, share or print outside Frontier. Exports are
made from **saved versions only**, as of your last saved version. Any unsaved changes are left out,
and Frontier tells you when the entries you chose have some.

What is always left out:

- The properties block at the top of each entry (the lore dates and tags).
- Appendices.
- Notes still waiting in the Inbox for you to accept.

How links are treated: a link to an entry **inside** the export stays a link. A link to an entry
**left out** of the export stays as its words, so a reader sees that there is more that was not
shared: in web pages it has a dotted underline and says "not shared" on hover; in Word, PDF and
slides it is followed by a dagger "†", explained in a note at the start. Images are included in the file. Web addresses
stay as links.

Exporting needs a connection, because the server does the work. Without one the buttons are
greyed out and say "Needs a connection".

### Export one entry (the Export tab)

Open an entry and press **Export** in the Entry actions (or **⋯ → Export**). The Export tab shows
five buttons:

| Button | You get |
| --- | --- |
| **Web page** | A zip of linked pages in Frontier's look, which opens in any browser by double-clicking `index.html`. No server needed. |
| **Word** | One `.docx` file, with headings and pictures, to edit or send. |
| **PDF** | One printable PDF with a title page and contents. |
| **Markdown** | A `.md` file with its images, which Obsidian and other editors open. |
| **Slides** | One `.pptx`: a title slide, then a slide per section. A starting point to polish, not a finished deck. |

Press a button; it says "Making it…" for a moment, and then your browser downloads the file. If
the entry has unsaved changes, a note at the top says so. A link at the bottom, **the Export
page**, goes to the page for folders and JSON.

### Export a folder or choose entries (the Export page)

From the **App menu** choose **Export**.

1. **Folder.** Choose a folder from the list. Everything in it, including its sub-folders, is
   exported.
2. **Title.** The name for the whole export: the title page of a Word or PDF file, the home page of
   a web export, and the name of the downloaded file. Change it to whatever you like.
3. Frontier shows "N entries will be exported", and a note if some of them have unsaved changes
   (with a link to save a version first). Open **Which entries** to see the list.
4. Press the form you want:

   | Button | You get |
   | --- | --- |
   | **Web pages** | A zip of linked pages in Frontier's look, to open in any browser. |
   | **Word document** | One `.docx`, with headings and pictures, to edit or send. |
   | **PDF** | One printable PDF, with a contents page. |
   | **Slides** | One `.pptx`: a title slide per entry and a slide per section, to edit. |
   | **Markdown** | A zip of `.md` files linking to each other, with their images, for reading on GitHub or in any Markdown editor. |
   | **JSON** | One file for other tools: each entry's properties, text and links. Images are named, not included. |

Entries are ordered by folder, then by title. Each entry's own title is the heading, and headings inside it
are moved one level down so the whole export reads as one document. Large exports can take a while
(a minute or two at most), and the buttons say "Making it…" while they work.

If **Word**, **PDF** or **Slides** fail, the conversion tool may be missing on your server; the **Status** page
(App menu) shows the state of the server. Web pages, Markdown and JSON do not need it.

**For a complete copy of the whole library to read in Obsidian**, use the full zip link on the
Status page rather than this Export page.

---

## The Gallery

Press **Gallery** in the side bar's list of places to see every image in your library.

- **Tabs** along the top filter the grid, with counts: **In entries**, **Not used**, **Icons** and
  **All**. The Gallery opens on **In entries**. **Not used** is handy for finding images you
  uploaded but never put in an entry. **Icons** are the small images used as map marker icons.
- **Find by name or entry** at the top searches file names and the names of the entries that use
  each image.
- **Folders** down the left side (with counts) narrow the grid to one folder. **All folders** resets it.
- Each **tile** is a thumbnail with its file name. Images used by entries come first. Under it,
  "In (entry), (entry) and N more" lists where it is used, each a link. A small **Unpublished**
  mark shows an image that was uploaded but is not in a saved version yet.
- Click a thumbnail to open it in the lightbox, with previous/next arrows across the gallery.

The Gallery is for looking and finding. To add an image to an entry, use the editor's **Add an
image** button, which opens the same grid in a picking mode.

---

## The Graph

The **Graph** shows how your library is connected: every entry is a dot, every link between
entries is a line. Dots are coloured by the top-level folder they live in, and bigger dots have
more connections. It is for looking and for jumping from entry to entry; you cannot edit from it.

### The Graph screen

Choose **Graph** in the side bar's list of places.

**Moving around**

| Do this | To get this |
| --- | --- |
| Drag the background | Pan |
| Mouse wheel, or pinch on a touchscreen | Zoom |
| **Zoom in**, **Zoom out**, **Fit the graph** buttons (bottom right of the picture) | Zoom, or fit everything on screen |
| Rest the pointer on a dot | A preview card with the start of the entry |
| Click a dot | Select it: a card at the bottom shows its name and folder, and **Open** |
| Double-click a dot, or press **Open** on the card | Open the entry |
| Tap a dot on a touchscreen | Select it; tap the selected dot again to open it |
| Click empty space, or **Clear the selection** (✕) | Clear the selection |

Entries that are not in a saved version yet are marked "unpublished" on the card and in the Entries list. Each time you
come back to the Graph in the same visit, it remembers where you were looking.

**Finding an entry.** The **Find an entry** box at the top left searches names, other names and
paths. Press **/** anywhere on the Graph to jump into it. Choose a result and the Graph centres on
that dot and selects it.

**Side panels.** Two buttons at the bottom, **Entries** and **Filters**, open panels in the side bar
(on a phone, Filters is also in the top line):

- **Entries** lists every entry currently shown, in alphabetical order. This is the way in for
  keyboard and screen-reader users. Up and Down move, Home and End jump to the ends, **Enter**
  selects an entry and centres the graph on it, a second **Enter** (or a double-click) opens it.
- **Filters** has a tick box for each top-level folder, each with its colour. Untick a folder to hide its dots
  and their links. **Appendices are unticked to begin with.** Your choices are kept while you use
  the app. If you untick everything, the screen says "Nothing to show" with a **Tick all folders**
  button.

**Keys on the Graph**

| Key | Does |
| --- | --- |
| **/** | Find an entry |
| **Enter** | Open the selected entry |
| **Esc** | Clear the selection |
| **0** | Fit the graph |
| **=** | Zoom in |
| **-** | Zoom out |

The Graph needs the server for fresh data; offline it may show a copy kept on this device ("Offline
copy from ...") or say "The graph needs a connection."

### An entry's local Graph tab

On any entry, press **Graph** in the Entry actions to open the **Graph** tab in the side bar. It
shows **this entry in the middle**, ringed, with its neighbours around it: the entries it links to
and the entries that link to it.

- **Depth 1 / Depth 2** switch between direct neighbours only, and neighbours of neighbours.
  (Appendices are left out, as on the full Graph.)
- The picture behaves like the big one: hover for a preview, click to select, click **Open** or
  double-click to open an entry.
- Under the picture, **Neighbours** lists them as plain links, with their folders. That is the
  keyboard and screen-reader way to move on to a neighbour.
- **Open in full graph** takes you to the Graph screen with this entry already selected.
- An entry with no links at all says "No other entry links here, nor is linked from here."

The Graph is also a good way to find **orphans**: dots with no lines, which no entry mentions and
which mention no entry.

---

## Finding things: search

### Go to an entry (Ctrl+K)

Press **Ctrl+K** (⌘+K on a Mac) anywhere, or press **Search** at the top of the side bar (or the
search icon on a phone), and a box opens: "Find an entry or search the text…".

- Start typing a **name or other name**. Matching entries are listed at once, with their folder.
  (If you match an other name, the list shows it with the real entry's name.)
- From **two letters** on, Frontier also searches the **text** of every entry. Those results are
  listed under "In the text", each with the sentence where your words were found.
- Move with **↑** and **↓**, open with **Enter** or a click, close with **Esc**.

### Tips for full-text search

- Search finds entries that contain **all** your words, anywhere in the entry, in any order.
  `ferrymen lantern` finds entries mentioning both.
- Word starts count: typing `ferry` also finds "ferrymen". Small typos are forgiven, so `lanturn`
  still finds "lantern".
- Matches in an entry's **title**, **other names** and **headings** rank higher than matches in the body.
- Appendices are not included in text results.
- Searching the text reads **saved versions**. Words you have typed in an unsaved change are not
  searched until you save a version. Searching by name does include your new unsaved entries.
- Capital letters do not matter.
- Searching text needs a connection. Offline, the box still finds entries by name and says "Full-text search needs a connection."
- If nothing is found: "Nothing found." Try fewer or shorter words.

---

## Keyboard shortcuts for this chapter

On a Mac, read Ctrl as ⌘ and Alt as ⌥. Press **?** (outside of a text box), or choose **Keyboard
shortcuts** in the App menu, to see the live list for the screen you are on.

| Keys | Where | What |
| --- | --- | --- |
| Ctrl+K | Everywhere | Go to an entry / search |
| ? | Everywhere | Show keyboard shortcuts |
| Ctrl+\ | Everywhere | Fold or unfold the side bar |
| Ctrl+B | Editor | Bold |
| Ctrl+I | Editor | Italic |
| Ctrl+U | Editor | Underline |
| Ctrl+Shift+X | Editor | Strikethrough |
| Ctrl+Shift+7 | Editor | Numbered list |
| Ctrl+Shift+8 | Editor | Bullet list |
| Ctrl+Shift+1 … 6 | Editor | Heading 1 … 6 |
| Ctrl+Shift+0 | Editor | Paragraph |
| Tab / Shift+Tab | Editor | Indent / indent less (in a table: next / previous cell) |
| Ctrl+S | Editor | Save now (send the text immediately) |
| Ctrl+Enter | Editor | Done (in a table: add a row below) |
| Ctrl+Shift+Enter | Table | Add a column to the right |
| Ctrl+Shift+Backspace | Table | Delete this row |
| Ctrl+Alt+Backspace | Table | Delete this column |
| Ctrl+J | Editor | Writing help on the selection or paragraph |
| Ctrl+Z | Editor | Undo |
| Ctrl+Shift+Z or Ctrl+Y | Editor | Redo |
| Esc then Tab | Editor | Leave the text for the next control |
| Esc / ← / → | Lightbox | Close / previous image / next image |
| / , Enter, Esc, 0, =, - | Graph | Find, open, clear, fit, zoom in, zoom out |
| Ctrl+Shift+M, Esc | Ask page, change boxes | Start or stop dictating; Esc stops |
| Enter / Esc | Rename field | Rename / cancel |

---

## Troubleshooting

**I typed something and the status says "Unsent: kept on this device".**
You have no connection, or you are signed out. Nothing is lost: the text is stored on your device
and goes to the server on its own once the connection is back. If you were signed out, sign in
again.

**The status says "Not saved" in red.**
The server refused the change and the message under the bar says why (for example the file is
read-only). Your text is still on your device. Fix the cause or copy your text elsewhere before
leaving.

**A banner says "Two texts to compare".**
The entry was changed on another device after you began, so Frontier kept both texts instead of
choosing for you. Open **Compare the two texts**, decide, and carry on.

**My changes are not in the export / search results.**
Exports and text search read saved versions. Save a version first (the **Unsaved** link at the
bottom of the side bar).

**Rename and Move to… are greyed out.**
You are offline (they need the server), or the entry still has changes being sent. Wait a moment, or
reconnect.

**A link is faded and clicking it asks "Write (name) now?".**
The linked entry does not exist yet. That is normal for a name you plan to write; choose **Write it**
to start it, or fix the spelling if it was a typo. If the entry exists under another spelling,
add that spelling under **Other names** in its Properties.

**A link shows as plain text with "N files share this name".**
Two entries have that name. Write the link with the folder: `[[People/Mira]]`, or choose it from the
`[[` list, which writes it correctly for you.

**Add an image is greyed out.**
You are offline. Images need a connection. Your text is safe; add the image when you are back
online.

**"The file needs an image extension" / "This file is not an image Frontier can read".**
Use a PNG, JPG, GIF, WebP, SVG, AVIF or BMP file under 25 MB.

**An image from a web address will not come in.**
Some sites refuse automatic downloads, and at most ten may be fetched a minute. Download the image
and use **Upload…** or paste it.

**The Comment button does nothing / says to select words.**
Select a few words, or click inside a paragraph. The passage needs at least three letters and must
be shorter than about a page.

**"For the AI" is greyed out in a comment, and Help says it needs an AI model.**
No model for conversations is chosen yet. See [05-ai.md](05-ai.md).

**I cannot restore a version.**
The entry has unsaved changes. Save or discard them first. Also, the newest version has no Restore
button because it is already the current one.

**The properties panel says the block "cannot be read".**
There is a typo in the lines between the `---` marks at the top. Switch to **Source** and correct
it; the panel then works again.

**Word, PDF or Slides export fails, but Web pages works.**
The server may be missing its document converter. Check the **Status** page, or ask whoever runs your
Frontier.

**The Graph is blank or says "Nothing to show".**
Either the library has no entries, or every folder is unticked in **Filters**. Press **Tick all folders**.
Appendices are hidden until you tick them.

**Dictation does not start.**
See the table under [Dictation](#dictation): the browser may not support it, or the microphone is blocked
for this site.

**The comment bubbles in the margin are missing.**
They only show when the side panel is closed and the window is wide enough to leave room beside the
text. Make the window wider, or close the panel, or use the Comments tab.
