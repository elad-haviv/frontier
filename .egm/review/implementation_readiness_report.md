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
# Stage 9 — Codebase details (raw)
B1 step 2 wrong files (route-local Save in routes/maps.ts:14, chronicles.ts:18; LoadedMap/LoadedChronicle in stores; web api.ts:404).
B2 queue can't carry map/chronicle `link` side channel + server-changed value + unlinked; chronicle.spec 313-353 tests it; senders own mergeMaps/mergeChronicles; return path to mounted page.
B3 device header path traversal; validate Id; absent id.
M4 tests: draft/second-version tests live in publish.test.ts:129-158 ({current, other}); ai.test.ts 361-370.
M5 step 5: published text source (extend PublishedInfo with text), server-made draft id/revision, op check before revision check.
M6 op on serverChange/saveFrom; chronicles makeMain caller (store.ts:222).
M7 attention versions in routes/status.ts + StatusSnapshot + status.ts.
M8 step 11 no-op; device name origin; Latin-1 header.
M9 Maps.tsx:45 saveMap, History.tsx:49 saveDraft.
M10 record kind; Discard -> queue.drop; Delete path.
M11 11a needs Shell.tsx/App.tsx: NewEntry unused, Ctrl+K listener, registry listener/KeySheet mount, notice, 401 login dialog file (Login is route today).
M12 Entry.tsx has no Delete; Delete/Discard in Edit.tsx:402-407; write.spec 150/141, helpers discardDraft, navigate.spec:27 Rename link.
M13 SaveStatus must keep selectors: .save-saved (helpers:111), .save-offline (write:136), .ch-saving texts (chronicle.spec x9), maps/mapstime/mapviews/ai specs.
M14 step 49 list wrong: passkey.spec:36 .topnav, reader.spec:86 .menu/.tree-folder, write.spec:41-43 .menu/.new-entry/answerDialog; library.spec:51 History link strict mode vs "History of the library".
M15 playwright.config.ts desktop testMatch; hover test only runs on phone project.
M16 web vitest env node: need jsdom/happy-dom or stubs.
M17 typeFromFolder third caller ai/fields.ts:185; fields.test.ts:112; 90% branch; draft folder type for CUJ1.
M18 type: on create written in Edit/NewEntry client or drafts route — not entries.ts.
M19 tree shows moved paths before publish -> links 404; map back or keep old path link.
M20 no preview route; planRename throws for folder only in folders.json — empty folder rename = line change only.
M21 mergeItemLists by id: key fn param or adapter.
M22 drop rule empty; GitHub/sample modes have outside renames (e2e changeFromOutside).
M23 useAsync already keeps value; list pages; failure keeps value + Problem.
M24 logout ask step.
Nits: 4 doc listeners not 8 + element onKeyDown; Mod-i basicSetup selectParentSyntax -> Prec.high, Esc-Tab built in; step 61 before 59; SITEMAP already lists; frontier.md buffer lines 376,553,1077,1183; token hex values; versions/React 19; clearPublished (publish.ts:137) must keep draft that only has versions.
# Stage 9 — Style on implementation plan (raw)
M1 step 55 drop rule ambiguous (and conflicts) — state outright (or remove per stage 8).
M2 Verification "top ten" check has no source/pass criterion.
M3 step 24 bundles five changes; split into sub-bullets, gloss codes.
Nits: `earlier` device id wording; "keys through the registry" verb; step 33 wording; slim line/footer refs; name non-goals/BACKLOG heading; step 58 wording; Why: lines inconsistent; terminology (response, side bar, UI string case); repeated op returns stored record no write; device id generated once in meta; build vs typecheck overlap; "each leaving every test green" -> must pass; drop EGM footer; "Later stages must build controls from these".
