# Stage 9 — Implementation readiness (raw)
B1 steps 5-6: device header written to disk unvalidated (path traversal); fetch throws on non-ISO-8859-1 names. Id format via makeId regex, reject else; absent -> `unknown`; encodeURIComponent name, cut 40; name origin + meta.
B2 step 9: attention() wrong place (VaultIndex has no drafts); build versions in routes/status.ts; StatusSnapshot.attention versions count (packages/schema/src/status.ts, status/status.ts); emit status after kept copy.
M3 step 2 wrong files: Save schemas local in routes/maps.ts, routes/chronicles.ts; LoadedMap in stores; api.ts client types.
M4 op for maps/chronicles: op param on saveFrom/serverChange, lastOp; repeat reply; stale extra when no draft.
M5 missing callers: History.tsx:49 saveDraft, Maps.tsx:45 saveMap; Edit.tsx delete draft (354) via queue?
M6 record lacks link (map/chronicle link arrays; fold by union), kind; sender owns merges; subscribe hands server value back.
M7 comments not queued (CommentsPanel.tsx:43).
M8 11a needs Shell.tsx: Ctrl+K listener, newEntry() prompt replaced, 401 login-over-page must be 11a, in-memory notice.
M9 Edit.tsx Delete/Discard (402-405) not moved; write.spec 141,147.
M10 e2e selectors: .save-saved used in ai.spec:318, mapstime 131-167, mapviews, maps, helpers.ts:112 — keep save-<state> classes; reader.spec:87 .tree-folder in 11c; step 49 list wrong (specs use page.goto); real: navigate.spec:27 Rename link.
M11 playwright.config.ts desktop testMatch only reader|chronicle|mapstime|mapviews; add shell, tree; project-specific skips.
M12 no preview route; previewRename gives paths only.
M13 folder routes lack request/response shapes; delete group mechanism; refusal codes.
M14 typeFromFolder signature; ai/fields.ts:185 caller; draft vs published folder file (CUJ1 needs draft); fields.test.ts 90% branch coverage.
M15 new-entry type: written in Edit.tsx (client builds text) or drafts route on create — pick.
M16 mergeItemLists id adapter; list icon names and colour hex values.
M17 publish.ts 90% branch coverage: publish.test.ts, lore tests.
M18 dependency versions/React 19 peers; fallback.
Nits: step 11 nothing to allow; versions response vs DraftVersion, api.ts type, hasVersions name; test file names + EventSource stubs; token hex values; NFR items w/o steps (lazy chunks, logout ask, write limit, offline move refusal); step 55 wording; web has no coverage thresholds.
