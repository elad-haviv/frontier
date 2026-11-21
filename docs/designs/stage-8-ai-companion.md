# Stage 8: the AI companion

Status: Draft, 2026-11-21, part 8a. Author: Elad Haviv. Parent: [Frontier](frontier.md); builds on
the AI basics of [stage 3](stage-3-review-and-ai-basics.md).

## Overview

The parent design gives stage 8 four parts: lore conversations, writing help in the editor,
character chat, and discovery on a map with concept art. Each gets its part of this document when
it is built. The author decided on 2026-11-21:

1.  **Lore conversations come first.**
2.  **The lore is looked up in Frontier's own library**, not in the Hindsight bank, which is set
    aside. The bank can be added later as a second source.
3.  **What the AI makes and the author keeps becomes an unsaved change**, shown as a difference
    first, and saved as a version like anything he types.

This amends the parent: goal G13 ("grounded and cited") is met from the library; the parent's
"Grounding" paragraph about recalling from the bank waits until the bank returns.

## 8a Lore conversations

### CUJ 11, as it now reads

*   **Given**: The author opens "Ask the lore" on his phone.
*   **When**: He asks how the Nirani keep time and what else relates to it.
*   **Then**: The answer is in paragraphs, each with links to the entries it rests on, and quotes
    that are checked word for word against those entries. Under it, "Also related" lists entries the
    question did not name but that bear on it. A follow-up about something the library does not
    cover gets "This is not in the lore" with what is missing. He presses "Draft an addition", reads
    the proposed text as a difference against the entry it would join, and keeps it: it becomes an
    unsaved change of that entry. Nothing enters the library until he saves a version.

### Looking up the lore

For each question, before the model is called, Frontier picks the entries to give it. All text is
the **published** text of the library; drafts are never read, appendices (`99 Appendices/`) never.

1.  **Named.** Every entry whose title or other name occurs in the question as whole words, ignoring
    letter case. Names of three letters or fewer are left out, so "Ezob" counts and "Ra" does not.
2.  **Searched.** The full-text search, with any word of the question (not every word), after
    dropping common English words, up to 8 entries, best first.
3.  **Earlier in the conversation.** The entries cited in the last two answers, so a follow-up can
    lean on them.
4.  **Nearby.** The entries that the first three named or searched entries link to, up to 6: the
    source of "Also related".

The list is cut to 16 entries in that order, without repeats. Each entry is given as its path, its
title and its body; a body longer than 6,000 characters is cut at a paragraph and marked as cut.
The whole stays under 60,000 characters, dropping from the end of the list.

### The call

*   **Task** `conversation`, with its own model chosen on the settings page ("Model for lore
    conversations"). The monthly cap and the cost log apply as for every call.
*   **System prompt**, in substance: answer only from the entries given; cite each paragraph's
    entries by path; quote a short passage where it helps, word for word; never invent lore; say
    plainly what the entries do not cover; Nirani culture is non-visual (one of the vault's rules
    that the model is most likely to break). The full text is in `apps/server/src/ai/lore.ts` with
    a version number, as the stage 3 prompt is.
*   **The user message** holds the entries, the last six turns of the conversation (questions and
    the text of the answers), and the question.
*   **The answer's form** (JSON schema, strict):

```json
{
  "paragraphs": [{ "text": "…", "sources": ["03 Gazetteer …/Nirani.md"] }],
  "quotes": [{ "path": "…", "text": "…" }],
  "related": [{ "path": "…", "why": "…" }],
  "missing": "what the entries do not say, or an empty string"
}
```

### Checks on the answer

The model's answer is untrusted text. Before it is stored or shown:

*   A source that is not one of the entries given is dropped. A paragraph left with no source is
    shown with the mark "not from the lore".
*   A quote is kept only if its text occurs in that entry's body, after folding runs of white space
    and typographic quotes; otherwise it is dropped and counted.
*   A related entry must exist in the library and must not already be a source; at most 6.
*   The text is rendered through the same sanitising Markdown renderer as entries. Links in it are
    not followed; Frontier draws its own links from the sources.

The answer shows "This is not in the lore" with the `missing` text when `missing` is not empty or no
paragraph has a source.

### Drafting an addition

*   "Draft an addition" under an answer with something missing makes a second call (task
    `conversation`) with the same entries and the missing text. It answers `{ path, text }`: the
    entry the addition joins (one of the entries given) or a new entry's path, and the Markdown to
    add, written in the style of the vault.
*   A new entry's path must be a Markdown path that does not exist, outside `99 Appendices/` and
    `.frontier/`; otherwise the addition is offered for the first source of the answer.
*   The page shows the difference: the entry's text now, and with the addition appended under a
    blank line. "Keep as a draft" writes it as a draft of that entry (or a new entry), through the
    same draft store as the editor, marked in the conversation as kept. "Discard" forgets it.
*   If the entry already has a draft, the addition is appended to the draft's text and the
    difference is against the draft.

### Conversations

*   Kept in `/data/state/conversations/<id>.json`, one file each: id, title (the first question, cut
    to 80 characters), when made, and the turns. A turn holds the question, the checked answer, the
    entries that were given, the cost, when, and any addition drafted from it. They are working
    files, not lore, and are not in the library, its history or its export; they are in the backup
    with the other working files.
*   The page **Ask the lore** (`/ask`, in the menu): the list of conversations, newest first, and a
    box to start one. A conversation's page (`/ask/:id`) shows its turns and a box to ask again.
    Conversations can be deleted.
*   While the model works, the page shows "Reading N entries…"; a call that fails shows the
    provider's or the cap's message and keeps the question in the box.
*   When no key or no model for conversations is set, the page says so and links to Settings.

### As built, after the design review

A design review found ways for invented lore to pass as checked, and for the page to be steered.
What was built differs from the sections above as follows; where they disagree, this is right.

*   **Never read: notes waiting in quarantine.** Every lookup rule, the related list and the
    addition use the same gate as field proposals (`aiMayRead`), as well as the appendices and
    Frontier's own folder.
*   **Quotes belong to paragraphs.** Each paragraph carries its own quotes. A paragraph is "from the
    lore" only when one of its quotes, of four words or more, is found in one of its own sources;
    links are read as their words, and emphasis, spacing and curly quotes are folded away on both
    sides. A paragraph without such a quote is shown as a guess, even when it names a source.
*   **History holds only what was supported**: the earlier questions and their quoted paragraphs.
    A guess never comes back to the model as something known.
*   **Shown as plain text.** The model's words, the related notes and what it says is missing are
    shown as plain text, never as Markdown, links or pictures. A drafted addition has pictures from
    other web addresses taken out; the server already allows pictures from itself only.
*   **Lookup order**: named (at most 8), earlier answers' sources, searched, nearby. A one-word title
    that the library itself writes in lowercase in three or more entries ("water") names its entry
    only when the question writes it with a capital. A follow-up is searched with the question
    before it. A long entry is cut to its opening and the sections holding most of the question's
    words. The search matches any word, whole words, with longer forms for words of five letters or
    more, without the search page's fuzziness.
*   **An addition is stored with its turn**, so showing it again costs nothing; "Draft again" asks
    anew. The author chooses where it goes: an entry the answer was read from, or the new entry the
    model proposed, which is kept only if it sits in the folder of an entry read, names no entry by
    title or other name, and is outside appendices and Frontier's folder.
*   **Keeping is done on the server.** The browser sends only the chosen place and a fingerprint of
    the text it was shown. The server appends the stored addition to the entry as it is now, and
    refuses with "changed" when that is not the text shown; it refuses an entry being renamed,
    marked for deletion, or holding two versions from two devices. The draft carries the origin
    `lore` with the conversation, turn and model, which the unsaved changes page names and a saved
    version records as `Frontier-Model`.
*   **Calls** wait up to two minutes and are not sent twice after a timeout, since a timed-out call
    may still be billed; the conversation is named in the cost log. Changes to one conversation are
    made one at a time. The list of conversations gives counts, not turns. Sources of entries since
    renamed or removed are shown struck through.
*   The Nirani rule in the prompt is one of the vault's own rules, kept there until rules can be
    read from the library.

### API

| Method and path | Body | Response |
| --- | --- | --- |
| `GET /api/lore` | none | `{ conversations: [{ id, title, at, turns }] }` |
| `POST /api/lore` | `{ question, conversation? }` | `{ conversation, turn }`: a new conversation when none is given |
| `GET /api/lore/:id` | none | `{ conversation }` |
| `DELETE /api/lore/:id` | none | `{ ok }` |
| `POST /api/lore/:id/turns/:n/addition` | none | `{ path, before, after, isNew }` |
| `POST /api/lore/:id/turns/:n/addition/keep` | `{ path, after }` | `{ draft }` |

### Files

| File | What |
| --- | --- |
| `apps/server/src/ai/lore.ts` | Looking up, the prompts, the call, the checks, the addition |
| `apps/server/src/ai/conversations.ts` | The conversation files |
| `apps/server/src/routes/lore.ts`, `app.ts` | The routes |
| `apps/server/src/index/search.ts` | A search that matches any word |
| `apps/server/src/ai/provider.ts`, `packages/schema/src/api.ts` | The `conversation` task and its model in the settings |
| `apps/web/src/pages/{Ask,Conversation}.tsx`, `Settings.tsx`, `components/Shell.tsx` | The pages, the model field, the menu |

### Risks

| Risk | Effect | Answer |
| --- | --- | --- |
| The model invents lore | A false "fact" is trusted | Sources checked, quotes checked word for word, unsupported paragraphs marked; nothing enters the library without a saved version |
| Lookup misses the entry that answers | "Not in the lore" when it is | Names, search and links together; the entries given are listed under each answer, so a miss is visible |
| A long conversation costs much | The cap is reached | Six turns of history at most; cost shown per answer; the cap stops calls |
| Text in an entry or the answer tries to steer the model or the page | Wrong answers; unsafe markup | Entries are data in the prompt; the answer is sanitised and its links are Frontier's own |

### Verification

*   **Server**, with a stand-in provider: lookup by name, by search and by link, with the limits;
    appendices and drafts never read; each check (an unknown source, a quote not in the entry, an
    unknown related entry, a paragraph without a source); "not in the lore"; the cap and a missing
    model; an addition to an existing entry, to a new one, and to an entry with a draft; keeping it
    makes a draft; conversations stored, listed and deleted.
*   **Browser**, with the stand-in: CUJ 11 on a phone.

## 8b Writing help in the editor

Built on 2026-11-21 with these choices, which the author can overrule; comments on a passage, from
the ideas inbox, wait for a later part.

*   **Where.** An "AI" button on the editor's toolbar, shown once a model for lore conversations is
    chosen; the same model serves writing help, and Settings says so. It opens a panel over the
    lower part of the editor.
*   **The passage** is the selection, or the paragraph the cursor is in when nothing is selected.
    It is fixed when the panel opens.
*   **Rewriting.** Shorter, Longer, Simpler, More vivid, or the author's own words ("as a legend told
    by an elder"). The model gets the passage, about 1,200 characters before and after it, the
    request, and up to six entries the passage names or is about (looked up as for a question,
    without the entry being edited and never a note in quarantine), and is told to add no new facts
    unless asked. Pictures from other web addresses are taken out of its answer.
*   **The difference first.** The rewrite is shown against the passage. "Replace" puts it in place of
    the passage and "Put below" after it, as an ordinary edit of the draft, so it can be undone and
    is saved as an unsaved change like anything typed. If the passage changed while the panel was
    open, nothing is put in and the panel says so.
*   **Asking about the passage.** A question in the panel starts a lore conversation whose question
    quotes the passage. The panel shows the answer's paragraphs as plain text, guesses marked, with a
    link to the conversation and its sources.
*   **API**: `POST /api/write/rewrite` with `{ path, passage, before, after, how }` answers
    `{ text }` and saves nothing.

## 8c Character chat

Built on 2026-11-21 following CUJ 12 of the parent, with these choices, which the author can
overrule:

*   **Where.** "Talk with …" on an entry typed `person` or `deity` (the Notable Individuals,
    Deities and Archdemons folders), once a model for conversations is chosen. The page is
    `/talk/<path>`.
*   **The profile** is drafted from the character's entry, the entries that link to it or that it
    links to, and what a search for its name finds (twelve at most, never appendices or notes in
    quarantine). Traits are of four kinds: how they speak, what they know, what they believe, and
    what is not known. A trait of the first three kinds is kept as such only with a quote of four
    words or more found in one of its sources; otherwise it is turned into "not known". The author
    edits, removes and adds traits, names the moment the character speaks from, and may give that
    moment's year in the main chronicle.
*   **Approving** saves the profile as a draft of `.frontier/profiles/<entry id>.json`, giving the
    entry an id first when it has none; both are saved together with the next version.
*   **Talking.** The model gets the profile, the same entries, the last twelve lines and the
    author's words, and answers in one to four lines in the character's voice. With a year given,
    entries whose span in the main chronicle begins after it are left out: the character does not
    know them. Each line is checked like a lore answer; a line with no supported quote is shown as
    improvised. The conversation is not kept; it ends when the page is left.
*   **Keeping a line.** "Add to …'s entry" appends the line to the entry as a draft, with the
    origin `lore`, which the unsaved changes page names.
*   **API**: `GET /api/characters/profile?path=`, `POST /api/characters/propose`,
    `POST /api/characters/approve`, `POST /api/characters/say`, `POST /api/characters/line`.

## 8d Discovery on a map, with concept art

Built on 2026-11-21 following CUJ 13 of the parent. The author decided: concept art is made **only
when he asks**, and the default style is **pencil and ink on aged paper**. Other choices, which he
can overrule:

*   **Explore** on a map's bar, shown once a model for conversations is chosen. While exploring, a
    tap asks what might be found at that place. With time on, the year and chronicle of the time
    bar are the moment: entries whose span begins later are not drawn on.
*   **What is drawn on**: the entries of the zones the place lies in, of the six nearest features
    linked to an entry, and the entries those link to, twelve at most; never appendices or notes in
    quarantine. With nothing near linked to an entry, Frontier says so and calls no model.
*   **Proposals**: one to three, each a settlement, place, creature, person or thing, with a name,
    a short description, the passages it grew from and what it might contradict. Passages are
    checked word for word; a name already used by an entry is flagged; a proposal with no checked
    passage says so. Proposals are working files (`/data/state/discoveries/<map>.json`), shown on
    the map as dashed "?" pins, and are not lore.
*   **Concept art**: "Make concept art" on a proposal calls the art model chosen in Settings
    (`/api/v1/images`), with the style from Settings and the proposal's description. The picture is
    kept with the proposal; "Draw it again" replaces it. Each call is checked against the cap and
    logged.
*   **Keeping**: the author picks a folder; the proposal becomes a new entry there (its name, its
    description, and its picture embedded when there is one, the picture added to the images
    folder), and a marker linked to it is added to the map, all as drafts saved with the next
    version. The entry carries the origin `lore`. "Discard" throws a proposal away.
*   **API**: `GET /api/maps/:id/discoveries`, `POST /api/maps/:id/discover` `{ at, chronicle,
    year }`, `POST /api/maps/:id/discoveries/:d/art`, `GET` the same address for the picture,
    `POST /api/maps/:id/discoveries/:d/keep` `{ folder }`, `DELETE /api/maps/:id/discoveries/:d`.
*   **Settings**: a model for concept art, and the style, a paragraph added to every picture's
    description.
