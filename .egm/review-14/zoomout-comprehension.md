# Stage 14 — zoom out + inventive + comprehension (raw)

Premise correction: entry-page backlinks are published-only (routes/entries.ts:157); tree doesn't show rename intents yet (11c will).
M1 re-cut 14a minimum: endpoint, canvas, hover, select, open, Entries list, find, folder filter; local graph 14a or alone in 14b; rest later polish.
M2 overlay too far; graph vs backlinks disagree. Use published links + edited note's own outbound via analyse; or overlay both. Reuse overlay() from entries.ts:45.
M3 drop ETag/memo/gzip; rebuild per request; compression app-wide if wanted.
M4 drop worker; main-thread time-sliced ticks; relax 2s budget.
M5 drop stored positions; seed start by path hash.
M6 auto colour per top-level folder from unused palette colours; neutral when exhausted.
M7 drop CI wall-clock budgets & prod test hooks; keep tick-count test; hand iPhone check; hooks test-only or drive via ?focus and list.
M8 reuse geo flat view (zoomAt, panBy, centreOn); shared pointer hook or say copy.
Nits: drop direction-cone arrows; one selection surface (canvas card); defer node drag; drop unused fields (edge count, links, version); local graph alone in 14b, facets optional, drop search dimming; link stage 11 §6 for folder file; define terms; one bundle limit; local graph appendix rule; 14b depends on stage 12 entry tabs.
