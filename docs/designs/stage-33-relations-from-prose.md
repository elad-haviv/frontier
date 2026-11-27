# Stage 33: relations proposed from the prose

- **Author:** Elad Haviv
- **Status:** Approved on 2026-11-27 with every recommendation in "Decisions", after an independent
  design review.
- **Parents:** [Stage 3, field proposals](stage-3-review-and-ai-basics.md), [stage 31, people and projects](stage-31-people-and-projects.md),
  [stage 30, Trees](stage-30-trees.md)
- **Mockup:** https://claude.ai/artifact/9owyFyveeRL7DGLSJjzQJf (the inbox with its keys and "Is
  this Pell Holt?", a tree with proposals, the phone's One at a time, the Relations tab, and Find
  relations). Its proposal tab lists what the review changed.

## What's wrong today

1. **Families are already written, just not as relations.** "Wren was the elder daughter of Corin
   Vane and Ilsa Thorne" is in the prose, but a tree only shows an entry's `relations`. Typing
   hundreds by hand is why trees will stay empty.
2. **The AI proposes only dates and types.** Propose fields, the folder run and the inbox already
   ask for the exact sentence, check it, and change nothing until you accept.
3. **Proposals are only visible in the inbox**, away from the tree or entry where you would judge
   them.

## How the AI reads

- **One reading finds everything.** Propose fields, the folder run and "propose on each publish"
  find relations too, in the same request. The model is given the kinds of relation with their
  other words and both directions.
- **For each relation** the model gives the sentence; the exact words that state it, holding both
  the relation word and the name ("daughter of Corin Vane and Ilsa Thorne", not "and Ilsa
  Thorne"); whether the sentence **states** it or it is only **worked out**; who, the other
  parent, and `how` or `when`.
- **Checks before you see anything:**
  - the sentence is in the entry, the marked words are in the sentence, and they hold the name;
  - the word is a known kind;
  - `how` and `when` are kept only where their own words are in the marked part;
  - a relation already written, on either entry, drafts included, is left out;
  - a rejected relation is not proposed again while its sentence stays the same.
- **Who is matched to an entry:** by title, then by another name. Each proposal says how: "→
  entry", "→ entry, as 'Odo'", or "no entry yet". With no match, the closest entry is offered,
  "Is this Pell Holt?": a title that begins with the name as a first name, best when the rest of
  it is in the sentence or the entry. Edit's Who is the entry picker, with "no entry yet" as one
  choice.
- **One relation, one proposal.** When Wren's text and Corin's text state the same thing, the
  second reading is added to the first proposal as another sentence. Accept writes it once, on the
  entry chosen under "Saved on" (the first one read, unless changed), in that entry's direction.
- **Warnings** before you accept, from the dates: a child born when a parent was under 14, or
  more than a year after a parent died.

## Where you decide

- **The inbox.**
  - Relations sit beside dates under each entry: a RELATION tag, the relation in words with how
    it matched, the sentence with the words marked, and Accept, Edit and Reject. "Not said
    directly", a warning or no match are shown, and those come after the clear ones.
  - For many: "12 of 40 decided" with a bar; filters by kind (All, Relations, Dates and types),
    folder and tree; keys `j` and `k` to move, `a` to accept, `r` to reject, `e` to edit.
  - "Accept the 3 clear ones of 5" for one entry accepts only what is stated, matched and without
    a warning, in one change, with Undo. There is no whole-inbox accept.
- **Trees.** A proposed relation is a blue dotted line with a **?** on it; cards stay as they are,
  and someone in the tree only through proposals says "proposed" on their card. Each ? is reached
  with Tab, read out, and opens the proposal in the panel (accept, edit in place, reject, saved
  on which entry). "Proposed · 3" shows or hides them per tree, on by default. Proposals count in
  no check and in no "How are they related?". With more than 15, the ? marks give way to the
  count when zoomed far out.
- **One at a time** on the phone shows proposed people with "? proposed"; a tap opens the same
  sheet.
- **The Relations tab:** "Proposed from the text" (with Accept the clear ones) and "Proposed in
  other entries", with the same evidence. The sentences are marked in the entry's text while the
  tab is open.

## Find relations

On the Trees page, as a card shown while AI is set up and some entries were never read for
relations, and in a tree's tool row. The dialog picks a folder or the whole library and says how
many entries it reads, that the first run reads all of them (the instructions changed), the cost
with the model's name and what is left of the monthly cap, that dates and types are proposed too,
and roughly how many proposals to expect. Then a progress bar that keeps going if closed (it is the
run in Settings › Propose for a folder), and a summary with Review in the inbox.

## Empty and failure states

- No AI: Find relations and Propose fields are not shown; the Trees page says "Set up AI in
  Settings to have relations proposed from your entries."
- Nothing found: "No relations or dates found in 14 entries."
- A sentence that has since changed: "no longer applies", Dismiss only.
- The spending cap: the run stops and says so.
- Proposals are never exported, printed or shared.

## Decisions (as approved)

- **A.** One reading finds dates, types and relations; the first run after this change reads every
  entry once more, and the dialog says so.
- **B.** Proposals are drawn in trees with a ?, on by default, remembered per tree.
- **C.** Accept all per entry, the clear ones only, with Undo; no whole-inbox accept.
- **D.** A name with no entry is proposed as a name, after offering the closest match.

## As built

- **Server.**
  - `PROMPT_VERSION` is 2. The cache key also holds the kinds, so a kind made later asks again.
  - The answer's `relations` is read with `stated` and `words`, and checked in
    `apps/server/src/ai/relationProposals.ts` (`checkRelations`, `matchName`, `relationWarning`),
    pure functions with tests.
  - The operation is `add_relation`, in the same proposal files as dates, with `whoPath`,
    `match`, `maybe`, `words`, `stated` and `also` (the other entries' sentences). A rejection is
    kept as path, word, who and the sentence's hash.
  - `POST /api/proposals/:id/relations` accepts one or more relations of one entry in one change.
    `POST /api/proposals/undo` takes back the last such Accept if the entry has not changed since;
    a draft the Accept made is discarded.
  - "Already written" reads drafts as well as the library, so an accepted relation is not
    proposed again before it is saved as a version.
  - The entries read for relations are kept in `state/proposals/read-for-relations.json`, for the
    Trees page's count.
  - `/api/relations` gives `proposed`, in the facts' shape, and `unread`.
- **Browser.**
  - One component, `components/trees/ProposedRelation.tsx`, shows a proposal everywhere: inbox,
    tree panel, phone sheet and Relations tab.
  - The tree draws from a graph with proposals (`makeGraph(r, { proposed: true })`), and its
    checks and kinship use one without.
  - The ? marks are drawn above the cards, so a card's + never covers them.
  - The sentences are marked in the entry with the browser's highlights (`CSS.highlights`), so
    the text is not changed; browsers without them mark nothing.
  - The inbox's keys are in the "?" sheet under "Inbox".
- **Not built.**
  - The run's summary says how many proposals in all, not relations and dates apart.
  - The Trees page's card pictures show written relations only.
