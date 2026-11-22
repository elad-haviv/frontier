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
