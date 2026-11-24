# Writing help: a simpler design

For approval before building. Mockup: `writing-help-mockup.html` (open it in a browser; desktop frames
at 1180 px, phone frames at 390 px).

Based on the code (`apps/server/src/ai/writing.ts`, `routes/writing.ts`, `routes/comments.ts`,
`apps/web/src/components/WritingPanel.tsx`, `CommentsPanel.tsx`, `editorTools.ts`, `pages/Edit.tsx`),
the stage 8b and 12 designs, and the running app (sample library, stand-in model) on desktop
(1280×800) and phone (390×844).

## 1. What's wrong today

1. **It's hard to find.** "Writing help" sits in the toolbar's "⋯" overflow, under "Comment and help",
   on both desktop and phone. When no AI model is chosen it vanishes, and nothing says why.
2. **It's not clear what it works on.** It quietly takes the paragraph the cursor is in and freezes it
   when the panel opens. The text isn't highlighted; the panel shows a cut-off quote. Select another
   passage and the panel still works on the old one. Type in the passage and "Replace" fails with
   "Close it and select the passage again."
3. **It sits far from the text.** On desktop it's a side-bar tab (the tab label is cut to "Writin"). On the
   phone it's a half-height sheet behind the formatting bar, and the result ends up below the fold.
4. **Two tools share one panel.** "Or say how…" + Rewrite changes the text. "Ask the lore about this
   passage…" + Ask answers a question. The two boxes look the same, and each answer appears in a
   different place.
5. **The result is hard to read.** It's a fixed-width, line-by-line difference. A rewritten paragraph is one
   long struck-through red line and one long green line in a code font.
6. **No way forward from a result.** You get Replace / Put below / Discard / Close. There's no "try again",
   and you can't say "good, but keep the first sentence".
7. **Waiting has no way out.** A request can take up to two minutes, and the only sign is the button saying
   "Writing…". There's no Stop.
8. **A third way to do the same thing.** A comment marked "For the AI" and "Work on it" runs the same
   rewrite, with its own copy of the difference and Replace.

## 2. The design

**One idea:** select text, press **✦ Help**, say what should change, read the suggestion as prose, keep it
or not. Help opens *in the text*, under the passage, so you always see what will change.

### Where it lives

| Place | Desktop | Phone |
| --- | --- | --- |
| Toolbar | **✦ Help** button, always visible in the toolbar (never in "⋯"), after Comment | **✦ Help** as the first button on the formatting bar above the keyboard |
| Selecting text | A small floating bar with **Comment** and **✦ Help** | (not used: iOS shows its own menu there) |
| Right-click menu | **Help with this…  Ctrl+J** and **Ask the lore about this…** | the toolbar's "⋯" has the same two |
| Keyboard | **Ctrl/⌘+J** | the same, with a hardware keyboard |

The right-side-bar "Writing help" tab goes away.

### Main flow

1. **Choose the passage.** Select some words, or just put the cursor in a paragraph.
2. **Press ✦ Help (Ctrl+J).** The passage gets a soft rust highlight that stays while help is open. A card
   opens right under it, in the flow of the text (a CodeMirror block widget), with the cursor in its box.
3. **Say what should change.** One box: *"What should change? For example: tell it as a legend an elder
   would…"*, then Enter (or **Go**). Below it, ready-made requests as chips: **Shorter · Longer · Simpler ·
   More vivid · Fix spelling and grammar**. One tap sends.
4. **Wait.** The card shows "Writing a suggestion…" with a **Stop** button. Esc also stops.
5. **Read the suggestion.** It's set in the entry's serif font, in the card. A small switch shows **Changes**
   (word by word: removed words struck in red, new words in green) or **Clean** (just the new text). The
   card opens on Changes when few words changed and on Clean when most did. The line "Keeps every name
   and fact. Adds nothing new." restates the rule the model is given.
6. **Decide.**
   * **Keep** (Enter): replaces the passage as one edit. A bar says "Passage replaced · Undo" for six
     seconds; Ctrl+Z works as usual.
   * **Try again**: asks for a different version of the same request. "1 of 2" lets you step back to an
     earlier one.
   * **Change it further…**: a box under the suggestion ("keep the first sentence", "less formal"). It
     refines the current suggestion, not the original.
   * **Discard** (Esc): closes the card. Nothing changed.
   * "Put below" (keep both) moves into a small "⋯" on the card, as it's rarely needed.

### States

| State | What the card says |
| --- | --- |
| No model chosen | "Writing help needs an AI model. Choose one once in Settings and it works in every entry." **Open Settings**. Help stays visible so it can be found. |
| Offline | "Writing help needs a connection. Your text is safe; try again when you are back online." The button stays enabled so the message can explain. |
| You typed in the passage meanwhile | The card follows the passage as the text changes (the range is mapped through each edit). If the passage itself changed: "You changed this passage after asking. The suggestion is for the older wording." **Ask again with the new wording** / Discard. This replaces today's dead-end error. |
| Nothing usable came back | "The model did not answer this time. Nothing in your text changed." **Try again**. |
| Passage in quarantine | The server's existing refusal, shown in the card in one line. |
| Very long selection (over 6,000 characters) | "Select a shorter passage (up to about a page)." |

### Phone

* Tap in a paragraph (or select), then tap **✦ Help** on the formatting bar. The card opens under the passage
  and the page scrolls it into view above the keyboard. There's no half-height sheet competing with the
  keyboard.
* While it writes, the keyboard drops so the suggestion has room. Keep / Again / Discard are full-height
  (at least 44 px) buttons in one row, with Keep the widest.
* No floating chip on selection: iOS's own callout already sits there.

### Keyboard (desktop)

* **Ctrl/⌘+J** opens help on the selection or paragraph. Pressing it again with the card open puts focus back
  in the box.
* **Enter** sends. **Esc** stops a request in flight, then discards, then closes.
* When a suggestion arrives, focus goes to **Keep**, so Enter keeps it. **Tab** moves to Try again, Discard
  and the "change it further" box.
* **Ctrl+Enter** keeps its editor meaning (Done) and is not reused here.

### Asking the lore moves out

A question about the passage isn't editing it. **Ask the lore about this…** (right-click menu and "⋯")
opens the Ask page with the passage quoted, as `api.ask` already builds it. Answers there already show
their sources and guesses. This takes the second box out of the help card.

### Comments for the AI

Keep them; they're the "do this later" version. Rename **Work on it** to **Suggest a change**, and show its
result in the same inline card under the commented passage, with the same Keep / Try again / Discard. After
that there's one look for every AI suggestion.

## 3. Mockup

`writing-help-mockup.html` has seven sections:

1. Desktop with a selection and the floating Comment / Help bar.
2. The card open.
3. A suggestion with Changes / Clean.
4. Every other state: waiting, no model, offline, passage edited, no answer, after Keep.
5. The right-click menu.
6. Two phone screens: asking, and the suggestion.
7. Today vs proposed.

## 4. Decisions for you

1. **Inline card under the passage, or keep the side panel?**
   *Recommendation: inline card.* It keeps the eye on the text and fixes the phone layout. The side panel can't
   show which words will change without you looking back and forth.
2. **Take "Ask the lore about this passage" out of writing help?**
   *Recommendation: yes.* Move it to the right-click and "⋯" menus, where it opens the Ask page with the
   passage quoted. One box with one job.
3. **Add "Fix spelling and grammar" as a fifth ready-made request?**
   *Recommendation: yes.* It's the most common small request, and it's the case where the word-by-word
   Changes view shines. It needs one new line in the server's list of requests.
4. **Show ✦ Help when no AI model is chosen?**
   *Recommendation: yes.* Show it, and have it explain how to turn help on. A hidden feature can't be
   found. If you'd rather not see AI in the editor at all, a "Show writing help" switch in Settings could
   hide it.

(Comments "For the AI" stay. Only their result view and button label change, as above. Say so if you'd
rather drop them.)

## 5. Build plan (one engineer, about 5 days)

| # | Where | What | Size |
| --- | --- | --- | --- |
| 1 | `apps/web/src/components/writing/helpCard.ts` (new) | A CodeMirror `StateField` holding `{ from, to, phase, suggestions[], index }`. It maps `from`/`to` through every transaction and marks `stale` when a change touches the range. It provides a mark decoration for the highlight and a block widget below the passage's last line. The widget is a `WidgetType` (like `ImageWidget` in `imageWidget.ts`) whose element hosts a React root (`createRoot`), unmounted in `destroy`. Model it on `commentMarks.ts`. | 1.5 d |
| 2 | `components/writing/HelpCard.tsx` (new) | The card UI: box, chips, waiting + Stop (an `AbortController` passed to `api.rewrite`), suggestion with Changes/Clean, Keep / Try again / Discard / "⋯ Put below", refine box, states. Keep dispatches one change with `userEvent: "input.ai"` and shows the undo toast (`components/ui/Toast.tsx`). | 1.5 d |
| 3 | `components/Diff.tsx` | Add `WordDiff` using `diffWords` from `diff` (already a dependency), in the prose font. Choose Changes vs Clean by the share of words changed (over 50% → Clean). | 0.25 d |
| 4 | `editorTools.ts`, `EditToolbar.tsx`, `EditorContextMenu.tsx`, `keys.ts` | "✦ Help" as a labelled tool that never folds into "⋯" (a `pinned` flag). New key `editor.help` = `Mod-j`. Menu items "Help with this…" and "Ask the lore about this…" (the latter navigates to Ask with the quoted passage). A selection bar with Comment and Help on pointer devices only. When no model is chosen, Help stays and opens the "Open Settings" state. | 0.75 d |
| 5 | `pages/Edit.tsx`, `WritingPanel.tsx` | Remove the "writing" right-bar panel and `WritingPanel.tsx`. Keep `passageOf` (move it into `helpCard.ts`). | 0.25 d |
| 6 | `apps/server/src/ai/writing.ts`, `routes/writing.ts` | Add `fix: "Correct spelling, grammar and punctuation only; change nothing else."` to `HOW`. Add optional `previous: string[]` (earlier suggestions, so Try again asks for a different one) and `refine: { suggestion, how }` (refine the current suggestion: the passage sent is the suggestion, and the original goes in as context). Bump `WRITING_PROMPT_VERSION`. Abort the provider call when the request closes, if the provider supports a signal; otherwise just ignore the late answer. | 0.5 d |
| 7 | `CommentsPanel.tsx` | Rename "Work on it" to "Suggest a change" and open the result in the inline card on the comment's passage; remove its own Diff and Replace. | 0.5 d |
| 8 | Tests | Rewrite `apps/web/e2e/ai.spec.ts` "writing help" for the card: phone and desktop, Keep, Try again, Discard, stale passage, no-model state. Unit-test range mapping in `helpCard.ts`. Server tests for `fix`, `previous` and `refine`. The e2e stand-in (`e2e/server.mjs`) already answers "=== Passage" prompts. | 0.75 d |

Nothing changes in what is saved: a kept suggestion is an ordinary edit of the draft, as today.
