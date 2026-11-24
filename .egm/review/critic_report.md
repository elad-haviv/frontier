# Stage 7 — Design critic (raw)

B1 folder delete overwrites unpublished edit drafts with "" (drafts.ts:240, routes/drafts.ts:68); Undo discards -> edit lost; queue has no group; image drafts can't be saved as delete. Fix: delete intent separate (like renames), single server call/undo, image deletes defined.
B2 item-file merge needs mounted page; mine-wins overwrites other device's unpublished draft; history lacks drafts. Fix: merge in queue via itemFile merges; keep other side as version.
M3 server truth table gaps: CUJ3 phone has draftId+rev>0 after publish -> today `invalid` (drafts.ts:200) before base check; cases no-draft/rev>0/base equal; base missing; path deleted/renamed. Full truth table.
M4 queue keyed by path (same flaw as rejected Alt B); block moves while queue holds affected paths or rewrite keys via movedPath.
M5 multiple tabs = multiple senders; elect leader (Web Locks/BroadcastChannel).
M6 SSE behind auth: 401 looks like offline, signed-out undetected; no heartbeat, proxy idle timeouts flap; per-tab connection limit. Probe /api/status on error; heartbeat 15-25s; share stream.
M7 IDB write once/sec regresses from per-change; flush on pagehide/visibilitychange.
M8 iOS eviction already affects stage 11 queue: persist(), show not persisted, risk.
M9 no dry-run rename preview; previewRename returns string[] only; add POST /api/renames/preview with counts.
M10 rename before folders.json exists loses type; publish of folder rename writes folders.json.
M11 drop rule never fires; vault import changes paths -> ghost folders; explicit empty flag; import behaviour; restate Alt M.
M12 rollback untrue: old build ignores versions/ (publish unblocked), folder types; write legacy content.v2 during window or document.
M13 G4 overclaims (comments, renames, grouped delete).
M14 laptop notice has no delivery: StatusSnapshot lacks versions count; emit on stale; attention source.
M15 G3: actual listeners 4 doc/window + element onKeyDown (Switcher, Dialogs, Properties x2, MapTurn); library keys not in registry -> label-only entries.
M16 Risks section missing: multi-tab, eviction, SSE, versions growth with in-memory ids, react-arborist/react-dnd React 19 risk -> spike.
M17 alternatives rejected by naming author w/o trade-off.
M18 missing alternatives: polling heartbeat vs SSE; SW + Background Sync; key by draft/entry id; versions per op.
Nits: device name; op for item files (false "merged" notice); validate icon/color/type/order/size in PUT /api/folders; logout deviation; drag sets order too, undo reverts both; unbacked 60KB and thresholds.

# Stage 7 — Structural (raw)

M1 no Risks & Mitigations section: IDB quota/eviction, versions/ unbounded device ids, in-memory fallback, 401 pause forever, wrong auto-merge, mine-wins, stale folder lines, rollback after folders.json, bundle drift.
M2 alternatives rely on "rejected by author/reviewers" w/o link or trade-off (F, G, K, §7) — lead with trade-off, link brief section.
M3 top-ten table incomplete: item 4 (IA-1/2, MO-2) is 11b; item 9 (RD-1/2) deferred to 12; DI-1, ED-3, AX-2 unmapped. Table of all ten with part/stage.
Nits: label sections by part, move §9 to impl plan; relative links; emoji in ASCII diagram misaligned, ⌘K vs Ctrl+K; Open Questions -> Decisions w/ links; CUJs "Covers: G…", add delete/reorder CUJ or say tests only.

# Stage 7 — Style (raw)

M1 rollback claim overstated: old build can't see versions/, unsent IDB queue, empty folders, folder types — list or prevent.
M2 perf claims unmeasured: state today's size, limit, tree target.
M3 Alt E "largest single cost" uncalibrated.
M4 "keyboard and screen-reader support" not for lucide; "small, unstyled" unchecked.
M5 top ten vs 8 rows/13 IDs.
M6 "version" means conflict copy / Save a version / schema version — use "kept copy" for conflict.
M7 Older builds sentence unclear.
Nits: line 31 aside; line 35 README evidence; line 57 "rare" claim; "clear outline"->two-tone; reviewer agreement as reason; private window vague; "(a link is [[)"; "Without Undo"; "curated"/contrast wording; diagram "N kept" vs one per device; terminology drift toolbar/tool bar, note/entry, shortcut list/keys registry, save queue; "Rejected by the author"; top-bar links claim.
