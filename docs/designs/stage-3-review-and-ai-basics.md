# Stage 3: review inbox, AI basics, structured fields

Status: Draft, 2026-11-21, revised after an implementation-readiness review. Author: Elad Haviv.
Parent: [Frontier](frontier.md).

## Overview

Stage 3 gives Frontier a place where every change the author did not type himself waits for his
decision. It adds the first AI feature, which proposes structured fields for an entry, and the parts
that later stages need: the connection to the AI provider with a spending cap, entry ids, the
quarantine of notes that reached `main` unreviewed, and passkey login.

This document fixes the formats and rules that the parent design left to stage 3. Where the two differ,
this document is the newer statement. It does not repeat the parent's reasons.

## What stage 3 delivers

The work is in five parts. Each part works on its own and is built and released in this order.

| Part | The author can | Depends on the author |
| --- | --- | --- |
| 3a Inbox for agent branches | See each `proposal/` branch as readable changes; accept, edit or reject each file | No |
| 3b Fields and ids | See an entry's type and dates as fields; edit them in the properties panel | No |
| 3c AI basics | Enter the provider key, choose a model, set a cap, see spending; ask for field proposals and decide each one in the inbox | An OpenRouter key |
| 3d Quarantine | See notes that arrived unreviewed; accept or revert each | The sync changes on the Hermes box |
| 3e Passkey | Log in with a passkey; switch the password off | No |

Stage 3 is done when CUJ 5 and CUJ 6 of the parent design work on the deployed app with the real vault,
and a test push by an agent account to `main` ends in a quarantined note that the author releases.

## Non-goals

*   Reading dates as numbers or placing them on a timeline. In stage 3 a date is text. Stage 5 reads it.
*   Lore conversations, character chat, discovery and the Hindsight client. They are stage 8.
*   Writing an `id` into any note. Stage 3 builds the mechanism; stage 4 is the first to use it.
*   A branch-protection rule on GitHub. See "Questions for the author".

## Rules shared by the parts

### Where a draft came from

A draft record gains `origins`, a list that is empty for a draft the author typed:

```json
"origins": [
  { "kind": "branch", "ref": "proposal/architect/vyrinea", "tip": "8a41…" },
  { "kind": "fields", "ref": "p4k2m9x0aa7q", "model": "…" }
]
```

*   **Groups.** Drafts that share a `branch` origin with the same `ref` form one Publish group, as the
    parent design requires for the files of one accepted proposal. A `fields` origin makes no group.
*   **Trailers.** The commit that publishes a draft with origins ends with one line per distinct origin:
    `Frontier-Proposal: <ref>`, followed for a `fields` origin by `Frontier-Model: <model>`.
*   **Record of acceptance.** The origin stays on the draft until the draft is published or discarded.
    After Publish, the trailer in the commit is the record that goal G8 checks.

### Changes the server makes to a draft

Accepting a field, and `ensureId`, change a draft from the server side. The rules:

*   The change increases the draft's revision, like a save, and the status event carries a counter of
    server-made draft changes. An open editor that sees the counter move asks for the entry again. With
    nothing unsent it shows the new text. With unsent text its next save is answered `stale_revision`
    and the two versions are merged by hand, as between two devices.
*   The change is refused with `not_allowed` and a reason when: the draft is a `delete` draft; the draft
    has a second version waiting to be merged; the note is read-only (mixed line endings); the note's
    frontmatter cannot be read.
*   A pending rename does not matter. Proposals and drafts name a note by its published path until the
    rename is published, and follow it then.

## 3a Inbox for agent branches

### Reading branches

*   Every fetch runs
    `git fetch --prune origin +refs/heads/main:refs/remotes/origin/main +refs/heads/proposal/*:refs/remotes/origin/proposal/*`.
    The `+` lets the local copy of a branch follow the remote when an agent rewrote its own branch. It is
    used in fetches only, never in a push. No other branch is read.
*   For a branch, the **fork point** is `git merge-base origin/main <branch>`. The changed files are
    `git diff --name-status --no-renames <fork> <branch>`. A file moved by the agent therefore shows as
    one removed file and one added file.
*   A branch with no fork point, or with more than 200 changed files, is listed with that fact and can
    only be rejected as a whole. A branch with no changed files is listed as "nothing to review" with a
    Remove action.

### What the author sees

One inbox page, `/inbox`. Agent branches are listed first, each with its name, its commit messages
(`git log --reverse --format=%s <fork>..<branch>`) and its files. Each file shows:

*   the kind: added, changed or removed;
*   the difference between the file at the fork point and the file on the branch, as on the Unpublished
    page; a new image shows as the image;
*   three actions: **Accept**, **Accept and edit** (notes only), **Reject**.

Frontier takes two kinds of file from an agent: notes (`.md`), added, changed or removed; and new images
(the formats the image server reads). A file the author may not take is shown with the reason and can
only be rejected:

| Case | Reason shown |
| --- | --- |
| Any other kind of file; an image that is changed or removed | Frontier takes notes and new images from agents |
| Path inside `.git`, `.obsidian`, `.claude`, `.gemini` or `.frontier` | Agents do not change these folders |
| An existing file under `99 Appendices` is changed or removed | Appendices are append-only |
| A new image whose name exists anywhere in the vault | An image of this name exists |
| The author has a draft or a pending rename of the same path | Publish or discard your own change first |
| The note has mixed line endings on `main` or on the branch | Read-only file |
| The note on the branch is not valid UTF-8 | Not readable as text |

A new image is not renamed to a free name, because the agent's note would then embed the wrong file.

### Decisions

*   `GET /api/inbox` gives each branch's `tip` and each file's `blob` on the branch. A decision carries
    that `blob` (a whole-branch reject or removal carries the `tip`). If the branch has moved and the
    blob or tip no longer matches, the server answers `proposal_moved` and the page loads the inbox
    again. The author therefore never accepts content he did not see.
*   **Accept** makes a draft of the file: `create` for an added file, `edit` for a changed one, `delete`
    for a removed one. For a note, the draft's base is the file's blob at the fork point, not at current
    `main`, so Publish merges it with what happened on `main` since, by the existing rules. Its line
    ending is the one the file has on the branch. A new image becomes a binary `create` draft.
    The draft gets a `branch` origin.
*   **Accept and edit** does the same and opens the editor on the draft.
*   **Reject** records the decision and makes nothing.
*   Decisions are kept in `/data/state/inbox/branches.json`:

    ```json
    {
      "proposal/architect/vyrinea": {
        "tip": "8a41…",
        "files": { "04 Inhabitants/…/Vyrinea Feim.md": { "decision": "accepted", "blob": "c07e…" } }
      }
    }
    ```

    When the branch moves, a file whose blob changed goes back to undecided; the others keep their
    decision.
*   When every file of a branch is decided, the server fetches once more. If the branch still has the
    recorded tip it deletes it with `git push origin :refs/heads/<branch>` and removes its record;
    otherwise it lists the branch again. This removes a branch; it is not a forced push. A push by the
    agent in the moment between that fetch and the deletion would be lost; the agent's rules say not to
    push to a branch under review. If the deletion fails the branch stays listed as "decided, could not
    be removed" with a retry.
*   Discarding an accepted draft does not bring the proposal back. The page says so before the last
    decision on a branch.

### Vault rules for agents

`AGENTS.md` and the Synchronization section of the vault's `README.md` change as the parent design
lists. The text is prepared on the `claude/vibrant-gates-ovwcp2` branch of `avalymia` for the author to
merge. Frontier does not depend on it: a branch pushed under any name starting with `proposal/` is read.

## 3b Fields and ids

### Shape in frontmatter

```yaml
id: k3f9x2ab
type: place
time:
  - what: founded
    when: "c. 340 EM"
  - what: destroyed
    when: "after [[The Nirani Exodus]], within a generation"
```

*   `id`: 8 characters from lower-case letters and digits. Optional. Never changed once written.
*   `type`: one name. Optional; without it the type comes from the folder. A name outside the schema is
    kept and shown with a mark; the properties panel lists it as one more choice.
*   `time`: a list. Each item has `what`, a name, and `when`, free text exactly as the lore puts it.
    `when` may contain wikilinks. Any other key of an item is kept and not read.
*   A value that does not fit (a `time` that is not a list, an item without `what` or `when`) is shown in
    the attention list under "fields that cannot be read". While an entry has such a problem with
    `time`, Frontier does not write its `time` key; the author corrects it in the text.

### Writing fields

*   `type` and `id` are written with the existing one-key writer.
*   `time` is written as a whole key: its lines are replaced by Frontier's standard form (block list,
    `what` then `when` then other keys, `when` in double quotes). No line outside the `time` key changes;
    the real-vault test asserts this. A comment inside the `time` list is not kept, which the properties
    panel says nowhere because no such comment exists today; the rule is recorded here.

### Schema

The schema says which types and `what` names exist. Frontier carries a built-in schema. If the vault has
`.frontier/schema.yaml`, that file is used instead. If that file cannot be read or has a `version` other
than 1, the built-in schema is used and the status page says why. Stage 3 does not create the file; the
settings page shows the schema in use as text to copy.

```yaml
version: 1
types:
  place: { folders: ["03 Gazetteer (Places & Locations)"] }
  person: { folders: ["04 Inhabitants/Notable Individuals"] }
  deity: { folders: ["04 Inhabitants/Deities", "04 Inhabitants/Archdemons"] }
  people: { folders: ["04 Inhabitants/Sapient Races"] }
  creature: { folders: ["04 Inhabitants/Creatures & Beastiary"] }
  group: { folders: ["05 Society & Culture"] }
  item: { folders: ["06 Compendium (Items & Mechanics)"] }
  event: { folders: ["02 History & Lore"] }
  concept: { folders: ["01 Universe & Concepts", "00 Overview"] }
what:
  born: { begins: true }
  founded: { begins: true }
  created: { begins: true }
  began: { begins: true }
  died: { ends: true }
  destroyed: { ends: true }
  ended: { ends: true }
  happened: {}
  changed: {}
```

*   An entry's type is its `type` field, or else the type whose folder is the longest match for its path,
    or else none. The folder names above exist in the vault (checked 2026-11-21).
*   Every `what` may be used with every type. A `what` outside the list is kept and shown with a mark.
*   `begins` and `ends` say which items open and close an entry's existence. Stage 5 uses them.

### Where fields show

*   **Reader:** a small block under the title with the type and each `time` item, with wikilinks in
    `when` working as links. An item proposed by the AI and not yet decided is shown here too, marked
    "proposed", as the parent design decided.
*   **Properties panel:** the type as a choice from the schema, and the `time` items as rows of
    `what` and `when`, with add and remove.
*   **Links inside `when`.** The link reader already reads the whole note, frontmatter included, so
    these links are indexed, appear in backlinks and are rewritten by a rename. One thing is added: a
    rename to a name containing `"` or `\` is refused, with the reason. Written into a link that sits
    in frontmatter, such a name would break the quoted text, and Windows, where the vault is also
    kept, does not allow either character in a file name. The entry response gives each `time` item
    its links with their resolution, so the reader can draw them.

### Ids

*   The index maps each `id` to its entry. Two entries with the same `id` are listed in the attention
    list as "same id in two entries". `GET /api/entries` accepts `id=` in place of `path=`.
*   `ensureId(path)` returns the entry's id, or makes one and writes it through a draft of that entry.
    Nothing calls it in stage 3 outside its tests.
*   A note renamed in Obsidian keeps its id, because the id is in the file.

## 3c AI basics

### Settings and secrets

The `Settings` schema in `packages/schema` is extended before anything else, because the current one
drops keys it does not know when the password is set. `settings.json` gains:

```json
{
  "ai": {
    "key": { "iv": "…", "data": "…", "tag": "…" },
    "models": { "extraction": "…" },
    "monthlyCapUsd": 10,
    "proposeOnPublish": false
  }
}
```

*   The provider key is encrypted with AES-256-GCM. The encryption key is the environment variable
    `SECRETS_KEY`, 32 bytes in base64. Without it, storing a key is refused with `secrets_key_missing`
    and the settings page says how to set the variable.
*   `OPENROUTER_API_KEY` in the environment is used when no key is stored. This suits a deployment
    where secrets are kept in Coolify.
*   The key is never sent to the browser. The settings page shows "set" and the last four characters.
    Sending `key: null` removes the stored key.
*   One model name per task. Stage 3 has one task, `extraction`. The settings page lists the models
    from OpenRouter's catalogue that support structured output, with their prices, and has a free-text
    field for any other name. There is no default model: the feature is off until the author picks one.
*   A "Test" button makes one call of a few tokens to the extraction model and reports the result and
    its cost.

### The provider interface

One function, `complete({ task, model, system, user, schema, entry? })`, is the only code that calls
OpenRouter. `schema` is a pair: a JSON Schema written by hand, and the zod schema that checks the answer.
It:

1.  refuses with `ai_off` when no key or no model is set;
2.  refuses with `ai_cap_reached` when this month's spending has reached the cap, with a message that
    states the cap, the amount spent and where to change it;
3.  calls `POST /api/v1/chat/completions` with `response_format` of type `json_schema`, no streaming, a
    60-second limit and one more attempt after a network error, a timeout or a 5xx answer;
4.  appends one line per attempt to `/data/state/ai-log/<yyyy-mm>.jsonl`:
    `{ at, task, model, promptTokens, completionTokens, costUsd, entry, ok, error? }`. `costUsd` is
    `usage.cost` from the answer, and 0 when no answer came;
5.  returns the parsed object, checked with zod. An answer that does not fit is `ai_bad_answer`; any
    other failure, including a model that refuses structured output, is `ai_failed` with the provider's
    message. Neither is retried.

The month is the calendar month in UTC. The month's spending is the sum of `costUsd` in its file, kept in
memory after the first read. The cap is Frontier's own; the hard limit is the one the author sets on the
key at OpenRouter. Tests use a stand-in for the HTTP call; no test calls OpenRouter.

### Field proposals

*   **Asked for** by a button on an entry ("Propose fields").
*   **After Publish**, when `proposeOnPublish` is on: for the notes whose own draft was published, not
    for notes that only had links rewritten. It runs after the publish call has answered. A failure
    shows in the status snapshot as the last AI error.
*   **For a folder**, from the settings page. The first call answers with the number of entries and an
    estimate (characters ÷ 4 × the model's input price, plus a fifth for output). The second starts a
    background job; one job runs at a time. The page shows progress, the entries that failed with the
    reason, and a Cancel button. The job stops at the cap. It is not resumed after a restart; running it
    again costs little because of the cache.
*   **Never read:** `99 Appendices`, `.frontier/`, drafts, and notes for which `aiMayRead` says no (see
    3d). The text sent is the published text of one entry, without its frontmatter.
*   **The request** gives the model the schema's types and `what` names and asks for
    `{ type, time: [{ what, when, quote }] }`. The instructions: take dates and time relations only from
    the text; write `when` in the entry's own words; give in `quote` the exact sentence it came from;
    invent nothing; an empty list is a good answer.
*   **Checks before anything is stored.** White space is collapsed before any comparison, and
    `quoteHash` is the SHA-256 of the collapsed quote. An item is dropped when:
    *   its `quote` is not found in the entry, or its `what` is not in the schema;
    *   the entry already has an item with the same `what` and `when`;
    *   a pending operation for the entry has the same `what` and `quoteHash`;
    *   the rejected list has the same path, `what` and `quoteHash`, whatever the `when`. A rejected date
        is therefore not proposed again until its sentence changes.

    A `type` is dropped when the entry has a `type` field, when it equals the folder's type, when it is
    pending, or when the rejected list has that path and type.
*   **Cache.** The answer is stored in `/data/state/ai-cache/<hash>.json`, the hash being the SHA-256 of
    the model, the prompt version, the schema text and the entry text.

### Proposal files

One file per entry, `/data/state/proposals/<id>.json`. A later run adds its operations to the entry's
existing file.

```json
{
  "id": "p4k2m9x0aa7q",
  "source": "fields",
  "path": "03 Gazetteer (Places & Locations)/…/Vel Aran.md",
  "createdAt": "2026-11-21T10:02:11Z",
  "operations": [
    {
      "id": "o1",
      "op": "add_time",
      "what": "founded",
      "when": "c. 340 EM",
      "quote": "Vel Aran was founded around 340 EM by…",
      "quoteHash": "…",
      "model": "…"
    },
    { "id": "o2", "op": "set_type", "type": "place", "model": "…" }
  ]
}
```

*   Stage 3 has two operations, `add_time` and `set_type`. Later stages add theirs to the same file form.
*   In the inbox each operation shows the quote, with a link to the entry, and **Accept**, **Edit** (change
    `what`, `when` or `type`, then accept) and **Reject**.
*   **Accept** applies the operation to the entry as it is now: to the author's draft when one exists,
    otherwise to a new draft made from `main`, by the rules under "Changes the server makes to a draft".
    The draft gets a `fields` origin. Nothing is published.
*   An `add_time` whose quote is no longer in the entry is shown as "no longer applies" and can only be
    dismissed.
*   **Reject** adds `{ path, op, what, quoteHash }` or `{ path, op, type }` to
    `/data/state/proposals/rejected.json`.
*   A decided operation is removed from the file, and the file with its last operation. When Frontier
    publishes a rename, proposal files and rejected entries move to the new path. When the entry is
    deleted they are removed. A rename made outside Frontier leaves them behind; they then show as "no
    longer applies".

## 3d Quarantine

The sync on the Hermes box decides what is quarantined; Frontier shows it and records the author's
decision. The parent design gives the order of events. This section fixes the files and Frontier's
behaviour. Quarantine covers notes only.

`.frontier/quarantine.json`, written only by the sync:

```json
{ "version": 1, "notes": [{ "path": "…", "commit": "9f2c…", "pushedBy": "hermes-agent", "at": "…" }] }
```

`.frontier/review-state.json`, written only by Frontier:

```json
{ "version": 1, "decisions": [{ "path": "…", "commit": "9f2c…", "decision": "accepted", "at": "…" }] }
```

*   `commit` is the first commit of the unreviewed push that touched the note. The **text before** is the
    note at that commit's first parent; the note may not exist there. `decision` is `accepted` or
    `reverted`.
*   Frontier reads `quarantine.json` whenever it builds the index. A listed note has the state
    `quarantined` in the tree and a banner in the reader with the pusher's name. All listed notes are
    also in the inbox, under the agent branches, each with the difference between the text before and
    the text at `commit`, and two actions.
*   A listed note that has a decision for the same path and commit, pending or published, is treated as
    released: no banner, state as any other note. `aiMayRead` allows it once an `accepted` decision is
    published.

### Decisions

*   A decision is first kept in `/data/state/quarantine/pending.json`:
    `[{ id, path, commit, decision, draftId?, at }]`.
*   **Accept** adds a pending decision.
*   **Revert** adds a pending decision and makes a draft, whose id it records:

    | The note at `commit` | The note before | Draft |
    | --- | --- | --- |
    | changed | existed | `edit`, content the text before, base the blob at `commit` |
    | new | did not exist | `delete`, base the blob at `commit` |
    | deleted | existed | `create`, content the text before |

    With the base at `commit`, Publish merges the undo with whatever happened to the note on `main`
    since, by the existing rules, so the author's own later edits are kept or shown as a conflict.
    Revert is refused with the reason when the author already has a draft of that note, or when the
    note is no longer at that path and the commit did not delete it; such a note can only be accepted.
*   A pending decision can be withdrawn, which also discards its draft.
*   **Publish.** `GET /api/unpublished` gains `decisions`, the plan request gains `decisionIds` and the
    plan answer lists them. A decision and its draft are one group. Publisher writes
    `.frontier/review-state.json` as the file on `main` plus the selected decisions, minus decisions
    whose note is no longer in `quarantine.json`. This is the only file outside the notes and images
    that Publisher writes.
*   After a fetch, a pending decision is removed once the file on `main` holds it, the same way
    published drafts are cleared, so a crash after the push leaves nothing behind.
*   A missing or unreadable `quarantine.json` means nothing is quarantined, and the status page says the
    file could not be read.

### The gap

Between an agent's push and the sync's list arriving, the note is on `main` and not yet listed. It is
closed on Frontier's side:

*   Frontier records the commits it pushed in `/data/state/pushed.json` (the last 200).
*   After a fetch that moved `main`, the notes touched by commits in the new range that are not in that
    record (`git log --name-only --no-renames`) are **settling** for 3 minutes. They are kept, each with
    its end time, in `/data/state/quarantine/settling.json`, so a restart does not reopen the gap.
*   `aiMayRead(path)` is false for a settling note, by the clock, and for a quarantined note that is not
    released. Every AI feature asks it. Settling is not shown in the tree; a "Propose fields" request for
    a settling note is answered with "this note just arrived; try again in a few minutes".
*   The author's own pushes from Obsidian settle too, which costs a short wait.

### Who Frontier is to the sync

Frontier may push with a token of the author's account or as its own GitHub App. Either works: the sync
releases a note when `.frontier/review-state.json` changes in a push by an allowed account, and both the
author and the App are allowed. No agent may write that file; the sync quarantines a change to
`.frontier/` by any other account like a change to a note.

### What the sync must do

Written for its maintainer in `docs/sync-changes.md` in this repository: the three changes of the parent
design; the two file forms above, with `commit` as defined here; and one rule for missed notifications:
a commit on `main` whose pusher the sync does not know is treated as pushed by an unknown account, and
its notes are quarantined.

## 3e Passkey

*   WebAuthn through `@simplewebauthn/server` and `@simplewebauthn/browser`. The relying party is the
    host of `PUBLIC_URL`; the expected origin is `PUBLIC_URL`. User verification is required.
*   `settings.json` gains `passkeys: [{ id, publicKey, counter, transports, name, addedAt }]` and
    `passwordOff: false`.
*   The challenge of a ceremony is kept in the signed session cookie with a 5-minute end time, for
    registration and for login alike. The session also records how the author logged in:
    `method: "password" | "passkey"`.
*   The settings page adds and removes passkeys, each with a name. Adding one needs a session.
*   The login page offers "Use a passkey" when at least one exists. The login `verify` call counts
    against the same limit as a password login (5 per 15 minutes per address, one shared counter); the
    `options` call does not count. The counter is Frontier's own: the rate-limit library counts each route
    separately.
*   `passwordOff` can be switched on only in a session whose `method` is `passkey`. The password then no
    longer logs in. `npm run set-password` on the server switches it back off, which is the way back in
    after losing the device. A deployment with passkeys and no password works the same way.

## API

All need a session except the two passkey login routes. New error codes: `ai_off` (409),
`ai_cap_reached` (402), `ai_failed` (502), `ai_bad_answer` (502), `secrets_key_missing` (409),
`not_allowed` (403), `proposal_moved` (409).

| Method and path | Body | Response | Part |
| --- | --- | --- | --- |
| `GET /api/inbox` | none | `{ branches: [{ name, tip, commits, state, files: [{ path, kind, binary, blob, blocked?, decision? }] }], proposals: [...], quarantine: [{ path, commit, pushedBy, at, kind, canRevert, pending? }] }` | 3a, 3c, 3d |
| `GET /api/inbox/branch-file?branch=&path=` | none | `{ before, after }` as text; a new image is fetched with `GET /api/images?branch=&path=` | 3a |
| `POST /api/inbox/branch-file` | `{ branch, path, blob, decision }`, `decision` being `accept` or `reject` | `{ draftId?, branchRemoved }` | 3a |
| `POST /api/inbox/branch` | `{ branch, tip, decision }`, `decision` being `reject` or `remove` | `{ branchRemoved }` | 3a |
| `GET /api/schema` | none | `{ text, builtIn, problem? }` | 3b |
| `GET /api/settings` | none | models, cap, `proposeOnPublish`, whether a key is set and its last four characters, whether `SECRETS_KEY` is set, spending this month, passkey names, `passwordOff` | 3c, 3e |
| `PUT /api/settings/ai` | `{ key?, models?, monthlyCapUsd?, proposeOnPublish? }` | `{ ok }` | 3c |
| `POST /api/settings/ai/test` | none | `{ ok, costUsd, message }` | 3c |
| `GET /api/ai/models` | none | `{ models: [{ id, name, promptPrice, completionPrice }] }`, cached for an hour | 3c |
| `GET /api/ai/log?month=` | none | `{ totalUsd, capUsd, calls: [...] }`, newest first, at most 200 | 3c |
| `POST /api/proposals/fields` | `{ path }` | `{ made }`, the number of new operations | 3c |
| `POST /api/proposals/job` | `{ folder, confirm? }` | without `confirm`: `{ entries, estimateUsd }`; with it: `{ started }` | 3c |
| `GET /api/proposals/job` | none | `{ state, folder, done, total, made, failed: [{ path, message }], stoppedBy? }` or `{ state: "none" }` | 3c |
| `DELETE /api/proposals/job` | none | `{ ok }` | 3c |
| `POST /api/proposals/:id/operations/:op` | `{ decision, what?, when?, type? }`, `decision` being `accept`, `reject` or `dismiss` | `{ draftId? }` | 3c |
| `POST /api/quarantine` | `{ path, commit, decision }` | `{ id, draftId? }` | 3d |
| `DELETE /api/quarantine/:id` | none | `{ ok }` | 3d |
| `POST /api/passkeys/register/options`, `…/verify` | WebAuthn | WebAuthn | 3e |
| `POST /api/passkeys/login/options`, `…/verify` | WebAuthn | WebAuthn; sets the cookie | 3e |
| `DELETE /api/passkeys/:id` | none | `{ ok }` | 3e |
| `PUT /api/settings/password-off` | `{ off }` | `{ ok }` | 3e |

Changes to existing answers:

*   `GET /api/entries` gains `id`,
    `fields: { type, typeFrom, typeKnown, time: [{ what, when, known, links }], proposed: [...], problems }`
    and, for a quarantined note that is not released, `quarantine: { commit, pushedBy, at }`.
*   `GET /api/unpublished` and the plan gain `decisions`; each draft gains `origins`.
*   `GET /api/attention` gains `unreadableFields: [{ path, problems }]` and
    `duplicateIds: [{ id, paths }]`.
*   The status snapshot gains `inbox: { branches, operations, quarantined }` (counts),
    `ai: { on, spentUsd, capUsd, lastError? }`, `serverDraftChanges` (a counter) and
    `problems: [text]` for an unreadable schema or quarantine file.

## Files

| File | What | Part |
| --- | --- | --- |
| `packages/schema/src/{state,api,errors,status}.ts` | `origins`; the extended settings; the shapes and codes above | all |
| `packages/vault/src/fields.ts` | Read `id`, `type`, `time`; write `type` and `time`; the schema type and the built-in schema | 3b |
| `packages/vault/src/rename.ts` | Refuse a name that would break a quoted link in frontmatter | 3b |
| `apps/server/src/git/gateway.ts` | Fetch and prune `proposal/*`; fork point; file lists; delete a branch; commits and their files in a range | 3a, 3d |
| `apps/server/src/inbox/branches.ts` | Branch list, blocked reasons, decisions, branch removal | 3a |
| `apps/server/src/state/drafts.ts` | Save a draft with a given base and origin; server-made changes | 3a, 3c |
| `apps/server/src/publish/publish.ts` | Groups and trailers from origins; `review-state.json`; pending decisions; the record of pushed commits; field proposals after Publish | 3a, 3c, 3d |
| `apps/server/src/index/build.ts` | Fields, ids, duplicates, quarantine state | 3b, 3d |
| `apps/server/src/state/secrets.ts`, `state/settings.ts`, `config.ts` | Encrypt and decrypt with `SECRETS_KEY`; the new settings; the new variables | 3c |
| `apps/server/src/ai/provider.ts`, `ai/log.ts`, `ai/models.ts` | The provider interface, cost log and cap, model list | 3c |
| `apps/server/src/ai/fields.ts`, `ai/job.ts` | The request, the checks, the cache; the folder job | 3c |
| `apps/server/src/proposals/store.ts` | Proposal files, applying operations, the rejected list | 3c |
| `apps/server/src/quarantine/quarantine.ts` | Read the list, pending decisions, the revert draft, settling, `aiMayRead` | 3d |
| `apps/server/src/auth/passkey.ts`, `routes/auth.ts`, `cli/set-password.ts` | Ceremonies; the session's `method`; the shared limit; switching the password back on | 3e |
| `apps/server/src/routes/{inbox,settings,ai,proposals,quarantine,passkeys}.ts` | The new routes | all |
| `apps/server/src/routes/{entries,drafts,images}.ts`, `status/status.ts`, `app.ts` | The changed answers; an image from a branch; the open routes | all |
| `apps/web/src/pages/Inbox.tsx`, `Settings.tsx` | The two new pages | 3a, 3c, 3d, 3e |
| `apps/web/src/components/Fields.tsx`, `Properties.tsx` | Field block in the reader; type and time rows in the panel | 3b |
| `apps/web/src/pages/{Entry,Edit,Login,Unpublished}.tsx`, `components/Shell.tsx` | Quarantine banner, reload after a server-made change, passkey button, review decisions, inbox count in the bar | all |
| `docs/sync-changes.md` | What the sync's maintainer changes | 3d |

New environment variables: `SECRETS_KEY`, `OPENROUTER_API_KEY` (optional). New packages:
`@simplewebauthn/server`, `@simplewebauthn/browser`.

## Risks

| Risk | Effect | Answer |
| --- | --- | --- |
| The model invents a date | A false field is proposed | Every item needs a quote found in the entry; the author decides each one; nothing is published without him |
| One call costs more than what was left under the cap | The cap is passed by one call | The cap is checked before each call; the hard limit is on the key at OpenRouter |
| An agent's branch touches many files | A long page | 200-file limit; reject as a whole |
| An agent pushes to its branch in the moment before Frontier deletes it | That push is lost | The tip is checked after a fresh fetch; the agent rules forbid pushing to a branch under review |
| The sync changes are not made | Quarantine never lists anything | Parts 3a, 3b, 3c and 3e do not depend on it; 3d is tested against hand-written list files and called done only after a real test push |
| `SECRETS_KEY` is lost | The stored provider key cannot be read | The author enters the key again; nothing else is encrypted |
| Passkey device is lost with the password off | No way in through the browser | `set-password` on the server |

## Verification

*   **3a:** server tests on a repository with proposal branches: added, changed and removed notes; a new
    image; every blocked case; a branch that moved after a decision and one that moved before the tap;
    an empty branch; branch removal; an accepted note merging with a later change on `main` at Publish;
    two accepted files held back together by one conflict; the trailer. One browser test of CUJ 6.
*   **3b:** vault tests for reading and writing fields, with the real-vault test asserting that writing
    `time` changes no line outside that key; a link in `when` rewritten on rename; the refused rename.
*   **3c:** provider tests with a stand-in HTTP server: the log line, the cap, a bad answer, the second
    attempt. Field tests: each dropped case, the cache, one file per entry, accept into an existing
    draft, each refusal, "no longer applies", the folder job with a cancel. One browser test of CUJ 5 up
    to the accepted field in the draft.
*   **3d:** tests with hand-written list files: state in the tree, accept, each row of the revert table,
    a revert merging with a later edit, the grouped publish, clearing after a crash, settling across a
    restart, and `aiMayRead`.
*   **3e:** server tests of both ceremonies with a software authenticator; a browser test using
    Chromium's virtual authenticator; the shared limit; `set-password` keeping the other settings.

## Questions for the author

None of these blocks parts 3a, 3b or 3e.

1.  **OpenRouter key and model.** Part 3c is built and tested without a key; it does nothing on the
    deployed app until a key and a model are set there.
2.  **Which account do the Hermes agents push with?** If they use the author's own token, the sync
    cannot tell them from the author and quarantine never applies to them. They need their own GitHub
    account or App for quarantine to mean anything.
3.  **A GitHub rule protecting `main`.** Rules on a private repository need a paid GitHub plan. If the
    author has one, a rule that lets only him and Frontier push to `main` stops the breach at its source
    and makes quarantine a second line. Frontier does not depend on it.
4.  **Obsidian and links inside `when`.** With Obsidian open: rename a note that a `when` text links to,
    and see whether Obsidian rewrites the link. If it does not, the link shows as unresolved in Frontier
    and the author picks the target, as the parent design accepts.
