# Stage 8 — Intermediate zoom out (adopt / simplify / defer)

1 Blocker ADOPT small: CUJ3 fails today (drafts.ts:200 `invalid` before base check). Rule: no draft & rev>0: baseBlob differs -> kept copy + stale; matches -> fresh draft; missing -> today; deleted/renamed path -> stale kept. Unit test CUJ3.
2 Major: narrow G4 to entry text, maps, chronicles, folder file; comments/renames/deletes/apply-type direct online, refused offline; stage 15 decides.
3 Major: merge in sender with pure mergeMaps/mergeChronicles + stored base; defer item-file kept copies to 15; notice names clashed items; drop history link; MapPage not moved onto useItemFile.
4 Major SIMPLIFY delete: refuse folder delete while any file has unpublished draft or is image; drop delete Undo.
5 Major SIMPLIFY renames: refuse move while queue holds records under paths; disable settings/new subfolders of folder with pending rename; publishing a rename writes folders.json (built from schema if absent). Reject translation layer.
6 Major ADOPT: overlay folder types in readSchema (index/build.ts:145); drop step 54.
7 Major: delete drop rule; never drop lines; reject empty flag & import reconciler; restate Alt M.
8 Major: navigator.locks single sender; on stream error fetch /api/status once; 20 s heartbeat; IDB write every put; skip attention/backoff records; drop `slow`; reject shared stream & rolling median.
9 Major: one table of all ten findings with part/deferred stage; keep MO-1 in 11a; move MP-1/2 to stage 13 (author agreement needed, departs from brief); deploy fixes-only 11a first.
10 Major: honest rollback wording; merge kept copies before rollback; reject dual-writing content.v2.
11 Major: drop note record after stale (server stored copy) -> attention -> /versions/:id; small list of other-4xx records with Retry/Discard from unsent count (top bar in 11a); add step.
12 Major: short Risks table: iOS eviction (same as today, stage 15); device id in localStorage for fallback; versions/ bounded by merge; react-arborist React 19/row height/no touch -> 1-day spike, fallback plain list + Radix menu + Move to…; drop virtual-rows claim.
13 Nit: context paragraph + 3 terms (unsent, unpublished, kept copy); 11a marks in top bar line; own-library only-writer line; link parents.
14 Nit: reject preview endpoint; POST /api/renames returns affected; reword CUJ2.
15 Nit: one trade-off sentence per rejection; add 2 alts (key by draft id; polling vs SSE).
16 Nit: attention count in StatusSnapshot; device name from UA in meta; logout follow brief or record; zod checks in PUT /api/folders; mergeFolders path->id; constants to impl plan; keep confirm + Undo for moves.
