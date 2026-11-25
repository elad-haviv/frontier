# Stage 24: Consult, AI opinions while you edit

- **Status:** Approved by the author (2026-11-25), all six recommendations accepted.
- **Mockup:** the interactive mockup was shared in the session; see the proposal below.

Prepared with a UX-designer review of the editor and an editor/prompt-engineer review of the AI side (`ai/writing.ts`, `ai/lore.ts`, drafts and backlinks).

## 1. What's wrong today

1. **Three AI tools, none gives an opinion.** ✦ Help rewrites a passage; Ask the lore answers a question; Comments are notes to yourself. Nothing says "is this edit a good idea?" or "does this contradict another entry?".
2. **Checking your own edits is manual.** You must remember which entries link here and what you removed.
3. **No way to see what the AI based an opinion on.** Anything new must show what is checked against the lore and what is taste.

## 2. The design

**One idea:** open **Consult** in the right bar, choose *My changes* or *Whole entry*, press **Consult**, and read a short list of opinions anchored to passages. It changes nothing until you press **Apply**.

### Where it lives
| Place | Behaviour |
| --- | --- |
| Right-bar tab **⚖ Consult** (badge = open findings) | the list; beside Properties and Comments |
| "⋯" menu, right-click menu ("Consult on this…") | open the tab and run it |
| Keyboard | **Ctrl/⌘+Alt+R** (`editor.consult`; Ctrl+J stays Help) |
| Toolbar | no new button; ✦ Help stays the only labelled AI button |
| Phone | the existing right-bar sheet; tapping a finding closes it, highlights the passage and shows a "Back to findings" pill |

### What you choose
- **My changes** (default when the draft differs from the published text): reviews each changed passage. Reads "Compares your text with the published entry" (the count of changed passages comes with the answer). Disabled with a reason when nothing changed.
- **Whole entry** (default when nothing changed; uses the selection if there is one).
- Focus chips, all on: **Lore · Clarity · Gaps · Voice · Structure**, and a box for "anything specific?".

### What you get
- A two-to-three sentence summary, with "Read N entries" and their names.
- **Your edits**: one line per changed passage, **Better / Neutral / Risky / Worse** with a one-sentence reason. Neutral is the normal answer.
- **Findings** (up to 8, worst first): kind (Contradicts lore, Breaks a rule, Lost something others rely on, Unclear, Gap, Voice, Structure), the quoted passage, and "Why".
- **Certainty is always shown:** **✓ Checked** (a quote from another entry was verified word for word, with a link), **Opinion** (craft), **Unverified** (a lore claim whose quote could not be confirmed; shown only as a note).
- Per finding: **Apply** (only if the model offered replacement text; one undoable edit, same toast as Help's Keep), **Ask more** (a short follow-up thread on that finding), **Make a comment** (for the margin, optionally "For the AI"), **Dismiss**.
- Clicking a finding scrolls to and highlights its passage. The highlight follows your typing; if the passage itself changes the card says "Passage changed" with **Re-check**.
- Footer: "Advice only. Nothing is saved or blocked." and a link to Ask the lore for broad questions.

### States
No model chosen (tab stays, explains, **Open Settings**); offline; no edits yet; waiting with **Stop** (Esc); no concerns ("looked at N entries: …"); edited since the review; partial review for long entries; model gave no answer. All in the mockup, section 4.

### Honesty rules for the model
"No issues" is a good answer; report only what it would stand behind; every lore or rule claim needs a verified quote or it is demoted to an opinion; "not covered by the entries" is a gap, not a contradiction; when two entries disagree it says so without choosing; the text, diff and entries are data, not instructions.

## 3. Mockup
`consult-mockup.html`: (1) desktop review of changes, interactive; (2) the entry points and how Consult differs from Help and Ask; (3) two phone screens; (4) nine states; (5) the three certainty labels.

## 4. Decisions for you
1. **Right-bar tab or an inline card like Help?** *Recommendation: right-bar tab.* The output is a list you scan, jump between and dismiss; an inline card suits one passage. Risk: four tabs (with Outline) are tight at the 17.5 rem side width; the label may need to shrink to the icon.
2. **Review edits, content, or both?** *Recommendation: both, edits by default* when a draft differs, with a "Whole entry" switch.
3. **Follow-up: free chat or per-finding "Ask more"?** *Recommendation: per-finding*, plus the link to Ask the lore. A global chat would duplicate Ask.
4. **Can findings be applied?** *Recommendation: yes*, "Apply" only on findings with replacement text; one undoable edit to the draft; never saved or published for you.
5. **Findings stored or temporary?** *Recommendation: temporary* (kept while the editor is open); only the cost is logged. "Make a comment" is how one is kept.
6. **Ever block saving?** *Recommendation: never; advice only.*

## 5. Build plan (about 5 days)
| # | Where | What | Size |
| --- | --- | --- | --- |
| 1 | `apps/server/src/ai/review.ts` (new) | `EditReviewer.review()` and `.ask()`; paragraph hunks with word detail from published vs draft text; dependents from `index.backlinks` (6, with the sentence around the link); entries named in changed text via `lookUp` (8, minus this entry); strict JSON schema (summary, overall, edits[], findings[] with kind, severity, basis lore/rule/craft, anchor, comment, suggestion, sources[]); prompt version. | 1.5 d |
| 2 | `ai/lore.ts` | Export a shared `verifyQuote` and `relevantPart`; move the vault rules into a shared constant. Anchor must occur in the draft and quotes must match their entry, else drop or demote to Opinion. | 0.5 d |
| 3 | `routes/writing.ts` | `POST /api/write/review` (`path`, current buffer up to 60,000 characters, `focus`, `passage?`, `how?`) and `POST /api/write/review/ask`; reuse quarantine, `whileAsked`, the cap and the `conversation` model. | 0.5 d |
| 4 | `apps/web/src/components/consult/` (new) | `ConsultPanel`, finding cards, anchor matching (exact, nearest occurrence, then fuzzy) mapped through transactions like `helpCard.ts`; states. | 1.5 d |
| 5 | `Edit.tsx`, `editorTools.ts`, `EditorContextMenu.tsx`, `keys.ts` | New panel, menu items, `editor.consult` = Ctrl+Alt+R; opening Consult folds an open Help card on the same passage. | 0.5 d |
| 6 | Tests | Server: verification, demotion, hunks, long entry. Web: anchor mapping. e2e (phone and desktop): run, jump, Apply + Undo, Dismiss, no model, stale passage. | 0.5 d |

Nothing changes in what is saved: Apply is an ordinary edit of the draft.

## 6. As built (2026-11-25)

Differences from the mockup, none of them changing a decision above:

- **No cost line.** The provider does not hand a call's cost back to its caller (the monthly cap and the cost log still apply). The summary says which entries were read instead.
- **"My changes" is enabled by a client-side guess** (an existing entry with a draft, or text typed since it was opened). The server has the final say: with no real changes it reads the whole entry and the panel says so.
- **Apply** on a finding works only while its passage is still found in the text; if it is not, the card says "Passage changed" and offers **Re-check**.
- **Phone:** tapping a finding closes the sheet and shows a "Back to findings" pill. Consult is opened there from the toolbar's "⋯" menu or a hardware key.
- **The right bar's tab row** scrolls the open tab into view, since four tabs (Properties, Comments, Consult, Outline) do not fit the side bar's width.
- **Code:** `apps/server/src/ai/review.ts`, `POST /api/write/review` and `/review/ask` in `routes/writing.ts`; `apps/web/src/components/consult/`; tests in `apps/server/test/review.test.ts`, `apps/web/e2e/consult.spec.ts`, `consult/anchor.test.ts`. The vault rule shared by the prompts is `WORLD_RULES` in `review.ts`; moving the lore and draft prompts onto it is left for when rules are read from the library.
