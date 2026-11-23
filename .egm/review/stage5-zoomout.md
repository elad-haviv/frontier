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
