# Stage 19: speaking to the lore and drafting entries

Status: Approved, 2026-11-24, from a clickable mockup in Frontier's current look. Author: Elad
Haviv. Builds on [stage 8](stage-8-ai-companion.md) (lore conversations and additions) and
[stage 17](stage-17-writing-help.md) (writing help).

## What was wrong

*   The question box on "Ask the lore" is typing only. On a phone, a long thought is slow to enter,
    and an idea that is not a question yet has nowhere to go.
*   "Draft an addition" appears only after an answer, so a new entry cannot start from nothing.
*   A drafted addition can only be kept or thrown away. It cannot be changed first.

## The design

**Speaking.** A microphone sits in the question box. Tap to start, tap to stop. The words appear
in the box and stay editable. Nothing is sent while it listens, and a pause never ends a turn.
Dictation uses the browser's own speech recognition. Where a browser has none, the microphone is
not shown and the page says "Dictation is not available in this browser. You can type."

**Two buttons.** The box has **Ask**, which answers from the lore as before, and **Draft entry**,
which proposes a new entry from what was said.

**The draft is a working draft.** It shows the title, the folder, and short paragraphs that keep to
what was said. What an entry like this would need but was not said is listed under "Not said yet"
instead of being invented. Links are shown as existing or "would be new".

*   **Edit in place.** The title, the folder and every paragraph can be changed where they stand.
    A changed paragraph is marked "Edited by you" with Undo.
*   **Rechecked.** When the author leaves a paragraph he changed, that paragraph alone is checked
    against the lore again. A conflict that his edit removes clears; one it adds appears.
*   **Conflicts.** A line that an entry contradicts has a dashed warning edge, quotes the entry's
    own words (checked to be there word for word, or the claim is dropped), and names the entry.
    The draft cannot be kept until each conflict is decided: **Fix it for me** (a suggestion, below)
    or **Keep mine anyway**. A line kept against the lore gets a hidden note in the file:
    `<!-- kept against the lore: Title -->`.
*   **Change this…** under each paragraph. The author says or types what to change, or picks
    Shorter, Simpler or More vivid. It uses the writing help of stage 17. The suggestion is shown
    as a word-by-word difference with **Accept**, **Edit first** and **Dismiss**.
*   **Keep as unsaved change** makes a new entry that waits under Unpublished, as a stage 8 addition
    does. Nothing enters the library until it is published. The draft's origin is recorded as
    `lore` with a `voice/<id>` reference, so the publishing commit names it.

## Phone and desktop

The page is the same. On a phone, while listening, a bar with Stop stays at the bottom, so the
microphone is under the thumb wherever the page is scrolled.

## Empty and failing states

*   No dictation in the browser, or no permission for the microphone: said in words; typing works.
*   No model chosen: the existing banner stays, and both buttons stay off.
*   A title that an entry already has: said above the draft, with a link; keeping is refused.
*   A recheck that fails: said under the draft; it does not block keeping.

## Keyboard

`Ctrl` or `⌘` + `Shift` + `M` starts and stops dictation in the box. `Esc` stops listening and keeps
the text. `Ctrl` or `⌘` + `Enter` asks. `Esc` in a paragraph or the title leaves it.

## Decisions

1.  **Where drafting starts:** a second button in the same box. One place, one microphone.
2.  **How speech becomes text:** the browser's own dictation first. It is free and needs no key.
    Its accuracy with invented names is the open risk; model transcription can be added later.
    Some browsers send the audio to their maker's servers, which is the browser's choice, not
    Frontier's.
3.  **When edits are rechecked:** when the author leaves the paragraph he changed, and only that
    paragraph. Each check is a small call that counts against the monthly cap. Dictation stays tap
    to start and tap to stop.
4.  **Conflicts:** keeping is blocked until each is decided, with "Keep mine anyway" as an explicit
    choice. This matches the rule that contradictions are flagged and never silently fixed.

## Not in this stage

*   Dictating a revision of the whole draft ("Revise by voice" in the mockup). Dictation is in the
    box and in each "Change this…" instead.
*   Adding or removing paragraphs in the draft, and a recheck when only the title changes.
*   Model transcription, hands-free listening, and reading the draft back aloud.
