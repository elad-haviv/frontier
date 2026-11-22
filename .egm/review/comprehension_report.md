# Stage 6 — Comprehension test

**What this proposes**

Stage 11 is the first of five stages reworking Frontier's interface and preparing it for offline use, shipped in three parts. 11a fixes the top UX review findings and builds four foundations: one browser-side save queue in IndexedDB (each change carries its starting version and a retry id); server-side refusal of stale saves, keeping one conflicting version per device instead of one spare slot; one connection-state service fed by the server's status stream; shared UI pieces (icons, tooltips, menus, combobox, keys registry). 11b replaces the top bar with a collapsible left side bar and a tabbed, resizable right side bar (drawer and bottom sheet on phones). 11c makes folders editable, with icon, colour, order and default type in a versioned `.frontier/folders.json` that also takes over folder-to-type mapping from `schema.yaml`.

**How the existing system works, per this document**

A web app plus server for editing a library of entries exportable to Obsidian. Changes become server drafts, published by "Save a version". Each page saves on its own path today (localStorage buffer with 5 s retry for text; in-browser item merge with an in-memory base for maps and chronicles); the server keeps one `content.v2` slot; saves don't name their base, so old text can overwrite newer text. Navigation is eleven top links; folders exist only through their files; keys spread over eight listeners; the status stream is unused.

**Findings**

1 Major: never says what Frontier/library is and its relation to Obsidian and Git — add context paragraph.
2 Major §2: draft/publish model undefined (draft, draftId, revision, publish vs Save a version, blob) — add "Drafts and versions today".
3 Major: unsaved/unsent/unpublished/saved used inconsistently — define "unsent" (device queue) and "unpublished" (server draft) and use throughout.
4 Major G1/§8: "top ten" vs 8 rows/14 IDs, IDs unexplained, review unlinked — list the ten with IDs, link review.
5 Major line 229: merged resend's baseBlob/revision unspecified (loop risk); say browser reloads file+blob, merges, updates base/baseBlob/revision; maps/chronicles keep no server version.
6 Major G5 vs §1: only notes kept as versions; limit G5.
7 Major: needs-attention record lifecycle; "waiting changes" list UI not built by any step.
8 Major: 11a features reference side bar that arrives in 11b; say where they show in 11a.
9 Major: "only writer" vs hand-edited schema.yaml / Obsidian — restate own-library rule.
10 Major: rename intent undefined.
11 Major: chronicles, inbox, Ask, Gallery, Writing help, attention undefined — gloss.
12 Nit: Frontier-Device-Name origin.
13 Nit: op per new value; lastOp on first-save draft.
14 Nit: why append-only/mixed endings block delete; define delete draft.
15 Nit: listener count vs Switcher.
16 Nit: define default type at G8.
17 Nit: define folder note.
18 Nit: "master design (frontier.md)".
19 Nit: logout-asks step missing.
