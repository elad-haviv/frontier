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
