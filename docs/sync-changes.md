# Changes to the Hindsight sync

For whoever maintains the sync agent on the Hermes box: the agent that ingests notes from
`elad-haviv/avalymia` into the `worldbuilding` memory bank on every push to `main`. These changes make
the bank hold reviewed canon only, as the Frontier design requires. They are specified in
[the Frontier design](designs/frontier.md) under "Quarantine" and in
[the stage 3 design](designs/stage-3-review-and-ai-basics.md) under "3d Quarantine". Frontier's side is
not built until these are made and tested with a real push.

## What changes

### 1. Skip changes that are not lore

Do not ingest a note when a push changed only:

*   its frontmatter (the block between the first two `---` lines), or
*   white space or line endings.

Frontier writes ids, types and dates into frontmatter. Those are not new lore, and ingesting them would
refill the bank with copies of unchanged text. Compare the note's body before and after the push, with
line endings normalised and trailing white space removed.

Ignore everything under `.frontier/` as content: it is never ingested. Two files there matter to the
sync and are described below.

### 2. Quarantine notes pushed by anyone but the author or Frontier

GitHub's push notification names the account that pushed (`pusher.name` and `sender.login`). Git itself
does not record this.

*   **Allowed accounts** are a setting of the sync: the author's GitHub account, Frontier's GitHub App
    if it has one, and the sync's own account.
*   When any other account pushes to `main`, every note (`.md` file outside `.frontier/`, `.obsidian/`,
    `.claude/`, `.gemini/`) that the push added, changed or removed is **quarantined**: it is not
    ingested, and what the bank already holds for it stays as it is.
*   A quarantined note stays quarantined when a later push by an allowed account touches it. Only a
    release (change 3) ends it.
*   A change to anything under `.frontier/` by an account that is not allowed is also a breach. Do not
    act on it: in particular, never read `review-state.json` as changed by such a push.

The sync keeps the list in the vault, in `.frontier/quarantine.json`, and pushes it to `main` only when
the list changes. It ignores its own pushes.

```json
{
  "version": 1,
  "notes": [
    {
      "path": "04 Inhabitants/Notable Individuals/Vyrinea Feim.md",
      "commit": "9f2c41d0…",
      "pushedBy": "hermes-agent",
      "at": "2026-11-21T10:02:11Z"
    }
  ]
}
```

*   `path`: the note's path in the vault.
*   `commit`: the **first** commit of the unreviewed push that touched this note, as a full hash.
    Frontier shows the author the difference that commit made, and a revert goes back to the note as it
    was at that commit's first parent. If the note is already quarantined, keep the existing entry.
*   `pushedBy`: the account name from the notification.
*   `at`: when the sync quarantined it, in UTC.

**A missed notification.** On every run, compare the last commit the sync processed with the head of
`main`. For a commit in between whose pusher the sync does not know, treat it as pushed by an unknown
account and quarantine its notes, with `pushedBy` set to `"unknown"`. The author then accepts them in
Frontier, which costs him a tap and keeps unreviewed text out of the bank.

### 3. Release a note when Frontier says so

Frontier records the author's decisions in `.frontier/review-state.json` and publishes that file:

```json
{
  "version": 1,
  "decisions": [
    {
      "path": "04 Inhabitants/Notable Individuals/Vyrinea Feim.md",
      "commit": "9f2c41d0…",
      "decision": "accepted",
      "at": "2026-11-21T10:30:00Z"
    }
  ]
}
```

When that file changes in a push by an allowed account, then for each decision whose `path` and
`commit` match an entry of `quarantine.json`:

*   `accepted`: remove the entry and ingest the note as it is on `main` now.
*   `reverted`: remove the entry. The same push restores the note's earlier text (or removes a note the
    unreviewed push created); ingest the note as it is on `main` now, or delete it from the bank if it
    is gone.

Then push the shortened `quarantine.json`. Frontier never writes to the bank and never writes
`quarantine.json`; the sync never writes `review-state.json`.

## The agents' own accounts

Quarantine can tell an agent from the author only by the account it pushes with. An agent that pushes
with the author's own token looks like the author and is never quarantined. For quarantine to cover the
Hermes agents they need a GitHub account or App of their own, and the token in `/opt/data/.env` must
belong to it. Until then the only protection is the rule in `AGENTS.md` that agents push
`proposal/<agent>/<topic>` branches and never `main`.

## Testing the changes

1.  With an agent account, push a commit to `main` that changes one note. `quarantine.json` gains one
    entry with that commit; the bank is unchanged.
2.  With the author's account, push a commit that changes only a note's frontmatter. Nothing is
    ingested and nothing is quarantined.
3.  In Frontier, accept the quarantined note and publish. The entry leaves `quarantine.json` and the
    note is ingested.
4.  Repeat step 1, then revert in Frontier and publish. The entry leaves `quarantine.json` and the bank
    holds the note's earlier text.
