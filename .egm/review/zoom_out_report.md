# Stage 5 — Zoom out (raw)

Verified claims match code.
1 Major §2 steps 5,7,55: base/op checks written 3-4 times; put once in DraftStore.saveFrom/serverChange; extract shared item-file store from maps/chronicles and build folders on it.
2 Major §1 item-file stale row: queue merge needs no mounted page — senders call pure mergeMaps/mergeChronicles/mergeItemLists; useItemFile stays the one hook (backed by queue); move MapPage onto useItemFile; limit/drop useQueued.
3 Major §7 steps 54,58: migration switches silently by time; typeFromFolder callers unlisted (ai/fields.ts:185, routes/entries.ts:60). Overlay folder types in readSchema (index/build.ts:145), drop step 54; write folders.json once at deploy or remove schema lists in same version.
4 Major steps 24-25,46 vs brief: map hover/selection added to 1618-line MapPage before split. Split first in 11a, or keep 11a to MO-1 and move MP-1/2 to stage 13.
5 Major: split 11a into fixes-only and foundations, deployed separately.
6 Major G1/§8: not all top ten covered (RD-1/2, Duplicate/Copy link, Live|Source toggle ED-3, Mod-Enter, map tool keys, AX-2 disabled states). List closed vs deferred with stage.
7 Major G4 comments in queue but no step; drop from G4 (stage 15) or add.
8 Major NFR logout keeps queue contradicts brief (warn then wipe).
9 Nit drop `slow`; one owner for signed-out.
10 Nit device name origin unspecified; derive from user agent, store in meta.
11 Nit three guards on move (confirm, toast, unpublished) — keep one.
12 Nit moved unpublished folder settings path; mergeItemLists keyed by id -> adapter.
13 Nit constants in architecture -> move to implementation plan.
14 Nit react-arborist costs: fixed row height/container, react-dnd no touch, React 19 support; virtual rows unneeded; name fallback.

# Stage 5 — Inventive catalyst (raw)

1 Major §6 lines 359-369/step55: drop rule vs empty-folder definition contradict -> phantom folders keep stale types (vault re-import, mine-wins resurrecting). Fix: explicit `empty: true`; import reconciles & reports dropped lines.
2 Major §6 rename row/tree pending/§7: folder file rewritten only at publish; edits to moved folder before publish (style, subfolder, new entry type) target which key? Fix: translation layer applying pending intents to folder paths on read and mapping writes back; or rewrite folder-file draft when intent created, restore on undo.
3 Major §1 Sending: head-of-line blocking; per-key order and back-off; global pause only on offline/401; skip needs-attention; state needed cross-key orderings.
4 Major §1 stale note row: queue record never cleared after server stored version; Retry recreates conflict. Fix: stale_revision (version stored) acknowledges -> drop record, point to /versions/:id.
5 Major §1 item-file clash keeps mine; other side's unpublished items lost, contradicts G4/CUJ3. Fix: store losing side as device version for item files, list in attention.
6 Major G4 vs key table: comments, renames, folder delete, apply-type sent directly, outside queue. Narrow G4 or queue intents with op.
7 Nit undo 10s only; list rename intents/grouped deletes in unsaved list with Discard.
8 Nit in-memory fallback new device id per reload; keep id in session/localStorage.
9 Nit fixed slow thresholds flip; use TTFB of light requests / rolling median.
