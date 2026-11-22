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
